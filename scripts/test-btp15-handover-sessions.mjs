import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID as uuid } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";

const workdir = process.env.BEETIP_TEST_LOCAL_STACK;
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3115";
assert(workdir && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Use a dedicated disposable loopback stack and app");
const stack = JSON.parse(execFileSync("rtk", ["proxy", "supabase", "status", "--workdir", workdir, "-o", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const db = new URL(stack.DB_URL);
assert(db.protocol === "postgresql:" && db.hostname === "127.0.0.1" && !db.search);
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(stack.API_URL));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");
const admin = createClient(stack.API_URL, stack.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = new pg.Client({ connectionString: db.href, statement_timeout: 15000 });
const endpoint = `${origin}/api/identity/handover`;
const purchase = `${origin}/api/identity/purchases`;
const headers = member => ({ Origin: origin, "X-Beetip-Member": member.id });
let browser;

async function actor() {
  const email = `btp15-${uuid()}@example.invalid`, password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Penguji Serah Terima" } });
  assert.ifError(error);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/account");
  return { id: data.user.id, email, password, page, context };
}

async function checked(response, status = 200) {
  assert.equal(response.status(), status, "Unexpected HTTP status");
  assert.match(response.headers()["cache-control"], /private, no-store/);
  return response.json();
}

try {
  await sql.connect();
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  const provider = await actor(), customer = await actor(), outsider = await actor();
  const api = () => createClient(stack.API_URL, stack.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const customerClient = api(), providerClient = api();
  assert.ifError((await customerClient.auth.signInWithPassword(customer)).error);
  assert.ifError((await providerClient.auth.signInWithPassword(provider)).error);
  const account = uuid();
  await sql.query("insert into private.funding_accounts(id,label) values($1,'Akun simulasi serah terima')", [account]);
  async function completedOrder() {
    const listing = uuid(), offer = uuid();
    await sql.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
      values($1,$2,'trip','Uji serah terima','Warung','Makanan','Alam Sutera','Kampus',$3,20000,5000,5000,false,2,40000,
        now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`,
    [listing, provider.id, JSON.stringify([{ name: "Nasi", specification: "", quantity: 1, unitBudget: 20000 }])]);
    const saved = await customerClient.rpc("save_offer", { p_operation_id: uuid(), p_offer_id: offer,
      p_listing_id: listing, p_version: 0, p_listing_version: 1, p_fee: 5000, p_action: "save" });
    assert.ifError(saved.error);
    const accepted = await providerClient.rpc("accept_order", { p_operation_id: uuid(), p_listing_id: listing,
      p_listing_version: 1, p_offer_id: offer, p_offer_version: 1 });
    assert.ifError(accepted.error);
    const id = accepted.data;
    await sql.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
      select $1,$2,$3,private.funding_required($1),'verified',now(),now(),$4`, [id, account, `TEST${uuid().replaceAll("-", "").toUpperCase()}`, outsider.id]);
    await sql.query("update public.reservations set funding_verified_at=now() where order_id=$1", [id]);
    const operationId = uuid();
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: `#${operationId.slice(0, 6)}` } }).png().toBuffer();
    const { imageHash } = await checked(await provider.context.request.put(`${purchase}/evidence?order=${id}&key=${operationId}`,
      { headers: { ...headers(provider), "Content-Type": "image/png" }, data: image }));
    const record = async (action, payload, key = uuid()) => checked(await provider.context.request.post(purchase,
      { headers: headers(provider), data: { orderId: id, operationId: key, version: 1, action, payload } }));
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
    const { resultId: receipt } = await record("receipt", { merchant: "Warung", reference: operationId.slice(0, 8), date, discount: 0,
      lines: [{ label: "Nasi", quantity: 1, gross: 20000 }], imageHash }, operationId);
    await record("allocate", { receipt, entries: [{ line: 1, item: 0, quantity: 1 }] });
    await record("finish", { unavailable: [], note: "" });
    return id;
  }
  const id = await completedOrder();
  await provider.page.goto(`${origin}/orders/${id}`);
  const handover = member => member.page.getByRole("region", { name: "Serah terima pesanan" });
  await handover(provider).getByRole("button", { name: "Mulai pengantaran" }).click({ timeout: 5000 });
  await expect(handover(provider).getByLabel("Kode serah terima")).toBeVisible();
  await customer.page.goto(`${origin}/orders/${id}`);
  const post = (member, data, status, extraHeaders = {}) => member.context.request.post(endpoint,
    { headers: { ...headers(member), ...extraHeaders }, data }).then(response => checked(response, status));
  const issue = { action: "issue", orderId: id, checked: true };
  await post(provider, issue, 403);
  await post(outsider, issue, 403);
  await post(customer, { ...issue, checked: false }, 400);
  await post(customer, issue, 403, { Origin: "https://example.invalid" });
  await post(customer, issue, 403, { "X-Beetip-Member": provider.id });

  const customerPanel = handover(customer), providerPanel = handover(provider);
  const checkbox = "Saya sudah memeriksa jumlah dan kondisi barang";
  const codeNode = customerPanel.locator(".qr-panel strong");
  const qrNode = customerPanel.getByRole("img", { name: "QR serah terima pesanan" });
  const generate = async () => {
    await customerPanel.getByRole("checkbox", { name: checkbox }).check();
    await customerPanel.getByRole("button", { name: "Buat kode serah terima" }).click();
    await expect(qrNode).toBeVisible();
    const code = await codeNode.textContent();
    assert(/^[A-F0-9]{12}$/.test(code), "Backup code has the expected format");
    return code;
  };
  const firstCode = await generate();
  for (const member of [provider, customer]) {
    const panel = handover(member);
    await expect(panel).toBeVisible();
    assert(await member.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Handover must fit mobile width");
    const audit = await new AxeBuilder({ page: member.page }).include('section[aria-label="Serah terima pesanan"]').analyze();
    assert.deepEqual(audit.violations.map(violation => violation.id), []);
  }
  await post(customer, { action: "confirm", orderId: id, code: firstCode }, 403);
  await post(outsider, { action: "confirm", orderId: id, code: firstCode }, 403);
  await provider.page.evaluate(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true, value: async () => { throw new DOMException("Test permission denial", "NotAllowedError"); },
    });
  });
  await providerPanel.getByRole("button", { name: "Pindai QR" }).click();
  await expect(providerPanel.getByRole("alert")).toContainText("masukkan kode cadangan");
  await expect(providerPanel.getByLabel("Kode serah terima")).toBeVisible();

  await customerPanel.getByRole("button", { name: "Buat ulang kode" }).click();
  await expect(qrNode).toBeVisible();
  const replacement = await codeNode.textContent();
  assert(replacement !== firstCode && /^[A-F0-9]{12}$/.test(replacement), "Regeneration replaces the displayed code");
  const manual = async code => {
    await providerPanel.getByLabel("Kode serah terima").evaluate((input, value) => { input.value = value; }, code);
    await providerPanel.getByRole("button", { name: "Konfirmasi serah terima" }).click();
  };
  await manual(firstCode);
  await expect(providerPanel.getByRole("alert")).toContainText("Kode tidak cocok");
  assert(await providerPanel.getByLabel("Kode serah terima").inputValue() === "", "Manual entry is cleared after submitting");
  await manual(replacement.toLowerCase().match(/.{4}/g).join("-"));
  await expect(providerPanel.getByRole("status")).toHaveText("Serah terima dikonfirmasi.");
  const confirm = { action: "confirm", orderId: id, code: replacement };
  assert.equal((await post(provider, confirm, 409)).code, "replayed");
  await customer.page.getByRole("button", { name: "Perbarui status" }).click();
  await expect(customerPanel.getByRole("status")).toHaveText("Serah terima dikonfirmasi.");
  await expect(qrNode).toHaveCount(0);
  await expect(customer.page.getByRole("link", { name: "Pesan pesanan" })).toBeVisible();
  await checked(await customer.context.request.post(`${origin}/api/identity/chat`, {
    headers: headers(customer), data: { action: "send", order: id, clientId: uuid(), body: "Barang diterima. Terima kasih." },
  }));

  const qrOrder = await completedOrder();
  await post(provider, { action: "start", orderId: qrOrder });
  await Promise.all([provider, customer].map(member => member.page.goto(`${origin}/orders/${qrOrder}`)));
  const qrCode = await generate();
  const imageSource = await qrNode.getAttribute("src");
  assert(imageSource?.startsWith("data:image/png;base64,"), "QR should be an inline image");
  await provider.page.evaluate(source => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 320;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, 320, 320);
      const stream = canvas.captureStream(15);
      const [track] = stream.getVideoTracks();
      window.testHandoverCamera = track;
      function frame() {
        if (track.readyState !== "live") return;
        ctx.drawImage(image, 0, 0, 320, 320);
        requestAnimationFrame(frame);
      }
      frame();
      return stream;
    } });
  }, imageSource);
  await providerPanel.getByRole("button", { name: "Pindai QR" }).click();
  await expect(providerPanel.getByRole("status")).toHaveText("Serah terima dikonfirmasi.");
  assert.equal(await provider.page.evaluate(() => window.testHandoverCamera?.readyState), "ended");

  const projections = await Promise.all([id, qrOrder].flatMap(orderId => [
    provider.context.request.get(`${purchase}?id=${orderId}`).then(response => checked(response)),
    customer.context.request.get(`${origin}/api/identity/orders?id=${orderId}`).then(response => checked(response)),
  ]));
  const audit = await sql.query("select detail from private.audit_events where target_id in ($1,$2)", [id, qrOrder]);
  const logs = process.env.BEETIP_TEST_APP_LOG ? readFileSync(process.env.BEETIP_TEST_APP_LOG, "utf8") : "";
  assert(!logs.includes(imageSource), "QR leaked to the app log");
  for (const code of [firstCode, replacement, qrCode]) {
    assert(!JSON.stringify([projections, audit.rows]).includes(code) && !logs.includes(code), "Code leaked to a projection, audit, or app log");
  }
  console.log("PASS BTP-15 real Supabase sessions, mobile axe, role and origin checks, camera denial, manual fallback, replacement, replay, QR software scan, camera teardown, and code redaction");
} finally {
  await browser?.close();
  await sql.end();
}
