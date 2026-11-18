import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55486/postgres");
assert(["postgres:", "postgresql:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.search && !url.hash, "Isolated local databases without connection overrides only");
const name = `btp08_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: url.href });
const clients = [];
let database;
const checks = [];
async function connect(actor) {
  const client = new pg.Client({ connectionString: database, statement_timeout: 10000 });
  await client.connect(); clients.push(client);
  if (actor) {
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: actor.id, session_id: actor.session, role: "authenticated", aal: "aal1" })]);
  }
  return client;
}
const send = (client, order, id = randomUUID(), body = "Halo") => client.query("select public.btp08_send($1,$2,$3) result", [order, id, body]).then(r => r.rows[0].result);
const history = (client, order, before = null, after = null) => client.query("select public.btp08_history($1,$2,$3) result", [order, before, after]).then(r => r.rows[0].result);
const denied = (promise, pattern = /PERMISSION:/) => assert.rejects(promise, pattern);
try {
  await admin.connect();
  for (const role of ["anon", "authenticated"]) await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$`);
  await admin.query(`create database ${name} encoding 'UTF8' template template0`);
  const target = new URL(url); target.pathname = `/${name}`; database = target.href;
  const owner = await connect();
  await owner.query(readFileSync(new URL("../supabase/tests/local_platform.sql", import.meta.url), "utf8"));
  for (const file of readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort()) {
    await owner.query(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
  checks.push("fresh ordered migration chain with transaction-aware Realtime stand-ins");
  for (const file of ["connected_listings.sql", "versioned_offers.sql", "atomic_acceptance.sql", "notification_inbox.sql"]) {
    await owner.query(readFileSync(new URL(`../supabase/tests/${file}`, import.meta.url), "utf8"));
  }
  checks.push("existing listing, offer, acceptance and notification SQL regressions");
  const actors = [];
  for (let i = 0; i < 3; i++) {
    const actor = { id: randomUUID(), session: randomUUID() };
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [actor.id, `btp08-${i}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [actor.session, actor.id]);
    actors.push(actor);
  }
  const [a, b, stranger] = await Promise.all(actors.map(connect));
  const listing = randomUUID();
  await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
    values($1,$2,'request','Chat test','Warung','Makanan','Alam Sutera','Private','[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',20000,5000,5000,false,1,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, actors[0].id]);
  const order = (await b.query("select public.accept_order($1,$2,1,null,null) id", [randomUUID(), listing])).rows[0].id;
  const conversation = (await owner.query("select conversation_id from public.orders where id=$1", [order])).rows[0].conversation_id;
  const a2 = await connect(actors[0]);
  async function waiting(client) {
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      if ((await owner.query("select wait_event_type from pg_stat_activity where pid=$1", [client.processID])).rows[0]?.wait_event_type === "Lock") return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("Expected a real PostgreSQL lock wait");
  }
  await denied(history(stranger, order)); await denied(send(stranger, order));
  await denied(history(a, randomUUID()));
  assert.equal((await stranger.query("select * from public.messages where conversation_id=$1", [conversation])).rowCount, 0);
  await denied(a.query("insert into public.messages(conversation_id,sequence,sender_id,body) values($1,99,$2,'bad')", [conversation, actors[0].id]), /permission denied/);
  for (const signature of ["public.btp08_send(uuid,uuid,text)", "public.btp08_history(uuid,bigint,bigint)", "public.btp08_read(uuid,bigint)"]) {
    assert.equal((await owner.query("select has_function_privilege('anon',$1,'execute') allowed", [signature])).rows[0].allowed, false);
  }
  checks.push("unrelated, nonexistent, raw writes and anonymous RPC access denied");
  const id = randomUUID();
  await a.query("begin");
  const first = await send(a, order, id, "  Pesan pertama  ");
  const secondPromise = send(b, order, randomUUID(), "Pesan kedua");
  await waiting(b);
  assert.equal((await history(a2, order)).highWater, 0);
  assert.equal((await owner.query("select count(*)::int n from realtime.messages")).rows[0].n, 0);
  await a.query("commit");
  const second = await secondPromise;
  assert.equal(first.sequence, 1); assert.equal(second.sequence, 2);
  assert.deepEqual((await history(a2, order, null, 0)).messages.map(row => row.sequence), [1, 2]);
  checks.push("later sender blocks behind uncommitted sequence; pre-commit catch-up and hints cannot skip late commits");
  await a.query("begin");
  const duplicateId = randomUUID();
  const original = await send(a, order, duplicateId, "Retry");
  const duplicatePromise = send(a2, order, duplicateId, "Retry");
  await waiting(a2); await a.query("commit");
  assert.deepEqual(await duplicatePromise, original);
  await denied(send(a, order, duplicateId, "Changed"), /CONFLICT:/);
  const countBefore = (await history(a, order)).highWater;
  await a.query("begin"); await send(a, order); await a.query("rollback");
  assert.equal((await send(a, order)).sequence, countBefore + 1);
  checks.push("concurrent exact retry returns one row; changed body conflicts; rollback restores counter and outbox");
  await a.query("select set_config('test.topic',$1,false)", [`member:${actors[0].id}`]);
  assert((await a.query("select * from realtime.messages")).rowCount > 0);
  await a.query("select set_config('test.topic',$1,false)", [`member:${actors[1].id}`]);
  assert.equal((await a.query("select * from realtime.messages")).rowCount, 0);
  await denied(a.query("insert into realtime.messages values('bad','broadcast','{}','refresh',true)"), /permission denied/);
  const hints = (await owner.query("select * from realtime.messages")).rows;
  assert(hints.every(row => row.private && row.event === "refresh" && Object.keys(row.payload).join() === "id" && /^[0-9a-f-]{36}$/.test(row.payload.id)));
  checks.push("private per-member SELECT policy, no client publication, content-free hints (SQL stand-ins only)");
  await owner.query("update public.messages set created_at=clock_timestamp()-interval '2 hours' where conversation_id=$1", [conversation]);
  for (let i = 0; i < 125; i++) {
    await send(i % 2 ? a : b, order, randomUUID(), `Page ${i}`);
    await owner.query("update public.messages set created_at=clock_timestamp()-interval '2 hours' where conversation_id=$1", [conversation]);
  }
  const latest = await history(a, order);
  assert.equal(latest.messages.length, 50); assert(latest.older);
  const all = new Map(latest.messages.map(row => [row.id, row]));
  let cursor = latest.older;
  while (cursor) { const page = await history(a, order, cursor); page.messages.forEach(row => all.set(row.id, row)); cursor = page.older; }
  assert.equal(all.size, latest.highWater);
  const catchup = [];
  let after = 0; let more;
  do { const page = await history(b, order, null, after); catchup.push(...page.messages); after = page.after; more = page.hasMore; } while (more);
  assert.equal(new Set(catchup.map(row => row.id)).size, latest.highWater);
  assert.deepEqual(catchup.map(row => row.sequence), Array.from({ length: latest.highWater }, (_, i) => i + 1));
  await Promise.all([a.query("select public.btp08_read($1,$2)", [order, 100]), a2.query("select public.btp08_read($1,$2)", [order, 30])]);
  assert.equal((await history(a, order)).readSequence, 100);
  const unread = (await owner.query("select count(*)::int n from public.messages where conversation_id=$1 and sender_id<>$2 and sequence>100", [conversation, actors[0].id])).rows[0].n;
  assert.equal((await history(a, order)).unread, unread);
  await denied(a.query("select public.btp08_read($1,99999)", [order]), /VALIDATION:/);
  checks.push("latest/older and bounded ascending catch-up cover 129 messages; concurrent read cursor monotonic, bounded and received-only unread");
  for (let i = 0; i < 10; i++) await send(a, order);
  await denied(send(a2, order), /THROTTLED:/);
  assert.equal((await send(a, order, id, "Pesan pertama")).id, first.id);
  await owner.query("update public.messages set created_at=clock_timestamp()-interval '2 hours' where conversation_id=$1", [conversation]);
  for (let i = 0; i < 100; i++) {
    await send(a, order);
    await owner.query("update public.messages set created_at=clock_timestamp()-interval '2 minutes' where conversation_id=$1 and sender_id=$2 and created_at>clock_timestamp()-interval '1 minute'", [conversation, actors[0].id]);
  }
  await denied(send(a, order), /THROTTLED:/);
  checks.push("atomic per-account minute/hour quotas; exact committed retry bypasses quota");
  const notification = (await owner.query("select * from public.notifications where event_id=$1", [first.id])).rows;
  assert.equal(notification.length, 1); assert.equal(notification[0].recipient_id, actors[1].id);
  assert.equal((await owner.query("select count(*)::int n from private.btp08_email_sources where notification_id=$1 and due_at=window_end+interval '1 minute'", [notification[0].id])).rows[0].n, 1);
  await owner.query("update public.conversation_members set revoked_at=clock_timestamp() where conversation_id=$1 and member_id=$2", [conversation, actors[1].id]);
  await denied(history(b, order)); await denied(send(b, order, randomUUID(), "Revoked"));
  await denied(b.query("select public.notification_target($1)", [notification[0].id]));
  assert.equal((await b.query("select * from public.messages where conversation_id=$1", [conversation])).rowCount, 0);
  await owner.query("update public.conversation_members set revoked_at=null where conversation_id=$1", [conversation]);
  await owner.query("update public.members set status='suspended' where id=$1", [actors[1].id]);
  await denied(history(b, order)); await owner.query("update public.members set status='pending' where id=$1", [actors[1].id]);
  await owner.query("delete from auth.sessions where id=$1", [actors[1].session]);
  await denied(history(b, order));
  checks.push("counterparty-only notification and durable delayed email source; revocation hides notification/history and denies sends; suspension/deleted session denied");
  await owner.query("update public.reservations set expires_at=clock_timestamp()-interval '1 second' where order_id=$1", [order]);
  assert.equal((await history(a, order)).closed, true);
  await denied(send(a, order), /CONFLICT: Conversation closed/);
  assert.equal((await send(a, order, id, "Pesan pertama")).id, first.id);
  await owner.query("update public.reservations set expires_at=clock_timestamp()+interval '1 hour' where order_id=$1", [order]);
  await owner.query("select private.btp07_preserve_verified_funding($1)", [order]);
  await owner.query("update public.reservations set expires_at=clock_timestamp()-interval '1 second' where order_id=$1", [order]);
  assert.equal((await history(a, order)).closed, false);
  await owner.query("update public.messages set created_at=clock_timestamp()-interval '2 hours' where conversation_id=$1", [conversation]);
  assert((await send(a, order, randomUUID(), "Verified reservation remains open")).id);
  checks.push("verified funding keeps chat open beyond the original unpaid deadline under shared reservation locks");
  await owner.query("update public.orders set state='cancelled' where id=$1", [order]);
  assert((await history(a, order)).messages.length > 0);
  checks.push("expired unpaid and cancelled orders retain history, deny new sends, resolve committed retries");
  const rollback = readFileSync(new URL("../supabase/rollback/btp08_connected_chat.sql", import.meta.url), "utf8");
  if ((await owner.query("select to_regprocedure('public.btp09_send(uuid,uuid,text)') result")).rows[0].result) {
    await denied(owner.query(rollback), /DEPENDENCY:/);
    await owner.query("rollback");
    assert((await history(a, order)).messages.length > 0);
    checks.push("BTP-08 rollback refuses to remove shared messaging used by BTP-09");
  } else {
    await owner.query(rollback);
    assert.equal((await owner.query("select to_regprocedure('public.btp08_send(uuid,uuid,text)') result")).rows[0].result, null);
    checks.push("owned rollback removes feature while retaining existing order/support message history");
  }
  checks.forEach(check => console.log(`PASS ${check}`));
} finally {
  await Promise.all(clients.map(client => client.end()));
  if (database) await admin.query(`drop database ${name} with (force)`);
  await admin.end();
}
