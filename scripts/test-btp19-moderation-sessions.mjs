import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID as uuid } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import pg from "pg";

const workdir = process.env.BEETIP_TEST_LOCAL_STACK;
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3119";
assert(workdir && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Use a dedicated disposable loopback stack and app");
assert.match(readFileSync(join(workdir, "supabase/config.toml"), "utf8"), /^project_id = "beetip_btp19_isolated"\r?$/m);
const stack = JSON.parse(execFileSync("rtk", ["proxy", "supabase", "status", "--workdir", workdir, "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}));
const db = new URL(stack.DB_URL);
assert(db.protocol === "postgresql:" && db.hostname === "127.0.0.1" && !db.search);
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(stack.API_URL));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const admin = createClient(stack.API_URL, stack.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = new pg.Client({ connectionString: db.href, statement_timeout: 15000 });
const moderation = "/api/identity/listing-moderation", ratings = "/api/identity/order-ratings";

let browser;

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/, "")].map(char => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  return String((hash.readUInt32BE(hash[hash.length - 1] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

async function actor(staff = false) {
  const email = `btp19-${uuid()}@example.invalid`, password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Penguji BeeTip" } });
  assert.ifError(error);
  const id = data.user.id;
  if (staff) {
    await sql.query("insert into public.staff_roles(member_id,role) values($1,'platform_admin')", [id]);

  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/account");
  return { id, context, page };
}

async function checked(response, status) {
  assert.equal(response.status(), status, status === response.status() ? undefined : (await response.text()).slice(0, 200));
  assert.match(response.headers()["cache-control"], /private, no-store/);
}

const post = (actor, endpoint, data, memberId = actor.id) => actor.context.request.post(origin + endpoint, {
  headers: { Origin: origin, "X-Beetip-Member": memberId }, data,
});

try {
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  await sql.connect();
  const provider = await actor(), customer = await actor(), operator = await actor(true);
  const listing = uuid(), offer = uuid(), title = `Titipan makan siang ${listing.slice(0, 8)}`;
  const date = hours => new Date(Date.now() + hours * 3600000).toISOString();
  const published = await post(provider, "/api/identity/listings", { operationId: uuid(), listingId: listing, version: 0, listing: {
    type: "trip", title, shop: "Warung", category: "Makanan", area: "Alam Sutera", destination: "Kampus",
    items: [{ name: "Nasi", specification: "", quantity: 1, unitBudget: 60000 }],
    fee: 10000, bound: 10000, negotiable: false, capacity: 2, spendingCapacity: 120000,
    cutoff: date(1), start: date(2), end: date(3), status: "active",
  } });
  await checked(published, 200);
  const sent = await post(customer, "/api/identity/offers", {
    operationId: uuid(), offerId: offer, listingId: listing, version: 0, listingVersion: 1, fee: 10000, action: "save",
  });
  await checked(sent, 200);
  const accepted = await post(provider, "/api/identity/orders", {
    operationId: uuid(), listingId: listing, listingVersion: 1, offerId: offer, offerVersion: 1,
  });
  await checked(accepted, 200);
  const { orderId } = await accepted.json();
  const decision = { operationId: uuid(), listingId: listing, version: 1, status: "paused", reason: "Pemeriksaan keamanan" };
  await checked(await post(customer, moderation, decision), 403);
  await checked(await post(operator, moderation, decision), 403);
  const { page } = operator;
  await page.goto(`${origin}/account/affiliation`);
  await page.getByRole("button", { name: "Siapkan autentikator" }).click();
  const secret = page.getByLabel("Kunci autentikator", { exact: true });
  await expect(secret).toBeVisible();
  await page.getByLabel("Kode autentikator", { exact: true }).fill(totp(await secret.inputValue()));
  await page.getByRole("button", { name: "Verifikasi MFA", exact: true }).click();
  await expect(page.getByText("MFA aktif pada sesi ini.")).toBeVisible();
  await checked(await post(operator, moderation, decision, customer.id), 403);
  await page.goto(`${origin}/account`);
  await page.getByRole("link", { name: "Moderasi listing" }).click();
  await page.getByLabel("Cari judul atau ID listing").fill(listing);
  await page.getByRole("button", { name: "Cari listing" }).click();
  const card = page.getByRole("article").filter({ hasText: title });
  await card.getByLabel("Status baru").selectOption("removed");
  const reason = card.getByLabel("Alasan moderasi");
  await reason.fill("Hapus setelah pemeriksaan");
  await checked(await post(operator, moderation, decision), 200);
  await card.getByRole("button", { name: "Simpan status" }).click();
  await expect(card.getByRole("alert")).toHaveText("Listing sudah berubah. Muat ulang sebelum menyimpan.");
  await expect(reason).toHaveValue("Hapus setelah pemeriksaan");
  await card.getByRole("button", { name: "Muat ulang listing" }).click();
  await expect(card.getByText("Dijeda oleh operator")).toBeVisible();
  await expect(reason).toHaveValue("Hapus setelah pemeriksaan");
  await expect(card.getByLabel("Status baru")).toHaveValue("removed");
  await card.getByRole("button", { name: "Simpan status" }).click();
  await expect(card.getByText("Dihapus oleh operator")).toBeVisible();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await provider.page.goto(`${origin}/account/notifications`);
  await expect(provider.page.getByText("Status moderasi listing berubah").first()).toBeVisible();
  await provider.page.goto(`${origin}/account/listings`);
  const removed = provider.page.getByRole("article").filter({ hasText: title });
  await expect(removed.getByText("Dihapus oleh operator")).toBeVisible();
  await expect(removed.getByRole("link", { name: "Ubah listing" })).toHaveCount(0);

  // SQL seeds delivery for the browser test. The PostgreSQL harness exercises the handover commands.
  await sql.query("update public.orders set state='delivery_confirmed' where id=$1", [orderId]);
  const orderPath = `${origin}/orders/${orderId}`;
  await customer.page.goto(orderPath);
  const form = customer.page.getByRole("region", { name: "Penilaian pesanan" });
  await form.getByLabel("Nilai layanan").selectOption("5");
  await form.getByLabel("Masukan pribadi (opsional)").fill("Barang sesuai pesanan");
  let operation;
  await customer.page.route(`**${ratings}`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    operation = route.request().postDataJSON().operationId;
    await route.abort();
  }, { times: 1 });
  await form.getByRole("button", { name: "Kirim penilaian" }).click();
  await expect(form.getByRole("alert")).toHaveText("Penilaian belum dapat dikonfirmasi. Coba lagi.");
  await expect(form.getByLabel("Masukan pribadi (opsional)")).toHaveValue("Barang sesuai pesanan");
  const response = customer.page.waitForResponse(result => result.url() === origin + ratings && result.request().method() === "POST");
  await form.getByRole("button", { name: "Kirim penilaian" }).click();
  const saved = await response;
  await checked(saved, 200);
  assert.equal(saved.request().postDataJSON().operationId, operation);
  await customer.page.reload();
  await expect(form.getByText("Barang sesuai pesanan")).toBeVisible();
  assert(await customer.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await provider.page.goto(orderPath);
  const providerForm = provider.page.getByRole("region", { name: "Penilaian pesanan" });
  await providerForm.getByLabel("Nilai layanan").selectOption("3");
  await expect(provider.page.getByText("Barang sesuai pesanan")).toHaveCount(0);
  await checked(await post(provider, ratings, { operationId: uuid(), orderId, score: 4, feedback: "" }), 200);
  await providerForm.getByRole("button", { name: "Kirim penilaian" }).click();
  await expect(providerForm.getByRole("alert")).toHaveText("Penilaian sudah dikirim. Muat ulang penilaian.");
  await providerForm.getByRole("button", { name: "Muat ulang penilaian" }).click();
  await expect(providerForm.getByText("Penilaian terkirim: 4 dari 5.")).toBeVisible();
  await checked(await post(operator, ratings, { operationId: uuid(), orderId, score: 1, feedback: "" }), 403);
  await checked(await post(customer, ratings, { operationId: uuid(), orderId, score: 3, feedback: "" }), 409);
  console.log("PASS local Auth and MFA sessions, mobile moderation conflict recovery, rating retry and reload, privacy and duplicate rejection");
} finally {
  await browser?.close();
  await sql.end();
}
