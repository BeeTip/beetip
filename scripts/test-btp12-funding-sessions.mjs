import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";
import pg from "pg";

const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3112";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Use the local application only");
const stack = JSON.parse(execFileSync("rtk", ["proxy", "supabase", "status", "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}));
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(stack.API_URL));
const db = new URL(stack.DB_URL);
assert(db.protocol === "postgresql:" && db.hostname === "127.0.0.1" && !db.search);
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
const sharp = require("sharp");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(stack.API_URL, stack.SECRET_KEY, options);
const sql = new pg.Client({ connectionString: db.href, statement_timeout: 10000 });
const password = randomBytes(24).toString("base64url");
const fundingPath = `${origin}/api/identity/funding`;
const account = randomUUID(), unusedAccount = randomUUID();
const reference = `TEST${randomUUID().replaceAll("-", "").toUpperCase()}`;
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

async function actor() {
  const email = `btp12-${randomUUID()}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Penguji Dana" } });
  assert.ifError(error);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await page.waitForURL("**/account");
  return { id: data.user.id, context, page };
}

async function mfa(actor) {
  const { page } = actor;
  await page.goto(`${origin}/account/affiliation`);
  await page.getByRole("button", { name: "Siapkan autentikator" }).click();
  const secret = page.getByLabel("Kunci autentikator", { exact: true });
  await expect(secret).toBeVisible();
  await page.getByLabel("Kode autentikator", { exact: true }).fill(totp(await secret.inputValue()));
  await page.getByRole("button", { name: "Verifikasi MFA", exact: true }).click();
  await expect(page.getByText("MFA aktif pada sesi ini.")).toBeVisible();
}

async function checked(response, expected) {
  assert.equal(response.status(), expected, await response.text());
  assert.match(response.headers()["cache-control"], /private, no-store/);
  return response;
}

async function post(actor, data, expected = 200) {
  return (await checked(await actor.context.request.post(fundingPath, {
    headers: { Origin: origin, "X-Beetip-Member": actor.id }, data: { operationId: randomUUID(), ...data },
  }), expected)).json();
}

async function view(actor, order, expected = 200) {
  return (await checked(await actor.context.request.get(`${fundingPath}?view=order&order=${order}`), expected)).json();
}

async function upload(actor, id, bytes, expected = 200, requestOrigin = origin) {
  return checked(await actor.context.request.put(`${fundingPath}/${id}/evidence`, {
    headers: { Origin: requestOrigin, "X-Beetip-Member": actor.id, "Content-Type": "image/png" }, data: bytes,
  }), expected);
}

async function download(actor, id, expected = 200) {
  return checked(await actor.context.request.get(`${fundingPath}/${id}/evidence`), expected);
}

async function createOrder(customer, provider) {
  const listing = randomUUID();
  await sql.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
    values($1,$2,'request','Pesanan uji BTP-12','Warung','Makanan','Alam Sutera','PRIVATE LOCATION','[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',
    20000,5000,5000,false,1,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, customer.id]);
  const response = await checked(await provider.context.request.post(`${origin}/api/identity/orders`, {
    headers: { Origin: origin, "X-Beetip-Member": provider.id }, data: { operationId: randomUUID(), listingId: listing, listingVersion: 1 },
  }), 200);
  return (await response.json()).orderId;
}

try {
  await sql.connect();
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  const customer = await actor(), provider = await actor(), operator = await actor(), unrelated = await actor();
  const order = await createOrder(customer, provider);
  assert.equal((await view(customer, order)).data.accounts.length, 0);
  await sql.query("insert into private.funding_accounts(id,label) values($1,'Akun sintetis'),($2,'Akun lain')", [account, unusedAccount]);
  await sql.query("insert into private.funding_account_customers(account_id,member_id) values($1,$2)", [account, customer.id]);
  await sql.query("insert into public.staff_roles(member_id,role) values($1,'finance_operation')", [operator.id]);
  await sql.query("insert into private.funding_account_operators(account_id,member_id) values($1,$2)", [account, operator.id]);
  await checked(await operator.context.request.get(`${fundingPath}?view=queue`), 403);
  await mfa(operator);

  await customer.page.goto(`${origin}/orders/${order}`);
  await customer.page.getByLabel("Akun penampung uji").selectOption(account);
  await customer.page.getByLabel("Referensi transfer uji").fill(reference);
  await customer.page.getByRole("button", { name: "Lanjut unggah bukti" }).click();
  await expect(customer.page.getByText("Draf bukti tersimpan", { exact: false })).toBeVisible();
  const id = (await view(customer, order)).data.submission.id;
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#fdb900" } })
    .png().withMetadata({ exif: { IFD0: { Artist: "SYNTHETIC-EXIF" } } }).toBuffer();
  const different = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#2D4400" } }).png().toBuffer();
  await upload(customer, id, image, 403, "https://wrong.invalid");
  await upload(customer, id, Buffer.from("invalid PNG"), 400);
  await post(customer, { action: "submit", id }, 400);
  await upload(provider, id, image, 403);
  await download(operator, id, 403);
  await view(unrelated, order, 403);
  const cookies = await customer.context.cookies();
  const memberStorage = createServerClient(stack.API_URL, stack.PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll() {} } }).storage.from("funding-evidence");
  const bypass = await memberStorage.upload(id, image, { contentType: "image/png" });
  assert(bypass.error);
  await upload(customer, id, image);
  await upload(customer, id, image);
  await upload(customer, id, different, 409);
  const object = await download(customer, id);
  assert.match(object.headers()["content-disposition"], /^attachment/);
  assert.equal(object.headers()["x-content-type-options"], "nosniff");
  assert.equal((await sharp(await object.body()).metadata()).exif, undefined);
  assert.equal((await view(customer, order)).data.purchaseReady, false);
  assert((await memberStorage.download(id)).error);
  console.log("PASS actual Auth, private Storage, MIME decoding, metadata stripping, immutable retry and failed finalization");

  await customer.page.reload();
  await customer.page.getByRole("button", { name: "Kirim untuk diperiksa" }).click();
  await expect(customer.page.getByText("Menunggu pemeriksaan bank", { exact: false })).toBeVisible();
  await download(provider, id, 403);
  await download(unrelated, id, 403);
  await download(operator, id);
  assert.equal((await view(provider, order)).data.submission, null);
  assert.equal((await view(provider, order)).data.purchaseReady, false);
  await post(operator, { action: "verify", id, account: unusedAccount, reference, amount: 25000 }, 400);
  await operator.page.goto(`${origin}/account/funding?order=${order}`);
  await expect(operator.page.getByText(reference, { exact: true })).toBeVisible();
  assert(await operator.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Operator viewport overflows");
  await operator.page.getByLabel("Akun pada catatan bank").selectOption(account);
  await operator.page.getByLabel("Referensi pada catatan bank").fill(reference);
  await operator.page.getByLabel("Nominal pada catatan bank").fill("25000");
  await operator.page.getByLabel("Saya sudah memeriksa catatan bank uji.").check();
  await operator.page.getByRole("button", { name: "Verifikasi dana" }).click();
  await expect(operator.page.getByText("Pemeriksaan selesai. Dana terverifikasi.")).toBeVisible();
  await customer.page.reload();
  await expect(customer.page.getByText("Syarat dana untuk belanja terpenuhi.", { exact: false })).toBeVisible();
  assert(await customer.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Customer viewport overflows");
  assert.equal((await view(provider, order)).data.purchaseReady, true);
  const notification = await checked(await customer.context.request.get(`${origin}/api/identity/notifications`), 200);
  assert.match(await notification.text(), /funding_review/);
  await sql.query("update public.staff_roles set revoked_at=now() where member_id=$1", [operator.id]);
  await checked(await operator.context.request.get(`${fundingPath}?view=queue`), 403);
  await download(operator, id, 403);
  console.log("PASS 390 px customer and bank-review UI, notifications, sufficient funds and live role revocation");

  const abandoned = await createOrder(customer, provider);
  const draft = (await post(customer, { action: "begin", id: abandoned, account, reference: "TESTDISCARD12", amount: 25000 })).id;
  await upload(customer, draft, image);
  await post(customer, { action: "discard", id: draft });
  await download(customer, draft, 403);
  await sql.query("update private.funding_submissions set discarded_at=now()-interval '2 hours' where id=$1", [draft]);
  await sql.query("update storage.objects set created_at=now()-interval '2 hours' where bucket_id='funding-evidence' and name=$1", [draft]);
  assert.match(execFileSync(process.execPath, ["scripts/purge-btp12-funding-drafts.mjs"], { encoding: "utf8" }), /Processed [1-9]/);
  const stored = await sql.query("select name from storage.objects where bucket_id='funding-evidence' and name in ($1,$2)", [id, draft]);
  assert.deepEqual(stored.rows.map(row => row.name), [id]);
  console.log("PASS discarded evidence loses access immediately and is purged without removing verified evidence");
} finally {
  await browser?.close();
  await sql.end();
}
