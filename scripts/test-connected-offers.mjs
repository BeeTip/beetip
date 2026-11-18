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
const checks = [];
const title = `BTP05 ${randomUUID()}`;
const listing = { type: "request", title, shop: "Warung", category: "Makanan", area: "Alam Sutera", destination: "ALAMAT-PRIVAT-BTP05", items: [{ name: "Nasi", specification: "", quantity: 1, unitBudget: 20000 }], fee: 5000, bound: 10000, negotiable: true, capacity: 1, spendingCapacity: 150000, start: new Date(Date.now() + 86400000).toISOString(), end: new Date(Date.now() + 90000000).toISOString(), cutoff: new Date(Date.now() + 82800000).toISOString(), status: "active" };
let browser;
async function post(fixture, body, status = 200, path = "offers", headers = {}) {
  const response = await fixture.context.request.post(`${origin}/api/identity/${path}`, { headers: { Origin: origin, "X-Beetip-Member": fixture.id, ...headers }, data: body });
  assert.equal(response.status(), status, await response.text());
  return response.json();
}
async function offers(fixture, listingId) {
  const response = await fixture.context.request.get(`${origin}/api/identity/offers?${listingId ? `listingId=${listingId}` : ""}`);
  assert.equal(response.status(), 200, await response.text());
  assert.match(response.headers()["cache-control"], /private, no-store/);
  return response.json();
}
function offer(listingId, fee = 6000) { return { operationId: randomUUID(), offerId: randomUUID(), listingId, version: 0, listingVersion: 1, fee, action: "save" }; }
try {
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  for (let index = 0; index < 4; index++) {
    const email = `btp05-${randomUUID()}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: index < 3, user_metadata: { display_name: "Penguji BTP05" } });
    assert.ifError(error);
    const fixture = { id: data.user.id, email };
    fixtures.push(fixture);
    fixture.context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    fixture.page = await fixture.context.newPage();
    if (index === 3) continue;
    await fixture.page.goto(`${origin}/login`);
    await fixture.page.getByLabel("Email", { exact: true }).fill(email);
    await fixture.page.getByLabel("Kata sandi", { exact: true }).fill(password);
    await fixture.page.getByRole("button", { name: "Masuk", exact: true }).click();
    await fixture.page.waitForURL("**/account");
    const cookies = await fixture.context.cookies();
    fixture.client = createServerClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll() {} } });
  }
  const [owner, author, other, unconfirmed] = fixtures;
  const guest = await browser.newContext();
  const listingId = randomUUID();
  await post(owner, { operationId: randomUUID(), listingId, version: 0, listing }, 200, "listings");
  const command = offer(listingId);
  await post(unconfirmed, command, 401);
  assert.equal((await guest.request.get(`${origin}/api/identity/offers?listingId=${listingId}`)).status(), 401);
  await post(author, command, 403, "offers", { Origin: "https://unrelated.invalid" });
  await post(author, command, 403, "offers", { "X-Beetip-Member": other.id });
  await post(author, { ...command, authorId: owner.id }, 400);
  await post(owner, command, 403);
  await post(author, { ...command, fee: 10001 }, 400);
  await post(author, { ...command, fee: 0.5 }, 400);
  assert((await author.client.rpc("save_offer", { p_operation_id: randomUUID(), p_offer_id: randomUUID(), p_listing_id: listingId, p_version: 0, p_listing_version: 1, p_fee: 10001, p_action: "save" })).error?.message.startsWith("VALIDATION"));
  checks.push("guest, CSRF, account-change, actor spoofing, self-offer and API/SQL fee denials");

  const duplicate = await Promise.all([post(author, command), post(author, command)]);
  assert.equal(duplicate[0].offerId, duplicate[1].offerId);
  await post(author, { ...command, fee: 7000 }, 409);
  await post(author, offer(listingId), 409);
  assert.equal((await offers(author, listingId)).offers.length, 1);
  assert.equal((await offers(owner, listingId)).offers.length, 1);
  assert.equal((await offers(other, listingId)).offers.length, 0);
  assert.deepEqual((await other.client.from("offers").select("*").eq("listing_id", listingId)).data, []);
  assert.deepEqual((await other.client.from("offer_revisions").select("*").eq("offer_id", command.offerId)).data, []);
  assert((await author.client.from("offers").update({ fee: 0 }).eq("id", command.offerId)).error);
  assert((await author.client.from("offer_revisions").delete().eq("offer_id", command.offerId)).error);
  assert(!(JSON.stringify(await offers(owner, listingId))).includes(listing.destination));
  const anon = createClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  assert((await anon.from("offers").select("*")).error);
  assert((await anon.rpc("offer_listing", { p_id: listingId })).error);
  checks.push("concurrent exact retry, changed payload conflict, one active offer, private reads and denied raw writes/revision deletion");

  await post(owner, { operationId: randomUUID(), listingId, version: 1, listing: { ...listing, start: new Date(Date.now() + 172800000).toISOString(), end: new Date(Date.now() + 176400000).toISOString() } }, 200, "listings");
  await post(author, { ...command, operationId: randomUUID(), version: 1 }, 409);
  await author.page.goto(`${origin}/account/offers?listing=${listingId}`);
  await expect(author.page.getByText("Jadwal atau rincian berubah.", { exact: false })).toBeVisible();
  await author.page.getByLabel("Ongkos penawaran (Rp)").fill("7000");
  await author.page.getByRole("checkbox").check();
  await author.page.getByRole("button", { name: "Perbarui dan setujui penawaran" }).click();
  await expect(author.page.getByText("Penawaran tersimpan.", { exact: false })).toBeVisible();
  assert.equal((await offers(author, listingId)).offers[0].listing_version, 2);
  const history = await author.client.from("offer_revisions").select("*").eq("offer_id", command.offerId).order("version");
  assert.ifError(history.error); assert.equal(history.data.length, 2);
  assert.equal(history.data[0].listing_version, 1); assert.equal(history.data[0].fee, 6000);
  assert.equal(history.data[1].listing_version, 2); assert.equal(history.data[1].fee, 7000);
  assert.notEqual(history.data[0].terms.start, history.data[1].terms.start);
  await owner.page.goto(`${origin}/account/offers?listing=${listingId}`);
  await expect(owner.page.getByRole("heading", { name: "Tinjau penawaran" })).toBeVisible();
  await expect(owner.page.getByText("Rp 7.000", { exact: true })).toBeVisible();
  assert.equal(await owner.page.getByRole("button", { name: "Kirim penawaran" }).count(), 0);
  checks.push("reschedule rejects stale consent, author renews through mobile UI, immutable schedule/fee history and owner review");

  const change = { ...command, operationId: randomUUID(), version: 2, listingVersion: 2, fee: 8000 };
  const withdraw = { ...change, operationId: randomUUID(), action: "withdraw", fee: 7000 };
  const raced = await Promise.all([author.context.request.post(`${origin}/api/identity/offers`, { headers: { Origin: origin, "X-Beetip-Member": author.id }, data: change }), author.context.request.post(`${origin}/api/identity/offers`, { headers: { Origin: origin, "X-Beetip-Member": author.id }, data: withdraw })]);
  assert.deepEqual(raced.map(response => response.status()).sort(), [200, 409]);
  await post(other, { ...change, operationId: randomUUID(), version: 3 }, 403);
  await post(owner, { ...change, operationId: randomUUID(), version: 3 }, 403);
  const current = (await offers(author, listingId)).offers[0];
  if (current.status === "active") await post(author, { ...withdraw, operationId: randomUUID(), version: current.version, fee: current.fee });
  await post(author, { ...change, operationId: randomUUID(), version: current.version }, 409);
  checks.push("concurrent update/withdraw has one winner, unrelated/owner mutation denial and terminal withdrawn version");

  const tripId = randomUUID();
  const trip = { ...listing, type: "trip", capacity: 3, fee: 7000, bound: 3000 };
  await post(owner, { operationId: randomUUID(), listingId: tripId, version: 0, listing: trip }, 200, "listings");
  await post(author, offer(tripId, 2999), 400);
  await author.page.goto(`${origin}/account/offers?listing=${tripId}`);
  await author.page.getByLabel("Ongkos penawaran (Rp)").fill("4000");
  await author.page.getByRole("checkbox").check();
  await author.page.getByRole("button", { name: "Kirim penawaran", exact: true }).click();
  await expect(author.page.getByText("Penawaran tersimpan.", { exact: false })).toBeVisible();
  const createdTripOffer = (await offers(author, tripId)).offers[0];
  const tripOffer = { ...offer(tripId, 4000), offerId: createdTripOffer.id };
  await post(other, offer(tripId, 5000));
  assert.equal((await offers(owner, tripId)).offers.length, 2);
  assert.equal((await offers(author, tripId)).offers.length, 1);
  await post(owner, { operationId: randomUUID(), listingId: tripId, version: 1, listing: { ...trip, status: "paused" } }, 200, "listings");
  await post(author, { ...tripOffer, operationId: randomUUID(), version: 1, listingVersion: 2 }, 409);
  await author.page.goto(`${origin}/account/offers?listing=${tripId}`);
  await expect(author.page.getByText("Listing ditutup atau batas waktu sudah lewat.")).toBeVisible();
  await author.page.getByRole("button", { name: "Tarik penawaran" }).click();
  await expect(author.page.getByText("Penawaran ditarik.", { exact: true })).toBeVisible();
  const fixedId = randomUUID();
  await post(owner, { operationId: randomUUID(), listingId: fixedId, version: 0, listing: { ...listing, negotiable: false, bound: 5000 } }, 200, "listings");
  await post(author, offer(fixedId, 4999), 400);
  await post(author, offer(fixedId, 5000));
  assert.ifError((await admin.from("members").update({ status: "suspended" }).eq("id", author.id)).error);
  await post(author, offer(fixedId, 5000), 403);
  assert.equal((await author.context.request.get(`${origin}/api/identity/offers`)).status(), 403);
  assert.deepEqual((await author.client.from("offers").select("*")).data, []);
  assert.ifError((await admin.from("members").update({ status: "pending" }).eq("id", author.id)).error);
  checks.push("trip minimum and competitor privacy, paused listing blocks changes but permits withdrawal, fixed fee exactness");

  await author.page.goto(`${origin}/account/offers`);
  await expect(author.page.getByRole("link", { name: "Kelola penawaran" })).toHaveCount(3);
  for (const width of [390, 768, 1440]) {
    await owner.page.setViewportSize({ width, height: 900 });
    await owner.page.goto(`${origin}/account/offers?listing=${tripId}`);
    await expect(owner.page.getByRole("heading", { name: "Tinjau penawaran" })).toBeVisible();
    assert(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
  }
  mkdirSync("test-results/btp05", { recursive: true });
  await author.page.screenshot({ path: "test-results/btp05/offers-mobile.png", fullPage: true });
  const logout = await author.context.newPage();
  await logout.goto(`${origin}/account`);
  await logout.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(author.page.getByRole("heading", { name: "Sesi akun berubah" })).toBeVisible();
  await expect(author.page.getByRole("link", { name: "Kelola penawaran" })).toHaveCount(0);
  checks.push("persisted own inbox, 390/768/1440 review layout and cross-tab logout clears private offers");
  console.log(JSON.stringify({ result: "PASS", checks, boundary: "Separate temporary confirmed sessions; no real email, order or payment claim" }));
} finally {
  await browser?.close();
  for (const fixture of fixtures) {
    assert.ifError((await admin.from("listings").delete().eq("owner_id", fixture.id)).error);
    assert.ifError((await admin.auth.admin.deleteUser(fixture.id)).error);
  }
  console.log("Temporary BTP05 listings, offers, revisions and users removed; private audit/receipts retained.");
}
