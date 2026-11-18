import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const project = process.env.BEETIP_TEST_PROJECT_REF;
assert.equal(project, "rgiptdfjlmwldngapojq", "Only the dedicated BeeTip development project is allowed");
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3108";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "This candidate harness accepts a local connected application only");
const settings = Object.fromEntries(readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8").split(/\r?\n/).filter(line => line.includes("=")).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
assert.equal(settings.NEXT_PUBLIC_SUPABASE_URL, `https://${project}.supabase.co`);
const keys = JSON.parse(execFileSync("rtk", ["proxy", "supabase", "projects", "api-keys", "--project-ref", project, "--reveal", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const key = keys.find(key => key.type === "secret" && !key.disabled) ?? keys.find(key => key.name === "service_role" && !key.disabled);
assert(key?.api_key);
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
const admin = createClient(settings.NEXT_PUBLIC_SUPABASE_URL, key.api_key, { auth: { persistSession: false, autoRefreshToken: false } });
const password = randomBytes(24).toString("base64url");
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1fQAAAAASUVORK5CYII=", "base64");
const fixtures = [];
const checks = [];
let browser;

function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.toUpperCase().replace(/=+$/, "")].map(char => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", bytes).update(counter).digest();
  const offset = hash[hash.length - 1] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
async function post(context, path, body, status = 200) {
  const response = await context.request.post(`${origin}/api/identity/${path}`, { headers: { Origin: origin }, data: body });
  assert.equal(response.status(), status, `${path}: expected ${status}, received ${response.status()}`);
  return response.json();
}
async function command(context, action, requestId, value = "", status = 200, operationId = randomUUID()) {
  return post(context, "affiliation", { operationId, action, requestId, value }, status);
}
async function get(context, path) { return context.request.get(`${origin}/api/identity/${path}`); }
async function mfa(fixture) {
  await fixture.page.goto(`${origin}/account/affiliation`);
  await fixture.page.getByRole("button", { name: "Siapkan autentikator" }).click();
  const secret = fixture.page.getByLabel("Kunci autentikator", { exact: true });
  await expect(secret).toBeVisible();
  await fixture.page.getByLabel("Kode autentikator", { exact: true }).fill(totp(await secret.inputValue()));
  await fixture.page.getByRole("button", { name: "Verifikasi MFA", exact: true }).click();
  await expect(fixture.page.getByText("MFA aktif pada sesi ini.")).toBeVisible();
}

try {
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  for (const name of ["Pemohon BTP03", "Pengguna lain BTP03", "Pemeriksa BTP03", "Pengelola BTP03"]) {
    const email = `btp03-${randomUUID()}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name, role: "platform_admin" } });
    assert.ifError(error);
    const fixture = { id: data.user.id, email };
    fixtures.push(fixture);
    fixture.context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    fixture.page = await fixture.context.newPage();
    await fixture.page.goto(`${origin}/login`);
    await fixture.page.getByLabel("Email", { exact: true }).fill(email);
    await fixture.page.getByLabel("Kata sandi", { exact: true }).fill(password);
    await fixture.page.getByRole("button", { name: "Masuk", exact: true }).click();
    await fixture.page.waitForURL("**/account");
    await expect(fixture.page.getByText("Email terkonfirmasi. Akunmu siap digunakan", { exact: false })).toBeVisible();
  }
  const [owner, other, reviewer, platform] = fixtures;
  assert.equal((await post(owner.context, "staff", { operationId: randomUUID(), memberId: other.id, role: "support", grant: true, reason: "owner_approved" }, 403)).ok, false);
  checks.push("confirmed accounts work without affiliation and forged profile roles give no authority");
  await owner.page.getByRole("link", { name: "Afiliasi opsional dan keamanan petugas" }).click();
  await owner.page.getByLabel("Institusi", { exact: true }).fill("Kampus uji BTP03");
  await owner.page.getByRole("button", { name: "Mulai pengajuan opsional" }).click();
  await expect(owner.page.getByText("Draf: unggah bukti lalu kirim")).toBeVisible();
  let ownData = await (await get(owner.context, "affiliation")).json();
  const requestId = ownData.requests[0].id;
  const evidencePath = `affiliation/${requestId}/evidence`;
  await owner.page.getByLabel("Bukti afiliasi", { exact: true }).setInputFiles({ name: "evidence.png", mimeType: "image/png", buffer: image });
  await owner.page.getByRole("button", { name: "Unggah dan kirim bukti" }).click();
  await expect(owner.page.getByText("Menunggu pemeriksaan")).toBeVisible();
  const ownerCookies = await owner.context.cookies();
  const directOwner = createServerClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => ownerCookies, setAll() {} } });
  const { error: downloadError } = await directOwner.storage.from("affiliation-evidence").download(`${owner.id}/${requestId}/evidence`);
  if (downloadError) throw new Error(`Authenticated Storage download failed: ${downloadError.message}`);
  assert.equal((await get(owner.context, evidencePath)).status(), 200);
  const { error: signedError } = await directOwner.storage.from("affiliation-evidence").createSignedUrl(`${owner.id}/${requestId}/evidence`, 3600);
  assert(signedError, "Evidence must not yield a signed URL that bypasses live authorization");
  const { error: signedUploadError } = await directOwner.storage.from("affiliation-evidence").createSignedUploadUrl(`${owner.id}/${requestId}/evidence`);
  assert(signedUploadError, "Evidence must not yield a signed upload capability");
  assert.equal((await get(other.context, evidencePath)).status(), 403);
  assert.deepEqual((await (await get(other.context, "affiliation")).json()).requests, []);
  const guest = await browser.newContext();
  assert.equal((await get(guest, evidencePath)).status(), 401);
  assert.equal((await get(guest, "affiliation")).status(), 401);
  const publicPage = await guest.newPage();
  await publicPage.goto(origin);
  await expect(publicPage.getByText("Kampus uji BTP03", { exact: true })).toHaveCount(0);
  const crossOrigin = await owner.context.request.post(`${origin}/api/identity/affiliation`, { headers: { Origin: "https://unrelated.invalid" }, data: { operationId: randomUUID(), action: "withdraw", requestId, value: "" } });
  assert.equal(crossOrigin.status(), 403);
  await post(owner.context, "affiliation", { operationId: randomUUID(), action: "withdraw", requestId, value: "", memberId: other.id }, 400);
  checks.push("real private Storage upload and owner/reviewer projection, unrelated and anonymous denial, CSRF and actor spoofing");
  await mfa(reviewer);
  await mfa(platform);
  const { error: bootstrapError } = await admin.from("staff_roles").insert({ member_id: platform.id, role: "platform_admin" });
  assert.ifError(bootstrapError);
  const grant = { operationId: randomUUID(), memberId: reviewer.id, role: "membership_review", grant: true, reason: "owner_approved" };
  await post(platform.context, "staff", grant);
  await post(platform.context, "staff", grant);
  const { data: targetRoles, error: targetError } = await admin.from("staff_roles").select("role").eq("member_id", reviewer.id).is("revoked_at", null);
  assert.ifError(targetError);
  assert.deepEqual(targetRoles.map(role => role.role), ["membership_review"]);
  await command(reviewer.context, "begin", randomUUID(), "Draf milik pemeriksa");
  const { error: historyError } = await admin.from("affiliation_requests").insert(Array.from({ length: 105 }, () => ({ id: randomUUID(), member_id: owner.id, institution: "Riwayat sintetis", status: "rejected", decision_code: "unreadable" })));
  assert.ifError(historyError);
  const reviewProjection = await (await get(reviewer.context, "affiliation")).json();
  assert(reviewProjection.requests.some(row => row.id === requestId), "Old pending work must survive more than 100 newer historical requests");
  assert(reviewProjection.requests.some(row => row.member_id === reviewer.id && row.status === "draft"), "Own draft must survive a busy queue");
  const { error: historyCleanupError } = await admin.from("affiliation_requests").delete().eq("member_id", owner.id).eq("institution", "Riwayat sintetis");
  assert.ifError(historyCleanupError);
  await reviewer.page.reload();
  await expect(reviewer.page.getByRole("heading", { name: "Antrean pemeriksaan afiliasi" })).toBeVisible();
  assert.equal((await get(reviewer.context, evidencePath)).status(), 200);
  await reviewer.page.getByRole("button", { name: "Tolak: bukti tidak terbaca" }).click();
  await owner.page.reload();
  await expect(owner.page.getByText("Bukti perlu diperbaiki", { exact: true })).toBeVisible();
  await post(owner.context, "support", { operationId: randomUUID(), body: "Afiliasi ditolak tidak memblokir akun." });
  checks.push("real TOTP enrollment/verification UI, scoped idempotent grant, busy-queue regression, reviewer rejection UI and continued account access");
  const secondId = randomUUID();
  await command(owner.context, "begin", secondId, "Kampus uji kedua");
  const secondPath = `affiliation/${secondId}/evidence`;
  assert.equal((await owner.context.request.put(`${origin}/api/identity/${secondPath}`, { headers: { Origin: origin, "Content-Type": "image/png" }, data: Buffer.from("this is not a PNG") })).status(), 400);
  assert.equal((await owner.context.request.put(`${origin}/api/identity/${secondPath}`, { headers: { Origin: origin, "Content-Type": "image/png" }, data: image })).status(), 200);
  assert.equal((await owner.context.request.put(`${origin}/api/identity/${secondPath}`, { headers: { Origin: origin, "Content-Type": "image/png" }, data: image })).status(), 200);
  const changedImage = Buffer.concat([image, Buffer.from("changed")]);
  assert.equal((await owner.context.request.put(`${origin}/api/identity/${secondPath}`, { headers: { Origin: origin, "Content-Type": "image/png" }, data: changedImage })).status(), 409);
  const submitOperation = randomUUID();
  const duplicates = await Promise.all([command(owner.context, "submit", secondId, "", 200, submitOperation), command(owner.context, "submit", secondId, "", 200, submitOperation)]);
  assert.equal(duplicates[0].requestId, duplicates[1].requestId);
  await command(owner.context, "withdraw", secondId, "", 409, submitOperation);
  await reviewer.page.reload();
  await reviewer.page.getByRole("button", { name: "Setujui lencana" }).click();
  await owner.page.reload();
  await expect(owner.page.getByText("Afiliasi terverifikasi", { exact: true })).toBeVisible();
  assert(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  mkdirSync(new URL("../test-results/btp03/", import.meta.url), { recursive: true });
  await owner.page.screenshot({ path: fileURLToPath(new URL("../test-results/btp03/account-affiliation.png", import.meta.url)), fullPage: true });
  await reviewer.page.screenshot({ path: fileURLToPath(new URL("../test-results/btp03/reviewer.png", import.meta.url)), fullPage: true });
  checks.push("bounded image validation, immutable evidence retry, concurrent command replay, changed-payload conflict, badge approval and mobile layout");
  await post(platform.context, "staff", { operationId: randomUUID(), memberId: reviewer.id, role: "membership_review", grant: false, reason: "access_removed" });
  assert.equal((await get(reviewer.context, secondPath)).status(), 403);
  assert((await (await get(reviewer.context, "affiliation")).json()).requests.every(row => row.member_id === reviewer.id), "Revocation preserves own account access but removes reviewer scope");
  await command(reviewer.context, "approve", secondId, "matched", 403);
  const { error: suspendError } = await admin.from("members").update({ status: "suspended" }).eq("id", owner.id);
  assert.ifError(suspendError);
  assert.equal((await get(owner.context, secondPath)).status(), 403);
  assert.equal((await get(owner.context, "affiliation")).status(), 403);
  assert.equal((await get(owner.context, "support")).status(), 403);
  assert.equal((await owner.context.request.get(origin)).status(), 200);
  const { error: restoreError } = await admin.from("members").update({ status: "approved" }).eq("id", owner.id);
  assert.ifError(restoreError);
  checks.push("same-session grant revocation and suspension remove protected reads and writes while browsing stays public");
  await owner.page.reload();
  await expect(owner.page.getByText("Afiliasi terverifikasi", { exact: true })).toBeVisible();
  await other.page.goto(`${origin}/account/affiliation`);
  await expect(other.page.getByRole("button", { name: "Siapkan autentikator" })).toBeVisible();
  let releaseEnrollment;
  let enrollmentStarted;
  const hold = new Promise(resolve => { releaseEnrollment = resolve; });
  const started = new Promise(resolve => { enrollmentStarted = resolve; });
  await other.page.route("**/api/identity/mfa", async route => {
    const response = await route.fetch();
    enrollmentStarted();
    await hold;
    await route.fulfill({ response });
  });
  await other.page.getByRole("button", { name: "Siapkan autentikator" }).click();
  await started;
  await other.page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    window.dispatchEvent(new StorageEvent("storage", { key: "beetip-auth-change", newValue: "test-account-change" }));
  });
  await expect(other.page.getByRole("button", { name: "Siapkan autentikator" })).toHaveCount(0);
  releaseEnrollment();
  await other.page.unrouteAll({ behavior: "wait" });
  await other.page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    window.dispatchEvent(new Event("focus"));
  });
  await expect(other.page.getByRole("button", { name: "Siapkan autentikator" })).toBeVisible();
  await expect(other.page.getByLabel("Kunci autentikator", { exact: true })).toHaveCount(0);
  await other.page.getByRole("button", { name: "Siapkan autentikator" }).click();
  await expect(other.page.getByLabel("Kunci autentikator", { exact: true })).toBeVisible();
  let releaseOldAccount;
  let oldAccountStarted;
  const holdOldAccount = new Promise(resolve => { releaseOldAccount = resolve; });
  const startedOldAccount = new Promise(resolve => { oldAccountStarted = resolve; });
  await other.page.route("**/api/identity/mfa", async route => {
    const response = await route.fetch();
    oldAccountStarted();
    await holdOldAccount;
    await route.fulfill({ response });
  });
  await other.page.getByRole("button", { name: "Siapkan autentikator" }).click();
  await startedOldAccount;
  await other.context.clearCookies();
  await other.context.addCookies(await owner.context.cookies());
  await other.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(other.page.getByText("Kampus uji kedua", { exact: true })).toBeVisible();
  await expect(other.page.getByRole("button", { name: "Tarik pengajuan" }).first()).toBeEnabled();
  releaseOldAccount();
  await other.page.unrouteAll({ behavior: "wait" });
  await expect(other.page.getByLabel("Kunci autentikator", { exact: true })).toHaveCount(0);
  checks.push("hidden-tab account event clears data, delayed enrollment cannot restore a seed, and focus identity fallback clears old MFA state");
  const logout = await owner.context.newPage();
  await logout.goto(`${origin}/account`);
  await logout.getByRole("button", { name: "Keluar", exact: true }).click();
  await logout.waitForURL(origin + "/");
  await expect(owner.page.getByText("Kampus uji kedua", { exact: true })).toHaveCount(0);
  assert.equal((await get(owner.context, secondPath)).status(), 401);
  checks.push("logout clears private affiliation history across tabs and returns to public browsing");
  console.log(JSON.stringify({ result: "PASS", origin, checks, setup: "Temporary admin-confirmed fixtures; real TOTP and Storage; no new email-delivery claim" }));
} finally {
  await browser?.close();
  for (const fixture of fixtures) {
    const { data: requests, error: requestError } = await admin.from("affiliation_requests").select("id").eq("member_id", fixture.id);
    assert.ifError(requestError);
    if (requests.length) {
      const { error } = await admin.storage.from("affiliation-evidence").remove(requests.map(row => `${fixture.id}/${row.id}/evidence`));
      assert.ifError(error);
      const { error: deleteError } = await admin.from("affiliation_requests").delete().eq("member_id", fixture.id);
      assert.ifError(deleteError);
    }
    const { data: conversations, error: listError } = await admin.from("conversations").select("id").eq("requester_id", fixture.id);
    assert.ifError(listError);
    if (conversations.length) {
      const ids = conversations.map(row => row.id);
      const { error: messageError } = await admin.from("messages").delete().in("conversation_id", ids);
      assert.ifError(messageError);
      const { error: conversationError } = await admin.from("conversations").delete().in("id", ids);
      assert.ifError(conversationError);
    }
  }
  for (const fixture of fixtures) {
    const { error } = await admin.auth.admin.deleteUser(fixture.id);
    assert.ifError(error);
  }
  console.log("Temporary BTP03 users, evidence and public fixtures removed; private audit and operation facts retained.");
}
