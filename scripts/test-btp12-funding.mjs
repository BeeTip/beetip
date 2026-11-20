import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { historicalPaymentMigrations } from "./historical-payment-migrations.mjs";
import { setTimeout } from "node:timers/promises";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55486/postgres");
assert(url.protocol === "postgres:" && url.hostname === "127.0.0.1" && !url.search, "Use disposable loopback PostgreSQL");
const database = `btp12_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: url.href });
const clients = [];
let created = false;
url.pathname = `/${database}`;
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

async function connect() {
  const client = new pg.Client({ connectionString: url.href, statement_timeout: 15000 });
  await client.connect();
  clients.push(client);
  return client;
}

try {
  await admin.connect();
  for (const role of ["anon", "authenticated"]) {
    await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$`);
  }
  await admin.query(`create database ${database} encoding 'UTF8' template template0`);
  created = true;
  const owner = await connect();
  await owner.query(read("../supabase/tests/local_platform.sql"));
  const migrations = historicalPaymentMigrations(new URL("../supabase/migrations/", import.meta.url));
  for (const migration of migrations) await owner.query(read(`../supabase/migrations/${migration}`));
  const uuid = randomUUID;
  async function actor(aal = "aal1") {
    const id = uuid(), session = uuid();
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, id]);
    const client = await connect();
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: session, aal })]);
    if (aal === "aal2") {
      await owner.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [uuid(), id]);
      await owner.query("insert into public.staff_roles(member_id,role) values($1,'finance_operation')", [id]);
    }
    return { id, client };
  }
  const customer = await actor(), provider = await actor(), unrelated = await actor(), reviewer = await actor("aal2"), otherOperator = await actor("aal2");
  const account = uuid(), otherAccount = uuid();
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Akun uji A'),($2,'Akun uji B')", [account, otherAccount]);
  await owner.query("insert into private.funding_account_customers(account_id,member_id) values($1,$3),($2,$3)", [account, otherAccount, customer.id]);
  await owner.query("insert into private.funding_account_operators(account_id,member_id) values($1,$2),($3,$4)", [account, reviewer.id, otherAccount, otherOperator.id]);

  async function order() {
    const listing = uuid();
    await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
      values($1,$2,'request','Uji pesanan','Warung','Makanan','Alam Sutera','PRIVATE LOCATION','[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',
      20000,5000,5000,false,1,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, customer.id]);
    const result = await provider.client.query("select public.accept_order($1,$2,1) id", [uuid(), listing]);
    return { id: result.rows[0].id, listing };
  }
  const command = async (actor, action, id, { key = uuid(), destination = null, reference = null, amount = null, reason = null } = {}) =>
    (await actor.client.query("select public.funding_command($1,$2,$3,$4,$5,$6,$7) id", [key, action, id, destination, reference, amount, reason])).rows[0].id;
  const state = async (actor, id) => (await actor.client.query("select public.funding_view($1) v", [id])).rows[0].v;
  const queue = async actor => (await actor.client.query("select public.funding_queue() q")).rows[0].q;
  const evidence = (actor, id, upload = false) => actor.client.query("select public.funding_evidence($1,$2)", [id, upload]);
  const deposit = (id, mime = "image/png") => owner.query("insert into storage.objects(id,bucket_id,name,metadata) values($1,'funding-evidence',$2,$3)",
    [uuid(), id, { mimetype: mime, size: 123 }]);
  const toPay = (reference, destination = account, amount = 25000) => ({ destination, reference, amount });
  const primary = await order();
  const key = uuid();
  await assert.rejects(command(provider, "begin", primary.id, toPay("TEST1001")), /PERMISSION/);
  await assert.rejects(state(unrelated, primary.id), /PERMISSION/);
  await assert.rejects(command(customer, "begin", primary.id, toPay("REAL1001")), /VALIDATION/);
  await assert.rejects(command(customer, "begin", primary.id, toPay("TEST1001", account, 24999)), /VALIDATION/);
  const id = await command(customer, "begin", primary.id, { ...toPay("test-10 01"), key });
  assert.equal(await command(customer, "begin", primary.id, { ...toPay("TEST1001"), key }), id);
  await assert.rejects(command(customer, "begin", primary.id, { ...toPay("TEST1002"), key }), /CONFLICT/);
  await assert.rejects(command(customer, "submit", id), /VALIDATION/);
  await assert.rejects(evidence(provider, id), /PERMISSION/);
  await assert.rejects(evidence(reviewer, id), /PERMISSION/);
  await evidence(customer, id, true);
  await deposit(id);
  assert.equal((await state(customer, primary.id)).purchaseReady, false);
  assert.equal((await state(provider, primary.id)).state, "unpaid");
  await command(customer, "submit", id);
  assert.equal((await state(customer, primary.id)).state, "pending");
  assert.equal((await state(provider, primary.id)).submission, null);
  assert.equal((await state(provider, primary.id)).purchaseReady, false);
  await assert.rejects(evidence(customer, id, true), /PERMISSION/);
  await evidence(reviewer, id);
  await assert.rejects(evidence(otherOperator, id), /PERMISSION/);
  assert.equal((await queue(reviewer))[0].id, id);
  assert.deepEqual(await queue(otherOperator), []);
  await assert.rejects(queue(customer), /PERMISSION/);
  await assert.rejects(customer.client.query("update private.funding_submissions set state='verified'"), /permission denied/);
  const inbox = (await reviewer.client.query("select public.notification_inbox(null,null) v")).rows[0].v;
  const notification = inbox.items.find(row => row.event_type === "funding_review");
  assert(notification);
  assert.equal((await reviewer.client.query("select public.notification_target($1) v", [notification.id])).rows[0].v, `/account/funding?order=${primary.id}`);
  const reviewClaims = (await reviewer.client.query("select auth.jwt() jwt")).rows[0].jwt;
  await reviewer.client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ ...reviewClaims, aal: "aal1" })]);
  const lowerInbox = (await reviewer.client.query("select public.notification_inbox(null,null) v")).rows[0].v;
  assert.equal(lowerInbox.items.some(row => row.id === notification.id), false);
  await assert.rejects(reviewer.client.query("select public.notification_target($1)", [notification.id]), /PERMISSION/);
  await reviewer.client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(reviewClaims)]);
  console.log("PASS draft, failed finalization, evidence scope, customer/provider status, reviewer queue and notification target");

  const duplicate = await order();
  await assert.rejects(command(customer, "begin", duplicate.id, toPay("TEST 10-01")), /CONFLICT/);
  const separate = await command(customer, "begin", duplicate.id, toPay("TEST 10-01", otherAccount));
  await deposit(separate);
  await command(customer, "submit", separate);
  await assert.rejects(command(otherOperator, "verify", id, toPay("TEST1001")), /PERMISSION/);
  await assert.rejects(command(reviewer, "verify", id, toPay("TEST1001", otherAccount)), /VALIDATION/);
  await assert.rejects(command(reviewer, "verify", id, toPay("TEST1001", account, 24000)), /VALIDATION/);
  await assert.rejects(command(reviewer, "verify", id, toPay("TEST1002")), /VALIDATION/);
  const uniqueRace = [await order(), await order()];
  const drafts = [];
  for (const order of uniqueRace) {
    const draft = await command(customer, "begin", order.id, toPay("TEST2002"));
    await deposit(draft);
    drafts.push(draft);
  }
  const alternate = await connect();
  await alternate.query("set role authenticated");
  const claims = (await customer.client.query("select auth.jwt() jwt")).rows[0].jwt;
  await alternate.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
  const outcomes = await Promise.allSettled([command(customer, "submit", drafts[0]), command({ client: alternate }, "submit", drafts[1])]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.match(outcomes.find(outcome => outcome.status === "rejected").reason.message, /CONFLICT/);
  console.log("PASS concurrent normalized-reference uniqueness, separate account namespace and bank-field checks");

  await command(reviewer, "verify", id, { ...toPay("TEST1001"), key });
  assert.equal(await command(reviewer, "verify", id, { ...toPay("TEST1001"), key }), id);
  assert.equal((await state(customer, primary.id)).purchaseReady, true);
  assert.equal((await state(provider, primary.id)).purchaseReady, true);
  await owner.query("update public.reservations set expires_at=clock_timestamp()-interval '1 hour' where order_id=$1", [primary.id]);
  await owner.query("select private.btp07_run_expiry()");
  assert.equal((await state(customer, primary.id)).purchaseReady, true);
  const audit = await owner.query("select event_type,detail,actor_id from private.audit_events where target_id=$1 order by created_at", [id]);
  assert.deepEqual(audit.rows.map(row => row.event_type), ["funding_begin", "funding_submit", "funding_verify"]);
  assert.deepEqual(audit.rows[2], { event_type: "funding_verify", detail: { orderId: primary.id }, actor_id: reviewer.id });
  await owner.query("update public.staff_roles set revoked_at=now() where member_id=$1", [reviewer.id]);
  await assert.rejects(command(reviewer, "verify", id, { ...toPay("TEST1001"), key }), /PERMISSION/);
  await assert.rejects(evidence(reviewer, id), /PERMISSION/);
  await assert.rejects(queue(reviewer), /PERMISSION/);
  console.log("PASS actor-scoped receipts, audit, verified purchase threshold, expiry skip and live role revocation");

  const racing = await order();
  const racingId = await command(customer, "begin", racing.id, toPay("TEST4001", otherAccount));
  await deposit(racingId);
  await command(customer, "submit", racingId);
  await owner.query("update public.reservations set expires_at=clock_timestamp()+interval '1 second' where order_id=$1", [racing.id]);
  await owner.query("begin");
  await owner.query("select id from public.listings where id=$1 for update", [racing.listing]);
  const attempt = command(otherOperator, "verify", racingId, toPay("TEST4001", otherAccount)).then(() => null, error => error);
  const observer = await connect();
  for (let waited = 0; ; waited++) {
    const wait = await observer.query("select wait_event_type from pg_stat_activity where pid=$1", [otherOperator.client.processID]);
    if (wait.rows[0]?.wait_event_type === "Lock") break;
    assert(waited < 40, "Verification never reached the listing lock");
    await setTimeout(25);
  }
  await owner.query("select pg_sleep(1.1)");
  await owner.query("commit");
  assert.match((await attempt)?.message ?? "", /CONFLICT/);
  await owner.query("select private.btp07_run_expiry()");
  assert.equal((await state(customer, racing.id)).purchaseReady, false);
  assert.equal((await queue(otherOperator)).some(row => row.id === racingId), false);
  const marker = (await owner.query("select funding_verified_at,released_at from public.reservations where order_id=$1", [racing.id])).rows[0];
  assert.equal(marker.funding_verified_at, null);
  assert(marker.released_at);
  await assert.rejects(command(otherOperator, "verify", racingId, toPay("TEST4001", otherAccount)), /CONFLICT/);
  console.log("PASS verification waits on capacity lock and honors the deadline after the wait");

  await owner.query(`create function private.funding_test_failure() returns trigger language plpgsql as $$
    begin if new.event_type='funding_review' then raise exception 'injected notification failure'; end if; return new; end; $$;
    create trigger funding_test_failure before insert on public.notifications for each row execute function private.funding_test_failure()`);
  const failedKey = uuid();
  await assert.rejects(command(otherOperator, "verify", separate, { ...toPay("TEST1001", otherAccount), key: failedKey }), /injected notification failure/);
  assert.deepEqual((await owner.query(`select f.state,r.funding_verified_at,
    exists (select 1 from private.operation_receipts where operation_id=$2) as receipt
    from private.funding_submissions f join public.reservations r on r.order_id=f.order_id where f.id=$1`, [separate, failedKey])).rows[0],
  { state: "pending", funding_verified_at: null, receipt: false });
  await owner.query("drop trigger funding_test_failure on public.notifications");
  await command(otherOperator, "reject", separate, { reason: "evidence_mismatch" });
  assert.equal((await state(customer, duplicate.id)).submission.reason, "evidence_mismatch");
  assert.equal((await state(customer, duplicate.id)).purchaseReady, false);
  const correction = await command(customer, "begin", duplicate.id, toPay("TEST1001", otherAccount));
  await deposit(correction);
  await command(customer, "submit", correction);
  console.log("PASS atomic rollback on notification failure, rejection reason and corrected reference resubmission");
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  try { if (created) await admin.query(`drop database ${database} with (force)`); }
  finally { await admin.end(); }
}
