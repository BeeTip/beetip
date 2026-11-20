import assert from "node:assert/strict";
import { createHash, randomUUID as uuid } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL ?? "postgres://postgres@127.0.0.1:55518/postgres");
assert(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname === "127.0.0.1" && !url.search,
  "Use disposable loopback PostgreSQL");
const database = `btp19_${uuid().replaceAll("-", "")}`;
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
  for (const file of readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter(file => file.endsWith(".sql")).sort()) {
    await owner.query(read(`../supabase/migrations/${file}`));
  }

  async function actor({ role, aal = "aal1" } = {}) {
    const id = uuid(), session = uuid(), client = await connect();
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, `${id}@example.invalid`]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, id]);
    if (role) {
      await owner.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [uuid(), id]);
      await owner.query("insert into public.staff_roles(member_id,role) values($1,$2)", [id, role]);
    }
    const claims = JSON.stringify({ sub: id, session_id: session, aal });
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [claims]);
    return { id, client, claims };
  }

  const provider = await actor(), customer = await actor(), outsider = await actor();
  const operator = await actor({ role: "platform_admin", aal: "aal2" });
  const weakOperator = await actor({ role: "platform_admin" });
  const listing = uuid();
  const terms = {
    type: "trip", title: "Titipan makan siang", shop: "Warung", category: "Makanan", area: "Alam Sutera", destination: "Kampus",
    items: [{ name: "Nasi", specification: "", quantity: 1, unitBudget: 60000 }],
    fee: 10000, bound: 10000, negotiable: false, capacity: 1, spendingCapacity: 60000, status: "active",
    cutoff: new Date(Date.now() + 3600000).toISOString(), start: new Date(Date.now() + 7200000).toISOString(),
    end: new Date(Date.now() + 10800000).toISOString(),
  };
  await value(provider.client, "select public.save_listing($1,$2,0,$3)", [uuid(), listing, terms]);
  const moderate = (actor, version, status, operation = uuid(), reason = "Pemeriksaan keamanan") =>
    value(actor.client, "select public.moderate_listing($1,$2,$3,$4,$5)", [operation, listing, version, status, reason]);
  const offer = uuid();
  const saveOffer = (actor, id, version, listingVersion, action = "save") =>
    value(actor.client, "select public.save_offer($1,$2,$3,$4,$5,10000,$6)", [uuid(), id, listing, version, listingVersion, action]);
  const accept = (version, offerVersion, operation = uuid()) =>
    value(provider.client, "select public.accept_order($1,$2,$3,$4,$5)", [operation, listing, version, offer, offerVersion]);
  await saveOffer(customer, offer, 0, 1);
  await assert.rejects(moderate(provider, 1, "paused"), /PERMISSION/);
  await assert.rejects(moderate(weakOperator, 1, "paused"), /PERMISSION/);
  await assert.rejects(value(provider.client, "select public.listing_moderation_queue('')"), /PERMISSION/);
  assert.equal((await value(operator.client, "select public.listing_moderation_queue($1)", [listing]))[0].id, listing);
  await assert.rejects(moderate(operator, 1, "paused", uuid(), " "), /VALIDATION/);

  const moderationOperation = uuid();
  await operator.client.query("begin");
  await moderate(operator, 1, "paused", moderationOperation);
  const lostAcceptance = assert.rejects(accept(1, 1), /CONFLICT: Listing closed/);
  const pid = provider.client.processID;
  let blocked = false;
  for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
    blocked = await value(owner, "select $1 = any(pg_blocking_pids($2))", [operator.client.processID, pid]);
    if (!blocked) await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.ok(blocked, "Acceptance waits on the moderation transaction");
  await operator.client.query("commit");
  await lostAcceptance;
  await moderate(operator, 1, "paused", moderationOperation);
  assert.equal(await value(owner, "select count(*)::int from private.audit_events where operation_id=$1", [moderationOperation]), 1);
  assert.deepEqual((await owner.query("select recipient_id from public.notifications where event_type='listing_moderated' and target_id=$1", [listing]))
    .rows.map(row => row.recipient_id).sort(), [provider.id, customer.id].sort());
  assert.deepEqual(await value(outsider.client, "select public.browse_listings(p_id=>$1)", [listing]), []);
  const customerInbox = await value(customer.client, "select public.notification_inbox()");
  const moderationNotice = customerInbox.items.find(item => item.event_type === "listing_moderated");
  assert.equal(await value(customer.client, "select public.notification_target($1)", [moderationNotice.id]), `/account/offers?listing=${listing}`);
  assert.equal((await value(customer.client, "select public.offer_listing($1)", [listing])).status, "paused");
  await assert.rejects(saveOffer(outsider, uuid(), 0, 2), /CONFLICT: Listing closed/);
  await assert.rejects(value(provider.client, "select public.save_listing($1,$2,2,$3)", [uuid(), listing, terms]), /CONFLICT/);
  console.log("PASS moderation authorization, audit, notifications, owner bypass and acceptance race");

  await moderate(operator, 2, "active");
  await assert.rejects(accept(3, 1), /consent stale/);
  await saveOffer(customer, offer, 1, 3);
  const acceptanceOperation = uuid();
  await provider.client.query("begin");
  const order = await accept(3, 2, acceptanceOperation);
  const removal = moderate(operator, 3, "removed");
  blocked = false;
  for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
    blocked = await value(owner, "select $1 = any(pg_blocking_pids($2))", [provider.client.processID, operator.client.processID]);
    if (!blocked) await new Promise(resolve => setTimeout(resolve, 15));
  }
  assert.ok(blocked, "Moderation waits on the acceptance transaction");
  await provider.client.query("commit");
  await removal;
  assert.equal(await accept(3, 2, acceptanceOperation), order);
  await assert.rejects(moderate(operator, 4, "active"), /capacity full/);
  assert.equal((await value(customer.client, "select public.read_order($1)", [order])).id, order);
  assert.equal((await value(provider.client, "select public.read_order($1)", [order])).state, "awaiting_payment");
  await assert.rejects(value(provider.client, "select public.save_listing($1,$2,4,$3)", [uuid(), listing, terms]), /Only an operator/);
  await assert.rejects(value(provider.client, "select public.save_listing($1,$2,4,$3)", [uuid(), listing, { ...terms, status: "removed" }]), /Only an operator/);
  await assert.rejects(value(provider.client, "select public.save_listing($1,$2,0,$3)", [uuid(), uuid(), { ...terms, status: "removed" }]), /VALIDATION/);
  await owner.query("update public.reservations set expires_at=now()-interval '1 minute' where order_id=$1", [order]);
  assert.equal(await value(owner, "select private.btp07_expire_reservations(10)"), 1);
  await moderate(operator, 4, "closed");
  await owner.query("update public.listings set cutoff_at=now()-interval '1 minute' where id=$1", [listing]);
  await assert.rejects(moderate(operator, 5, "active"), /future schedule/);
  await value(provider.client, "select public.save_listing($1,$2,5,$3)", [uuid(), listing, { ...terms, status: "closed" }]);
  await moderate(operator, 6, "active");
  assert.equal((await value(outsider.client, "select public.browse_listings(p_id=>$1)", [listing]))[0].version, 7);

  const fixed = uuid();
  await value(customer.client, "select public.save_listing($1,$2,0,$3)", [uuid(), fixed, { ...terms, type: "request" }]);
  await value(operator.client, "select public.moderate_listing($1,$2,1,'closed','Pemeriksaan keamanan')", [uuid(), fixed]);
  await assert.rejects(value(provider.client, "select public.accept_order($1,$2,2)", [uuid(), fixed]), /Listing closed/);
  await value(operator.client, "select public.moderate_listing($1,$2,2,'active','Pemeriksaan selesai')", [uuid(), fixed]);
  const fixedOrder = await value(provider.client, "select public.accept_order($1,$2,3)", [uuid(), fixed]);
  await owner.query("update public.reservations set expires_at=now()-interval '1 minute' where order_id=$1", [fixedOrder]);
  await assert.rejects(value(operator.client, "select public.moderate_listing($1,$2,3,'active','Buka permintaan')", [uuid(), fixed]), /Request already accepted/);
  console.log("PASS acceptance first, capacity, expired schedule, reschedule and reopening");

  const nextOffer = uuid();
  await saveOffer(customer, nextOffer, 0, 7);
  const delivered = await value(provider.client, "select public.accept_order($1,$2,7,$3,1)", [uuid(), listing, nextOffer]);
  const rating = (actor, id, score, feedback, operation = uuid()) =>
    value(actor.client, "select public.submit_order_rating($1,$2,$3,$4)", [operation, id, score, feedback]);
  const readRating = (actor, id) => value(actor.client, "select public.read_order_rating($1)", [id]);
  await assert.rejects(rating(customer, delivered, 5, ""), /CONFLICT: Order is not eligible/);
  await assert.rejects(rating(customer, order, 5, ""), /CONFLICT: Order is not eligible/);
  await moderate(operator, 7, "removed");

  await value(customer.client, "select public.btp08_send($1,$2,$3)", [delivered, uuid(), "Sampai jumpa di kampus"]);
  const thread = await value(provider.client, "select public.btp08_history($1,null,null)", [delivered]);
  assert.match(JSON.stringify(thread), /Sampai jumpa di kampus/);
  const finance = await actor({ role: "finance_operation", aal: "aal2" });
  const account = uuid();
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Akun sintetis')", [account]);
  await owner.query("insert into private.synthetic_transfer_accounts values($1)", [account]);
  await owner.query("insert into private.funding_account_operators values($1,$2)", [account, finance.id]);
  await owner.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
    values($1,$2,$3,70000,'verified',now(),now(),$4)`, [delivered, account, `TEST${uuid().replaceAll("-", "").toUpperCase()}`, finance.id]);
  await owner.query("update public.reservations set funding_verified_at=now() where order_id=$1", [delivered]);
  const evidence = uuid(), hash = createHash("sha256").update(evidence).digest("hex");
  const evidencePath = `${provider.id}/${delivered}/${evidence}/${hash}`;
  await owner.query("insert into storage.objects(id,bucket_id,name,metadata) values($1,'purchase-receipts',$2,$3)",
    [uuid(), evidencePath, { mimetype: "image/png", size: 123 }]);
  const purchase = (action, payload, operation = uuid()) =>
    value(provider.client, "select public.record_purchase($1,$2,1,$3,$4)", [operation, delivered, action, payload]);
  const date = await value(owner, "select (now() at time zone 'Asia/Jakarta')::date::text");
  const receipt = await purchase("receipt", { merchant: "Warung", reference: evidence.slice(0, 8), date, discount: 0, imageHash: hash,
    lines: [{ label: "Nasi", gross: 60000, quantity: 1 }] }, evidence);
  await purchase("allocate", { receipt, entries: [{ line: 1, item: 0, quantity: 1 }] });
  await purchase("finish", { unavailable: [], note: "" });
  assert.equal(await value(provider.client, "select public.purchase_evidence_path($1,$2,false)", [delivered, receipt]), evidencePath);
  await assert.rejects(value(customer.client, "select public.purchase_evidence_path($1,$2,false)", [delivered, receipt]), /PERMISSION/);
  await value(provider.client, "select public.start_delivery($1)", [delivered]);
  const { code } = await value(customer.client, "select public.issue_handover_code($1,true)", [delivered]);
  const digest = createHash("sha256").update(`${delivered}:${code}`).digest("hex");
  assert.equal(await value(provider.client, "select public.confirm_handover($1,$2)", [delivered, digest]), "confirmed");
  const transfer = (action, payload) => value(finance.client, "select public.manual_transfer_command($1,$2,$3,$4)",
    [uuid(), delivered, action, { note: "Pencatatan transfer sintetis", ...payload }]);
  const transferId = await transfer("prepare", { component: "purchase", amount: 60000, itemIndex: 0 });
  await transfer("start", { transferId, version: 1 });
  await transfer("completed", { transferId, version: 2, reference: `TEST${uuid().replaceAll("-", "").toUpperCase()}` });
  const report = await value(finance.client, "select public.read_reconciliation('order',$1)", [delivered]);
  assert.equal(report.totals.purchase_paid, "60000");
  console.log("PASS removed listing preserves order chat, purchase evidence, handover and synthetic reconciliation");
  await assert.rejects(rating(outsider, delivered, 5, ""), /PERMISSION/);
  await assert.rejects(readRating(operator, delivered), /PERMISSION/);
  await assert.rejects(rating(customer, delivered, 6, ""), /VALIDATION/);
  await assert.rejects(rating(customer, delivered, 5, "x".repeat(501)), /VALIDATION/);
  const retryOperation = uuid();
  const score = await rating(customer, delivered, 5, "  Layanan baik  ", retryOperation);
  assert.deepEqual(score, { score: 5, feedback: "Layanan baik" });
  assert.deepEqual(await rating(customer, delivered, 5, "Layanan baik", retryOperation), score);
  assert.deepEqual(await readRating(customer, delivered), score);
  assert.equal(await readRating(provider, delivered), null);
  await assert.rejects(rating(customer, delivered, 3, "", retryOperation), /Changed operation payload/);
  const providerAgain = await connect();
  await providerAgain.query("set role authenticated");
  await providerAgain.query("select set_config('request.jwt.claims',$1,false)", [provider.claims]);
  const attempts = await Promise.allSettled([
    rating(provider, delivered, 4, ""),
    rating({ client: providerAgain }, delivered, 1, "Catatan pribadi"),
  ]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.match(attempts.find(result => result.status === "rejected").reason.message, /Rating already submitted/);
  assert.deepEqual(await readRating(customer, delivered), score);
  await assert.rejects(outsider.client.query("select * from private.order_ratings"), /permission denied/);
  const anonymous = await connect();
  await anonymous.query("set role anon");
  await assert.rejects(readRating({ client: anonymous }, delivered), /permission denied/);
  await owner.query("update public.staff_roles set revoked_at=now() where member_id=$1", [operator.id]);
  await assert.rejects(moderate(operator, 1, "paused", moderationOperation), /PERMISSION/);
  await assert.rejects(value(operator.client, "select public.listing_moderation_queue('')"), /PERMISSION/);
  console.log("PASS rating eligibility, author privacy, score bounds, replay and duplicate race");
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  if (created) await admin.query(`drop database ${database} with (force)`);
  await admin.end();
}
