import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const project = process.env.BEETIP_TEST_PROJECT_REF;
assert.equal(project, "rgiptdfjlmwldngapojq", "This destructive-fixture test is restricted to the dedicated BeeTip development project");
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3108";
const staging = origin === "https://beetip-campus.vercel.app";
const publicStaging = staging && process.env.BEETIP_STAGING_EXPOSURE === "public";
assert(staging || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Use a local connected server or the exact protected BeeTip staging origin");
const bypass = staging && !publicStaging ? readFileSync(process.env.BEETIP_STAGING_BYPASS_FILE, "utf8").trim() : undefined;
assert(!staging || publicStaging || bypass, "Protected staging requires its automation bypass file");
const settings = Object.fromEntries(readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8").split(/\r?\n/).filter(line => line.includes("=")).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
assert.equal(settings.NEXT_PUBLIC_SUPABASE_URL, `https://${project}.supabase.co`);
const cli = execFileSync("rtk", ["proxy", "supabase", "projects", "api-keys", "--project-ref", project, "--reveal", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const keys = JSON.parse(cli);
const privileged = keys.find(key => key.type === "secret" && !key.disabled) ?? keys.find(key => key.name === "service_role" && !key.disabled);
assert(privileged?.api_key, "CLI could not retrieve the development-only administration key");
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const admin = createClient(settings.NEXT_PUBLIC_SUPABASE_URL, privileged.api_key, { auth: { persistSession: false, autoRefreshToken: false } });
const password = randomBytes(24).toString("base64url");
const users = [];
let browser;
const checked = [];
try {
  for (const name of ["Pemohon", "Anggota lain"]) {
    const email = `btp02-${randomUUID()}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } });
    assert.ifError(error);
    users.push({ id: data.user.id, email });
  }
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  const owner = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const other = await browser.newContext();
  async function signIn(context, user) {
    if (staging && !publicStaging) {
      const gate = await context.request.get(`${origin}/login`, {
        headers: { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }, maxRedirects: 0,
      });
      assert([200, 302, 307].includes(gate.status()), "Staging protection setup failed");
      assert.equal((await context.request.get(`${origin}/login`, { maxRedirects: 0 })).status(), 200, "Staging bypass cookie was not established");
    }
    const page = await context.newPage();
    await page.goto(`${origin}/login`);
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Kata sandi", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await page.waitForURL("**/account");
    await expect(page.getByText("Email terkonfirmasi. Akunmu siap digunakan", { exact: false })).toBeVisible();
    return page;
  }
  const page = await signIn(owner, users[0]);
  const otherPage = await signIn(other, users[1]);
  checked.push("real Auth sessions and automatically active accounts");
  await page.goto(`${origin}/support`);
  await page.getByLabel("Pesan bantuan").fill("Pertanyaan pribadi dari pemohon");
  await page.getByRole("button", { name: "Kirim ke bantuan" }).click();
  await expect(page.getByText("Pertanyaan pribadi dari pemohon", { exact: true })).toBeVisible();
  const operationId = randomUUID();
  const send = body => owner.request.post(`${origin}/api/identity/support`, { headers: { Origin: origin }, data: { operationId, body } });
  const responses = await Promise.all([send("Permintaan yang sama"), send("Permintaan yang sama")]);
  responses.forEach(response => assert.equal(response.status(), 200));
  const values = await Promise.all(responses.map(response => response.json()));
  assert.equal(values[0].conversationId, values[1].conversationId);
  assert.equal((await send("Isi yang berbeda")).status(), 409);
  checked.push("concurrent exact retry and changed-payload conflict");
  const ownHistory = await (await owner.request.get(`${origin}/api/identity/support`)).json();
  assert.equal(ownHistory.threads.length, 2);
  assert.equal(ownHistory.threads.filter(thread => thread.id === values[0].conversationId).length, 1);
  const otherHistory = await (await other.request.get(`${origin}/api/identity/support`)).json();
  assert.equal(otherHistory.threads.length, 0);
  checked.push("cross-account history isolation");
  const denied = await owner.request.post(`${origin}/api/identity/support`, { headers: { Origin: "https://unrelated.invalid" }, data: { operationId: randomUUID(), body: "Denied" } });
  assert.equal(denied.status(), 403);
  const spoofed = await owner.request.post(`${origin}/api/identity/support`, { headers: { Origin: origin }, data: { operationId: randomUUID(), body: "Denied", actorId: users[1].id } });
  assert.equal(spoofed.status(), 400);
  checked.push("cross-origin and actor-spoofing rejection");
  await page.reload();
  await expect(page.getByText("Pertanyaan pribadi dari pemohon", { exact: true })).toBeVisible();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  mkdirSync(new URL("../test-results/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL(`../test-results/${staging ? "connected-staging-support" : "connected-support"}.png`, import.meta.url)), fullPage: true });
  checked.push("durable reload and mobile layout");
  const secondTab = await owner.newPage();
  await secondTab.goto(`${origin}/account`);
  await secondTab.getByRole("button", { name: "Keluar", exact: true }).click();
  await secondTab.waitForURL(`${origin}/`);
  await expect(page.getByText("Pertanyaan pribadi dari pemohon", { exact: true })).toHaveCount(0);
  assert.equal((await owner.request.get(`${origin}/api/identity/support`)).status(), 401);
  checked.push("logout clears another tab and denies subsequent history");
  await otherPage.goto(`${origin}/admin`);
  await otherPage.waitForURL("**/account");
  await expect(otherPage.getByRole("button", { name: "Reset data lokal" })).toHaveCount(0);
  checked.push("unmigrated demo authority is gated");
  console.log(JSON.stringify({ checks: checked, result: "PASS", origin, accountSetup: "admin-confirmed fixtures; no email delivery evidence" }));
} finally {
  await browser?.close();
  for (const user of users) {
    const { data: conversations, error: listError } = await admin.from("conversations").select("id").eq("requester_id", user.id);
    assert.ifError(listError);
    const ids = conversations.map(row => row.id);
    if (ids.length) {
      const { error: notificationError } = await admin.from("notifications").delete().in("target_id", ids);
      assert.ifError(notificationError);
      const { error: messageError } = await admin.from("messages").delete().in("conversation_id", ids);
      assert.ifError(messageError);
      const { error: conversationError } = await admin.from("conversations").delete().in("id", ids);
      assert.ifError(conversationError);
    }
    const { error } = await admin.auth.admin.deleteUser(user.id);
    assert.ifError(error);
  }
  console.log("Temporary Auth users and public support fixtures removed. Private audit/operation facts remain for reconciliation.");
}
