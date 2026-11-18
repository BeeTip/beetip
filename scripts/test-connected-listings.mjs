import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";

const project = process.env.BEETIP_TEST_PROJECT_REF;
assert.equal(project, "rgiptdfjlmwldngapojq", "Only the dedicated development project is allowed");
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
const title = `BTP04 ${randomUUID()}`;
const start = new Date(Date.now() + 86400000).toISOString();
const listing = { type: "request", title, shop: "W".repeat(100), category: "Makanan", area: "Alam Sutera", destination: "ALAMAT-PRIVAT-BTP04", items: [{ name: "Nasi", specification: "Tanpa pedas", quantity: 2, unitBudget: 20000 }], fee: 5000, bound: 5000, negotiable: false, capacity: 1, spendingCapacity: 150000, start, end: new Date(Date.now() + 90000000).toISOString(), cutoff: new Date(Date.now() + 82800000).toISOString(), status: "active" };
let browser;
async function post(fixture, body, status = 200, extraHeaders = {}) {
  const response = await fixture.context.request.post(`${origin}/api/identity/listings`, { headers: { Origin: origin, "X-Beetip-Member": fixture.id, ...extraHeaders }, data: body });
  assert.equal(response.status(), status, `Expected ${status}, got ${response.status()}: ${await response.text()}`);
  return response.json();
}
async function board(context, params = {}) {
  const response = await context.request.get(`${origin}/api/listings?${new URLSearchParams(params)}`);
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}
async function own(fixture, id) {
  const response = await fixture.context.request.get(`${origin}/api/identity/listings?id=${id}`);
  assert.equal(response.status(), 200);
  return response.json();
}
try {
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  for (const confirmed of [true, true, false]) {
    const email = `btp04-${randomUUID()}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: confirmed, user_metadata: { display_name: "Penguji BTP04", role: "platform_admin" } });
    assert.ifError(error);
    const fixture = { id: data.user.id, email };
    fixtures.push(fixture);
    fixture.context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    fixture.page = await fixture.context.newPage();
    if (!confirmed) continue;
    await fixture.page.goto(`${origin}/login`);
    await fixture.page.getByLabel("Email", { exact: true }).fill(email);
    await fixture.page.getByLabel("Kata sandi", { exact: true }).fill(password);
    await fixture.page.getByRole("button", { name: "Masuk", exact: true }).click();
    await fixture.page.waitForURL("**/account");
    const cookies = await fixture.context.cookies();
    fixture.client = createServerClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { cookies: { getAll: () => cookies, setAll() {} } });
  }
  const [owner, other, unconfirmed] = fixtures;
  const guest = await browser.newContext();
  const page = await guest.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${origin}/listings/new`);
  await page.waitForURL("**/login?form=signup&next=%2Flistings%2Fnew");
  const command = { operationId: randomUUID(), listingId: randomUUID(), version: 0, listing };
  assert.equal((await guest.request.get(`${origin}/api/identity/listings`)).status(), 401);
  await post(unconfirmed, command, 401);
  await post(owner, command, 403, { Origin: "https://unrelated.invalid" });
  await post(owner, command, 403, { "X-Beetip-Member": other.id });
  await post(owner, { ...command, ownerId: other.id }, 400);
  await post(owner, { ...command, listing: { ...listing, fee: 0.5 } }, 400);
  checks.push("guest/unconfirmed denial, CSRF, changed-account guard, actor spoofing and fractional IDR validation");

  await owner.page.goto(`${origin}/listings/new`);
  await owner.page.getByLabel("Judul", { exact: true }).fill(title);
  await owner.page.getByLabel("Tempat belanja", { exact: true }).fill(listing.shop);
  await owner.page.getByLabel("Alamat tepat (privat)", { exact: true }).fill(listing.destination);
  await owner.page.getByLabel("Nama barang 1", { exact: true }).fill("Nasi");
  await owner.page.getByRole("button", { name: "Terbitkan listing" }).click();
  await expect(owner.page.getByRole("heading", { name: "Listing tersimpan" })).toBeVisible();
  const publicRows = await board(guest, { search: title });
  assert.equal(publicRows.listings.length, 1);
  const id = publicRows.listings[0].id;
  const ownRow = (await own(owner, id)).listings[0];
  assert.equal(ownRow.destination, listing.destination);
  assert.deepEqual((await own(other, id)).listings, []);
  assert(!JSON.stringify(publicRows).includes(listing.destination));
  assert(!JSON.stringify(publicRows).includes(owner.id));
  const { data: rawOther, error: rawOtherError } = await other.client.from("listings").select("*").eq("id", id);
  assert.ifError(rawOtherError); assert.deepEqual(rawOther, []);
  const anon = createClient(settings.NEXT_PUBLIC_SUPABASE_URL, settings.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  assert((await anon.from("listings").select("*")).error);
  assert((await other.client.from("listings").update({ owner_id: other.id }).eq("id", id)).error);
  checks.push("real request creation UI, persisted structured items, private destination, owner-only RLS and no direct writes");

  const duplicates = await Promise.all([post(owner, command), post(owner, command)]);
  assert.equal(duplicates[0].listingId, duplicates[1].listingId);
  await post(owner, { ...command, listing: { ...listing, fee: 6000, bound: 6000 } }, 409);
  await post(other, { operationId: randomUUID(), listingId: id, version: 1, listing }, 403);
  const edit = { operationId: randomUUID(), listingId: command.listingId, version: 1, listing: { ...listing, title: title + " revised" } };
  const competing = [edit, { ...edit, operationId: randomUUID() }];
  const race = await Promise.all(competing.map(body => owner.context.request.post(`${origin}/api/identity/listings`, { headers: { Origin: origin, "X-Beetip-Member": owner.id }, data: body })));
  assert.deepEqual(race.map(response => response.status()).sort(), [200, 409]);
  await post(owner, competing[race.findIndex(response => response.status() === 200)]);
  assert.equal((await own(owner, command.listingId)).listings[0].version, 2);
  const invalidSQL = await owner.client.rpc("save_listing", { p_operation_id: randomUUID(), p_listing_id: randomUUID(), p_version: 0, p_listing: { ...listing, items: [{ ...listing.items[0], quantity: 50 }] } });
  assert(invalidSQL.error?.message.startsWith("VALIDATION:"));
  checks.push("concurrent exact retry, changed-payload conflict, unrelated owner denial, stale-version conflict and SQL budget validation");

  await owner.page.goto(`${origin}/listings/new?edit=${id}`);
  await expect(owner.page.getByLabel("Judul", { exact: true })).toHaveValue(title);
  await owner.page.getByLabel("Jenis listing").selectOption("trip");
  await owner.page.getByLabel("Kapasitas pelanggan", { exact: true }).fill("3");
  await owner.page.getByLabel("Bisa nego", { exact: true }).check();
  await owner.page.getByLabel("Ongkos minimal (Rp)", { exact: true }).fill("4000");
  await owner.page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(owner.page.getByRole("heading", { name: "Listing tersimpan" })).toBeVisible();
  const trip = (await own(owner, id)).listings[0];
  assert.equal(trip.type, "trip"); assert.equal(trip.capacity, 3); assert.equal(trip.bound, 4000);
  await page.goto(`${origin}/listings/${id}`);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText(listing.destination, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Ongkos jasa", { exact: false })).toContainText("Bisa nego");
  checks.push("owner edit UI, offered-jastip capacity and negotiable fee, public detail without private address");

  const batch = [];
  for (let i = 0; i < 24; i++) batch.push({ id: randomUUID(), owner_id: owner.id, type: i % 2 ? "trip" : "request", title: title + ` page ${i}`, shop: listing.shop, category: listing.category, area: listing.area, destination: listing.destination, items: listing.items, budget: 40000, fee: 5000, bound: 5000, negotiable: false, capacity: 1, spending_capacity: 150000, start_at: listing.start, end_at: listing.end, cutoff_at: listing.cutoff, status: "active", created_at: "2026-11-18T00:00:00Z" });
  assert.ifError((await admin.from("listings").insert(batch)).error);
  const first = await board(guest, { search: title });
  assert.equal(first.listings.length, 20); assert(first.next);
  const second = await board(guest, { search: title, ...first.next });
  assert.equal(new Set([...first.listings, ...second.listings].map(row => row.id)).size, 26);
  assert.equal(second.next, null);
  assert((await board(guest, { search: title, type: "trip" })).listings.every(row => row.type === "trip"));
  assert.equal((await board(guest, { search: title, category: "Minuman" })).listings.length, 0);
  assert.equal((await board(guest, { search: title, date: "2026-11-01" })).listings.length, 0);
  const day = new Date(listing.start).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
  assert.equal((await board(guest, { search: title, date: day })).listings.length, 20);
  assert.ifError((await admin.from("listings").update({ status: "paused" }).eq("id", batch[0].id)).error);
  assert.ifError((await admin.from("listings").update({ cutoff_at: new Date(Date.now() - 60000).toISOString() }).eq("id", batch[1].id)).error);
  assert.equal((await board(guest, { id: batch[0].id })).listings.length, 0);
  assert.equal((await board(guest, { id: batch[1].id })).listings.length, 0);
  checks.push("keyset pagination with 24 tied timestamps, no duplicate/missing IDs, kind/category/WIB-date filters, paused and cutoff exclusion");

  assert.ifError((await admin.from("members").update({ status: "suspended" }).eq("id", owner.id)).error);
  assert.equal((await board(guest, { search: title })).listings.length, 0);
  await post(owner, { ...command, operationId: randomUUID(), listingId: randomUUID() }, 403);
  assert.equal((await owner.context.request.get(`${origin}/api/identity/listings`)).status(), 403);
  assert.ifError((await admin.from("members").update({ status: "approved" }).eq("id", owner.id)).error);
  checks.push("same-session suspension denies commands/private reads and removes public owner listings");

  await page.route("**/api/listings?*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, message: "Penyimpanan sementara tidak tersedia." }) }));
  await page.goto(origin);
  await expect(page.getByRole("alert").filter({ hasText: "Penyimpanan sementara tidak tersedia." })).toBeVisible();
  await page.unroute("**/api/listings?*");
  await page.getByRole("button", { name: "Coba lagi" }).click();
  await expect(page.getByRole("link", { name: "Lihat detail", exact: true })).toHaveCount(20);
  checks.push("provider outage displays retry and recovers through the live board API");

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await page.getByLabel("Cari listing", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Terapkan filter" }).click();
    await expect(page.getByRole("link", { name: "Lihat detail", exact: true })).toHaveCount(20);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Board overflow at ${width}`);
    await page.goto(`${origin}/listings/${id}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Detail overflow at ${width}`);
  }
  await owner.page.goto(`${origin}/listings/new?edit=${id}`);
  await expect(owner.page.getByLabel("Alamat tepat (privat)")).toHaveValue(listing.destination);
  assert(await owner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Form mobile overflow");
  mkdirSync("test-results/btp04", { recursive: true });
  await owner.page.screenshot({ path: "test-results/btp04/edit-mobile.png", fullPage: true });
  const logout = await owner.context.newPage();
  await logout.goto(`${origin}/account`);
  await logout.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(owner.page.getByRole("heading", { name: "Sesi akun berubah" })).toBeVisible();
  await expect(owner.page.getByLabel("Alamat tepat (privat)")).toHaveCount(0);
  assert.deepEqual(errors, []);
  checks.push("390/768/1440 board/detail, mobile form, cross-tab logout clears private edit UI, no public client errors");
  console.log(JSON.stringify({ result: "PASS", checks, setup: "Temporary confirmed test identities only; no email or payment acceptance claim" }));
} finally {
  await browser?.close();
  for (const fixture of fixtures) {
    assert.ifError((await admin.from("listings").delete().eq("owner_id", fixture.id)).error);
    assert.ifError((await admin.auth.admin.deleteUser(fixture.id)).error);
  }
  console.log("Temporary BTP04 listings and users removed; private audit/receipt facts retained.");
}
