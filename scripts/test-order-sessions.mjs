import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const listingIds = [];
const checks = [];
let browser;
const baseListing = { type: "request", title: "BTP06 synthetic order", shop: "Warung", category: "Makanan", area: "Alam Sutera", destination: "PRIVATE-BTP06-ADDRESS", items: [{ name: "Nasi", specification: "Tanpa sambal", quantity: 1, unitBudget: 20000 }], fee: 5000, bound: 10000, negotiable: true, capacity: 1, spendingCapacity: 150000, start: new Date(Date.now() + 86400000).toISOString(), end: new Date(Date.now() + 90000000).toISOString(), cutoff: new Date(Date.now() + 82800000).toISOString(), status: "active" };
async function post(fixture, path, body, status = 200, headers = {}) {
  const response = await fixture.context.request.post(`${origin}/api/identity/${path}`, { headers: { Origin: origin, "X-Beetip-Member": fixture.id, ...headers }, data: body });
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
async function publish(fixture, changes = {}) {
  const id = randomUUID(); listingIds.push(id);
  await post(fixture, "listings", { operationId: randomUUID(), listingId: id, version: 0, listing: { ...baseListing, ...changes } });
  return id;
}
async function propose(fixture, listingId) {
  const offerId = randomUUID();
  await post(fixture, "offers", { operationId: randomUUID(), offerId, listingId, version: 0, listingVersion: 1, fee: 6000, action: "save" });
  return { operationId: randomUUID(), listingId, listingVersion: 1, offerId, offerVersion: 1 };
}
async function order(fixture, id, status = 200) {
  const response = await fixture.context.request.get(`${origin}/api/identity/orders?id=${id}`);
  assert.equal(response.status(), status, await response.text());
  assert.match(response.headers()["cache-control"], /private, no-store/);
  return response.json();
}
async function race(fixture, commands) {
  const results = await Promise.all(commands.map(data => fixture.context.request.post(`${origin}/api/identity/orders`, { headers: { Origin: origin, "X-Beetip-Member": fixture.id }, data })));
  assert.deepEqual(results.map(row => row.status()).sort(), [200, 409]);
  return (await results.find(row => row.status() === 200).json()).orderId;
}
try {
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  for (let index = 0; index < 4; index++) {
    const email = `btp06-${randomUUID()}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Penguji BTP06" } });
    assert.ifError(error);
    const fixture = { id: data.user.id, email }; fixtures.push(fixture);
    fixture.context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    fixture.page = await fixture.context.newPage();
    await fixture.page.goto(`${origin}/login`);
    await fixture.page.getByLabel("Email", { exact: true }).fill(email);
    await fixture.page.getByLabel("Kata sandi", { exact: true }).fill(password);
    await fixture.page.getByRole("button", { name: "Masuk", exact: true }).click();
    await fixture.page.waitForURL("**/account");
    const cookies = await fixture.context.cookies();
    fixture.client = createServerClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll() {} } });
  }
  const [owner, author, other, unrelated] = fixtures;
  const requestId = await publish(owner);
  const command = await propose(author, requestId);
  const guest = await browser.newContext();
  assert.equal((await guest.request.get(`${origin}/api/identity/orders?id=${randomUUID()}`)).status(), 401);
  await post(owner, "orders", command, 403, { Origin: "https://unrelated.invalid" });
  await post(owner, "orders", command, 403, { "X-Beetip-Member": author.id });
  await post(owner, "orders", { ...command, actorId: owner.id }, 400);
  await post(author, "orders", command, 403);
  const accepted = await Promise.all([post(owner, "orders", command), post(owner, "orders", command)]);
  assert.equal(accepted[0].orderId, accepted[1].orderId);
  const id = accepted[0].orderId;
  await post(owner, "orders", { ...command, listingVersion: 2 }, 409);
  await post(owner, "orders", { ...command, operationId: randomUUID() }, 409);
  const detail = (await order(author, id)).order;
  assert.equal(detail.terms.fee, 6000);
  assert.equal(detail.terms.destination, baseListing.destination);
  await order(unrelated, id, 403);
  for (const table of ["orders", "order_terms", "reservations"]) assert.deepEqual((await unrelated.client.from(table).select("*")).data, []);
  assert.deepEqual((await unrelated.client.from("conversations").select("*").eq("id", detail.conversationId)).data, []);
  assert((await author.client.from("orders").update({ state: "cancelled" }).eq("id", id)).error);
  assert((await author.client.from("order_terms").update({ terms: {} }).eq("order_id", id)).error);
  const notifications = await author.context.request.get(`${origin}/api/identity/notifications`);
  const acceptedNotifications = (await notifications.json()).items.filter(row => row.event_type === "order_accepted");
  assert.equal(acceptedNotifications.length, 1);
  assert.equal((await (await author.context.request.get(`${origin}/api/identity/notifications/${acceptedNotifications[0].id}/target`)).json()).target, `/orders/${id}`);
  checks.push("confirmed sessions, guest/CSRF/actor/account guards, concurrent exact retry, changed-payload conflict, private snapshot/conversation and counterpart-only notification bridge");

  const tripId = await publish(owner, { type: "trip", capacity: 1, bound: 3000 });
  const firstTrip = await propose(author, tripId);
  const secondTrip = await propose(other, tripId);
  await race(owner, [firstTrip, secondTrip]);
  const spendingId = await publish(owner, { type: "trip", capacity: 3, spendingCapacity: 30000, bound: 3000 });
  await race(owner, [await propose(author, spendingId), await propose(other, spendingId)]);
  const multiId = await publish(owner, { type: "trip", capacity: 3, bound: 3000 });
  const multi = await Promise.all([post(owner, "orders", await propose(author, multiId)), post(owner, "orders", await propose(other, multiId))]);
  assert.notEqual(multi[0].orderId, multi[1].orderId);
  const competingId = await publish(owner);
  await race(owner, [await propose(author, competingId), await propose(other, competingId)]);
  checks.push("real concurrent final-slot, spending-limit and request uniqueness races, plus multiple orders per offered trip");

  const staleId = await publish(owner);
  const stale = await propose(author, staleId);
  await post(owner, "listings", { operationId: randomUUID(), listingId: staleId, version: 1, listing: { ...baseListing, end: new Date(Date.now() + 93600000).toISOString() } });
  await post(owner, "orders", { ...stale, listingVersion: 2 }, 409);
  await post(owner, "listings", { operationId: randomUUID(), listingId: staleId, version: 2, listing: { ...baseListing, status: "paused" } });
  await post(owner, "orders", { ...stale, operationId: randomUUID(), listingVersion: 3 }, 409);
  checks.push("renewed schedule consent and paused-listing rejection on connected API");

  const fixedId = await publish(owner, { negotiable: false, bound: 5000 });
  await author.page.goto(`${origin}/account/offers?listing=${fixedId}`);
  const attempts = [];
  await author.page.route("**/api/identity/orders", async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) { const committed = await route.fetch(); assert.equal(committed.status(), 200); return route.abort("failed"); }
    return route.continue();
  });
  await author.page.getByRole("checkbox", { name: /untuk membuat pesanan/ }).check();
  await author.page.getByRole("button", { name: "Ambil permintaan harga tetap", exact: true }).click();
  await expect(author.page.getByRole("button", { name: "Coba lagi penerimaan", exact: true })).toBeVisible();
  await author.page.getByRole("button", { name: "Coba lagi penerimaan", exact: true }).click();
  await expect(author.page.getByRole("link", { name: "Lihat pesanan", exact: true })).toBeVisible();
  assert.deepEqual(attempts[0], attempts[1]);
  await author.page.getByRole("link", { name: "Lihat pesanan", exact: true }).click();
  await expect(author.page.getByRole("heading", { name: "Rincian yang disepakati", exact: true })).toBeVisible();
  for (const width of [390, 768, 1440]) {
    await author.page.setViewportSize({ width, height: 900 });
    assert(await author.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
  }
  await author.page.setViewportSize({ width: 390, height: 844 });
  mkdirSync("test-results/btp06", { recursive: true });
  await author.page.screenshot({ path: "test-results/btp06/order-mobile.png", fullPage: true });
  const logout = await author.context.newPage();
  await logout.goto(`${origin}/account`);
  await logout.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(author.page.getByRole("heading", { name: "Rincian yang disepakati", exact: true })).toHaveCount(0);
  checks.push("fixed-price UI acceptance, committed response loss and original-command retry, private detail at three widths, cross-tab logout clearing");
  console.log(JSON.stringify({ result: "PASS", checks, boundary: "Dedicated development synthetic orders only; no email, funding, payment or production release evidence" }));
} finally {
  await browser?.close();
  if (listingIds.length) {
    assert(listingIds.every(id => /^[0-9a-f-]{36}$/.test(id)));
    const ids = listingIds.map(id => `'${id}'::uuid`).join(",");
    const cleanup = `begin;
      create temporary table btp06_orders as select id,conversation_id from public.orders where listing_id in (${ids});
      delete from private.acceptance_notification_intents where order_id in (select id from btp06_orders);
      alter table public.order_terms disable trigger order_terms_immutable;
      delete from public.order_terms where order_id in (select id from btp06_orders);
      alter table public.order_terms enable trigger order_terms_immutable;
      delete from public.reservations where order_id in (select id from btp06_orders);
      delete from public.orders where id in (select id from btp06_orders);
      delete from public.conversation_members where conversation_id in (select conversation_id from btp06_orders);
      delete from public.conversations where id in (select conversation_id from btp06_orders);
      delete from public.listings where id in (${ids}); commit;`;
    mkdirSync("test-results/btp06", { recursive: true });
    writeFileSync("test-results/btp06/cleanup.sql", cleanup);
    execFileSync("rtk", ["proxy", "supabase", "db", "query", "--linked", "--project-ref", project, "--file", "test-results/btp06/cleanup.sql", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  }
  for (const fixture of fixtures) assert.ifError((await admin.auth.admin.deleteUser(fixture.id)).error);
  console.log("Temporary BTP06 business fixtures and Auth users removed; audit/receipts retained.");
}
