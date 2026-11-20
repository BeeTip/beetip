import assert from "node:assert/strict";
import { randomUUID as uuid } from "node:crypto";
import { readFileSync } from "node:fs";
import { historicalPaymentMigrations } from "./historical-payment-migrations.mjs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55491/postgres");
assert(url.protocol === "postgres:" && url.hostname === "127.0.0.1" && !url.search, "Use disposable loopback PostgreSQL");
const database = `btp16_${uuid().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: url.href });
let created = false;
const clients = [];
url.pathname = `/${database}`;
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const value = async (client, query, args = []) => Object.values((await client.query(query, args)).rows[0])[0];

async function connect() {
  const client = new pg.Client({ connectionString: url.href, statement_timeout: 12000 });
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

  async function actor(aal = "aal1") {
    const id = uuid(), session = uuid(), client = await connect();
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, id]);
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: session, aal })]);
    return { id, client };
  }
  const customer = await actor(), provider = await actor();
  const account = uuid();
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Akun uji kasus')", [account]);
  async function order(buyer = customer, existingListing) {
    const listing = existingListing ?? uuid(), offer = uuid();
    if (!existingListing) await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
      values($1,$2,'trip','Uji kasus','Warung','Makanan','Alam Sutera','Kampus',
        '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":15000},{"name":"Teh","specification":"","quantity":1,"unitBudget":5000}]',
        20000,5000,5000,false,3,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, provider.id]);
    await buyer.client.query("select public.save_offer($1,$2,$3,0,1,5000,'save')", [uuid(), offer, listing]);
    const id = await value(provider.client, "select public.accept_order($1,$2,1,$3,1)", [uuid(), listing, offer]);
    await owner.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
      values($1,$2,$3,25000,'verified',now(),now(),$4)`, [id, account, `TEST${uuid().replaceAll("-", "").toUpperCase()}`, customer.id]);
    await owner.query("update public.reservations set funding_verified_at=now() where order_id=$1", [id]);
    return id;
  }
  const command = (actor, id, action, payload, key = uuid()) =>
    value(actor.client, "select public.order_case_command($1,$2,$3,$4)", [key, id, action, payload]);
  const state = (actor, id) => value(actor.client, "select public.read_order_cases($1)", [id]);
  const first = await order(), untouched = await order();
  const key = uuid(), cancellation = { kind: "cancellation", reason: "Pesanan tidak diperlukan" };
  const opened = await command(customer, first, "open", cancellation, key);
  assert.equal(await command(customer, first, "open", cancellation, key), opened);
  assert.deepEqual((await state(provider, first)).held, { purchase: 0, fee: 5000, refund: 20000 });
  assert.deepEqual((await state(provider, untouched)).held, { purchase: 0, fee: 0, refund: 0 });
  console.log("PASS cancellation holds only the affected order, with idempotent opening");

  async function staff({ aal = "aal2", scoped = true } = {}) {
    const member = await actor(aal);
    await owner.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [uuid(), member.id]);
    await owner.query("insert into public.staff_roles(member_id,role) values($1,'finance_operation')", [member.id]);
    if (scoped) await owner.query("insert into private.funding_account_operators values($1,$2)", [account, member.id]);
    return member;
  }
  const proposer = await staff(), reviewer = await staff(), low = await staff({ aal: "aal1" });
  const unscoped = await staff({ scoped: false }), outsider = await actor();
  const proposal = { caseId: opened, outcome: "resolve", purchase: 0, fee: 0, refund: 25000, reason: "Belum dibelanjakan" };
  await assert.rejects(state(outsider, first), /PERMISSION/);
  await assert.rejects(state(low, first), /PERMISSION/);
  await assert.rejects(state(unscoped, first), /PERMISSION/);
  await assert.rejects(command(proposer, first, "propose", { ...proposal, refund: 24999 }), /VALIDATION/);
  await assert.rejects(command(proposer, first, "propose", { ...proposal, purchase: 1000, refund: 24000 }), /VALIDATION/);
  await assert.rejects(command(proposer, first, "propose", { ...proposal, fee: 1000, refund: 24000 }), /VALIDATION/);
  const proposalId = await command(proposer, first, "propose", proposal);
  const decision = { caseId: opened, proposalId, decision: "approve", reason: "Dana dan status belanja diperiksa" };
  await assert.rejects(command(proposer, first, "review", decision), /PERMISSION/);
  await assert.rejects(command(low, first, "review", decision), /PERMISSION/);
  const reviewKey = uuid();
  await command(reviewer, first, "review", decision, reviewKey);
  await command(reviewer, first, "review", decision, reviewKey);
  assert.deepEqual((await state(customer, first)).allocation, { purchase: 0, fee: 0, refund: 25000 });
  assert.deepEqual((await state(customer, first)).held, { purchase: 0, fee: 0, refund: 0 });
  assert.equal(await value(owner, "select state from public.orders where id=$1", [first]), "cancelled");
  assert.equal(await value(owner, "select count(*) from private.audit_events where target_id=$1 and event_type='case_review'", [first]), "1");
  console.log("PASS before-purchase refund conservation, authorization, independent review and replay");

  const partial = await order();
  const receiptKey = uuid(), hash = "a".repeat(64);
  const deposit = (bucket, name) => owner.query("insert into storage.objects(id,bucket_id,name,metadata) values($1,$2,$3,$4)",
    [uuid(), bucket, name, { mimetype: "image/png", size: 123 }]);
  const purchase = (action, payload, operation = uuid(), target = partial) => value(provider.client, "select public.record_purchase($1,$2,1,$3,$4)", [operation, target, action, payload]);
  await deposit("purchase-receipts", `${provider.id}/${partial}/${receiptKey}/${hash}`);
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
  const receipt = await purchase("receipt", { merchant: "Warung", reference: "TEST-STRUK", date, discount: 0, imageHash: hash,
    lines: [{ label: "Nasi", gross: 14000, quantity: 1 }] }, receiptKey);
  await purchase("allocate", { receipt, entries: [{ line: 1, item: 0, quantity: 1 }] });
  await purchase("finish", { unavailable: [1], note: "Teh habis" });
  const disputeKey = uuid();
  const dispute = { kind: "dispute", reason: "Sebagian nasi rusak", component: "purchase", itemIndex: 0, amount: 3000, imageHash: hash };
  const path = (actor, orderId, key, upload) => value(actor.client, "select public.order_case_evidence($1,$2,$3)", [orderId, key, upload]);
  await assert.rejects(command(customer, partial, "open", dispute, disputeKey), /VALIDATION/);
  await assert.rejects(path(outsider, partial, disputeKey, true), /PERMISSION/);
  const prefix = await path(customer, partial, disputeKey, true);
  await deposit("order-case-evidence", `${prefix}/${hash}`);
  await assert.rejects(command(customer, partial, "open", { ...dispute, itemIndex: 1 }, disputeKey), /VALIDATION/);
  await assert.rejects(command(customer, partial, "open", { ...dispute, amount: 14001 }, disputeKey), /VALIDATION/);
  await assert.rejects(command(customer, untouched, "open", dispute, disputeKey), /CONFLICT|VALIDATION/);
  const disputeId = await command(customer, partial, "open", dispute, disputeKey);
  const partialState = await state(provider, partial);
  assert.deepEqual(partialState.held, { purchase: 3000, fee: 0, refund: 0 });
  assert.deepEqual(partialState.unheld, { purchase: 11000, fee: 5000, refund: 6000 });
  const evidence = partialState.case.evidence[0].id;
  assert.equal(await path(reviewer, partial, evidence, false), `${prefix}/${hash}`);
  await assert.rejects(path(unscoped, partial, evidence, false), /PERMISSION/);
  await assert.rejects(path(provider, untouched, evidence, false), /PERMISSION/);
  await assert.rejects(customer.client.query("select name from storage.objects where bucket_id='order-case-evidence'"), /permission denied/);
  const disputedProposal = { caseId: disputeId, outcome: "resolve", purchase: 11000, fee: 5000, refund: 9000, reason: "Foto menunjukkan kerusakan sebagian" };
  await assert.rejects(command(proposer, partial, "propose", { ...disputedProposal, purchase: 10000, refund: 10000 }), /VALIDATION/);
  await assert.rejects(command(proposer, partial, "propose", { ...disputedProposal, fee: 4000, refund: 10000 }), /VALIDATION/);
  const stale = await command(proposer, partial, "propose", disputedProposal);
  const responseKey = uuid(), responsePrefix = await path(provider, partial, responseKey, true);
  await deposit("order-case-evidence", `${responsePrefix}/${hash}`);
  await command(provider, partial, "evidence", { caseId: disputeId, imageHash: hash, reason: "Foto pembanding" }, responseKey);
  await assert.rejects(command(reviewer, partial, "review", { ...decision, caseId: disputeId, proposalId: stale }), /CONFLICT/);
  const updated = await command(proposer, partial, "propose", disputedProposal);
  await command(reviewer, partial, "review", { ...decision, caseId: disputeId, proposalId: updated });
  assert.deepEqual((await state(customer, partial)).allocation, { purchase: 11000, fee: 5000, refund: 9000 });
  console.log("PASS disputed item attribution, private evidence, stale review, and preservation of unchallenged amounts");

  const sibling = await order(outsider, await value(owner, "select listing_id from public.orders where id=$1", [partial]));
  const secondReceiptKey = uuid(), secondHash = "b".repeat(64);
  await deposit("purchase-receipts", `${provider.id}/${sibling}/${secondReceiptKey}/${secondHash}`);
  const siblingReceipt = await purchase("receipt", { merchant: "Warung", reference: "TEST-STRUK-2", date, discount: 0, imageHash: secondHash,
    lines: [{ label: "Nasi", gross: 13000, quantity: 1 }] }, secondReceiptKey, sibling);
  await purchase("allocate", { receipt: siblingReceipt, entries: [{ line: 1, item: 0, quantity: 1 }] }, uuid(), sibling);
  await purchase("finish", { unavailable: [1], note: "Teh habis" }, uuid(), sibling);
  await owner.query("update public.orders set state='delivery_confirmed' where id in ($1,$2)", [partial, sibling]);
  const claim = (client, target, component, amount, item = null) =>
    value(client, "select private.claim_case_transfer($1,$2,$3,$4)", [target, component, amount, item]);
  const repeatKey = uuid(), repeatPrefix = await path(customer, partial, repeatKey, true);
  await deposit("order-case-evidence", `${repeatPrefix}/${hash}`);
  const concurrent = await connect();
  await customer.client.query("begin");
  await command(customer, partial, "open", { ...dispute, amount: 2000 }, repeatKey);
  const blocked = claim(concurrent, partial, "purchase", 11000, 0).then(() => null, error => error);
  try { await claim(owner, sibling, "purchase", 13000, 0); }
  finally { await customer.client.query("commit"); await blocked; }
  assert.match((await blocked)?.message ?? "", /CONFLICT/);
  await claim(concurrent, partial, "purchase", 9000, 0);
  await claim(concurrent, partial, "fee", 5000);
  assert.deepEqual((await state(provider, partial)).unheld, { purchase: 0, fee: 0, refund: 9000 });
  assert.equal(await value(owner, "select state from public.orders where id=$1", [sibling]), "delivery_confirmed");

  const secondCaseKey = uuid(), secondPrefix = await path(outsider, sibling, secondCaseKey, true);
  await deposit("order-case-evidence", `${secondPrefix}/${hash}`);
  await assert.rejects(command(outsider, sibling, "open", dispute, secondCaseKey), /VALIDATION|CONFLICT/);
  assert.deepEqual((await state(provider, sibling)).held, { purchase: 0, fee: 0, refund: 0 });
  await assert.rejects(claim(customer.client, partial, "refund", 1), /permission denied/);
  console.log("PASS transfer/hold serialization, previously committed entitlement, and confirmed sibling independence");

  const pending = await order(), pendingCase = await command(customer, pending, "open", cancellation);
  await assert.rejects(purchase("receipt", {}, uuid(), pending), /CONFLICT/);
  await assert.rejects(value(provider.client, "select public.start_delivery($1)", [pending]), /CONFLICT/);
  const inbox = async member => (await value(member.client, "select public.notification_inbox(null,null)")).items;
  const noticeId = (member) => member.client.query("select id from public.notifications where event_type='order_case_activity' and target_id=$1", [pending]).then(result => result.rows[0]?.id);
  const pendingNoticeId = await noticeId(reviewer);
  const pendingNotice = (await inbox(reviewer)).find(row => row.id === pendingNoticeId);
  assert(pendingNotice);
  assert.equal(await value(reviewer.client, "select public.notification_target($1)", [pendingNotice.id]), `/account/order-cases?order=${pending}`);
  assert(await noticeId(provider));
  assert.equal(await noticeId(customer), undefined);
  assert.equal(await noticeId(unscoped), undefined);
  const scopeQueue = (member, filter = null) => value(member.client, "select public.order_case_queue($1,null)", [filter]);
  assert((await scopeQueue(reviewer, pending)).some(row => row.orderId === pending));
  assert.deepEqual(await scopeQueue(unscoped), []);
  await assert.rejects(scopeQueue(low), /PERMISSION/);
  const draft = await command(proposer, pending, "propose", { ...proposal, caseId: pendingCase });
  await command(reviewer, pending, "review", { ...decision, caseId: pendingCase, proposalId: draft, decision: "return" });
  assert.equal((await state(customer, pending)).case.proposal.status, "returned");
  const reconsidered = await command(proposer, pending, "propose", { ...proposal, caseId: pendingCase });
  const lastDecision = { ...decision, caseId: pendingCase, proposalId: reconsidered };
  await owner.query("update public.staff_roles set revoked_at=now() where member_id=$1", [reviewer.id]);
  assert(!(await inbox(reviewer)).some(row => row.id === pendingNotice.id));
  await assert.rejects(value(reviewer.client, "select public.notification_target($1)", [pendingNotice.id]), /PERMISSION/);
  await assert.rejects(command(reviewer, pending, "review", lastDecision), /PERMISSION/);
  assert.equal((await state(customer, first)).case.state, "resolved");
  console.log("PASS cancellation gates, private notifications, scoped queue, returned proposal, and live revocation");
} finally {
  await Promise.all(clients.map(client => client.end()));
  if (created) await admin.query(`drop database ${database}`);
  await admin.end();
}
