import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55486/postgres");
assert(["postgres:", "postgresql:"].includes(url.protocol) && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.search && !url.hash, "Local PostgreSQL without connection overrides only; hosted databases are forbidden");
const database = `btp06_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: url.href });
const clients = [];
const checks = [];
let db;
async function connect(actor) {
  const client = new pg.Client({ connectionString: db, statement_timeout: 10000 });
  await client.connect(); clients.push(client);
  if (actor) {
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: actor.id, session_id: actor.session, aal: "aal1", role: "authenticated" })]);
  }
  return client;
}
async function denied(promise, match = /CONFLICT:/) { await assert.rejects(promise, match); }
const accept = (client, command) => client.query("select public.accept_order($1,$2,$3,$4,$5) id", [command.operation, command.listing, command.version ?? 1, command.offer ?? null, command.offerVersion ?? (command.offer ? 1 : null)]).then(result => result.rows[0].id);
const command = (listing, offer) => ({ operation: randomUUID(), listing, offer });

async function checkDemoUpgrade(owner, migration) {
  const seller = randomUUID(), buyer = randomUUID(), session = randomUUID(), account = randomUUID();
  await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1::uuid,$1::uuid::text||'@example.invalid',now()),($2::uuid,$2::uuid::text||'@example.invalid',now())", [seller, buyer]);
  await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, buyer]);
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Fixture upgrade demo')", [account]);
  const orders = {};
  for (const type of ["unpaid", "expired", "funded"]) {
    const listing = randomUUID();
    await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
      values($1,$2,'request','Uji upgrade demo','Warung','Makanan','Alam Sutera','Kampus',
        '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',20000,5000,5000,false,1,150000,
        now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, seller]);
    await owner.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: buyer, session_id: session, aal: "aal1" })]);
    orders[type] = (await owner.query("select public.accept_order($1,$2,1) id", [randomUUID(), listing])).rows[0].id;
  }
  await owner.query("update public.reservations set expires_at=now()-interval '1 minute' where order_id=$1", [orders.expired]);
  await owner.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
    values($1,$2,'TESTDEMOUPGRADE',25000,'verified',now(),now(),$3)`, [orders.funded, account, seller]);
  await owner.query("update public.reservations set funding_verified_at=now() where order_id=$1", [orders.funded]);
  const reservation = id => owner.query("select expires_at from public.reservations where order_id=$1", [id]).then(result => result.rows[0].expires_at);
  const unpaidDeadline = await reservation(orders.unpaid);

  await owner.query(migration);
  const state = id => owner.query("select public.read_order($1)->>'state' state", [id]).then(result => result.rows[0].state);
  assert.equal(await state(orders.unpaid), "booth_awaiting_payment");
  assert.deepEqual(await reservation(orders.unpaid), unpaidDeadline, "Upgrade preserves the unpaid deadline");
  assert.equal(await state(orders.expired), "expired");
  assert.equal(await state(orders.funded), "funding_verified");
  assert.equal((await owner.query("select amount::int from private.funding_submissions where order_id=$1", [orders.funded])).rows[0].amount, 25000);
  await owner.query("select set_config('request.jwt.claims','{}',false)");
  checks.push("demo upgrade converts active unpaid orders, preserves their deadline, never revives expiry, and preserves legacy funding");
}

