import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID as uuid } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import pg from "pg";

const workdir = process.env.BEETIP_TEST_LOCAL_STACK;
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3118";
assert(workdir && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Use a dedicated disposable loopback stack and app");
assert.match(readFileSync(join(workdir, "supabase/config.toml"), "utf8"), /^project_id = "beetip_btp18_isolated"\r?$/m);
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
const endpoint = `${origin}/api/identity/reconciliation`;
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
  const email = `btp18-${uuid()}@example.invalid`, password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Penguji Dana" } });
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

async function checked(response, status) {
  assert.equal(response.status(), status, status === response.status() ? undefined : (await response.text()).slice(0, 200));
  assert.match(response.headers()["cache-control"], /private, no-store/);
}

function exportOrder(context, order, memberId, requestOrigin = origin) {
  return context.request.post(endpoint, {
    headers: { Origin: requestOrigin, "X-Beetip-Member": memberId },
    data: { scope: "order", id: order },
  });
}

try {
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  const anonymous = await browser.newContext();
  await checked(await exportOrder(anonymous, uuid(), uuid()), 401);
  await sql.connect();
  await sql.query("insert into private.funding_accounts(id,label) values($1,'Akun rekonsiliasi sintetis')", [account]);
  await sql.query("insert into private.synthetic_transfer_accounts values($1)", [account]);
  const customer = await actor(), provider = await actor(), finance = await actor(true);
  const listing = uuid(), offer = uuid();
  const title = `+Rekonsiliasi ${listing.slice(0, 8)}`;
  await sql.query(`insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
    values($1,$2,'trip',$3,'Warung','Makanan','Alam Sutera','Kampus',
      '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":60000}]',
      60000,10000,10000,false,3,400000,now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active')`, [listing, provider.id, title]);
  async function as(person, query, args) {
    const { rows: [session] } = await sql.query("select id from auth.sessions where user_id=$1 order by created_at desc limit 1", [person.id]);
    await sql.query("begin");
    try {
      await sql.query("set local role authenticated");
      await sql.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: person.id, session_id: session.id, aal: "aal1" })]);
      const { rows } = await sql.query(query, args);
      await sql.query("commit");
      return rows[0].value;
    } catch (error) { await sql.query("rollback"); throw error; }
  }
  await as(customer, "select public.save_offer($1,$2,$3,0,1,10000,'save') as value", [uuid(), offer, listing]);
  const order = await as(provider, "select public.accept_order($1,$2,1,$3,1) as value", [uuid(), listing, offer]);
  await sql.query(`insert into private.funding_submissions(order_id,account_id,reference,amount,state,submitted_at,reviewed_at,reviewed_by)
    values($1,$2,$3,70000,'verified',now(),now(),$4)`, [order, account, `TEST${uuid().replaceAll("-", "").toUpperCase()}`, finance.id]);

  await checked(await exportOrder(finance.context, order, finance.id), 403);
  await checked(await exportOrder(customer.context, order, customer.id), 403);
  const { page } = finance;
  await page.goto(`${origin}/account/affiliation`);
  await page.getByRole("button", { name: "Siapkan autentikator" }).click();
  const secret = page.getByLabel("Kunci autentikator", { exact: true });
  await expect(secret).toBeVisible();
  await page.getByLabel("Kode autentikator", { exact: true }).fill(totp(await secret.inputValue()));
  await page.getByRole("button", { name: "Verifikasi MFA", exact: true }).click();
  await expect(page.getByText("MFA aktif pada sesi ini.")).toBeVisible();

  await checked(await exportOrder(finance.context, order, customer.id), 403);
  await checked(await exportOrder(finance.context, order, finance.id, "https://example.invalid"), 403);
  await page.goto(`${origin}/account/funding`);
  await page.getByRole("link", { name: "Rekonsiliasi dana" }).click();
  await page.getByRole("link", { name: title }).click();
  await expect(page.getByText("Menunggu belanja")).toBeVisible();
  await expect(page.getByText("Belum selesai")).toBeVisible();
  await page.getByRole("link", { name: "Lihat rekonsiliasi trip" }).click();
  await expect(page.getByRole("heading", { name: "Rekonsiliasi trip" })).toBeVisible();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const responsePromise = page.waitForResponse(response => response.url() === endpoint && response.request().method() === "POST");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh CSV" }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  await checked(response, 200);
  assert.match(response.headers()["content-type"], /^text\/csv/);
  assert.match(response.headers()["content-disposition"], /attachment/);
  const csv = readFileSync(await download.path(), "utf8");
  assert.match(csv, /"'\+Rekonsiliasi /);
  const audit = await sql.query("select id,scope,scope_id,order_count,csv_sha256 from private.reconciliation_exports where actor_id=$1", [finance.id]);
  assert.deepEqual(audit.rows, [{
    id: response.headers()["x-beetip-export"], scope: "trip", scope_id: listing, order_count: 1,
    csv_sha256: createHash("sha256").update(csv).digest("hex"),
  }]);
  await sql.query("delete from private.funding_account_operators where account_id=$1 and member_id=$2", [account, finance.id]);
  await checked(await exportOrder(finance.context, order, finance.id), 403);
  await page.reload();
  await expect(page.getByText("Akses rekonsiliasi tidak diizinkan.")).toBeVisible();
  console.log("PASS local Auth sessions, MFA and scope denial, mobile trip view, audited CSV download and live revocation");
} finally {
  await browser?.close();
  await sql.end();
}
