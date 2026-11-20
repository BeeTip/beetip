import assert from "node:assert/strict";
import { createHash, randomUUID as uuid } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55841/postgres");
assert(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && !url.search,
  "Use disposable loopback PostgreSQL");
assert(process.argv.length === 2 || process.argv[2] === "--baseline", "Expected --baseline or no argument");
const database = `booth_cases_${uuid().replaceAll("-", "")}`;
const admin = new pg.Client({ connectionString: url.href });
const clients = [];
let created = false;
url.pathname = `/${database}`;
const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const value = async (client, sql, args = []) => Object.values((await client.query(sql, args)).rows[0])[0];

try {
  await admin.connect();
  await admin.query(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  end $$`);
  await admin.query(`create database ${database} encoding 'UTF8' template template0`);
  created = true;

  async function connect() {
    const client = new pg.Client({ connectionString: url.href, statement_timeout: 12000 });
    await client.connect();
    clients.push(client);
    return client;
  }
  const owner = await connect();
  await owner.query(read("../supabase/tests/local_platform.sql"));
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort();
  for (const migration of migrations) {
    if (process.argv[2] === "--baseline" && migration.startsWith("20261121004100_")) continue;
    await owner.query(read(`../supabase/migrations/${migration}`));
  }

  async function actor(aal = "aal1") {
    const id = uuid(), session = uuid(), client = await connect();
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, id]);
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: session, aal })]);
    return { id, client };
  }
  const customer = await actor(), provider = await actor(), outsider = await actor();
  if (!migrations.some(file => file.startsWith("20261121004000_"))) {
    await owner.query("insert into private.booth_members values ($1),($2)", [customer.id, provider.id]);
  }

  async function order() {
    const listing = uuid(), offer = uuid();
    await owner.query(read("./booth-rating-cases-fixture.sql"), [listing, provider.id]);
    await customer.client.query("select public.save_offer($1,$2,$3,0,1,5000,'save')", [uuid(), offer, listing]);
    const id = await value(provider.client, "select public.accept_order($1,$2,1,$3,1)", [uuid(), listing, offer]);
    assert.equal(await value(owner, "select booth_demo from public.orders where id=$1", [id]), true);
    return id;
  }

  const completed = await order();
  const rating = (actor, orderId, key, score = 5, feedback = "  Terima kasih  ") =>
    value(actor.client, "select public.submit_order_rating($1,$2,$3,$4)", [key, orderId, score, feedback]);
  const readRating = (actor, orderId) => value(actor.client, "select public.read_order_rating($1)", [orderId]);
  const ratingKey = uuid(), expectedRating = { score: 5, feedback: "Terima kasih" };
  const simulate = id => customer.client.query("select public.confirm_booth_payment($1)", [id]);
  const deposit = (bucket, path) => owner.query("insert into storage.objects(id,bucket_id,name,metadata) values($1,$2,$3,$4)",
    [uuid(), bucket, path, { mimetype: "image/png", size: 100 }]);
  const purchase = (id, action, payload, key = uuid()) =>
    value(provider.client, "select public.record_purchase($1,$2,1,$3,$4)", [key, id, action, payload]);
  async function finishPurchase(id) {
    const key = uuid(), imageHash = createHash("sha256").update(key).digest("hex");
    await deposit("purchase-receipts", `${provider.id}/${id}/${key}/${imageHash}`);
    const date = await value(owner, "select (now() at time zone 'Asia/Jakarta')::date::text");
    const receipt = await purchase(id, "receipt", { merchant: "Warung", reference: key.slice(0, 8), date, discount: 0, imageHash,
      lines: [{ label: "Nasi", quantity: 1, gross: 15000 }] }, key);
    await purchase(id, "allocate", { receipt, entries: [{ line: 1, item: 0, quantity: 1 }] });
    await purchase(id, "finish", { unavailable: [], note: "" });
  }
  await assert.rejects(rating(customer, completed, ratingKey), /CONFLICT: Order is not eligible/);
  await simulate(completed);
  await finishPurchase(completed);
  await provider.client.query("select public.start_delivery($1)", [completed]);
  const { code } = await value(customer.client, "select public.issue_handover_code($1,true)", [completed]);
  const digest = createHash("sha256").update(`${completed}:${code}`).digest("hex");
  assert.equal(await value(provider.client, "select public.confirm_handover($1,$2)", [completed, digest]), "confirmed");
  assert.deepEqual(await rating(customer, completed, ratingKey), expectedRating);
  assert.deepEqual(await rating(customer, completed, ratingKey), expectedRating);
  assert.deepEqual(await readRating(customer, completed), expectedRating);
  assert.equal(await readRating(provider, completed), null);
  await assert.rejects(readRating(outsider, completed), /PERMISSION/);
  await assert.rejects(rating(outsider, completed, uuid()), /PERMISSION/);
  await assert.rejects(rating(customer, completed, ratingKey, 4), /CONFLICT: Changed operation payload/);
  await assert.rejects(rating(customer, completed, uuid()), /CONFLICT: Rating already submitted/);
  assert.deepEqual(await rating(provider, completed, uuid(), 4, ""), { score: 4, feedback: "" });
  console.log("PASS completed demo ratings reuse participant privacy, validation and operation replay");

  const command = (actor, id, action, payload, key = uuid()) =>
    value(actor.client, "select public.order_case_command($1,$2,$3,$4)", [key, id, action, payload]);
  const state = (actor, id) => value(actor.client, "select public.read_order_cases($1)", [id]);
  const cancelOrder = await order();
  await simulate(cancelOrder);
  assert.equal((await state(customer, cancelOrder)).canCancel, true);
  assert.equal(await value(owner, "select private.funding_purchase_ready($1)", [cancelOrder]), true);
  const cancellation = { kind: "cancellation", reason: "Pesanan tidak diperlukan" };
  const cancelKey = uuid(), zero = { purchase: 0, fee: 0, refund: 0 };
  async function staff(aal) {
    const member = await actor(aal);
    await owner.query("insert into public.staff_roles(member_id,role) values($1,'finance_operation')", [member.id]);
    await owner.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [uuid(), member.id]);
    return member;
  }
  const proposer = await staff("aal2"), reviewer = await staff("aal2");
  const unscoped = await staff("aal2"), low = await staff("aal1");
  const assign = (id, actor) => owner.query("insert into private.booth_case_operators values($1,$2)", [id, actor.id]);
  await assign(cancelOrder, proposer);
  await assign(cancelOrder, reviewer);
  await assign(cancelOrder, low);
  await assert.rejects(command(outsider, cancelOrder, "open", cancellation), /PERMISSION/);
  const cancelCase = await command(customer, cancelOrder, "open", cancellation, cancelKey);
  assert.equal(await command(customer, cancelOrder, "open", cancellation, cancelKey), cancelCase);
  await assert.rejects(command(customer, cancelOrder, "open", { ...cancellation, reason: "Berbeda" }, cancelKey), /CONFLICT/);
  await assert.rejects(command(provider, cancelOrder, "open", cancellation), /CONFLICT/);
  await assert.rejects(command(customer, completed, "open", cancellation), /CONFLICT/);
  const opened = await state(provider, cancelOrder);
  assert.equal(opened.case.id, cancelCase);
  assert.equal(opened.verified, 0);
  assert.deepEqual(opened.held, zero);
  assert.deepEqual(opened.allocation, zero);
  assert.deepEqual(opened.unheld, zero);
  assert.equal(opened.canCancel, false);
  await assert.rejects(purchase(cancelOrder, "finish", { unavailable: [0], note: "Stok habis" }), /CONFLICT: Purchase funding/);
  console.log("PASS cancellation opens idempotently, exposes zero funds, and pauses fulfillment");

  const queue = actor => value(actor.client, "select public.order_case_queue()");
  await assert.rejects(unscoped.client.query("insert into private.booth_case_operators values($1,$2)", [cancelOrder, unscoped.id]), /permission denied/);
  assert.equal((await queue(reviewer))[0].id, cancelCase);
  assert.deepEqual(await queue(unscoped), []);
  await assert.rejects(queue(low), /PERMISSION/);
  await assert.rejects(state(unscoped, cancelOrder), /PERMISSION/);
  await assert.rejects(state(low, cancelOrder), /PERMISSION/);
  await assert.rejects(state(reviewer, completed), /PERMISSION/);
  await assert.rejects(value(reviewer.client, "select public.read_manual_transfers($1)", [cancelOrder]), /PERMISSION|does not exist/);
  const notification = await value(owner, `select (select id from public.notifications
    where recipient_id=$1 and target_id=$2 and event_type='order_case_activity')`, [reviewer.id, cancelOrder]);
  assert.ok(notification, "The assigned reviewer should receive the case notification");
  assert.equal(await value(reviewer.client, "select public.notification_target($1)", [notification]), `/account/order-cases?order=${cancelOrder}`);
  await assert.rejects(value(low.client, "select public.notification_target($1)", [notification]), /PERMISSION/);

  const proposal = { caseId: cancelCase, outcome: "resolve", ...zero, reason: "Pesanan belum dibelanjakan" };
  await assert.rejects(command(proposer, cancelOrder, "propose", { ...proposal, refund: 1 }), /VALIDATION/);
  await assert.rejects(command(unscoped, cancelOrder, "propose", proposal), /PERMISSION/);
  const proposalId = await command(proposer, cancelOrder, "propose", proposal);
  const approval = { caseId: cancelCase, proposalId, decision: "approve", reason: "Pembatalan demo diperiksa" };
  await assert.rejects(command(proposer, cancelOrder, "review", approval), /PERMISSION/);
  await assert.rejects(command(low, cancelOrder, "review", approval), /PERMISSION/);
  const reviewKey = uuid();
  assert.equal(await command(reviewer, cancelOrder, "review", approval, reviewKey), proposalId);
  assert.equal(await command(reviewer, cancelOrder, "review", approval, reviewKey), proposalId);
  assert.equal((await state(customer, cancelOrder)).case.state, "resolved");
  assert.equal(await value(owner, "select state from public.orders where id=$1", [cancelOrder]), "cancelled");
  assert.equal(await value(owner, "select released_at is not null from public.reservations where order_id=$1", [cancelOrder]), true);
  assert.deepEqual(await queue(reviewer), []);
  console.log("PASS independent, scoped MFA review resolves cancellation and releases reservation capacity");

  const disputeOrder = await order();
  await simulate(disputeOrder);
  await assign(disputeOrder, proposer);
  await assign(disputeOrder, reviewer);
  assert.equal((await state(provider, disputeOrder)).canDispute, false);
  const disputeKey = uuid(), imageHash = createHash("sha256").update(disputeKey).digest("hex");
  const dispute = { kind: "dispute", reason: "Pesanan yang diterima berbeda", imageHash };
  const evidencePath = (actor, id, key, upload) => value(actor.client, "select public.order_case_evidence($1,$2,$3)", [id, key, upload]);
  await assert.rejects(evidencePath(outsider, disputeOrder, disputeKey, true), /PERMISSION/);
  const prefix = await evidencePath(customer, disputeOrder, disputeKey, true);
  await assert.rejects(command(customer, disputeOrder, "open", dispute, disputeKey), /VALIDATION: Evidence missing/);
  await deposit("order-case-evidence", `${prefix}/${imageHash}`);
  await assert.rejects(command(customer, disputeOrder, "open", dispute, disputeKey), /CONFLICT: Complete purchase progress/);
  await finishPurchase(disputeOrder);
  assert.equal((await state(provider, disputeOrder)).canDispute, true);
  await assert.rejects(command(customer, disputeOrder, "open", { ...dispute, amount: 10, component: "fee" }, disputeKey), /VALIDATION/);
  const disputeCase = await command(customer, disputeOrder, "open", dispute, disputeKey);
  assert.equal(await command(customer, disputeOrder, "open", dispute, disputeKey), disputeCase);
  const disputed = await state(reviewer, disputeOrder);
  assert.equal(disputed.boothDemo, true);
  assert.equal(disputed.case.id, disputeCase);
  assert.deepEqual(disputed.held, zero);
  assert.equal(disputed.case.itemIndex, null);
  const evidence = disputed.case.evidence[0].id;
  assert.equal(await evidencePath(reviewer, disputeOrder, evidence, false), `${prefix}/${imageHash}`);
  await assert.rejects(evidencePath(reviewer, cancelOrder, evidence, false), /PERMISSION/);
  await assert.rejects(evidencePath(unscoped, disputeOrder, evidence, false), /PERMISSION/);
  await provider.client.query("select public.start_delivery($1)", [disputeOrder]);
  const resolution = await command(proposer, disputeOrder, "propose", { ...proposal, caseId: disputeCase });
  await command(reviewer, disputeOrder, "review", { ...approval, caseId: disputeCase, proposalId: resolution });
  const resolved = await state(provider, disputeOrder);
  assert.equal(resolved.case.state, "resolved");
  assert.deepEqual(resolved.allocation, zero);
  assert.equal(await value(owner, "select state from public.orders where id=$1", [disputeOrder]), "delivering");
  assert.equal(await value(owner, `select exists(select 1 from private.funding_submissions)
    or exists(select 1 from private.manual_transfers) or exists(select 1 from private.case_transfer_claims)
    or exists(select 1 from public.reservations where funding_verified_at is not null)`), false);
  await assert.rejects(owner.query("select private.claim_case_transfer($1,'refund',1,null)", [cancelOrder]), /CONFLICT: Insufficient unheld entitlement/);
  await owner.query("delete from private.booth_case_operators where order_id=$1 and member_id=$2", [disputeOrder, reviewer.id]);
  await assert.rejects(evidencePath(reviewer, disputeOrder, evidence, false), /PERMISSION/);
  await assert.rejects(state(reviewer, disputeOrder), /PERMISSION/);
  console.log("PASS demo dispute evidence, review, fulfillment, and zero funding/transfer writes");

  const legacyOrder = await order(), legacyCase = uuid(), legacyProposal = uuid(), legacyEvidence = uuid(), fundingAccount = uuid();
  const legacyPlace = `${customer.id}/${legacyOrder}/${uuid()}/${imageHash}`;
  await owner.query("update public.orders set booth_demo=false where id=$1", [legacyOrder]);
  await owner.query("delete from private.booth_payments where order_id=$1", [legacyOrder]);
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Riwayat kasus')", [fundingAccount]);
  await owner.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
    values($1,$2,$3,20000,'verified',now(),now(),$4)`, [legacyOrder, fundingAccount, `TEST${uuid().replaceAll("-", "").toUpperCase()}`, proposer.id]);
  await owner.query("update public.reservations set funding_verified_at=now() where order_id=$1", [legacyOrder]);
  await owner.query("insert into private.funding_account_operators values($1,$2),($1,$3)", [fundingAccount, proposer.id, reviewer.id]);
  await owner.query(`insert into private.order_cases(id,order_id,opened_by,kind,reason,baseline,held)
    values($1,$2,$3,'cancellation','Kasus historis',row(0,5000,15000),row(0,5000,15000))`, [legacyCase, legacyOrder, customer.id]);
  await owner.query(`insert into private.order_case_proposals(id,case_id,proposed_by,outcome,allocation,evidence_count,reason)
    values($1,$2,$3,'resolve',row(0,0,20000),1,'Usulan historis')`, [legacyProposal, legacyCase, proposer.id]);
  await owner.query(`insert into private.order_case_evidence(id,case_id,submitted_by,object_name,note)
    values($1,$2,$3,$4,'Bukti historis')`, [legacyEvidence, legacyCase, customer.id, legacyPlace]);
  await deposit("order-case-evidence", legacyPlace);
  const historical = await state(reviewer, legacyOrder);
  assert.equal(historical.boothDemo, false);
  assert.equal(historical.verified, 20000);
  assert.equal(historical.case.id, legacyCase);
  assert.equal(await evidencePath(reviewer, legacyOrder, legacyEvidence, false), legacyPlace);
  assert.equal(await evidencePath(provider, legacyOrder, legacyEvidence, false), legacyPlace);
  await assert.rejects(evidencePath(unscoped, legacyOrder, legacyEvidence, false), /PERMISSION/);
  await assert.rejects(evidencePath(customer, legacyOrder, uuid(), true), /PERMISSION/);
  const readOnly = /PERMISSION: Legacy order cases are read-only/;
  await assert.rejects(command(customer, legacyOrder, "open", cancellation), readOnly);
  await assert.rejects(command(customer, legacyOrder, "evidence", { caseId: legacyCase, imageHash, reason: "Lampiran baru" }), readOnly);
  await assert.rejects(command(proposer, legacyOrder, "propose", { ...proposal, caseId: legacyCase, refund: 20000 }), readOnly);
  await assert.rejects(command(reviewer, legacyOrder, "review", { ...approval, caseId: legacyCase, proposalId: legacyProposal }), readOnly);
  assert.equal(historical.case.proposal.canReview, false);
  assert.deepEqual(await state(reviewer, legacyOrder), historical);
  assert.equal(await value(owner, "select state from public.orders where id=$1", [legacyOrder]), "awaiting_payment");
  console.log("PASS legacy case commands and uploads blocked; scoped case history and evidence remain readable");
} finally {
  await Promise.all(clients.map(client => client.end()));
  if (created) await admin.query(`drop database ${database}`);
  await admin.end();
}
