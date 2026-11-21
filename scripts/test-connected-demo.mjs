import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import pg from "pg";
import { rehearseConnectedChatLoad } from "./connected-chat-load.mjs";

const workdir = process.env.BEETIP_TEST_LOCAL_STACK;
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3196";
const loopbackHttp = /^http:\/\/127\.0\.0\.1:\d+$/;
assert(workdir && loopbackHttp.test(origin), "Set BEETIP_TEST_LOCAL_STACK to a disposable Supabase workdir and use a loopback app");
const config = readFileSync(resolve(workdir, "supabase/config.toml"), "utf8");
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
assert(projectId && projectId !== "beetip", "Give the disposable Supabase stack a project ID distinct from beetip");
const stack = JSON.parse(execFileSync("supabase", ["status", "--workdir", workdir, "-o", "json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
}));
const db = new URL(stack.DB_URL);
assert(db.protocol === "postgresql:" && db.hostname === "127.0.0.1" && !db.search, "Use a disposable loopback database");
assert(loopbackHttp.test(stack.API_URL) && stack.PUBLISHABLE_KEY && stack.SECRET_KEY, "Use the local Supabase API and its local keys");

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");
const auth = { persistSession: false, autoRefreshToken: false };
const admin = createClient(stack.API_URL, stack.SECRET_KEY, { auth });
const sql = new pg.Client({ connectionString: db.href, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
const expect = playwrightExpect.configure({ timeout: 10000 });
const run = randomUUID().slice(0, 8);
const title = `Jastip uji ${run}`;
const shop = "Toko Contoh";
const item = "Nasi ayam contoh";
const destination = `Lobi latihan ${run}`;
let browser;

async function actor(role) {
  const email = `connected-demo-${role}-${run}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: `Penguji ${role}` },
  });
  assert.ifError(error);
  assert(data.user.email_confirmed_at, `${role} email was not confirmed`);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block",
  });
  await context.route("**/*", route => {
    const target = new URL(route.request().url()).origin;
    return target === origin || target === stack.API_URL ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => console.error(`Browser error (${role}): ${error.message}`));
  page.setDefaultTimeout(10000);
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/account");
  assert.equal(await page.evaluate(() => window.innerWidth), 390);
  return { id: data.user.id, email, password, page, context };
}

async function assertOrdinary(actors) {
  const result = await sql.query("select member_id from private.booth_members where member_id = any($1::uuid[])", [
    actors.map(({ id }) => id),
  ]);
  assert.deepEqual(result.rows, [], "Test accounts must remain outside the booth allowlist");
}

async function publish(page) {
  await page.goto(`${origin}/`);
  await page.getByRole("link", { name: "Buat listing" }).click();
  await expect(page.getByRole("heading", { name: "Buat listing", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Jenis listing" }).selectOption("trip");
  await page.getByLabel("Judul", { exact: true }).fill(title);
  await page.getByLabel("Tempat belanja").fill(shop);
  await page.getByLabel("Nama barang 1", { exact: true }).fill(item);
  await page.getByLabel("Jumlah 1", { exact: true }).fill("1");
  await page.getByLabel("Batas harga satuan (Rp) 1", { exact: true }).fill("25000");
  await page.getByLabel("Alamat tujuan").fill(destination);
  await page.getByRole("button", { name: "Terbitkan listing" }).click();
  await expect(page.getByRole("heading", { name: "Listing tersimpan" })).toBeVisible();
  const href = await page.getByRole("link", { name: "Lihat listing", exact: true }).getAttribute("href");
  assert.match(href, /^\/listings\/[0-9a-f-]{36}$/);
  return href;
}

function observeChat({ page, id }) {
  const topic = `realtime:member:${id}`;
  const wireOrigin = stack.API_URL.replace(/^http:/, "ws:");
  let joined = false;
  let navigations = 0;
  const hints = [];
  page.on("websocket", socket => {
    const url = new URL(socket.url());
    if (url.origin !== wireOrigin || url.pathname !== "/realtime/v1/websocket") return;
    socket.on("framereceived", ({ payload }) => {
      if (Buffer.isBuffer(payload)) {
        // Realtime v2 encodes server broadcasts as binary frames with sized topic, event and metadata fields.
        const [kind, topicSize, eventSize, metadataSize, encoding] = payload;
        if (kind !== 4 || encoding !== 1) return;
        const topicEnd = 5 + topicSize;
        const eventEnd = topicEnd + eventSize;
        if (payload.toString("utf8", 5, topicEnd) === topic && payload.toString("utf8", topicEnd, eventEnd) === "refresh") {
          hints.push(JSON.parse(payload.toString("utf8", eventEnd + metadataSize)));
        }
        return;
      }
      const frame = JSON.parse(payload);
      const message = Array.isArray(frame) ? { topic: frame[2], event: frame[3], payload: frame[4] } : frame;
      if (message.topic !== topic) return;
      if (message.event === "phx_reply" && message.payload.status === "ok") joined = true;
      if (message.event === "broadcast" && message.payload.event === "refresh") hints.push(message.payload.payload);
    });
  });
  return {
    hints,
    async open() {
      await page.getByRole("link", { name: "Pesan pesanan", exact: true }).click();
      await page.waitForURL("**/chat/*");
      await expect(page.getByText("Belum ada pesan.", { exact: false })).toBeVisible();
      await expect.poll(() => joined, { message: `Realtime subscription for ${topic}` }).toBe(true);
      page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
    },
    assertNoNavigation() {
      assert.equal(navigations, 0, "Chat must deliver without navigation or reload");
    },
  };
}

async function denyPrivateAccess(outsider, provider, orderId) {
  for (const path of [`orders?id=${orderId}`, `chat?order=${orderId}`]) {
    const result = await outsider.context.request.get(`${origin}/api/identity/${path}`, { maxRedirects: 0 });
    assert.equal(result.status(), 403, `Unrelated member could read ${path}: ${await result.text()}`);
    assert.match(result.headers()["cache-control"], /private, no-store/);
  }
  const client = createClient(stack.API_URL, stack.PUBLISHABLE_KEY, { auth });
  assert.ifError((await client.auth.signInWithPassword({ email: outsider.email, password: outsider.password })).error);
  const channel = client.channel(`member:${provider.id}`, { config: { private: true } })
    .on("broadcast", { event: "refresh" }, () => {});
  try {
    const status = await new Promise(resolve => channel.subscribe(resolve, 10000));
    assert.equal(status, "CHANNEL_ERROR", "Realtime must deny an unrelated member's authenticated subscription");
  } finally {
    await client.removeAllChannels();
    client.realtime.disconnect();
  }
}

async function sendMessage(sender, recipient, wire, body) {
  const hintCount = wire.hints.length;
  await sender.getByRole("textbox", { name: "Pesan", exact: true }).fill(body);
  await sender.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  await expect.poll(() => wire.hints.length, { message: "Recipient received a private Realtime refresh" }).toBeGreaterThan(hintCount);
  const message = recipient.getByRole("list", { name: "Pesan tersimpan" }).getByRole("listitem").filter({ hasText: body });
  await expect(message).toContainText("Lawan bicara");
  for (const hint of wire.hints.slice(hintCount)) {
    assert.deepEqual(Object.keys(hint), ["id"]);
    assert.match(hint.id, /^[0-9a-f-]{36}$/);
  }
}

async function finishPurchase(provider, customer, outsider, orderPath) {
  const purchase = provider.getByRole("region", { name: "Progres belanja" });
  await purchase.getByRole("button", { name: "Tambah struk" }).click();
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="220">
    <rect width="420" height="220" fill="white"/>
    <g font-family="sans-serif" font-size="20" fill="black">
      <text x="20" y="36">STRUK CONTOH BEE TIP</text>
      <text x="20" y="80">${shop} - ${run}</text>
      <text x="20" y="124">1 Nasi ayam contoh - Rp20.000</text>
      <text x="20" y="168">TOTAL Rp20.000</text>
    </g>
  </svg>`)).png().toBuffer();
  await purchase.getByLabel("Nama toko").fill(shop);
  await purchase.getByLabel("Nomor struk").fill(run);
  await purchase.getByLabel("Foto struk").setInputFiles({ name: "struk-contoh.png", mimeType: "image/png", buffer: png });
  await purchase.getByLabel("Nama barang di struk").fill(item);
  await purchase.getByLabel("Total baris sebelum diskon bersama (Rp)").fill("20000");
  await purchase.getByRole("button", { name: "Simpan struk" }).click();
  await expect(purchase.getByText("Struk tersimpan.", { exact: false })).toBeVisible();

  const evidence = await purchase.getByRole("link", { name: "Unduh foto struk" }).getAttribute("href");
  assert(evidence?.startsWith("/api/identity/"), "Expected private receipt endpoint");
  const receipt = await provider.request.get(new URL(evidence, origin).href, { maxRedirects: 0 });
  assert.equal(receipt.status(), 200);
  assert.equal(receipt.headers()["content-type"], "application/octet-stream");
  assert.match(receipt.headers()["cache-control"], /private, no-store/);
  assert.equal((await sharp(await receipt.body()).metadata()).format, "png");
  const blocked = await outsider.request.get(new URL(evidence, origin).href, { maxRedirects: 0 });
  assert.equal(blocked.status(), 403, "An unrelated account could access receipt evidence");
  await purchase.getByLabel("Baris yang akan dialokasikan").selectOption({ index: 1 });
  await purchase.getByRole("combobox", { name: "Barang pesanan" }).selectOption({ index: 1 });
  await purchase.getByRole("button", { name: "Simpan alokasi" }).click();
  await expect(purchase.getByText(/Dibeli 1\/1/)).toBeVisible();
  await purchase.getByRole("button", { name: "Selesaikan belanja" }).click();
  await purchase.getByRole("button", { name: "Konfirmasi selesai" }).click();
  await expect(purchase.getByText("Semua barang dibeli", { exact: true })).toBeVisible();
  await customer.goto(`${origin}${orderPath}`);
  const customerPurchase = customer.getByRole("region", { name: "Progres belanja" });
  await expect(customerPurchase.getByText(/Dibeli 1\/1/)).toBeVisible();
  await customerPurchase.getByText("Rincian struk dan diskon", { exact: true }).click();
  await expect(customerPurchase.getByText(`${shop} (${run},`, { exact: false })).toBeVisible();

  const handover = page => page.getByRole("region", { name: "Serah terima pesanan" });
  await handover(provider).getByRole("button", { name: "Mulai pengantaran" }).click();
  const codeInput = handover(provider).getByLabel("Kode serah terima", { exact: true });
  await expect(codeInput).toBeVisible();
  await customer.getByRole("button", { name: "Perbarui status" }).click();
  await handover(customer).getByRole("checkbox", { name: "Saya sudah memeriksa jumlah dan kondisi barang" }).check();
  await handover(customer).getByRole("button", { name: "Buat kode serah terima" }).click();
  const code = handover(customer).getByText("Kode cadangan", { exact: false }).locator("strong");
  await expect(code).toHaveText(/\S+/);
  await codeInput.fill(await code.innerText());
  await handover(provider).getByRole("button", { name: "Konfirmasi serah terima" }).click();
  await expect(handover(provider).getByText("Serah terima dikonfirmasi.")).toBeVisible();
  await customer.getByRole("button", { name: "Perbarui status" }).click();
  await expect(handover(customer).getByText("Serah terima dikonfirmasi.")).toBeVisible();
  console.log("PASS provider uploaded and allocated private receipt, both participants saw confirmed handover");
}

