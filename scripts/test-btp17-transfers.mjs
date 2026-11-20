import assert from "node:assert/strict";
import { createHash, randomUUID as uuid } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55517/postgres");
assert(url.protocol === "postgres:" && url.hostname === "127.0.0.1" && !url.search, "Use disposable loopback PostgreSQL");
const database = `btp17_${uuid().replaceAll("-", "")}`;
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
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort();
  for (const migration of migrations) await owner.query(read(`../supabase/migrations/${migration}`));

  async function actor(aal = "aal1") {
    const id = uuid(), session = uuid(), client = await connect();
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, id]);
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: session, aal })]);
    return { id, client, claims: JSON.stringify({ sub: id, session_id: session, aal }) };
  }
  const customer = await actor(), provider = await actor();
  const account = uuid();
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Akun uji kasus')", [account]);
  async function order(fundingAccount = account) {
    const listing = uuid(), offer = uuid();
    await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
      values($1,$2,'trip','Uji transfer','Warung','Makanan','Alam Sutera','Kampus',
        '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":15000},{"name":"Teh","specification":"","quantity":1,"unitBudget":5000}]',
        20000,5000,5000,false,3,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, provider.id]);
    await customer.client.query("select public.save_offer($1,$2,$3,0,1,5000,'save')", [uuid(), offer, listing]);
    const id = await value(provider.client, "select public.accept_order($1,$2,1,$3,1)", [uuid(), listing, offer]);
    await owner.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
      values($1,$2,$3,25000,'verified',now(),now(),$4)`, [id, fundingAccount, `TEST${uuid().replaceAll("-", "").toUpperCase()}`, customer.id]);
    await owner.query("update public.reservations set funding_verified_at=now() where order_id=$1", [id]);
    return id;
  }
  const command = (actor, id, action, payload, key = uuid()) =>
    value(actor.client, "select public.order_case_command($1,$2,$3,$4)", [key, id, action, payload]);

  async function staff(aal = "aal2", scope = account) {
    const member = await actor(aal);
    await owner.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [uuid(), member.id]);
    await owner.query("insert into public.staff_roles(member_id,role) values($1,'finance_operation')", [member.id]);
    if (scope) await owner.query("insert into private.funding_account_operators values($1,$2)", [scope, member.id]);
    return member;
  }
  const initiator = await staff(), reviewer = await staff();
  async function cancelledOrder() {
    const id = await order();
    const caseId = await command(customer, id, "open", { kind: "cancellation", reason: "Pesanan tidak diperlukan" });
    const proposalId = await command(initiator, id, "propose", {
      caseId, outcome: "resolve", purchase: 0, fee: 0, refund: 25000, reason: "Belum dibelanjakan",
    });
    await command(reviewer, id, "review", { caseId, proposalId, decision: "approve", reason: "Dana diperiksa" });
    return id;
  }
  const first = await cancelledOrder();
  const send = (actor, id, action, payload, key = uuid()) =>
    value(actor.client, "select public.manual_transfer_command($1,$2,$3,$4)", [key, id, action, payload]);
  const prepare = { component: "refund", amount: 25000, note: "Pengembalian sintetis" };
  const preparationKey = uuid();
  await assert.rejects(send(initiator, first, "prepare", prepare), /PERMISSION: Synthetic/);
  const configure = id => owner.query("insert into private.synthetic_transfer_accounts values($1)", [id]);
  await configure(account);
  const transfer = await send(initiator, first, "prepare", prepare, preparationKey);
  assert.equal(await send(initiator, first, "prepare", prepare, preparationKey), transfer);
  console.log("PASS cancelled order refund preparation and replay");

  const detail = (actor, id) => value(actor.client, "select public.read_manual_transfers($1)", [id]);
  const queue = actor => value(actor.client, "select public.manual_transfer_queue()", []);
  assert((await queue(reviewer)).some(row => row.orderId === first));
  assert.deepEqual((await detail(initiator, first)).history[0].actions, ["abandon"]);
  assert.deepEqual((await detail(reviewer, first)).history[0].actions, ["approve", "abandon"]);

  const step = (actor, id, transferId, version, action, extra = {}, key = uuid()) =>
    send(actor, id, action, { transferId, version, note: "Catatan akun sintetis", ...extra }, key);
  const lookup = (actor, key) => value(actor.client, "select public.manual_transfer_operation($1)", [key]);
  const low = await staff("aal1"), unscoped = await staff("aal2", null);
  const anonymous = await connect();
  await anonymous.query("set role anon");
  await assert.rejects(anonymous.query("select public.manual_transfer_queue()"), /permission denied/);
  await assert.rejects(initiator.client.query("delete from private.manual_transfer_facts"), /permission denied/);
  await assert.rejects(detail(customer, first), /PERMISSION/);
  await assert.rejects(detail(unscoped, first), /PERMISSION/);
  assert.deepEqual(await queue(unscoped), []);
  await assert.rejects(send(initiator, first, "prepare", { ...prepare, amount: 24999 }, preparationKey), /CONFLICT: Operation ID/);
  await assert.rejects(step(initiator, first, transfer, 1, "approve"), /PERMISSION/);
  await assert.rejects(step(low, first, transfer, 1, "approve"), /PERMISSION/);
  await assert.rejects(step(unscoped, first, transfer, 1, "approve"), /PERMISSION/);
  await assert.rejects(step(customer, first, transfer, 1, "approve"), /PERMISSION/);
  await assert.rejects(step(initiator, first, transfer, 1, "start"), /CONFLICT/);
  const approvalKey = uuid();
  await step(reviewer, first, transfer, 1, "approve", {}, approvalKey);
  assert.deepEqual(await lookup(reviewer, approvalKey), { orderId: first, transferId: transfer });
  assert.equal(await lookup(initiator, approvalKey), null);
  await assert.rejects(step(initiator, first, transfer, 1, "start"), /CONFLICT/);
  await owner.query("update public.staff_roles set revoked_at=now() where member_id=$1", [reviewer.id]);
  await assert.rejects(lookup(reviewer, approvalKey), /PERMISSION/);
  await assert.rejects(step(initiator, first, transfer, 2, "start"), /CONFLICT/);
  await step(initiator, first, transfer, 2, "abandon");
  console.log("PASS independent approval, stale versions, actor-only lookup and review revocation");

  const second = await order();
  await owner.query("update public.orders set state='delivery_confirmed' where id=$1", [second]);
  const freshReviewer = await staff();
  const fee = { component: "fee", amount: 5000, note: "Ongkos sintetis" };
  const contenders = await Promise.allSettled([send(initiator, second, "prepare", fee), send(freshReviewer, second, "prepare", fee)]);
  const winner = contenders.findIndex(result => result.status === "fulfilled");
  assert.equal(contenders.filter(result => result.status === "fulfilled").length, 1);
  assert.match(contenders[1-winner].reason.message, /CONFLICT/);
  const operator = [initiator, freshReviewer][winner], payout = contenders[winner].value;
  const startKey = uuid();
  const secondConnection = await connect();
  await secondConnection.query("set role authenticated");
  await secondConnection.query("select set_config('request.jwt.claims',$1,false)", [operator.claims]);
  const start = actor => step(actor, second, payout, 1, "start", {}, startKey);
  assert.deepEqual(await Promise.all([start(operator), start({ client: secondConnection })]), [payout, payout]);
  assert.deepEqual(await lookup(operator, startKey), { orderId: second, transferId: payout });
  await step(operator, second, payout, 2, "ambiguous");
  assert.deepEqual((await detail(operator, second)).history[0].actions, ["resolve_completed", "resolve_not_sent"]);
  const refund = await send(initiator, first, "prepare", prepare);
  await step(freshReviewer, first, refund, 1, "approve");
  assert.equal((await detail(initiator, first)).blockingOrderId, second);
  await assert.rejects(step(initiator, first, refund, 2, "start"), /CONFLICT: Account/);
  await assert.rejects(step(operator, second, payout, 3, "completed", { reference: "TESTPAID1" }), /CONFLICT/);
  await assert.rejects(step(operator, second, payout, 3, "resolve_completed", { reference: "TESTPAID1" }), /VALIDATION/);
  await assert.rejects(step(operator, second, payout, 3, "resolve_not_sent", { record: "\t\n" }), /VALIDATION: Account record/);
  await step(operator, second, payout, 3, "resolve_completed", { reference: "TESTPAID1", record: "Catatan mutasi uji 01" });
  await step(initiator, first, refund, 2, "start");
  await assert.rejects(step(initiator, first, refund, 3, "completed", { reference: "test-paid1" }), /CONFLICT: Reference/);
  await step(initiator, first, refund, 3, "not_sent");
  const retried = await send(initiator, first, "prepare", prepare);
  await step(freshReviewer, first, retried, 1, "approve");
  await step(initiator, first, retried, 2, "start");
  await step(initiator, first, retried, 3, "completed", { reference: "TESTPAID2" });
  await assert.rejects(send(initiator, first, "prepare", prepare), /CONFLICT: Insufficient/);
  console.log("PASS two operators, double-click, ambiguous account block, reconciliation, unique reference and released entitlement");

  const separateAccount = uuid();
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Akun uji lain')", [separateAccount]);
  await configure(separateAccount);
  const otherOperator = await staff("aal2", separateAccount);
  const otherOrder = await order(separateAccount);
  await owner.query("update public.orders set state='delivery_confirmed' where id=$1", [otherOrder]);
  await assert.rejects(detail(initiator, otherOrder), /PERMISSION/);
  const otherTransfer = await send(otherOperator, otherOrder, "prepare", fee);
  await step(otherOperator, otherOrder, otherTransfer, 1, "start");
  await step(otherOperator, otherOrder, otherTransfer, 2, "completed", { reference: "TESTPAID1" });
  assert.equal((await detail(otherOperator, otherOrder)).history[0].facts.length, 3);
  console.log("PASS outbound references can repeat across separately scoped accounts");

  const pendingCancellation = await order();
  const cancellationRace = await Promise.allSettled([
    command(customer, pendingCancellation, "open", { kind: "cancellation", reason: "Belum dibelanjakan" }),
    send(initiator, pendingCancellation, "prepare", fee),
  ]);
  assert.equal(cancellationRace[0].status, "fulfilled");
  assert.match(cancellationRace[1].reason.message, /CONFLICT: Order is not eligible/);
  assert.deepEqual((await detail(initiator, pendingCancellation)).options, []);

  async function purchasedOrder() {
    const id = await order(), receiptKey = uuid(), hash = createHash("sha256").update(receiptKey).digest("hex");
    const deposit = (bucket, name) => owner.query("insert into storage.objects(id,bucket_id,name,metadata) values($1,$2,$3,$4)",
      [uuid(), bucket, name, { mimetype: "image/png", size: 123 }]);
    const purchase = (action, payload, key = uuid()) => value(provider.client, "select public.record_purchase($1,$2,1,$3,$4)", [key, id, action, payload]);
    await deposit("purchase-receipts", `${provider.id}/${id}/${receiptKey}/${hash}`);
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
    const receipt = await purchase("receipt", { merchant: "Warung", reference: `TEST-${receiptKey}`, date, discount: 0, imageHash: hash,
      lines: [{ label: "Nasi", gross: 14000, quantity: 1 }] }, receiptKey);
    await purchase("allocate", { receipt, entries: [{ line: 1, item: 0, quantity: 1 }] });
    await purchase("finish", { unavailable: [1], note: "Teh habis" });
    await owner.query("update public.orders set state='delivery_confirmed' where id=$1", [id]);
    const disputeKey = uuid();
    const prefix = await value(customer.client, "select public.order_case_evidence($1,$2,true)", [id, disputeKey]);
    await deposit("order-case-evidence", `${prefix}/${hash}`);
    const dispute = amount => command(customer, id, "open", {
      kind: "dispute", reason: "Sebagian barang rusak", component: "purchase", itemIndex: 0, amount, imageHash: hash,
    }, disputeKey);
    return { id, dispute };
  }
  const disputed = await purchasedOrder();
  const item = { component: "purchase", itemIndex: 0, amount: 14000, note: "Biaya barang sintetis" };
  const pendingItem = await send(initiator, disputed.id, "prepare", item);
  const race = await Promise.allSettled([disputed.dispute(3000), step(initiator, disputed.id, pendingItem, 1, "start")]);
  assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
  if (race[0].status === "fulfilled") {
    assert.match(race[1].reason.message, /CONFLICT: Allocation changed/);
    assert.equal((await detail(initiator, disputed.id)).history[0].allocationChanged, true);
    await step(initiator, disputed.id, pendingItem, 1, "abandon");
  } else {
    assert.match(race[0].reason.message, /VALIDATION: Disputed amount/);
    await step(initiator, disputed.id, pendingItem, 2, "not_sent");
    await disputed.dispute(3000);
  }
  await assert.rejects(send(initiator, disputed.id, "prepare", item), /CONFLICT: Insufficient/);
  const unaffected = await send(initiator, disputed.id, "prepare", { ...item, amount: 11000 });
  await assert.rejects(step(initiator, disputed.id, unaffected, 1, "start"), /CONFLICT/);
  await step(freshReviewer, disputed.id, unaffected, 1, "approve");
  await step(initiator, disputed.id, unaffected, 2, "start");
  await step(initiator, disputed.id, unaffected, 3, "ambiguous");
  await step(freshReviewer, disputed.id, unaffected, 4, "resolve_not_sent", { record: "Mutasi uji tidak memuat transfer" });
  assert.equal((await detail(initiator, disputed.id)).options.find(option => option.component === "purchase").amount, 11000);
  const startedFirst = await purchasedOrder();
  const reservedItem = await send(initiator, startedFirst.id, "prepare", item);
  await step(initiator, startedFirst.id, reservedItem, 1, "start");
  await assert.rejects(startedFirst.dispute(3000), /VALIDATION: Disputed amount/);
  await step(initiator, startedFirst.id, reservedItem, 2, "not_sent");
  assert.equal(typeof await startedFirst.dispute(3000), "string");
  console.log("PASS cancellation and dispute races, held item caps, disputed payout review and not-sent reconciliation");
} finally {
  await Promise.all(clients.map(client => client.end()));
  if (created) await admin.query(`drop database ${database}`);
  await admin.end();
}
