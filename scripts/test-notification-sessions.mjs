import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";

const project = process.env.BEETIP_TEST_PROJECT_REF;
assert.equal(project, "rgiptdfjlmwldngapojq", "Only dedicated development project allowed");
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3108";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Local candidate only");
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
const fixtures = [];
const listingId = randomUUID();
const checks = [];
let browser;
async function post(fixture, path, body, status = 200, headers = {}) {
  const response = await fixture.context.request.post(`${origin}/api/identity/${path}`, { headers: { Origin: origin, "X-Beetip-Member": fixture.id, ...headers }, data: body });
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
async function inbox(fixture, cursor) {
  const response = await fixture.context.request.get(`${origin}/api/identity/notifications?${new URLSearchParams(cursor ?? {})}`);
  assert.equal(response.status(), 200, await response.text());
  assert.match(response.headers()["cache-control"], /private, no-store/);
  return response.json();
}
try {
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  for (let index = 0; index < 3; index++) {
    const email = `btp10-${randomUUID()}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Penguji BTP10" } });
    assert.ifError(error);
    const fixture = { id: data.user.id, email };
    fixtures.push(fixture);
    fixture.context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    fixture.page = await fixture.context.newPage();
    await fixture.page.goto(`${origin}/login?next=%2Faccount%2Fnotifications`);
    await fixture.page.getByLabel("Email", { exact: true }).fill(email);
    await fixture.page.getByLabel("Kata sandi", { exact: true }).fill(password);
    await fixture.page.getByRole("button", { name: "Masuk", exact: true }).click();
    await fixture.page.waitForURL("**/account/notifications");
    const cookies = await fixture.context.cookies();
    fixture.client = createServerClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll() {} } });
  }
  const [owner, author, unrelated] = fixtures;
  const guest = await browser.newContext();
  assert.equal((await guest.request.get(`${origin}/api/identity/notifications`)).status(), 401);
  await post(owner, "notifications", { action: "preference", eventType: "offer_received", email: false, actorId: owner.id }, 400);
  checks.push("separate real Auth sessions, safe login destination, guest/CSRF/account-change/actor-spoofing denials");

  const listing = { type: "request", title: `BTP10 ${randomUUID()}`, shop: "Warung", category: "Makanan", area: "Alam Sutera", destination: "PRIVATE-BTP10-ADDRESS", items: [{ name: "Nasi", specification: "", quantity: 1, unitBudget: 20000 }], fee: 5000, bound: 10000, negotiable: true, capacity: 1, spendingCapacity: 150000, start: new Date(Date.now() + 86400000).toISOString(), end: new Date(Date.now() + 90000000).toISOString(), cutoff: new Date(Date.now() + 82800000).toISOString(), status: "active" };
  await post(owner, "listings", { operationId: randomUUID(), listingId, version: 0, listing });
  const offerId = randomUUID();
  const command = { operationId: randomUUID(), offerId, listingId, version: 0, listingVersion: 1, fee: 6000, action: "save" };
  await Promise.all([post(author, "offers", command), post(author, "offers", command)]);
  assert.equal((await inbox(owner)).items.length, 1);
  assert.equal((await inbox(author)).items.length, 0);
  assert.equal((await inbox(unrelated)).items.length, 0);
  const first = (await inbox(owner)).items[0];
  assert(!JSON.stringify(await inbox(owner)).includes(listing.destination));
  assert.deepEqual((await unrelated.client.from("notifications").select("*")).data, []);
  assert((await owner.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", first.id)).error);
  assert((await author.client.from("notification_preferences").insert({ recipient_id: owner.id, event_type: "offer_received", email_enabled: false })).error);
  assert((await owner.client.schema("private").rpc("enqueue_notification", { p_event: randomUUID(), p_type: "offer_received", p_target: offerId, p_actor: author.id, p_recipients: [owner.id] })).error);
  await post(unrelated, "notifications", { action: "read", id: first.id }, 403);
  assert.equal((await unrelated.context.request.get(`${origin}/api/identity/notifications/${first.id}/target`)).status(), 403);
  const target = await owner.context.request.get(`${origin}/api/identity/notifications/${first.id}/target`);
  assert.equal((await target.json()).target, `/account/offers?listing=${listingId}`);
  checks.push("transactional offer event and exact-retry deduplication, no self-notify, private RLS/write/internal-RPC/target denials");

  await Promise.all([post(owner, "notifications", { action: "read", id: first.id }), post(owner, "notifications", { action: "read", id: first.id })]);
  const readAt = (await inbox(owner)).items[0].read_at;
  await post(owner, "notifications", { action: "read", id: first.id });
  assert.equal((await inbox(owner)).items[0].read_at, readAt);
  assert.equal((await inbox(owner)).unread, 0);
  await post(owner, "notifications", { action: "preference", eventType: "offer_changed", email: false }, 400);
  assert.equal((await inbox(owner)).preferences, undefined);
  await post(owner, "notifications", { action: "read", id: first.id }, 403, { Origin: "https://unrelated.invalid" });
  await post(owner, "notifications", { action: "read", id: first.id }, 403, { "X-Beetip-Member": unrelated.id });
  for (let revision = 1; revision < 24; revision++) await post(author, "offers", { ...command, operationId: randomUUID(), version: revision, fee: 6000 + revision });
  const page1 = await inbox(owner);
  const page2 = await inbox(owner, page1.next);
  assert.equal(page1.items.length, 20);
  assert.equal(page2.items.length, 4);
  assert.equal(new Set([...page1.items, ...page2.items].map(row => row.id)).size, 24);
  assert.equal(page1.unread, 23);
  checks.push("monotonic concurrent reads, retired email preferences, real-event keyset pagination and exact unread totals");

  for (const width of [390, 768, 1440]) {
    await owner.page.setViewportSize({ width, height: 900 });
    await owner.page.goto(`${origin}/account`);
    await owner.page.getByRole("link", { name: "Notifikasi", exact: true }).click();
    await expect(owner.page.getByRole("heading", { name: "Notifikasi", exact: true })).toBeVisible();
    await expect(owner.page.getByRole("button", { name: "Muat lebih banyak", exact: true })).toBeVisible();
    assert(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
  }
  await owner.page.getByRole("button", { name: "Muat lebih banyak", exact: true }).click();
  await expect(owner.page.getByRole("button", { name: "Buka", exact: true })).toHaveCount(24);
  await owner.page.getByRole("button", { name: "Tandai dibaca", exact: true }).first().click();
  await expect(owner.page.getByText("22 belum dibaca", { exact: true })).toBeVisible();
  await owner.page.setViewportSize({ width: 390, height: 844 });
  mkdirSync("test-results/btp10", { recursive: true });
  await owner.page.screenshot({ path: "test-results/btp10/inbox-mobile.png", fullPage: true });
  await owner.page.getByRole("button", { name: "Buka", exact: true }).first().click();
  await owner.page.waitForURL(`**/account/offers?listing=${listingId}`);
  await expect(owner.page.getByRole("heading", { name: "Tinjau penawaran" })).toBeVisible();
  checks.push("account navigation, 390/768/1440 layouts, rendered pagination/read controls and authorized deep link");

  assert.ifError((await admin.from("members").update({ status: "suspended" }).eq("id", owner.id)).error);
  assert.equal((await owner.context.request.get(`${origin}/api/identity/notifications`)).status(), 403);
  assert.deepEqual((await owner.client.from("notifications").select("*")).data, []);
  assert.equal((await owner.context.request.get(`${origin}/api/identity/notifications/${first.id}/target`)).status(), 403);
  assert.ifError((await admin.from("members").update({ status: "pending" }).eq("id", owner.id)).error);
  await owner.page.goto(`${origin}/account/notifications`);
  await expect(owner.page.getByRole("button", { name: "Buka", exact: true })).toHaveCount(20);
  const logout = await owner.context.newPage();
  await logout.goto(`${origin}/account`);
  await logout.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(owner.page.getByRole("button", { name: "Buka", exact: true })).toHaveCount(0);
  checks.push("live suspension denies inbox/raw reads/target and cross-tab logout clears cached notifications");
  console.log(JSON.stringify({ result: "PASS", checks, boundary: "Synthetic Auth sessions on dedicated development only; no email delivery or production release claim" }));
} finally {
  await browser?.close();
  if (fixtures[0]) assert.ifError((await admin.from("listings").delete().eq("id", listingId).eq("owner_id", fixtures[0].id)).error);
  for (const fixture of fixtures) assert.ifError((await admin.auth.admin.deleteUser(fixture.id)).error);
  console.log("Temporary BTP10 users/listing/offers/notifications/preferences removed; audit/receipts retained.");
}
