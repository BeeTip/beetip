import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { notificationRegistry } from "../packages/validation/src/notifications.ts";

const connection = process.env.BEETIP_LOCAL_DATABASE_URL;
assert(connection, "Set BEETIP_LOCAL_DATABASE_URL to the disposable Supabase database");
const url = new URL(connection);
assert(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && !url.search,
  "Use a disposable loopback Supabase database");
const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
const migrations = new URL("../supabase/migrations/", import.meta.url);
const tests = new URL("../supabase/tests/", import.meta.url);

try {
  await client.connect();
  const versions = readdirSync(migrations).filter(file => /^\d+_.+\.sql$/.test(file)).map(file => file.split("_")[0]).sort();
  const applied = await client.query("select version from supabase_migrations.schema_migrations order by version");
  assert(versions.length > 0, "Expected repository migrations");
  assert.deepEqual(applied.rows.map(row => row.version), versions, "Local migration history differs from repository");
  console.log(`PASS ${versions.length} migrations applied to fresh Supabase`);

  const unprotected = await client.query(`
    select relname from pg_class
    where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') and not relrowsecurity
    order by relname`);
  assert.deepEqual(unprotected.rows, [], "Public tables must enable RLS");
  const claim = await client.query(`
    select
      has_function_privilege('anon', rpc, 'execute') as anon,
      has_function_privilege('authenticated', rpc, 'execute') as authenticated,
      has_function_privilege('service_role', rpc, 'execute') as service_role
    from (values ('public.claim_affiliation_upload(uuid,uuid,text)'::regprocedure)) as f(rpc)`);
  assert.deepEqual(claim.rows, [{ anon: false, authenticated: false, service_role: true }],
    "Only the service role may call the affiliation upload claim among API roles");
  console.log("PASS public table RLS and affiliation upload claim grants");

  const { rows } = await client.query(`
    select event_type, recipient_rule as recipients, target_kind as target, template, title,
      email_mode as email, implemented
    from private.notification_rules`);
  const sqlRegistry = Object.fromEntries(rows.map(({ event_type, ...rule }) => [event_type, rule]));
  assert.deepEqual(sqlRegistry, notificationRegistry, "Migrated notification rules differ from TypeScript");
  console.log(`PASS ${rows.length} migrated notification rules match TypeScript`);

  for (const file of readdirSync(tests).filter(name => name.endsWith(".sql") && name !== "local_platform.sql").sort()) {
    try {
      await client.query(readFileSync(new URL(file, tests), "utf8"));
      console.log(`PASS ${file}`);
    } catch (error) {
      throw new Error(`SQL suite failed: ${file}`, { cause: error });
    }
  }
} finally {
  await client.end();
}
