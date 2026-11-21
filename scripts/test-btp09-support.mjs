import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55486/postgres");
assert(["postgres:", "postgresql:"].includes(url.protocol)
  && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.search && !url.hash,
  "Isolated local databases without connection overrides only");
const name = `btp09_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: url.href });
const clients = [];
let database;

async function connect(actor, aal = "aal2") {
  const client = new pg.Client({ connectionString: database, statement_timeout: 10000 });
  await client.connect();
  clients.push(client);
  if (actor) {
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)",
      [JSON.stringify({ sub: actor.id, session_id: actor.session, role: "authenticated", aal })]);
  }
  return client;
}

async function value(client, sql, params = []) {
  return (await client.query(sql, params)).rows[0]?.result;
}
const cases = (client, before = null, id = null) => value(client, "select public.btp09_cases($1,$2) result", [before, id]);
const open = (client, operation, body, category, order = null) =>
  value(client, "select public.btp09_open($1,$2,$3,$4) result", [operation, body, category, order]);
const history = (client, id, before = null, order = false) =>
  value(client, "select public.btp09_history($1,$2,$3) result", [id, before, order]);
const act = (client, id, action, version, assignee = null, reason = null) =>
  client.query("select public.btp09_act($1,$2,$3,$4,$5)", [id, action, version, assignee, reason]);
const send = (client, id, body, message = randomUUID()) =>
  value(client, "select public.btp09_send($1,$2,$3) result", [id, message, body]);
const read = (client, id, sequence) => client.query("select public.btp09_read($1,$2)", [id, sequence]);
const denied = (request, pattern = /PERMISSION:/) => assert.rejects(request, pattern);
const pass = message => console.log(`PASS ${message}`);

try {
  await admin.connect();
  for (const role of ["anon", "authenticated"]) {
    await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$`);
  }
  await admin.query(`create database ${name} encoding 'UTF8' template template0`);
  const target = new URL(url);
  target.pathname = `/${name}`;
  database = target.href;
  const owner = await connect();
  await owner.query(readFileSync(new URL("../supabase/tests/local_platform.sql", import.meta.url), "utf8"));
  const migrationDir = new URL("../supabase/migrations/", import.meta.url);
  const migrations = readdirSync(migrationDir).filter(file => file.endsWith(".sql")).sort();
  const boundary = migrations.indexOf("20261119000900_btp09_private_support.sql");
  assert(boundary > 0);
  async function migrate(files) {
    for (const file of files) await owner.query(readFileSync(new URL(file, migrationDir), "utf8"));
  }
  await migrate(migrations.slice(0, boundary));

  async function fixture(label, role) {
    const actor = { id: randomUUID(), session: randomUUID() };
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [actor.id, `btp09-${label}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [actor.session, actor.id]);
    if (role) {
      await owner.query("insert into public.staff_roles(member_id,role) values($1,$2)", [actor.id, role]);
      await owner.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [randomUUID(), actor.id]);
    }
    return { ...actor, client: await connect(actor, role ? "aal2" : "aal1") };
  }
  const requester = await fixture("requester");
  const counterparty = await fixture("counterparty");
  const first = await fixture("first", "support");
  const second = await fixture("second", "support");
  const lead = await fixture("lead", "platform_admin");
  const finance = await fixture("finance", "finance_operation");
  const secondAal1 = await connect(second, "aal1");
  const legacyId = randomUUID();
  const legacy = await value(requester.client, "select public.open_support($1,'Legacy help') result", [legacyId]);
  const legacyMessage = await value(owner, "select id result from public.messages where conversation_id=$1", [legacy]);
  await owner.query(`insert into public.conversation_members(conversation_id,member_id,role,granted_at)
    values($1,$2,'support',now()-interval '1 day'),($1,$3,'support',now())`, [legacy, first.id, second.id]);
  await migrate(migrations.slice(boundary));

  assert.equal(await value(requester.client, "select public.open_support($1,'Legacy help') result", [legacyId]), legacy);
  assert.equal((await history(requester.client, legacy)).messages[0].id, legacyMessage);
  assert.equal((await send(second.client, legacy, "Legacy reply")).sequence, 2);
  await denied(history(first.client, legacy));
  assert.equal(await value(owner, "select count(*)::int result from private.audit_events where target_id=$1 and event_type='support_migration_revoked'", [legacy]), 1);
  assert.equal(await value(owner, `select count(*)::int result from private.notification_delivery_intents d join public.notifications n on n.id=d.notification_id
    where n.target_id=$1 and n.event_type='support_opened' and d.channel='email' and d.status='pending'`, [legacy]), 0);
  pass("migration preserves legacy case, message, operation retry and sequence while auditing duplicate assignment cleanup");

  const listing = randomUUID();
  await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
    values($1,$2,'request','Support order','Warung','Makanan','Alam Sutera','Private','[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',20000,5000,5000,false,1,150000,
    now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, requester.id]);
  const order = await value(counterparty.client, "select public.accept_order($1,$2,1,null,null) result", [randomUUID(), listing]);
  await value(counterparty.client, "select public.btp08_send($1,$2,'Order-private content') result", [order, randomUUID()]);
  const orderConversation = await value(owner, "select conversation_id result from public.orders where id=$1", [order]);
  await owner.query("update public.members set status='pending' where id=$1", [requester.id]);
  const operation = randomUUID();
  const caseId = await open(requester.client, operation, "Private case content", "order", order);
  assert.equal(await open(requester.client, operation, "Private case content", "order", order), caseId);
  await denied(open(requester.client, operation, "Different body", "order", order), /CONFLICT:/);
  await denied(open(finance.client, randomUUID(), "Invalid reference", "order", order));
  await denied(history(counterparty.client, caseId));
  await denied(history(lead.client, caseId));
  await denied(history(secondAal1, caseId));
  await denied(act(secondAal1, caseId, "claim", 0));
  await denied(act(finance.client, caseId, "claim", 0));
  await denied(history(finance.client, caseId));
  assert.deepEqual((await cases(finance.client)).queue, []);
  const queue = (await cases(first.client)).queue.find(row => row.id === caseId);
  assert.deepEqual(Object.keys(queue).sort(), ["category", "id", "updatedAt", "version"]);
  assert(!(await cases(first.client, queue.updatedAt, queue.id)).queue.some(row => row.id === caseId));
  assert.equal(await value(first.client, "select count(*)::int result from public.messages where conversation_id=$1", [caseId]), 0);
  assert.equal(await value(owner, `select count(*)::int result from private.notification_delivery_intents d join public.notifications n on n.id=d.notification_id
    where n.target_id=$1 and n.event_type='support_opened' and d.channel='email'`, [caseId]), 0);
  pass("pending requester retains support, order counterparty is excluded, and MFA queue exposes category metadata with in-app-only alerts");

  const contenders = [first, second];
  const claims = await Promise.allSettled(contenders.map(actor => act(actor.client, caseId, "claim", queue.version)));
  assert.equal(claims.filter(result => result.status === "fulfilled").length, 1);
  assert.match(claims.find(result => result.status === "rejected").reason.message, /CONFLICT:/);
  const winner = contenders[claims.findIndex(result => result.status === "fulfilled")];
  const replacement = contenders.find(actor => actor !== winner);
  assert.equal((await history(winner.client, caseId)).messages[0].body, "Private case content");
  await denied(history(replacement.client, caseId));
  await denied(history(winner.client, caseId, null, true));
  await denied(act(winner.client, caseId, "reassign", 1, replacement.id, "Shift coverage"));
  const replyId = randomUUID();
  const [replyA, replyB] = await Promise.all([
    send(winner.client, caseId, "Operator reply", replyId),
    send(await connect(winner), caseId, "Operator reply", replyId),
  ]);
  assert.equal(replyA.id, replyB.id);
  assert.equal(replyA.sequence, 2);
  await denied(send(winner.client, caseId, "Different body", replyId), /CONFLICT:/);
  const before = await send(requester.client, caseId, "Before reassignment");
  assert.equal((await history(requester.client, caseId)).messages.length, 3);
  await read(requester.client, caseId, 3);
  await read(requester.client, caseId, 1);
  await denied(read(requester.client, caseId, 4), /VALIDATION:/);
  assert.equal(await value(owner, "select last_sequence::int result from public.conversation_reads where conversation_id=$1 and member_id=$2", [caseId, requester.id]), 3);
  assert.deepEqual(await value(owner, "select array_agg(recipient_id) result from public.notifications where event_id=$1", [before.id]), [winner.id]);
  assert.deepEqual(await value(owner, "select array_agg(recipient_id) result from public.notifications where event_id=$1", [replyA.id]), [requester.id]);
  const replyNotice = await value(owner, "select id result from public.notifications where event_id=$1", [replyA.id]);
  assert.equal(await value(requester.client, "select public.notification_target($1) result", [replyNotice]), `/support?case=${caseId}`);
  await denied(value(counterparty.client, "select public.notification_target($1) result", [replyNotice]));
  pass("exactly one concurrent claimant, stable message retry and committed sequence, monotonic read cursor, and no self-notifications");

  await act(winner.client, caseId, "escalate", 1, null, "Review order coordination");
  await denied(act(lead.client, caseId, "grant_order", 1, null, "Stale record"), /CONFLICT:/);
  await act(lead.client, caseId, "grant_order", 2, null, "Review coordination");
  assert.equal((await history(winner.client, caseId, null, true)).messages[0].body, "Order-private content");
  assert.equal(await value(winner.client, "select count(*)::int result from public.messages where conversation_id=$1", [orderConversation]), 0);
  await denied(value(winner.client, "select public.btp08_history($1) result", [order]));
  await denied(value(winner.client, "select public.btp08_send($1,$2,'Read grant is limited') result", [order, randomUUID()]));
  await denied(history(requester.client, caseId, null, true));
  await denied(history(lead.client, caseId, null, true));
  await denied(history(finance.client, caseId, null, true));
  assert.equal(await value(owner, `select count(*)::int result from private.audit_events
    where target_id=$1 and actor_id=$2 and event_type='support_order_history_read'`, [caseId, winner.id]), 1);
  pass("escalated order history requires an explicit lead grant and writes a per-read audit entry");

  await act(lead.client, caseId, "reassign", 3, replacement.id, "Shift coverage");
  await denied(history(winner.client, caseId));
  await denied(history(winner.client, caseId, null, true));
  await denied(history(replacement.client, caseId, null, true));
  await denied(send(winner.client, caseId, "Stale screen message"));
  await denied(read(winner.client, caseId, 1));
  assert.equal(await value(winner.client, "select count(*)::int result from public.messages where conversation_id=$1", [caseId]), 0);
  assert.equal(await value(winner.client, "select count(*)::int result from public.notifications where event_id=$1", [before.id]), 0);
  assert.equal(await value(owner, `select count(*)::int result from private.notification_delivery_intents d
    join public.notifications n on n.id=d.notification_id where n.event_id=$1 and d.channel='email'`, [before.id]), 0);
  const after = await send(requester.client, caseId, "After reassignment");
  assert.deepEqual(await value(owner, "select array_agg(recipient_id) result from public.notifications where event_id=$1", [after.id]), [replacement.id]);
  assert.equal(await value(owner, "select count(*)::int result from private.btp08_email_sources s join public.notifications n on n.id=s.notification_id where n.event_id=$1", [after.id]), 0);
  assert.equal(await value(owner, `select detail->>'previous_assignee' result from private.audit_events
    where target_id=$1 and event_type='support_reassign'`, [caseId]), winner.id);
  assert.equal(await value(owner, `select count(*)::int result from realtime.messages
    where event='refresh' and not private or event='refresh' and payload-'id'<>'{}'::jsonb`), 0);
  pass("reassignment during the old operator's session revokes access and preserves in-app notifications, audits the change, and redirects subsequent notifications");

  await act(lead.client, caseId, "grant_order", 4, null, "Continue review");
  await act(lead.client, caseId, "revoke_order", 5, null, "Review completed");
  await denied(history(replacement.client, caseId, null, true));
  await act(lead.client, caseId, "grant_order", 6, null, "New issue");
  await act(replacement.client, caseId, "resolve", 7);
  assert.equal((await history(requester.client, caseId)).status, "resolved");
  await denied(history(replacement.client, caseId, null, true));
  await denied(send(requester.client, caseId, "Closed case"), /CONFLICT:/);
  await act(requester.client, caseId, "reopen", 8);
  assert.equal((await send(requester.client, caseId, "Pending member can reopen")).sequence, 5);
  await denied(history(replacement.client, caseId, null, true));
  await owner.query("update public.staff_roles set revoked_at=now() where member_id=$1 and role='support'", [replacement.id]);
  await denied(history(replacement.client, caseId));
  assert(!(await cases(replacement.client)).queue.length);
  await owner.query("update public.members set status='suspended' where id=$1", [requester.id]);
  await denied(history(requester.client, caseId));
  await denied(cases(requester.client));
  pass("resolve makes history read-only and revokes the grant, pending requester can reopen, and live role/account revocation applies");
} finally {
  await Promise.all(clients.map(client => client.end()));
  if (database) await admin.query(`drop database ${name} with (force)`);
  await admin.end();
}
