import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL);
assert(["postgres:", "postgresql:"].includes(url.protocol)
  && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.search && !url.hash,
  "Use an isolated loopback PostgreSQL server");
const name = `email_retirement_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: url.href });
url.pathname = `/${name}`;
const owner = new pg.Client({ connectionString: url.href });
let created = false;

try {
  await admin.connect();
  for (const role of ["anon", "authenticated"]) {
    await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$`);
  }
  await admin.query(`create database ${name} encoding 'UTF8' template template0`);
  created = true;
  await owner.connect();
  await owner.query(readFileSync(new URL("../supabase/tests/local_platform.sql", import.meta.url), "utf8"));
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = readdirSync(dir).filter(file => file.endsWith(".sql")).sort();
  const retirement = files.findIndex(file => file.endsWith("_retire_application_email.sql"));
  assert(retirement > 0);
  const migrate = file => owner.query(readFileSync(new URL(file, dir), "utf8"));
  for (const file of files.slice(0, retirement)) await migrate(file);

  const recipient = randomUUID();
  await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,'email-retirement@example.invalid',now())", [recipient]);
  const delivered = randomUUID();
  await owner.query(`insert into private.email_deliveries(recipient_id,template,due_at,status)
    values ($1,'order_accepted.v1',now(),'queued'), ($1,'order_message.v1',now(),'retry')`, [recipient]);
  await owner.query(`insert into private.email_deliveries(id,recipient_id,template,due_at,status)
    values ($1,$2,'order_accepted.v1',now(),'delivered')`, [delivered, recipient]);

  for (const file of files.slice(retirement)) await migrate(file);
  const { rows } = await owner.query(`select template,status,last_error from private.email_deliveries
    where recipient_id=$1 and id<>$2 order by template`, [recipient, delivered]);
  assert.deepEqual(rows, ["order_accepted.v1", "order_message.v1"].map(template => ({
    template, status: "suppressed", last_error: "application_email_retired",
  })));
  assert.equal((await owner.query("select status from private.email_deliveries where id=$1", [delivered])).rows[0].status, "delivered");
  const { rows: [state] } = await owner.query(`select
    to_regprocedure('public.btp11_claim()') is null as worker_removed,
    to_regprocedure('public.btp11_operator_action(uuid,uuid,text)') is null as replay_removed,
    to_regprocedure('public.set_notification_preference(text,boolean)') is null as preferences_removed,
    not exists(select 1 from private.notification_rules where email_mode<>'in_app_only') as in_app_only`);
  assert.deepEqual(state, { worker_removed: true, replay_removed: true, preferences_removed: true, in_app_only: true });
  console.log("PASS upgrade retires queued application email, preserves delivery history and disables worker, replay and preferences");
} finally {
  await owner.end();
  if (created) await admin.query(`drop database ${name} with (force)`);
  await admin.end();
}
