import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55486/postgres");
assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && !url.search, "Only loopback PostgreSQL without connection overrides is allowed");
const database = `btp07_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: url.href });
const clients = [];
let created = false;
let db;
async function connect() {
  const client = new pg.Client({ connectionString: db, statement_timeout: 10000 });
  await client.connect(); clients.push(client); return client;
}
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
try {
  await admin.connect();
  for (const role of ["anon", "authenticated"]) await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$`);
  await admin.query(`create database ${database} encoding 'UTF8' template template0`); created = true;
  const candidate = new URL(url); candidate.pathname = `/${database}`; db = candidate.href;
  const owner = await connect(); const worker = await connect(); const verifier = await connect();
  await owner.query(read("../supabase/tests/local_platform.sql"));
  for (const file of readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort()) {
    await owner.query(read(`../supabase/migrations/${file}`));
  }
  await owner.query(read("../supabase/tests/btp07_reservation_expiry.sql"));
  const cron = (await owner.query("select exists(select 1 from pg_extension where extname='pg_cron') installed")).rows[0].installed;
  console.log(`PASS fresh migrations and rollback SQL privilege/projection/batch assertions; real pg_cron ${cron ? "installed" : "UNAVAILABLE (schedule acceptance pending)"}`);
  const actors = [];
  for (let i = 0; i < 2; i++) {
    const actor = { id: randomUUID(), session: randomUUID() };
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,clock_timestamp())", [actor.id, `btp07-${i}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [actor.session, actor.id]); actors.push(actor);
  }
  const member = await connect();
  await member.query("set role authenticated");
  await member.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: actors[1].id, session_id: actors[1].session, aal: "aal1", role: "authenticated" })]);
  const listingOwner = await connect(); await listingOwner.query("set role authenticated");
  await listingOwner.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: actors[0].id, session_id: actors[0].session, aal: "aal1", role: "authenticated" })]);
  async function fixture(type = "request") {
    const listing = randomUUID();
    await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
      values($1,$2,$3,'Expiry test','Warung','Makanan','Alam Sutera','PRIVATE DESTINATION','[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',20000,5000,5000,false,1,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, actors[0].id, type]);
    const operation = randomUUID();
    let id;
    if (type === "trip") {
      const offer = randomUUID();
      await member.query("select public.save_offer($1,$2,$3,0,1,5000,'save')", [randomUUID(), offer, listing]);
      id = (await listingOwner.query("select public.accept_order($1,$2,1,$3,1) id", [operation, listing, offer])).rows[0].id;
    } else id = (await member.query("select public.accept_order($1,$2,1) id", [operation, listing])).rows[0].id;
    return { id, listing, operation };
  }
  const due = id => owner.query("update public.reservations set expires_at=clock_timestamp()-interval '1 hour' where order_id=$1", [id]);
  const expire = client => client.query("select private.btp07_run_expiry() n").then(result => result.rows[0].n);
  async function waiting(client) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      if ((await owner.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'", [client.processID])).rowCount) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("Expected actual PostgreSQL lock wait");
  }
  const delayed = await fixture(); await due(delayed.id);
  assert.equal((await member.query("select public.read_order($1) data", [delayed.id])).rows[0].data.state, "expired");
  assert.equal((await member.query("select public.browse_orders() data")).rows[0].data.find(row => row.id === delayed.id).state, "expired");
  await assert.rejects(owner.query("select private.btp07_lock_payable_order($1)", [delayed.id]), /Reservation expired/);
  assert.equal((await member.query("select public.accept_order($1,$2,1) id", [delayed.operation, delayed.listing])).rows[0].id, delayed.id);
  assert.equal(await expire(worker), 1);
  const released = (await owner.query("select released_at from public.reservations where order_id=$1", [delayed.id])).rows[0].released_at;
  assert.equal(await expire(worker), 0);
  assert.equal((await owner.query("select released_at from public.reservations where order_id=$1", [delayed.id])).rows[0].released_at.getTime(), released.getTime());
  assert.equal((await owner.query("select count(*)::int n from private.audit_events where event_type='reservation_expired' and target_id=$1", [delayed.id])).rows[0].n, 1);
  console.log("PASS delayed-job guards, read/list projections, original receipt recovery and exactly-once release/audit");

  const funded = await fixture();
  await owner.query("update public.reservations set expires_at=clock_timestamp()+interval '500 milliseconds' where order_id=$1", [funded.id]);
  await verifier.query("begin"); await verifier.query("select private.btp07_preserve_verified_funding($1)", [funded.id]);
  await owner.query("select pg_sleep(0.6)");
  assert.equal(await expire(worker), 0);
  await verifier.query("commit"); assert.equal(await expire(worker), 0);
  assert.equal((await member.query("select public.read_order($1) data", [funded.id])).rows[0].data.state, "funding_verified");
  await assert.rejects(owner.query("update public.listings set spending_capacity=1000 where id=$1", [funded.listing]), /CONFLICT:/);
  assert.equal((await owner.query("select released_at from public.reservations where order_id=$1", [funded.id])).rows[0].released_at, null);
  console.log("PASS verification before deadline preserves capacity past deadline and overlapping expiry skips its listing lock");

  const fundedTrip = await fixture("trip");
  await owner.query("select private.btp07_preserve_verified_funding($1)", [fundedTrip.id]); await due(fundedTrip.id);
  const nextOffer = randomUUID();
  await member.query("select public.save_offer($1,$2,$3,0,1,5000,'save')", [randomUUID(), nextOffer, fundedTrip.listing]);
  await assert.rejects(listingOwner.query("select public.accept_order($1,$2,1,$3,1)", [randomUUID(), fundedTrip.listing, nextOffer]), /capacity full/);
  console.log("PASS fresh acceptance counts verified reservations after their unpaid deadline");

  const expiryWins = await fixture(); await due(expiryWins.id);
  await worker.query("begin"); assert.equal(await expire(worker), 1);
  const refused = verifier.query("select private.btp07_preserve_verified_funding($1)", [expiryWins.id]).then(() => null, error => error);
  await waiting(verifier); await worker.query("commit");
  assert.match((await refused).message, /Reservation expired/);
  console.log("PASS expiry winner commits before blocked verifier; expired reservation cannot regain capacity");

  const waitingDeadline = await fixture();
  await owner.query("update public.reservations set expires_at=clock_timestamp()+interval '500 milliseconds' where order_id=$1", [waitingDeadline.id]);
  await worker.query("begin"); await worker.query("select id from public.listings where id=$1 for update", [waitingDeadline.listing]);
  await verifier.query("begin");
  const late = verifier.query("select private.btp07_preserve_verified_funding($1)", [waitingDeadline.id]).then(() => null, error => error);
  await waiting(verifier); await owner.query("select pg_sleep(0.6)"); await worker.query("commit");
  assert.match((await late).message, /Reservation expired/); await verifier.query("rollback");
  assert.equal(await expire(worker), 1);
  console.log("PASS verification rechecks database wall clock after lock wait even in a transaction begun before deadline");

  const backlog = await Promise.all(Array.from({ length: 4 }, () => fixture()));
  for (const item of backlog) await due(item.id);
  await worker.query("begin");
  assert.equal((await worker.query("select private.btp07_expire_reservations(2) n")).rows[0].n, 2);
  assert.equal((await verifier.query("select private.btp07_expire_reservations(4) n")).rows[0].n, 2);
  await worker.query("commit"); assert.equal(await expire(worker), 0);
  assert.equal((await owner.query("select count(*)::int n from private.audit_events where event_type='reservation_expired' and target_id=any($1::uuid[])", [backlog.map(item => item.id)])).rows[0].n, 4);
  console.log("PASS bounded batches, overlapping manual workers skip locks, downtime backlog drains without duplicate releases");

  const overlap = await fixture(); await due(overlap.id);
  await worker.query("begin"); assert.equal(await expire(worker), 1);
  assert.equal(await expire(verifier), 0); await worker.query("commit");
  assert.equal((await owner.query("select count(*)::int n from private.btp07_expiry_runs where status='overlap'")).rows[0].n, 1);
  console.log("PASS scheduled-run advisory lock prevents overlapping work and records sanitized overlap");

  const failure = await fixture(); await due(failure.id);
  await owner.query(`create function private.btp07_test_failure() returns trigger language plpgsql as $$ begin
    if new.event_type='reservation_expired' then raise exception 'PRIVATE BANK DESTINATION injected'; end if; return new; end $$;
    create trigger btp07_test_failure before insert on private.audit_events for each row execute function private.btp07_test_failure()`);
  assert.equal(await expire(worker), 0);
  const failed = (await owner.query("select status,error_code,released_count from private.btp07_expiry_runs where status='failed'")).rows[0];
  assert.deepEqual(failed, { status: "failed", error_code: "P0001", released_count: 0 });
  assert.equal((await owner.query("select released_at from public.reservations where order_id=$1", [failure.id])).rows[0].released_at, null);
  assert.equal((await owner.query("select last_status from private.btp07_expiry_heartbeat")).rows[0].last_status, "failed");
  assert(!JSON.stringify((await owner.query("select * from private.btp07_expiry_runs")).rows).includes("PRIVATE"));
  await owner.query("drop trigger btp07_test_failure on private.audit_events; drop function private.btp07_test_failure()");
  assert.equal(await expire(worker), 1);
  assert.equal((await owner.query("select last_status,last_success_at is not null success from private.btp07_expiry_heartbeat")).rows[0].success, true);
  console.log("PASS injected audit failure rolls back release/state, records SQLSTATE only, heartbeat recovers with retry");
  await owner.query(read("../supabase/rollback/btp07_reservation_expiry.sql"));
  await owner.query(read("../supabase/rollback/btp07_reservation_expiry.sql"));
  assert.equal((await member.query("select public.read_order($1) data", [failure.id])).rows[0].data.state, "expired");
  assert.equal((await member.query("select public.read_order($1) data", [funded.id])).rows[0].data.state, "funding_verified");
  assert.equal(await expire(worker), 0);
  console.log("PASS idempotent operational rollback retains terminal orders, funding protection and manual recovery");
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  if (created) await admin.query(`drop database ${database} with (force)`);
  await admin.end();
}
