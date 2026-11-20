import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID as uuid } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import pg from "pg";

const workdir = process.env.BEETIP_TEST_LOCAL_STACK;
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3117";
assert(workdir && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Use a dedicated disposable loopback stack and app");
assert.match(readFileSync(join(workdir, "supabase", "config.toml"), "utf8"), /^project_id = "beetip_btp17_isolated"\r?$/m);
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
const endpoint = `${origin}/api/identity/manual-transfers`;
const value = async (client, query, args = []) => Object.values((await client.query(query, args)).rows[0])[0];
const headers = actor => ({ Origin: origin, "X-Beetip-Member": actor.id });
const account = uuid();
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
  const email = `btp17-${uuid()}@example.invalid`, password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Penguji Transfer" } });
  assert.ifError(error);
  const id = data.user.id;
  if (finance) {
    await sql.query("insert into public.staff_roles(member_id,role) values($1,'finance_operation')", [id]);
    await sql.query("insert into private.funding_account_operators values($1,$2)", [account, id]);
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

async function submit({ page }, label, note, fields = {}) {
  const button = page.getByRole("button", { name: label, exact: true });
  const form = button.locator("..");
  await form.locator('[name="note"]').fill(note);
  for (const [name, value] of Object.entries(fields)) await form.locator(`[name="${name}"]`).fill(value);
  await button.click();
}

try {
  await sql.connect();
  await sql.query("insert into private.funding_accounts(id,label) values($1,'Akun transfer sintetis')", [account]);
  await sql.query("insert into private.synthetic_transfer_accounts values($1)", [account]);
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  const customer = await actor(), provider = await actor();
  const initiator = await actor(true), reviewer = await actor(true);
  await checked(await reviewer.context.request.get(`${endpoint}?view=queue`), 403);
  await mfa(initiator);
  await mfa(reviewer);

  const listing = uuid(), title = `Pengembalian pesanan kampus ${listing.slice(0, 8)}`;
  await sql.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
    values($1,$2,'request',$3,'Warung','Makanan','Alam Sutera','Kampus',
      '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',
      20000,5000,5000,false,1,150000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, customer.id, title]);
  const providerSession = await value(sql, "select id from auth.sessions where user_id=$1 order by created_at desc limit 1", [provider.id]);
  let order;
  await sql.query("begin");
  try {
    await sql.query("set local role authenticated");
    await sql.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: provider.id, session_id: providerSession, aal: "aal1" })]);
    order = await value(sql, "select public.accept_order($1,$2,1)", [uuid(), listing]);
    await sql.query("commit");
  } catch (error) { await sql.query("rollback"); throw error; }
  await sql.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
    values($1,$2,$3,25000,'verified',now(),now(),$4)`, [order, account, `TEST${uuid().replaceAll("-", "").toUpperCase()}`, reviewer.id]);
  await sql.query("update public.reservations set funding_verified_at=now() where order_id=$1", [order]);
  async function caseCommand(actor, action, payload) {
    const response = await checked(await actor.context.request.post(`${origin}/api/identity/order-cases`, {
      headers: headers(actor), data: { orderId: order, operationId: uuid(), action, payload },
    }));
    return (await response.json()).resultId;
  }
  const caseId = await caseCommand(customer, "open", { kind: "cancellation", reason: "Belum dibelanjakan" });
  const proposalId = await caseCommand(initiator, "propose", {
    caseId, outcome: "resolve", purchase: 0, fee: 0, refund: 25000, reason: "Kembalikan seluruh dana uji",
  });
  await caseCommand(reviewer, "review", { caseId, proposalId, decision: "approve", reason: "Bukti diperiksa" });
  await checked(await customer.context.request.get(`${endpoint}?order=${order}`), 403);

  await initiator.page.goto(`${origin}/account/funding`);
  await initiator.page.getByRole("link", { name: "Transfer dan pengembalian dana" }).click();
  await initiator.page.getByRole("link", { name: title, exact: true }).click();
  await initiator.page.getByLabel("Alokasi tersedia").selectOption("0");
  await submit(initiator, "Simpan permintaan", "Dana sintetis siap dikembalikan", { amount: "25000" });
  await expect(initiator.page.getByText(/Memerlukan persetujuan petugas kedua/)).toBeVisible();
  await expect(initiator.page.getByRole("button", { name: "Setujui permintaan" })).toHaveCount(0);

  const detailUrl = `${origin}/account/transfers?order=${order}`;
  await reviewer.page.goto(detailUrl);
  await submit(reviewer, "Setujui permintaan", "Alokasi dan tujuan uji sesuai");
  await expect(reviewer.page.getByText("Disetujui", { exact: true }).first()).toBeVisible();
  await initiator.page.getByRole("button", { name: "Muat ulang data" }).click();
  const routeMatcher = "**/api/identity/manual-transfers";
  await initiator.page.route(routeMatcher, async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort("failed");
  }, { times: 1 });
  await submit(initiator, "Mulai simulasi transfer", "Simulasi akan dimulai");
  await expect(initiator.page.getByRole("alert").filter({ hasText: "Status penyimpanan belum diketahui" })).toBeVisible();
  await initiator.page.reload();
  await initiator.page.getByRole("button", { name: "Periksa operasi" }).click();
  await expect(initiator.page.getByText("Operasi tersimpan. Status transfer diperbarui.")).toBeVisible();
  await submit(initiator, "Catat hasil belum pasti", "Hasil simulasi belum terlihat");
  await expect(initiator.page.getByText("Hasil belum pasti", { exact: true }).first()).toBeVisible();
  await reviewer.page.reload();
  await submit(reviewer, "Konfirmasi terkirim dari mutasi", "Mutasi sintetis sesuai nominal", {
    reference: "TESTBTP1701", record: "Mutasi uji 0001",
  });
  await expect(reviewer.page.getByText("Tercatat terkirim", { exact: true }).first()).toBeVisible();
  await reviewer.page.getByText("Catatan dan hasil", { exact: true }).click();
  await expect(reviewer.page.getByText("Referensi TESTBTP1701")).toBeVisible();
  const factCount = await value(sql, `select count(*) from private.manual_transfer_facts f
    join private.manual_transfers t on t.id=f.transfer_id where t.order_id=$1`, [order]);
  assert.equal(factCount, "5");
  await sql.query("update public.staff_roles set revoked_at=now() where member_id=$1", [reviewer.id]);
  await checked(await reviewer.context.request.get(`${endpoint}?order=${order}`), 403);
  console.log("PASS 390px synthetic refund with two real local Auth and TOTP sessions, dropped-response recovery, reconciliation, and live revocation");
} finally {
  await browser?.close();
  await sql.end();
}