async function withIncidentPause(check) {
  await sql.query("insert into private.demo_incident_pause default values");
  try {
    await check();
  } finally {
    await sql.query("delete from private.demo_incident_pause");
  }
}

async function expectPausedWrite(page, path, button) {
  const response = page.waitForResponse(response =>
    new URL(response.url()).pathname === path && response.request().method() === "POST");
  await button.click();
  assert.equal((await response).status(), 503);
  await expect(page.getByRole("alert").filter({ hasText: "sedang dijeda" })).toBeVisible();
}

try {
  await sql.connect();
  const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url))
    .filter(name => /^\d+_.+\.sql$/.test(name))
    .map(name => name.split("_")[0]).sort();
  const applied = await sql.query("select version from supabase_migrations.schema_migrations order by version");
  assert.deepEqual(applied.rows.map(row => row.version), migrations, "Disposable stack migration history differs from checkout");
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  const provider = await actor("provider");
  const customer = await actor("customer");
  const outsider = await actor("outsider");
  await assertOrdinary([provider, customer, outsider]);
  console.log("PASS three confirmed ordinary accounts signed in at 390px");

  const listing = await publish(provider.page);
  await customer.page.goto(`${origin}/`);
  await customer.page.getByLabel("Cari listing").fill(title);
  await customer.page.getByRole("button", { name: "Terapkan filter" }).click();
  const card = customer.page.getByRole("article").filter({ has: customer.page.getByRole("heading", { name: title, exact: true }) });
  const detail = card.getByRole("link", { name: "Lihat detail" });
  await expect(detail).toHaveAttribute("href", listing);
  await detail.click();
  await expect(customer.page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(customer.page.getByText(destination, { exact: false })).toHaveCount(0);
  await customer.page.getByRole("link", { name: "Lanjut ke penawaran" }).click();
  await customer.page.getByRole("checkbox", { name: /Saya menyetujui rincian barang/ }).check();
  await customer.page.getByRole("button", { name: "Kirim penawaran", exact: true }).click();
  await expect(customer.page.getByText("Aktif", { exact: true })).toBeVisible();

  await provider.page.getByRole("link", { name: "Listing saya", exact: true }).click();
  await provider.page.getByRole("article").filter({ hasText: title }).getByRole("link", { name: "Tinjau penawaran" }).click();
  await provider.page.getByRole("checkbox", { name: /Saya menyetujui rincian, ongkos, dan jadwal/ }).check();
  const accept = provider.page.getByRole("button", { name: "Terima penawaran", exact: true });
  await withIncidentPause(() => expectPausedWrite(provider.page, "/api/identity/orders", accept));
  const acceptance = provider.page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/identity/orders" && response.request().method() === "POST");
  await provider.page.getByRole("button", { name: "Coba lagi penerimaan", exact: true }).click();
  const accepted = await acceptance;
  assert.equal(accepted.status(), 200, `Order acceptance failed: ${await accepted.text()}`);
  await provider.page.getByRole("link", { name: "Lihat pesanan", exact: true }).click();
  await provider.page.waitForURL("**/orders/*");
  const orderPath = new URL(provider.page.url()).pathname;
  assert.match(orderPath, /^\/orders\/[0-9a-f-]{36}$/);
  const orderId = orderPath.split("/").at(-1);
  await customer.page.goto(`${origin}/account/orders`);
  const customerOrder = customer.page.getByRole("article").filter({ hasText: title })
    .getByRole("link", { name: "Lihat pesanan", exact: true });
  await expect(customerOrder).toHaveAttribute("href", orderPath);
  await customerOrder.click();
  for (const { page } of [provider, customer]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText(`Pesanan ${orderId}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Tujuan: ${destination}`, { exact: true })).toBeVisible();
  }
  console.log("PASS UI published listing, sent and accepted offer, and opened the order for both participants");

  await denyPrivateAccess(outsider, provider, orderId);
  const providerWire = observeChat(provider);
  const customerWire = observeChat(customer);
  await Promise.all([providerWire.open(), customerWire.open()]);
  await sendMessage(customer.page, provider.page, providerWire, `Tolong pisahkan sambal ${run}`);
  await sendMessage(provider.page, customer.page, customerWire, `Sambal saya pisahkan ${run}`);
  providerWire.assertNoNavigation();
  customerWire.assertNoNavigation();
  console.log("PASS private Realtime delivered chat in both directions without reload and denied the unrelated account");

  for (const { page } of [provider, customer]) {
    await page.getByRole("link", { name: "Kembali ke pesanan" }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  }
  const payment = page => page.getByRole("button", { name: "Simulasikan pembayaran", exact: true });
  const orderView = await customer.context.request.get(`${origin}/api/identity/orders?id=${orderId}`, { maxRedirects: 0 });
  assert.equal(orderView.status(), 200);
  const { order } = await orderView.json();
  await expect(payment(provider.page)).toHaveCount(0);
  await expect(payment(customer.page), `Ordinary customer has no demo payment button (state=${order.state}, canSimulatePayment=${order.canSimulatePayment})`).toBeVisible();
  await expect(customer.page.getByText("Menunggu pembayaran demo", { exact: true })).toBeVisible();
  await withIncidentPause(async () => {
    await expectPausedWrite(customer.page, "/api/identity/orders/demo-payment", payment(customer.page));
    for (const participant of [provider, customer]) {
      const read = await participant.context.request.get(`${origin}/api/identity/orders?id=${orderId}`, { maxRedirects: 0 });
      assert.equal(read.status(), 200);
      assert.equal((await read.json()).order.state, order.state);
    }
  });
  console.log("PASS incident pause blocked new acceptance and checkout while preserving participant reads");
  await payment(customer.page).click();
  await expect(customer.page.getByText("Siap belanja demo", { exact: true })).toBeVisible();
  await expect(payment(customer.page)).toHaveCount(0);
  await provider.page.getByRole("button", { name: "Perbarui status" }).click();
  await expect(provider.page.getByText("Siap belanja demo", { exact: true })).toBeVisible();
  console.log("PASS ordinary customer simulated payment in the UI and both participants saw purchase readiness");

  await finishPurchase(provider.page, customer.page, outsider.page, orderPath);
  await assertOrdinary([provider, customer, outsider]);
  const load = await rehearseConnectedChatLoad({ admin, origin, sql });
  assert.equal(load.members, 50);
  assert.equal(load.sessions, 20);
  assert.equal(load.orders, 10);
  assert.equal(load.acknowledgments, 60);
  assert.equal(load.durableMessages, 60);
  assert.equal(load.inAppIntents, 60);
  assert(load.p95Ms <= 2000, `Chat send p95 ${load.p95Ms} ms exceeded 2000 ms`);
  console.log(`PASS connected load ${JSON.stringify(load)}`);
  console.log("PASS connected synthetic demo");
} finally {
  try {
    await browser?.close();
  } finally {
    await sql.end();
  }
}