try {
  await admin.connect();
  for (const role of ["anon", "authenticated"]) await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$`);
  await admin.query(`create database ${database} encoding 'UTF8' template template0`);
  const candidate = new URL(url); candidate.pathname = `/${database}`; db = candidate.href;
  const owner = await connect();
  await owner.query(readFileSync(new URL("../supabase/tests/local_platform.sql", import.meta.url), "utf8"));
  for (const file of readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort()) {
    const migration = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
    if (file === "20261121004000_connected_demo_only.sql") await checkDemoUpgrade(owner, migration);
    else await owner.query(migration);
  }
  checks.push("all repository migrations apply to fresh PostgreSQL with local platform stubs");
  assert.equal((await owner.query(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('orders','order_terms','reservations') and c.relrowsecurity`)).rows[0].n, 3);
  for (const signature of ["public.accept_order(uuid,uuid,integer,uuid,integer)", "private.accept_order(uuid,uuid,integer,uuid,integer)", "public.read_order(uuid)", "public.browse_orders(timestamp with time zone,uuid)"]) {
    assert.equal((await owner.query("select has_function_privilege('anon',$1,'execute') allowed", [signature])).rows[0].allowed, false);
  }
  checks.push("new public tables enforce RLS and acceptance/order RPCs deny anon execution");
  for (const file of ["connected_listings.sql", "versioned_offers.sql", "atomic_acceptance.sql", "notification_inbox.sql", "connected_demo_payment.sql"]) {
    const path = new URL(`../supabase/tests/${file}`, import.meta.url);
    await owner.query(readFileSync(path, "utf8"));
  }
  checks.push("rollback-only listing, offer, acceptance, notification and demo checkout authorization suites");
  const actors = [];
  for (let i = 0; i < 5; i++) {
    const actor = { id: randomUUID(), session: randomUUID() };
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())", [actor.id, `btp06-${i}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [actor.session, actor.id]);
    actors.push(actor);
  }
  const [a, b, c, d] = await Promise.all(actors.slice(0, 4).map(connect));
  const support = randomUUID();
  await owner.query("insert into public.conversations(id,requester_id) values($1,$2)", [support, actors[1].id]);
  await owner.query("insert into public.conversation_members(conversation_id,member_id,role) values($1,$2,'support')", [support, actors[0].id]);
  await owner.query("insert into public.staff_roles(member_id,role) values($1,'support')", [actors[0].id]);
  assert.equal((await a.query("select * from public.conversations where id=$1", [support])).rowCount, 0);
  await owner.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [randomUUID(), actors[0].id]);
  await a.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: actors[0].id, session_id: actors[0].session, aal: "aal2", role: "authenticated" })]);
  assert.equal((await a.query("select * from public.conversations where id=$1", [support])).rowCount, 1);
  await owner.query("update public.staff_roles set revoked_at=clock_timestamp() where member_id=$1", [actors[0].id]);
  assert.equal((await a.query("select * from public.conversations where id=$1", [support])).rowCount, 0);
  checks.push("support conversation access still requires live scoped staff grant and verified MFA");
  async function listing({ type = "request", negotiable = false, capacity = 1, spending = 150000 } = {}) {
    const id = randomUUID();
    await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
      values($1,$2,$3,'Atomic test','Warung','Makanan','Alam Sutera','PRIVATE DESTINATION','[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',20000,5000,5000,$4,$5,$6,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [id, actors[0].id, type, negotiable, capacity, spending]);
    return id;
  }
  async function offer(listing, client = b) {
    const id = randomUUID();
    await client.query("select public.save_offer($1,$2,$3,0,1,5000,'save')", [randomUUID(), id, listing]);
    return id;
  }
  async function waiting(client) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await owner.query("select wait_event_type from pg_stat_activity where pid=$1", [client.processID]);
      if (result.rows[0]?.wait_event_type === "Lock") return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("Competing transaction did not reach a real database lock wait");
  }
  const fixed = await listing();
  const fixedCommand = command(fixed);
  await b.query("begin");
  const first = await accept(b, fixedCommand);
  const bRetry = await connect(actors[1]);
  const retry = accept(bRetry, fixedCommand);
  await waiting(bRetry);
  await b.query("commit");
  assert.equal(await retry, first);
  await denied(accept(b, { ...fixedCommand, version: 2 }));
  await denied(accept(c, command(fixed)));
  checks.push("same-key concurrent retry blocks on receipt and returns the same order; changed payload and duplicate request conflict");

  const changedListing = await listing();
  const changedCommand = command(changedListing);
  await b.query("begin"); await accept(b, changedCommand);
  const changedClient = await connect(actors[1]);
  const changed = accept(changedClient, { ...changedCommand, version: 2 }).then(value => ({ value }), error => ({ error }));
  await waiting(changedClient); await b.query("commit");
  assert.match((await changed).error?.message ?? "", /CONFLICT: Changed operation payload/);
  checks.push("same operation with a concurrently changed payload waits for receipt commit and conflicts");

  const facts = await owner.query(`select
    (select count(*) from public.orders where id=$1)::int orders,
    (select count(*) from public.order_terms where order_id=$1)::int terms,
    (select count(*) from public.reservations where order_id=$1)::int reservations,
    (select count(*) from public.conversation_members where conversation_id=(select conversation_id from public.orders where id=$1))::int members,
    (select count(*) from private.audit_events where target_id=$1)::int audit,
    (select count(*) from private.acceptance_notification_intents where order_id=$1)::int intents,
    (select count(*) from private.operation_receipts where result_id=$1)::int receipts`, [first]);
  assert.deepEqual(facts.rows[0], { orders: 1, terms: 1, reservations: 1, members: 2, audit: 1, intents: 1, receipts: 1 });
  await denied(owner.query("update public.order_terms set terms='{}' where order_id=$1", [first]), /immutable/);
  await denied(owner.query("delete from public.order_terms where order_id=$1", [first]), /immutable/);
  await owner.query("update public.listings set destination='CHANGED',version=2 where id=$1", [fixed]);
  assert.equal((await b.query("select public.read_order($1) result", [first])).rows[0].result.terms.destination, "PRIVATE DESTINATION");
  assert.equal((await c.query("select * from public.orders")).rowCount, 0);
  await denied(c.query("select public.read_order($1)", [first]), /PERMISSION:/);
  await denied(b.query("delete from public.reservations"), /permission denied/);
  await denied(b.query("update public.orders set state='cancelled'"), /permission denied/);
  await denied(b.query("select * from private.acceptance_notification_intents"), /permission denied/);
  assert.equal((await b.query("select * from public.conversations where id=(select conversation_id from public.orders where id=$1)", [first])).rowCount, 1);
  assert.equal((await c.query("select * from public.conversations where kind='order'")).rowCount, 0);
  checks.push("atomic durable facts, no self-intent, immutable snapshot and participant-only order/conversation reads and direct-write denial");

  async function raceCapacity(options, expected) {
    const id = await listing({ type: "trip", negotiable: true, ...options });
    const offers = await Promise.all([offer(id, b), offer(id, c)]);
    const a2 = await connect(actors[0]);
    await a.query("begin");
    await accept(a, command(id, offers[0]));
    const pending = accept(a2, command(id, offers[1])).then(value => ({ value }), error => ({ error }));
    await waiting(a2); await a.query("commit");
    const result = await pending;
    if (expected === 1) assert.match(result.error?.message ?? "", /CONFLICT:/);
    else assert(result.value);
    assert.equal((await owner.query("select count(*)::int n from public.orders where listing_id=$1", [id])).rows[0].n, expected);
    return id;
  }
  await raceCapacity({ capacity: 1, spending: 150000 }, 1);
  const trip = await raceCapacity({ capacity: 3, spending: 40000 }, 2);
  const thirdOffer = await offer(trip, d);
  await denied(accept(a, command(trip, thirdOffer)));
  await raceCapacity({ capacity: 3, spending: 30000 }, 1);
  await denied(owner.query("update public.listings set capacity=1 where id=$1", [trip]));
  checks.push("real lock-wait final-slot and spending races; two distinct trip orders succeed; third customer cannot exceed spending; capacity edits preserve reservations");

  const requested = await listing({ negotiable: true });
  const [requestOffer, otherOffer] = await Promise.all([offer(requested, b), offer(requested, c)]);
  await denied(accept(c, command(requested, requestOffer)), /PERMISSION:/);
  const requestOwner = await connect(actors[0]);
  await a.query("begin"); await accept(a, command(requested, requestOffer));
  const losingRequest = accept(requestOwner, command(requested, otherOffer)).then(value => ({ value }), error => ({ error }));
  await waiting(requestOwner); await a.query("commit");
  assert.match((await losingRequest).error?.message ?? "", /CONFLICT:/);
  assert.equal((await owner.query("select status from public.offers where id=$1", [requestOffer])).rows[0].status, "accepted");
  await denied(b.query("select public.save_offer($1,$2,$3,1,1,5000,'withdraw')", [randomUUID(), requestOffer, requested]));
  checks.push("only owner approves negotiated offers; concurrent offers on one request have one winner and accepted offers cannot be withdrawn");

  const expiredTrip = await listing({ type: "trip", negotiable: true });
  const expiredOffer = await offer(expiredTrip, b);
  const expiredOrder = await accept(a, command(expiredTrip, expiredOffer));
  await owner.query("update public.reservations set expires_at=clock_timestamp()-interval '1 second' where order_id=$1", [expiredOrder]);
  const freshOffer = await offer(expiredTrip, c);
  await accept(a, command(expiredTrip, freshOffer));
  assert.equal((await owner.query("select count(*)::int n from public.orders where trip_id=$1", [expiredTrip])).rows[0].n, 2);
  checks.push("expired unpaid trip reservations release capacity without deleting accepted snapshots or orders");

  for (const change of ["status='paused'", "version=version+1,start_at=start_at+interval '1 hour',end_at=end_at+interval '1 hour'", "cutoff_at=clock_timestamp()-interval '1 second'"]) {
    const id = await listing({ negotiable: true }); const proposed = await offer(id);
    await owner.query("begin");
    await owner.query(`update public.listings set ${change} where id=$1`, [id]);
    const pending = accept(a, command(id, proposed)).then(value => ({ value }), error => ({ error }));
    // The administrative connection holds the row lock, so use a separate observer.
    const observer = await connect();
    const deadline = Date.now() + 5000;
    while (!(await observer.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'", [a.processID])).rowCount) {
      assert(Date.now() < deadline, "Acceptance must wait on listing change");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await owner.query("commit");
    assert.match((await pending).error?.message ?? "", /CONFLICT:/);
    assert.equal((await owner.query("select count(*)::int n from public.orders where listing_id=$1", [id])).rows[0].n, 0);
  }
  checks.push("concurrent moderation, rescheduling consent and cutoff changes block acceptance and leave no partial order");

  const elapsed = await listing();
  await owner.query("update public.listings set cutoff_at=clock_timestamp()+interval '500 milliseconds' where id=$1", [elapsed]);
  await owner.query("begin"); await owner.query("select id from public.listings where id=$1 for update", [elapsed]);
  await b.query("begin");
  const elapsedResult = accept(b, command(elapsed)).then(value => ({ value }), error => ({ error }));
  const observer = await connect();
  for (let i = 0; i < 100; i++) {
    if ((await observer.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'", [b.processID])).rowCount) break;
    assert(i < 99, "Expected cutoff lock wait");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await owner.query("select pg_sleep(0.6)"); await owner.query("commit");
  assert.match((await elapsedResult).error?.message ?? "", /CONFLICT: Listing expired/);
  await b.query("rollback");
  checks.push("database wall clock rejects cutoff that passes while an already-open transaction waits for the listing lock");

  const rollbackListing = await listing();
  await owner.query(`create function private.btp06_fail_intent() returns trigger language plpgsql as $$ begin raise exception 'injected outbox failure'; end $$;
    create trigger btp06_fail_intent before insert on private.acceptance_notification_intents for each row execute function private.btp06_fail_intent()`);
  const failed = command(rollbackListing);
  await denied(accept(b, failed), /injected outbox failure/);
  assert.equal((await owner.query("select count(*)::int n from private.operation_receipts where operation_id=$1", [failed.operation])).rows[0].n, 0);
  assert.equal((await owner.query("select count(*)::int n from public.orders where listing_id=$1", [rollbackListing])).rows[0].n, 0);
  await owner.query("drop trigger btp06_fail_intent on private.acceptance_notification_intents; drop function private.btp06_fail_intent()");
  await accept(b, failed);
  checks.push("injected final intent failure rolls back receipt and all acceptance facts; exact command succeeds after recovery");
  for (const check of checks) console.log(`PASS ${check}`);
} finally {
  await Promise.all(clients.map(client => client.end()));
  if (db) await admin.query(`drop database ${database} with (force)`);
  await admin.end();
}
