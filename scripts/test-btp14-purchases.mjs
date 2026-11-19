import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID as uuid } from "node:crypto";
import { createRequire } from "node:module";
import { setTimeout } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";
import pg from "pg";

const workdir = process.env.BEETIP_TEST_LOCAL_STACK;
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3114";
assert(workdir && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Use a dedicated disposable loopback stack and app");
const stack = JSON.parse(execFileSync("rtk", ["proxy", "supabase", "status", "--workdir", workdir, "-o", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const db = new URL(stack.DB_URL);
assert(db.protocol === "postgresql:" && db.hostname === "127.0.0.1" && !db.search);
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(stack.API_URL));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");
const admin = createClient(stack.API_URL, stack.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const connections = [];
const path = `${origin}/api/identity/purchases`;
const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
const terms = [{ name: "Nasi", specification: "", quantity: 2, unitBudget: 20000 }, { name: "Teh", specification: "Tawar", quantity: 1, unitBudget: 6000 }];
let browser;

async function connect(member) {
  const client = new pg.Client({ connectionString: db.href, statement_timeout: 15000 });
  await client.connect();
  connections.push(client);
  if (member) {
    const sessionId = await value(client, "select id from auth.sessions where user_id=$1 order by created_at desc limit 1", [member.id]);
    await client.query("set role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: member.id, session_id: sessionId, aal: "aal1" })]);
  }
  return client;
}

async function actor() {
  const email = `btp14-${uuid()}@example.invalid`, password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Penguji Struk" } });
  assert.ifError(error);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/account");
  const member = { id: data.user.id, context, page };
  return { ...member, sql: await connect(member) };
}

async function checked(response, status = 200) {
  assert.equal(response.status(), status, await response.text());
  assert.match(response.headers()["cache-control"], /private, no-store/);
  return response;
}

const value = async (sql, statement, values = []) => Object.values((await sql.query(statement, values)).rows[0])[0];
const headers = member => ({ Origin: origin, "X-Beetip-Member": member.id });
const evidence = (order, key) => `${path}/evidence?${new URLSearchParams({ order, key })}`;
const command = (orderId, action, payload) => ({ orderId, action, payload, version: 1, operationId: uuid() });
const allocate = (order, receipt, entries) => command(order, "allocate", { receipt, entries });
const entry = (line = 1, item = 0, quantity = 1) => ({ line, item, quantity });
async function post(member, data, status) {
  return (await checked(await member.context.request.post(path, { headers: headers(member), data }), status)).json();
}
async function read(member, id, status) {
  return (await checked(await member.context.request.get(`${path}?id=${id}`), status)).json();
}
async function upload(member, order, key, image, status) {
  return (await checked(await member.context.request.put(evidence(order, key), {
    headers: { ...headers(member), "Content-Type": "image/png" }, data: image,
  }), status)).json();
}

try {
  const owner = await connect();
  assert.equal(await value(owner, "select id from storage.buckets where id='purchase-receipts' and public=false"), "purchase-receipts");
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  const provider = await actor(), a = await actor(), b = await actor(), c = await actor();
  const account = uuid();
  await owner.query("insert into private.funding_accounts(id,label) values($1,'Akun simulasi struk')", [account]);

  async function trip(title) {
    const id = uuid();
    await owner.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
      values($1,$2,'trip',$3,'Warung','Makanan','Alam Sutera','Kampus',$4,46000,5000,5000,false,3,150000,
        now()+interval '24 hours',now()+interval '25 hours',now()+interval '23 hours','active')`, [id, provider.id, title, JSON.stringify(terms)]);
    return id;
  }
  async function order(member, listing) {
    const offer = uuid();
    await member.sql.query("select public.save_offer($1,$2,$3,0,1,5000,'save')", [uuid(), offer, listing]);
    return value(provider.sql, "select public.accept_order($1,$2,1,$3,1)", [uuid(), listing, offer]);
  }
  async function fund(id) {
    await owner.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
      select $1,$2,$3,private.funding_required($1),'verified',now(),now(),$4`, [id, account, `TEST${uuid().replaceAll("-", "").toUpperCase()}`, c.id]);
    await owner.query("update public.reservations set funding_verified_at=now() where order_id=$1", [id]);
  }
  const listing = await trip("Belanja bersama"), otherListing = await trip("Belanja terpisah");
  const first = await order(a, listing), second = await order(b, listing), third = await order(c, listing), other = await order(a, otherListing);
  const expired = await order(b, otherListing);
  await owner.query("update public.reservations set expires_at=now()-interval '1 minute' where order_id=$1", [expired]);
  await Promise.all([fund(first), fund(second), fund(third)]);
  const img = async color => sharp({ create: { width: 24, height: 32, channels: 3, background: color } })
    .png().withMetadata({ exif: { IFD0: { Artist: "SYNTHETIC-EXIF" } } }).toBuffer();
  const image = await img("#fdb900"), different = await img("#445500");
  const base = { merchant: "Warung  Nasi", reference: "NY-01", date, discount: 3001,
    lines: [{ label: "Nasi", quantity: 3, gross: 60002 }, { label: "Teh", quantity: 1, gross: 6001 }] };
  const draft = command(first, "receipt", { ...base, imageHash: "a".repeat(64) });
  await read(b, first, 403);
  await post(a, draft, 403);
  await post(provider, { ...draft, orderId: other }, 409);
  await post(provider, { ...draft, orderId: expired }, 409);
  await upload(provider, other, draft.operationId, image, 403);
  await upload(a, first, draft.operationId, image, 403);
  await post(provider, draft, 400);

  const { page } = provider;
  const progress = page.getByRole("region", { name: "Progres belanja" });
  await page.goto(`${origin}/orders/${first}`);
  await expect(progress.getByText("Siap dibelanjakan")).toBeVisible();
  const companionLinks = progress.getByRole("navigation", { name: "Pesanan lain dalam perjalanan ini" }).getByRole("link");
  await expect(companionLinks).toHaveCount(2);
  await expect(companionLinks.first()).toHaveAttribute("href", `/orders/${second}`);
  await progress.getByRole("button", { name: "Tambah struk" }).click();
  await progress.getByLabel("Nama toko").fill(base.merchant);
  await progress.getByLabel("Nomor struk").fill(base.reference);
  await progress.getByLabel("Foto struk", { exact: false }).setInputFiles({ name: "struk.png", mimeType: "image/png", buffer: image });
  await progress.getByRole("button", { name: "Tambah baris struk" }).click();
  for (const [index, line] of base.lines.entries()) {
    const fields = progress.getByRole("group", { name: `Baris struk ${index + 1}` });
    await fields.getByLabel("Nama barang di struk").fill(line.label);
    await fields.getByLabel("Jumlah di struk").fill(String(line.quantity));
    await fields.getByLabel("Total baris sebelum diskon bersama (Rp)").fill(String(line.gross));
  }
  await progress.getByLabel("Diskon bersama pada struk (Rp)").fill(String(base.discount));
  await progress.getByRole("button", { name: "Simpan struk" }).click();
  await expect(progress.getByText("Struk tersimpan.", { exact: false })).toBeVisible();
  await expect(progress.getByRole("button", { name: "Simpan alokasi" })).toBeVisible();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Receipt and allocation controls fit mobile width");
  const [receipt] = (await read(provider, first)).purchase.receipts;
  const object = await checked(await provider.context.request.get(evidence(first, receipt.id)));
  assert.match(object.headers()["content-disposition"], /^attachment/);
  assert.equal((await sharp(await object.body()).metadata()).exif, undefined);
  await checked(await a.context.request.get(evidence(first, receipt.id)), 403);
  await checked(await provider.context.request.get(evidence(other, receipt.id)), 403);
  assert((await createClient(stack.API_URL, stack.PUBLISHABLE_KEY).storage.from("purchase-receipts").download(
    await value(owner, "select object_name from private.purchase_receipt_evidence where receipt_id=$1", [receipt.id]))).error);

  await fund(other);
  const { imageHash } = await upload(provider, first, draft.operationId, different);
  assert.equal((await upload(provider, first, draft.operationId, different)).imageHash, imageHash);
  await post(provider, { ...draft, orderId: second, payload: { ...base, imageHash } }, 400);
  await post(provider, { ...draft, payload: { ...base, merchant: "WARUNG NASI", reference: " n y 01 ", imageHash } }, 409);
  const duplicate = command(first, "receipt", { ...base, reference: "NY-02", imageHash: "" });
  duplicate.payload.imageHash = (await upload(provider, first, duplicate.operationId, image)).imageHash;
  await post(provider, duplicate, 409);
  await post(provider, allocate(other, receipt.id, [entry()]), 403);
  await post(provider, allocate(first, receipt.id, [entry(), entry()]), 400);
  const tooExpensive = command(first, "receipt", { ...base, reference: "NY-03", discount: 0,
    lines: [{ label: "Nasi mahal", quantity: 1, gross: 20001 }], imageHash });
  tooExpensive.payload.imageHash = (await upload(provider, first, tooExpensive.operationId, different)).imageHash;
  const expensive = (await post(provider, tooExpensive)).resultId;
  await post(provider, allocate(first, expensive, [entry()]), 409);
  await post(provider, allocate(first, receipt.id, [entry(), entry(2, 1, 2)]), 409);
  assert.equal((await read(a, first)).purchase.allocations.length, 0, "A failing second entry rolls back the first");

  await progress.getByLabel("Baris yang akan dialokasikan").selectOption("1");
  await progress.getByLabel("Barang pesanan").selectOption("0");
  await progress.getByRole("button", { name: "Tambah alokasi" }).click();
  const secondRow = progress.getByRole("group", { name: "Alokasi 2" });
  await secondRow.getByLabel("Baris yang akan dialokasikan").selectOption("2");
  await secondRow.getByLabel("Barang pesanan").selectOption("1");
  const requests = [];
  await page.route(path, async route => {
    if (route.request().method() !== "POST") return route.continue();
    requests.push(route.request().postData());
    if (requests.length > 1) return route.continue();
    await checked(await route.fetch());
    await route.abort();
  });
  await progress.getByRole("button", { name: "Simpan alokasi" }).click();
  await progress.getByRole("button", { name: "Kirim ulang tindakan" }).click();
  await expect(progress.getByText("Alokasi tersimpan.")).toBeVisible();
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
  await page.unroute(path);
  await post(provider, { ...JSON.parse(requests[0]), payload: { receipt: receipt.id, entries: [entry()] } }, 409);
  await post(provider, allocate(second, receipt.id, [entry()]));

  const change = newTerms => provider.sql.query("select public.amend_order($1,$2,'propose',1,null,$3,'Alternatif')", [uuid(), first, JSON.stringify(newTerms)]);
  await assert.rejects(change([{ ...terms[0], name: "Pengganti" }, terms[1]]), /CONFLICT: Purchased items/);
  const proposal = await value(provider.sql, "select public.amend_order($1,$2,'propose',1,null,$3,'Alternatif')",
    [uuid(), first, JSON.stringify([...terms, { name: "Buah", specification: "", quantity: 1, unitBudget: 5000 }])]);
  await post(provider, command(first, "finish", { unavailable: [0], note: "Stok habis" }), 409);
  await a.sql.query("select public.amend_order($1,$2,'reject',1,$3)", [uuid(), first, proposal]);

  const racer = await connect(provider), locker = await connect();
  const run = (sql, cmd) => value(sql, "select public.record_purchase($1,$2,$3,$4,$5)",
    [cmd.operationId, cmd.orderId, cmd.version, cmd.action, JSON.stringify(cmd.payload)]);
  await locker.query("begin");
  await locker.query("select 1 from public.listings where id=$1 for update", [listing]);
  const results = Promise.allSettled([run(provider.sql, allocate(second, receipt.id, [entry()])), run(racer, allocate(third, receipt.id, [entry()]))]);
  try {
    for (const sql of [provider.sql, racer]) {
      for (let attempt = 0; ; attempt++) {
        if (await value(owner, "select wait_event_type from pg_stat_activity where pid=$1", [sql.processID]) === "Lock") break;
        assert(attempt < 100, "Both allocations must reach the shared listing lock");
        await setTimeout(20);
      }
    }
  } finally { await locker.query("rollback"); }
  const outcomes = await results;
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.match(outcomes.find(result => result.status === "rejected").reason.message, /Receipt line quantity exhausted/);
  const totals = (await owner.query(`select sum(quantity)::int as quantity,sum(gross)::int as gross,sum(discount)::int as discount,sum(net)::int as net
    from private.purchase_allocations where receipt_id=$1`, [receipt.id])).rows[0];
  assert.deepEqual(totals, { quantity: 4, gross: 66003, discount: 3001, net: 63002 });

  await post(provider, command(first, "finish", { unavailable: [], note: "" }), 409);
  await progress.getByRole("button", { name: "Selesaikan belanja" }).click();
  await progress.getByRole("checkbox", { name: /Nasi.*tidak tersedia/ }).check();
  await progress.getByLabel("Alasan barang tidak tersedia").fill("Stok habis setelah satu barang dibeli.");
  await progress.getByRole("button", { name: "Konfirmasi selesai" }).click();
  await expect(progress.getByText("Sebagian barang dibeli", { exact: true })).toBeVisible();
  await expect(progress.getByRole("button", { name: "Selesaikan belanja" })).toHaveCount(0);
  await assert.rejects(change([{ ...terms[0], name: "Pengganti" }, terms[1]]), /Shopping already completed/);
  await a.page.goto(`${origin}/orders/${first}`);
  const customerProgress = a.page.getByRole("region", { name: "Progres belanja" });
  await expect(customerProgress.getByText("Sebagian barang dibeli", { exact: true })).toBeVisible();
  await customerProgress.getByText("Rincian struk dan diskon").click();
  await expect(customerProgress.getByText(/dikurangi.*=/).first()).toBeVisible();
  await expect(customerProgress.getByText(/Nasi.*tidak tersedia 1/)).toBeVisible();
  await expect(customerProgress.getByRole("link", { name: "Unduh foto struk" })).toHaveCount(0);
  const customer = (await read(a, first)).purchase;
  assert.equal(customer.allocations.length, 2);
  const riceDiscount = Math.floor(base.discount * base.lines[0].gross / 66003);
  assert.deepEqual(customer.allocations.map(({ gross, discount, net }) => [gross, discount, net]), [
    [20000, Math.floor(riceDiscount * 20000 / 60002), 20000 - Math.floor(riceDiscount * 20000 / 60002)],
    [6001, base.discount - riceDiscount, 6001 - (base.discount - riceDiscount)],
  ]);
  assert.equal(customer.receipts.length, 0);
  assert.equal(customer.tripOrders.length, 0);
  assert.equal(customer.customerName, null);
  assert.equal(customer.spent, customer.allocations.reduce((sum, row) => sum + row.net, 0));
  assert.equal((await read(b, second)).purchase.allocations.every(row => row.item === 0), true);
  assert.equal(await value(owner, "select count(*)::int from private.purchase_completions where order_id=$1", [first]), 1);
  await a.page.goto(`${origin}/account/orders`);
  await expect(a.page.getByText("Sebagian barang dibeli", { exact: false })).toBeVisible();

  const unavailable = command(other, "finish", { unavailable: [0, 1], note: "Toko tutup" });
  assert.equal((await post(provider, unavailable)).resultId, (await post(provider, unavailable)).resultId);
  assert.equal((await read(a, other)).purchase.state, "purchase_unavailable");
  const remainingRice = 2 - (await read(b, second)).purchase.items[0].purchased;
  const finalReceipt = command(second, "receipt", { ...base, reference: "NY-04", discount: 0, imageHash: "",
    lines: [{ label: "Teh", quantity: 1, gross: 6000 }, { label: "Nasi", quantity: 1, gross: 20000 }] });
  finalReceipt.payload.imageHash = (await upload(provider, second, finalReceipt.operationId, await img("#445566"))).imageHash;
  const { resultId } = await post(provider, finalReceipt);
  await post(provider, allocate(second, resultId, [entry(1, 1), ...(remainingRice ? [entry(2, 0)] : [])]));
  await post(provider, command(second, "finish", { unavailable: [], note: "" }));
  assert.equal((await read(b, second)).purchase.state, "purchased");
  assert.equal(await value(owner, "select allocated_quantity from private.purchase_receipt_lines where receipt_id=$1 and line_no=1", [receipt.id]), 3);
  console.log("PASS BTP-14 real mobile sessions, private evidence, wrong-order rejection, funding/roles, idempotent batch, shared discount conservation, blocked concurrency, and all three completion outcomes");
} finally {
  if (browser) await browser.close();
  await Promise.allSettled(connections.map(connection => connection.end()));
}
