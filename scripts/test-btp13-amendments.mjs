import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55486/postgres");
assert.match(url.protocol, /^postgres(?:ql)?:$/);
assert(url.hostname === "127.0.0.1" && !url.search, "Use disposable loopback PostgreSQL");
const admin = new pg.Client({ connectionString: url.href });
const database = `btp13_${uuid().replaceAll("-", "")}`;
const clients = [];
let created = false;
url.pathname = `/${database}`;
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const item = (unitBudget, name = "Nasi pengganti") => [{ name, specification: "", quantity: 1, unitBudget }];

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
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort();
  for (const migration of migrations) await owner.query(read(`../supabase/migrations/${migration}`));

  async function session(claims) {
    const client = await connect();
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
    return client;
  }
  async function actor(aal = "aal1") {
    const id = uuid(), sessionId = uuid();
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [sessionId, id]);
    if (aal === "aal2") {
      await owner.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [uuid(), id]);
      await owner.query("insert into public.staff_roles(member_id,role) values($1,'finance_operation')", [id]);
    }
    const claims = { sub: id, session_id: sessionId, aal };
    return { id, claims, client: await session(claims) };
  }
  const provider = await actor(), customer = await actor(), other = await actor(), outsider = await actor(), finance = await actor("aal2");
  const secondCustomerSession = { ...customer, client: await session(customer.claims) };
  const locker = await connect();
  const account = uuid();
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Akun uji')", [account]);
  await owner.query("insert into private.funding_account_customers(account_id,member_id) values($1,$2)", [account, customer.id]);
  await owner.query("insert into private.funding_account_operators(account_id,member_id) values($1,$2)", [account, finance.id]);

  async function listing(spending) {
    const id = uuid();
    await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
      values($1,$2,'trip','Uji perubahan','Warung','Makanan','Alam Sutera','Kampus',$3,20000,5000,5000,false,3,$4,
        now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [id, provider.id, JSON.stringify(item(20000, "Nasi")), spending]);
    return id;
  }
  async function offer(listing, member) {
    const id = uuid();
    await member.client.query("select public.save_offer($1,$2,$3,0,1,5000,'save')", [uuid(), id, listing]);
    return id;
  }
  const first = async (client, sql, params) => Object.values((await client.query(sql, params)).rows[0])[0];
  const accept = (listing, offerId) => first(provider.client, "select public.accept_order($1,$2,1,$3,1)", [uuid(), listing, offerId]);
  const readView = (member, order) => first(member.client, "select public.read_amendments($1)", [order]);
  const amend = (member, order, action, { version = 1, id = null, items = null, reason = null, key = uuid() } = {}) =>
    first(member.client, "select public.amend_order($1,$2,$3,$4,$5,$6,$7)", [key, order, action, version, id, items === null ? null : JSON.stringify(items), reason]);
  const propose = (order, amount, version = 1) => amend(provider, order, "propose", { version, items: item(amount), reason: "Stok habis" });
  const funding = (member, action, id, reference = null, amount = null) => first(member.client,
    "select public.funding_command($1,$2,$3,$4,$5,$6)", [uuid(), action, id, reference && account, reference, amount]);
  const funds = order => first(customer.client, "select public.funding_view($1)", [order]);
  async function evidence(id) {
    await owner.query("insert into storage.objects(id,bucket_id,name,metadata) values($1,'funding-evidence',$2,$3)",
      [uuid(), id, { mimetype: "image/png", size: 100 }]);
  }
  async function race(listing, ...requests) {
    await locker.query("begin");
    await locker.query("select 1 from public.listings where id=$1 for update", [listing]);
    const settled = Promise.allSettled(requests.map(([,, run]) => run()));
    try {
      for (const [member, label] of requests) {
        for (let attempt = 0; ; attempt++) {
          const wait = await first(owner, "select wait_event_type from pg_stat_activity where pid=$1", [member.client.processID]);
          if (wait === "Lock") break;
          assert(attempt < 200, `${label} did not reach a database lock wait`);
          await setTimeout(10);
        }
      }
    } finally {
      await locker.query("rollback");
    }
    return settled;
  }
  function oneCommit(results, error) {
    assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
    assert.match(results.find(row => row.status === "rejected").reason.message, error);
  }

  const trip = await listing(100000);
  const order = await accept(trip, await offer(trip, customer));
  const original = await first(owner, "select terms from public.order_terms where order_id=$1", [order]);
  const anon = await connect();
  await anon.query("set role anon");
  await assert.rejects(anon.query("select public.read_amendments($1)", [order]), /permission denied/);
  await assert.rejects(readView(outsider, order), /PERMISSION/);
  await assert.rejects(customer.client.query("select * from private.order_amendments"), /permission denied/);
  await assert.rejects(amend(customer, order, "propose", { items: item(21000), reason: "Stok habis" }), /PERMISSION/);
  await assert.rejects(amend(provider, order, "propose", { items: item(150001), reason: "Mahal" }), /VALIDATION/);
  const payload = { items: item(26000), reason: "Stok habis", key: uuid() };
  const rejected = await amend(provider, order, "propose", payload);
  await assert.rejects(amend(provider, order, "approve", { id: rejected }), /PERMISSION/);
  assert.equal(await amend(provider, order, "propose", payload), rejected);
  await assert.rejects(amend(provider, order, "propose", { ...payload, reason: "Berbeda" }), /CONFLICT/);
  await assert.rejects(propose(order, 28000), /CONFLICT/);
  await amend(customer, order, "reject", { id: rejected });
  assert.equal((await readView(customer, order)).budget, 20000);
  const live = await propose(order, 30000);
  await assert.rejects(amend(customer, order, "approve", { id: rejected }), /CONFLICT/);
  const initial = await funding(customer, "begin", order, "TESTBASE13", 25000);
  await evidence(initial);
  await funding(customer, "submit", initial);
  const key = uuid();
  const duplicate = await race(trip,
    [customer, "approve", () => amend(customer, order, "approve", { id: live, key })],
    [secondCustomerSession, "replay", () => amend(secondCustomerSession, order, "approve", { id: live, key })]);
  assert.deepEqual(duplicate.map(row => row.value), [live, live]);
  await assert.rejects(amend(customer, order, "approve", { id: live, version: 2 }), /CONFLICT/);
  assert.equal((await funds(order)).requiredAmount, 35000);
  assert.equal((await funds(order)).purchaseReady, false);
  await funding(finance, "verify", initial, "TESTBASE13", 25000);
  assert.equal((await funds(order)).outstandingAmount, 10000);
  assert.equal((await funds(order)).purchaseReady, false);
  assert.equal(await amend(customer, order, "approve", { id: live, key }), live);
  assert.deepEqual(await first(owner, "select terms from public.order_terms where order_id=$1", [order]), original);
  await assert.rejects(owner.query("update public.order_terms set terms='{}' where order_id=$1", [order]), /immutable/i);
  await assert.rejects(owner.query("update private.order_amendments set budget=1000 where id=$1", [live]), /immutable/i);
  const events = await owner.query("select recipient_id,actor_id,id from public.notifications where target_id=$1 and event_type='amendment_action' order by created_at", [order]);
  assert.deepEqual(events.rows.map(row => [row.recipient_id,row.actor_id]), [[customer.id,provider.id],[provider.id,customer.id],[customer.id,provider.id],[provider.id,customer.id]]);
  for (const [index, event] of events.rows.entries()) {
    const recipient = index % 2 === 0 ? customer : provider;
    assert.equal(await first(recipient.client, "select public.notification_target($1)", [event.id]), `/orders/${order}`);
    await assert.rejects(outsider.client.query("select public.notification_target($1)", [event.id]), /PERMISSION/);
  }
  assert.equal(Number(await first(owner, "select count(*) from private.notification_delivery_intents where notification_id=any($1::uuid[])", [events.rows.map(row => row.id)])), 8);
  console.log("PASS SQL participant authorization, immutable terms, stale/rejected amendments, exact concurrent replay and counterpart notification targets");

  await owner.query("update public.reservations set expires_at=now()-interval '1 minute' where order_id=$1", [order]);
  await assert.rejects(funding(customer, "begin", order, "TESTWRONG13", 35000), /VALIDATION/);
  const draft = await funding(customer, "begin", order, "TESTDRAFT13", 10000);
  const change = await propose(order, 34000, 2);
  await amend(customer, order, "approve", { id: change, version: 2 });
  await evidence(draft);
  await assert.rejects(funding(customer, "submit", draft), /CONFLICT/);
  await funding(customer, "discard", draft);
  const topup = await funding(customer, "begin", order, "TESTTOPUP13", 14000);
  assert.equal(await first(customer.client, "select public.funding_evidence($1,true)", [topup]), topup);
  await evidence(topup);
  await funding(customer, "submit", topup);
  assert.deepEqual((await first(finance.client, "select public.funding_queue($1)", [order])).map(row => [row.id,row.expiresAt]), [[topup,null]]);
  assert.equal((await funds(order)).purchaseReady, false);
  await funding(finance, "verify", topup, "TESTTOPUP13", 14000);
  assert.equal((await funds(order)).purchaseReady, true);
  assert.equal(await first(owner, "select private.funding_purchase_ready($1)", [order]), true);
  const sameCost = await amend(provider, order, "propose", { version: 3, items: item(34000,"Nasi lain"), reason: "Varian habis" });
  assert.equal((await funds(order)).purchaseReady, false);
  await amend(customer, order, "reject", { id: sameCost, version: 3 });
  assert.equal((await funds(order)).purchaseReady, true);
  const competing = await accept(trip, await offer(trip, other));
  const exceedsVerifiedCapacity = await propose(competing, 67000);
  await assert.rejects(amend(other, competing, "approve", { id: exceedsVerifiedCapacity }), /CONFLICT: Trip spending/);
  console.log("PASS SQL threshold, grandfathered submitted evidence, stale draft, exact top-up after initial deadline and pending purchase gate");

  const tight = await listing(60000);
  const a = await accept(tight, await offer(tight, customer));
  const b = await accept(tight, await offer(tight, other));
  const aChange = await propose(a, 35000), bChange = await propose(b, 35000);
  oneCommit(await race(tight, [customer, "first approval", () => amend(customer, a, "approve", { id: aChange })],
    [other, "second approval", () => amend(other, b, "approve", { id: bChange })]), /CONFLICT: Trip spending/);
  assert.equal(Number(await first(owner, "select sum(amount) from public.reservations where listing_id=$1", [tight])), 55000);
  const decision = await propose(order, 35000, 3);
  oneCommit(await race(trip, [customer, "approve", () => amend(customer, order, "approve", { id: decision, version: 3 })],
    [secondCustomerSession, "reject", () => amend(secondCustomerSession, order, "reject", { id: decision, version: 3 })]), /CONFLICT/);
  const { version: currentVersion } = await readView(customer, order);
  const reduction = await propose(order, 25000, currentVersion);
  await amend(customer, order, "approve", { id: reduction, version: currentVersion });
  const reduced = await funds(order);
  assert.equal(reduced.requiredAmount, 30000);
  assert.equal(reduced.outstandingAmount, 0);
  assert.equal(reduced.purchaseReady, true);
  assert.equal(Number(await first(owner, "select sum(amount) from private.funding_submissions where order_id=$1 and state='verified'", [order])), 39000);

  const mixed = await listing(60000);
  const existing = await accept(mixed, await offer(mixed, customer));
  const proposed = await propose(existing, 45000), pendingOffer = await offer(mixed, other);
  oneCommit(await race(mixed, [customer, "approval", () => amend(customer, existing, "approve", { id: proposed })],
    [provider, "acceptance", () => accept(mixed, pendingOffer)]), /CONFLICT:.*capacity/i);
  assert(Number(await first(owner, "select sum(amount) from public.reservations where listing_id=$1", [mixed])) <= 60000);
  await owner.query("update public.reservations set expires_at=now()-interval '1 minute' where order_id=$1", [existing]);
  await assert.rejects(propose(existing, 41000), /CONFLICT: Reservation/);
  console.log("PASS SQL competing approvals and acceptance share a real capacity lock; expired unpaid reservations reject amendments");
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  if (created) await admin.query(`drop database ${database} with (force)`);
  await admin.end();
}
