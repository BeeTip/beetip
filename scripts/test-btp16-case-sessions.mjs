import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID as uuid } from "node:crypto";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";
import pg from "pg";

const workdir = process.env.BEETIP_TEST_LOCAL_STACK;
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3116";
assert(workdir && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Use a dedicated disposable loopback stack and app");
const stack = JSON.parse(execFileSync("supabase", ["status", "--workdir", workdir, "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}));
const db = new URL(stack.DB_URL);
assert(db.protocol === "postgresql:" && db.hostname === "127.0.0.1" && !db.search);
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(stack.API_URL));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const sharp = require("sharp");
const admin = createClient(stack.API_URL, stack.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = new pg.Client({ connectionString: db.href, statement_timeout: 15000 });
const endpoint = `${origin}/api/identity/order-cases`;
const value = async (client, query, args = []) => Object.values((await client.query(query, args)).rows[0])[0];
const headers = actor => ({ Origin: origin, "X-Beetip-Member": actor.id });
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

async function actor(finance = false) {
  const email = `btp16-${uuid()}@example.invalid`, password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Penguji Kasus" } });
  assert.ifError(error);
  const id = data.user.id;
  if (finance) {
    await sql.query("insert into public.staff_roles(member_id,role) values($1,'finance_operation')", [id]);
  }
  async function signIn(destination = "/account") {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${origin}${destination === "/account" ? "/login" : destination}`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Kata sandi", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.waitForURL(`${origin}${destination}`);
    return { context, page };
  }
  return { id, ...await signIn(), signIn };
}

async function mfa({ page }) {
  await page.goto(`${origin}/account/affiliation`);
  await page.getByRole("button", { name: "Siapkan autentikator" }).click();
  const secret = page.getByLabel("Kunci autentikator", { exact: true });
  await expect(secret).toBeVisible();
  await page.getByLabel("Kode autentikator", { exact: true }).fill(totp(await secret.inputValue()));
  await page.getByRole("button", { name: "Verifikasi MFA", exact: true }).click();
  await expect(page.getByText("MFA aktif pada sesi ini.")).toBeVisible();
}

async function checked(response, expected = 200) {
  assert.equal(response.status(), expected, await response.text());
  assert.match(response.headers()["cache-control"], /private, no-store/);
  return response;
}

try {
  await sql.connect();
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  const customer = await actor(), provider = await actor(), stranger = await actor();
  const proposer = await actor(true), reviewer = await actor(true);
  await checked(await reviewer.context.request.get(`${endpoint}?view=queue`), 403);
  await mfa(proposer);
  await mfa(reviewer);

  const listing = uuid();
  await sql.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
    values($1,$2,'request','Kasus nasi rusak','Warung','Makanan','Alam Sutera','Kampus',
      '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":15000},{"name":"Teh","specification":"","quantity":1,"unitBudget":5000}]',
      20000,5000,5000,false,1,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, customer.id]);
  const providerSession = await value(sql, "select id from auth.sessions where user_id=$1 order by created_at desc limit 1", [provider.id]);
  let order;
  await sql.query("begin");
  try {
    await sql.query("set local role authenticated");
    await sql.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: provider.id, session_id: providerSession, aal: "aal1" })]);
    order = await value(sql, "select public.accept_order($1,$2,1)", [uuid(), listing]);
    await sql.query("commit");
  } catch (error) { await sql.query("rollback"); throw error; }
  const orderPath = `/orders/${order}`;
  const linkedCustomer = await customer.signIn(orderPath);
  await expect(linkedCustomer.page.getByRole("heading", { name: "Kasus nasi rusak", exact: true })).toBeVisible();
  await linkedCustomer.context.close();
  const linkedStranger = await stranger.signIn(orderPath);
  await expect(linkedStranger.page.getByRole("alert")).toBeVisible();
  await expect(linkedStranger.page.getByRole("heading", { name: "Kasus nasi rusak", exact: true })).toHaveCount(0);
  await linkedStranger.context.close();
  console.log("PASS signing in from an order link resumes the order and preserves participant-only access");
  await sql.query("insert into private.booth_case_operators(order_id,member_id) values($1,$2),($1,$3)", [order, proposer.id, reviewer.id]);
  await checked(await customer.context.request.post(`${origin}/api/identity/orders/demo-payment`, {
    headers: headers(customer), data: { orderId: order },
  }));

  const image = await sharp({ create: { width: 24, height: 32, channels: 3, background: "#fdb900" } })
    .jpeg().withMetadata({ exif: { IFD0: { Artist: "SYNTHETIC CASE" } } }).toBuffer();
  const purchasePath = `${origin}/api/identity/purchases`, receiptKey = uuid();
  const { imageHash } = await (await checked(await provider.context.request.put(`${purchasePath}/evidence?order=${order}&key=${receiptKey}`, {
    data: image, headers: { ...headers(provider), "Content-Type": "image/jpeg" },
  }))).json();
  const purchase = async (action, payload, operationId = uuid()) => (await checked(await provider.context.request.post(purchasePath, {
    headers: headers(provider), data: { orderId: order, version: 1, operationId, action, payload },
  }))).json();
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
  const { resultId: receipt } = await purchase("receipt", { merchant: "Warung", reference: "NASI-001", date, discount: 0, imageHash,
    lines: [{ label: "Nasi", quantity: 1, gross: 14000 }] }, receiptKey);
  await purchase("allocate", { receipt, entries: [{ line: 1, item: 0, quantity: 1 }] });
  await purchase("finish", { unavailable: [1], note: "Teh habis" });

  const view = async (member, expected = 200) => (await checked(await member.context.request.get(`${endpoint}?order=${order}`), expected)).json();
  await view(stranger, 403);
  await checked(await customer.context.request.put(`${endpoint}/evidence?order=${order}&key=${uuid()}`, {
    headers: { ...headers(customer), "Content-Type": "image/jpeg" }, data: Buffer.from("invalid"),
  }), 400);
  assert.equal((await view(customer)).data.case, null);
  const region = customer.page.getByRole("region", { name: "Pembatalan dan sengketa" });
  await customer.page.goto(`${origin}/orders/${order}`);
  await region.getByText("Ajukan sengketa pesanan", { exact: true }).click();
  await expect(region.getByLabel("Nominal sengketa (Rp)")).toHaveCount(0);
  await region.getByLabel("Alasan sengketa").fill("Sebagian nasi rusak");
  await region.getByLabel("Foto bukti (wajib)", { exact: false }).setInputFiles({ name: "nasi.jpg", mimeType: "image/jpeg", buffer: image });
  await region.getByRole("button", { name: "Ajukan sengketa", exact: true }).click();
  await expect(region.getByRole("heading", { name: "Sengketa sedang ditinjau" })).toBeVisible();
  const opened = (await view(provider)).data;
  assert.equal(opened.boothDemo, true);
  const noFunds = { purchase: 0, fee: 0, refund: 0 };
  assert.deepEqual(opened.held, noFunds);
  assert.deepEqual(opened.unheld, noFunds);
  const evidenceUrl = `${endpoint}/evidence?order=${order}&key=${opened.case.evidence[0].id}`;
  await checked(await stranger.context.request.get(evidenceUrl), 403);
  const downloaded = await checked(await reviewer.context.request.get(evidenceUrl));
  assert.match(downloaded.headers()["content-disposition"], /^attachment/);
  assert.equal((await sharp(await downloaded.body()).metadata()).exif, undefined);

  await proposer.page.goto(`${origin}/account/order-cases`);
  await proposer.page.getByRole("link", { name: /Sengketa.*Kasus nasi rusak/ }).click();
  await proposer.page.getByText("Ajukan atau perbarui keputusan", { exact: true }).click();
  await expect(proposer.page.getByLabel("Biaya barang (Rp)")).toHaveCount(0);
  await proposer.page.getByLabel("Alasan usulan").fill("Foto dan struk sudah diperiksa");
  await proposer.page.getByRole("button", { name: "Kirim usulan", exact: true }).click();
  await expect(proposer.page.getByText("Menunggu petugas kedua", { exact: true })).toBeVisible();
  await expect(proposer.page.getByRole("button", { name: "Simpan keputusan" })).toHaveCount(0);
  await reviewer.page.goto(`${origin}/account/order-cases?order=${order}`);
  await reviewer.page.getByLabel("Keputusan tinjauan").selectOption("approve");
  await reviewer.page.getByLabel("Alasan keputusan petugas kedua").fill("Setuju dengan penyelesaian kasus");
  await reviewer.page.getByRole("button", { name: "Simpan keputusan" }).click();
  await expect(reviewer.page.getByRole("heading", { name: "Sengketa diselesaikan" })).toBeVisible();
  await customer.page.reload();
  await expect(region.getByRole("heading", { name: "Sengketa diselesaikan" })).toBeVisible();
  assert.deepEqual((await view(customer)).data.allocation, noFunds);
  assert.equal(await value(sql, "select count(*)::int from private.funding_submissions where order_id=$1", [order]), 0);
  await provider.page.goto(`${origin}/account/notifications`);
  await expect(provider.page.getByText("Sengketa diselesaikan", { exact: true })).toBeVisible();

  await sql.query("update public.staff_roles set revoked_at=now() where member_id=$1", [reviewer.id]);
  await view(reviewer, 403);
  await checked(await reviewer.context.request.get(evidenceUrl), 403);
  console.log("PASS 390px connected participant and two-staff workflow with real local Auth, TOTP, Storage, notifications, and revocation");
} finally {
  await browser?.close();
  await sql.end();
}
