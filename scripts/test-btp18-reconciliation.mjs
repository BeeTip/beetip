import assert from "node:assert/strict";
import { createHash, randomUUID as uuid } from "node:crypto";
import { readFileSync } from "node:fs";
import { historicalPaymentMigrations } from "./historical-payment-migrations.mjs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55518/postgres");
assert(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && !url.search,
  "Use disposable loopback PostgreSQL");
const database = `btp18_${uuid().replaceAll("-", "")}`;
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
  for (const file of historicalPaymentMigrations(new URL("../supabase/migrations/", import.meta.url))) {
    await owner.query(read(`../supabase/migrations/${file}`));
  }

  const account = uuid();
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Akun sintetis')", [account]);
  await owner.query("insert into private.synthetic_transfer_accounts values($1)", [account]);
  async function actor({ finance = false, aal = "aal1", scope = account } = {}) {
    const id = uuid(), session = uuid(), client = await connect();
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, id]);
    if (finance) {
      await owner.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [uuid(), id]);
      await owner.query("insert into public.staff_roles(member_id,role) values($1,'finance_operation')", [id]);
      if (scope) await owner.query("insert into private.funding_account_operators values($1,$2)", [scope, id]);
    }
    await client.query("set role authenticated");
    const claims = JSON.stringify({ sub: id, session_id: session, aal });
    await client.query("select set_config('request.jwt.claims',$1,false)", [claims]);
    return { id, client, claims };
  }

  const customer = await actor(), provider = await actor();
  const initiator = await actor({ finance: true, aal: "aal2" });
  const reviewer = await actor({ finance: true, aal: "aal2" });
  const trip = uuid();
  const title = '=HYPERLINK("https://example.invalid","Uji")';
  await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
    values($1,$2,'trip',$3,'Warung','Makanan','Alam Sutera','Kampus',
      '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":60000}]',
      60000,10000,10000,false,3,400000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [trip, provider.id, title]);
  async function purchasedOrder(buyer, fundingAccount = account) {
    const offer = uuid();
    await buyer.client.query("select public.save_offer($1,$2,$3,0,1,10000,'save')", [uuid(), offer, trip]);
    const id = await value(provider.client, "select public.accept_order($1,$2,1,$3,1)", [uuid(), trip, offer]);
    await owner.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
      values($1,$2,$3,70000,'verified',now(),now(),$4)`, [id, fundingAccount, `TEST${uuid().replaceAll("-", "").toUpperCase()}`, reviewer.id]);
    await owner.query("update public.reservations set funding_verified_at=now() where order_id=$1", [id]);
    const key = uuid(), hash = createHash("sha256").update(key).digest("hex");
    await owner.query("insert into storage.objects(id,bucket_id,name,metadata) values($1,'purchase-receipts',$2,$3)",
      [uuid(), `${provider.id}/${id}/${key}/${hash}`, { mimetype: "image/png", size: 123 }]);
    const purchase = (action, payload, operation = uuid()) =>
      value(provider.client, "select public.record_purchase($1,$2,1,$3,$4)", [operation, id, action, payload]);
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
    const receipt = await purchase("receipt", { merchant: "Warung", reference: `TEST-${key}`, date, discount: 0, imageHash: hash,
      lines: [{ label: "Nasi", gross: 55000, quantity: 1 }] }, key);
    await purchase("allocate", { receipt, entries: [{ line: 1, item: 0, quantity: 1 }] });
    await purchase("finish", { unavailable: [], note: "" });
    return id;
  }

  const first = await purchasedOrder(customer);
  const report = (person, scope, id = null) => value(person.client, "select public.read_reconciliation($1,$2)", [scope, id]);
  const before = await report(initiator, "order", first);
  assert.equal(before.totals.received, "70000");
  assert.equal(before.totals.purchase_due, "55000");
  assert.equal(before.totals.fee_due, "10000");
  assert.equal(before.totals.refund_due, "5000");
  assert.equal(before.totals.outstanding, "70000");
  assert.equal(before.totals.unused_budget, "5000");
  assert.equal(before.totals.platform_revenue, "0");
  assert.equal(before.totals.disclosed_charges, "0");
  assert.equal(before.orders[0].fulfillment, "purchased");
  assert.equal(before.orders[0].money_status, "outstanding");
  console.log("PASS PRD amounts before transfer");

  const download = (person, scope, id) => value(person.client, "select public.export_reconciliation($1,$2)", [scope, id]);
  const exported = await download(initiator, "order", first);
  assert.match(exported.csv, /"'=HYPERLINK\(""https:\/\/example\.invalid"",""Uji""\)"/);
  assert.equal(await value(owner, "select csv_sha256 from private.reconciliation_exports where id=$1", [exported.id]),
    createHash("sha256").update(exported.csv).digest("hex"));
  console.log("PASS audited CSV with formula-safe title");

  const secondCustomer = await actor();
  const second = await purchasedOrder(secondCustomer);
  const otherAccount = uuid();
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Akun di luar cakupan')", [otherAccount]);
  const hidden = await purchasedOrder(await actor(), otherAccount);
  const low = await actor({ finance: true });
  const unscoped = await actor({ finance: true, aal: "aal2", scope: null });
  const anonymous = await connect();
  await anonymous.query("set role anon");
  await assert.rejects(anonymous.query("select public.export_reconciliation('order',$1)", [first]), /permission denied/);
  await assert.rejects(anonymous.query("select public.read_reconciliation('order',$1)", [first]), /permission denied/);
  for (const person of [customer, provider, low, unscoped]) {
    await assert.rejects(download(person, "trip", trip), /PERMISSION/);
    await assert.rejects(report(person, "order", first), /PERMISSION/);
  }
  assert.deepEqual((await report(unscoped, "list")).orders, []);
  await assert.rejects(download(initiator, "list", null), /VALIDATION/);
  await assert.rejects(download(initiator, "order", hidden), /PERMISSION/);
  await owner.query("insert into private.funding_account_operators values($1,$2)", [otherAccount, initiator.id]);
  await assert.rejects(report(initiator, "order", hidden), /PERMISSION: Synthetic/);
  const visible = await report(initiator, "trip", trip);
  assert.deepEqual(visible.orders.map(row => row.order_id), [first, second].sort());
  assert.equal(visible.totals.received, "140000");
  assert.equal(await value(owner, "select count(*) from private.reconciliation_exports"), "1");
  await assert.rejects(initiator.client.query("delete from private.reconciliation_exports"), /permission denied/);
  console.log("PASS export permissions and trip data limited to synthetic account scope");

  async function confirm(buyer, id) {
    await value(provider.client, "select public.start_delivery($1)", [id]);
    const { code } = await value(buyer.client, "select public.issue_handover_code($1,true)", [id]);
    const digest = createHash("sha256").update(`${id}:${code}`).digest("hex");
    assert.equal(await value(provider.client, "select public.confirm_handover($1,$2)", [id, digest]), "confirmed");
  }

  const note = "Pencatatan transfer sintetis";
  const transfer = (person, id, action, payload) =>
    value(person.client, "select public.manual_transfer_command($1,$2,$3,$4)", [uuid(), id, action, { note, ...payload }]);
  async function start(id, component, amount, independent = false) {
    const options = component === "purchase" ? { itemIndex: 0 } : {};
    const transferId = await transfer(initiator, id, "prepare", { component, amount, ...options });
    if (independent) await transfer(reviewer, id, "approve", { transferId, version: 1 });
    const version = independent ? 2 : 1;
    await transfer(initiator, id, "start", { transferId, version });
    return { transferId, version: version + 1 };
  }
  const reference = () => `TEST${uuid().replaceAll("-", "").toUpperCase()}`;
  const complete = (id, attempt) => transfer(initiator, id, "completed", { ...attempt, reference: reference() });
  await confirm(customer, first);
  assert.equal((await report(initiator, "order", first)).orders[0].fulfillment, "delivery_confirmed");
  assert.equal((await report(initiator, "order", second)).orders[0].fulfillment, "purchased");
  assert.equal((await report(initiator, "order", first)).orders[0].money_status, "outstanding");
  await complete(first, await start(first, "purchase", 55000));
  await complete(first, await start(first, "fee", 10000));
  const refund = await start(first, "refund", 5000, true);

  const writer = await connect();
  await writer.query("begin");
  await writer.query("lock table private.reconciliation_exports in share mode");
  const inFlight = download(reviewer, "trip", trip);
  void inFlight.catch(() => {});
  try {
    let waiting = false;
    for (let i = 0; i < 100 && !waiting; i++) {
      waiting = await value(owner, `select exists(select 1 from pg_locks where pid=$1
        and relation='private.reconciliation_exports'::regclass and not granted)`, [reviewer.client.processID]);
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(waiting, "Expected the export to reach the audit insert with its snapshot already captured");
    await complete(first, refund);
  } finally {
    await writer.query("rollback");
  }

  function amountsFromCsv({ csv }, id) {
    const [header, ...rows] = csv.trimEnd().split("\r\n");
    const keys = header.split(",").slice(5);
    const cells = rows.find(row => row.startsWith(`"${id}",`)).split(",").slice(-keys.length);
    return Object.fromEntries(keys.map((key, index) => [key, cells[index]]));
  }

  const priorCsv = await inFlight;
  const freshCsv = await download(reviewer, "trip", trip);
  assert.equal(amountsFromCsv(priorCsv, first).refund_paid, "0");
  assert.equal(amountsFromCsv(priorCsv, first).outstanding, "5000");
  assert.equal(amountsFromCsv(priorCsv, second).outstanding, "70000");
  assert.equal(amountsFromCsv(freshCsv, first).refund_paid, "5000");
  assert.equal(amountsFromCsv(freshCsv, first).outstanding, "0");
  assert.deepEqual((await owner.query("select scope_id,order_count,csv_sha256 from private.reconciliation_exports where id=$1", [priorCsv.id])).rows,
    [{ scope_id: trip, order_count: 2, csv_sha256: createHash("sha256").update(priorCsv.csv).digest("hex") }]);
  const settled = await report(initiator, "order", first);
  assert.equal(settled.orders[0].money_status, "settled");
  assert.deepEqual([settled.totals.purchase_paid, settled.totals.fee_paid, settled.totals.refund_paid], ["55000", "10000", "5000"]);
  console.log("PASS independent handover and PRD settlement, with a consistent audit snapshot during transfer completion");

  await confirm(secondCustomer, second);
  const caseKey = uuid(), hash = createHash("sha256").update(caseKey).digest("hex");
  const prefix = await value(secondCustomer.client, "select public.order_case_evidence($1,$2,true)", [second, caseKey]);
  await owner.query("insert into storage.objects(id,bucket_id,name,metadata) values($1,'order-case-evidence',$2,$3)",
    [uuid(), `${prefix}/${hash}`, { mimetype: "image/png", size: 123 }]);
  const orderCase = (person, action, payload, op = uuid()) =>
    value(person.client, "select public.order_case_command($1,$2,$3,$4)", [op, second, action, payload]);
  const caseId = await orderCase(secondCustomer, "open", {
    kind: "dispute", reason: "Sebagian barang rusak", component: "purchase", itemIndex: 0, amount: 3000, imageHash: hash,
  }, caseKey);
  const held = await report(initiator, "order", second);
  assert.equal(held.orders[0].money_status, "held");
  assert.equal(held.totals.held, "3000");
  const unaffected = await start(second, "purchase", 52000, true);
  await transfer(initiator, second, "ambiguous", unaffected);
  const uncertain = await report(initiator, "trip", trip);
  assert.equal(uncertain.orders.find(row => row.order_id === first).money_status, "settled");
  assert.equal(uncertain.orders.find(row => row.order_id === second).money_status, "ambiguous");
  assert.equal(uncertain.totals.ambiguous, "52000");
  assert.equal(uncertain.totals.outstanding, "70000");
  assert.equal(uncertain.totals.purchase_paid, "55000");
  await transfer(reviewer, second, "resolve_completed", {
    ...unaffected, version: unaffected.version + 1, reference: reference(), record: "Mutasi uji cocok",
  });
  const proposalId = await orderCase(initiator, "propose", {
    caseId, outcome: "resolve", purchase: 52000, fee: 10000, refund: 8000, reason: "Dana barang rusak dikembalikan",
  });
  await orderCase(reviewer, "review", { caseId, proposalId, decision: "approve", reason: "Alokasi diuji" });
  const reallocated = await report(initiator, "order", second);
  assert.equal(reallocated.totals.purchase_paid, "52000");
  assert.equal(reallocated.totals.refund_due, "8000");
  assert.equal(reallocated.totals.outstanding, "18000");
  assert.equal(reallocated.orders[0].money_status, "outstanding");
  const feeAttempt = await start(second, "fee", 10000, true);
  await transfer(initiator, second, "ambiguous", feeAttempt);
  await transfer(reviewer, second, "resolve_not_sent", {
    ...feeAttempt, version: feeAttempt.version + 1, record: "Mutasi uji tanpa transaksi",
  });
  const retryable = await report(initiator, "order", second);
  assert.equal(retryable.totals.ambiguous, "0");
  assert.equal(retryable.totals.fee_paid, "0");
  assert.equal(retryable.totals.outstanding, "18000");
  await complete(second, await start(second, "fee", 10000, true));
  await complete(second, await start(second, "refund", 8000, true));
  const final = await report(initiator, "trip", trip);
  assert(final.orders.every(row => row.money_status === "settled"));
  assert.deepEqual([final.totals.received, final.totals.purchase_paid, final.totals.fee_paid, final.totals.refund_paid, final.totals.outstanding],
    ["140000", "107000", "20000", "13000", "0"]);
  console.log("PASS partial dispute, ambiguous transfer, independent approvals and exact trip totals");

  const late = uuid();
  await owner.query(`insert into private.funding_submissions(id,order_id,account_id,reference,amount,state,submitted_at)
    values($1,$2,$3,$4,1000,'pending',now())`, [late, second, account, reference()]);
  const pending = await report(initiator, "order", second);
  assert.equal(pending.totals.received, "70000");
  assert.equal(pending.totals.pending, "1000");
  assert.equal(pending.orders[0].money_status, "outstanding");
  await owner.query("update private.funding_submissions set state='verified',reviewed_at=now(),reviewed_by=$2 where id=$1", [late, reviewer.id]);
  const lateFunds = await report(initiator, "order", second);
  assert.equal(lateFunds.totals.received, "71000");
  assert.equal(lateFunds.totals.unallocated, "1000");
  assert.equal(lateFunds.totals.outstanding, "1000");
  assert.equal(lateFunds.orders[0].money_status, "outstanding");
  console.log("PASS late verified funds and pending evidence prevent a settled money status");
} finally {
  await Promise.all(clients.map(client => client.end()));
  if (created) await admin.query(`drop database ${database}`);
  await admin.end();
}
