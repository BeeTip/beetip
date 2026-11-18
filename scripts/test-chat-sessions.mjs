import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, expect } from "@playwright/test";

const project = process.env.BEETIP_TEST_PROJECT_REF;
assert.equal(project, "rgiptdfjlmwldngapojq", "Dedicated development project only");
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3108";
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Local candidate only");
const settings = Object.fromEntries(readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8").split(/\r?\n/).filter(line => line.includes("=")).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
assert.equal(settings.NEXT_PUBLIC_SUPABASE_URL, `https://${project}.supabase.co`);
const keys = JSON.parse(execFileSync("rtk", ["proxy", "supabase", "projects", "api-keys", "--project-ref", project, "--reveal", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const key = keys.find(row => row.type === "secret" && !row.disabled) ?? keys.find(row => row.name === "service_role" && !row.disabled);
assert(key?.api_key);
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
const admin = createClient(settings.NEXT_PUBLIC_SUPABASE_URL, key.api_key, { auth: { persistSession: false, autoRefreshToken: false } });
const fixtures = [];
const listingIds = [];
const checks = [];
let browser;
async function command(fixture, path, input, status = 200, headers = {}) {
  const response = await fixture.context.request.post(`${origin}/api/identity/${path}`, { headers: { Origin: origin, "X-Beetip-Member": fixture.id, ...headers }, data: input });
  assert.equal(response.status(), status, await response.text());
  assert.match(response.headers()["cache-control"], /private, no-store/);
  return response.json();
}
async function history(fixture, order, status = 200) {
  const response = await fixture.context.request.get(`${origin}/api/identity/chat?order=${order}`);
  assert.equal(response.status(), status, await response.text());
  assert.match(response.headers()["cache-control"], /private, no-store/);
  return response.json();
}
function sql(query) {
  mkdirSync("test-results/btp08", { recursive: true });
  writeFileSync("test-results/btp08/fixtures.sql", query);
  return JSON.parse(execFileSync("rtk", ["proxy", "supabase", "db", "query", "--linked", "--project-ref", project, "--file", "test-results/btp08/fixtures.sql", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}
try {
  browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
  const password = randomBytes(24).toString("base64url");
  for (let index = 0; index < 3; index++) {
    const email = `btp08-${randomUUID()}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Penguji chat ${index + 1}` } });
    assert.ifError(error);
    const fixture = { id: data.user.id }; fixtures.push(fixture);
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
  const [customer, provider, stranger] = fixtures;
  const { data: { session } } = await provider.client.auth.getSession();
  assert(session?.access_token);
  await provider.client.realtime.setAuth(session.access_token);
  const hints = [];
  const channel = provider.client.channel(`member:${provider.id}`, { config: { private: true } }).on("broadcast", { event: "refresh" }, event => hints.push(event.payload));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Authorized private subscription timed out")), 15000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); reject(new Error(`Private subscription ${status}: ${error?.message ?? "no diagnostic"}`)); }
    });
  });
  const strangerSession = (await stranger.client.auth.getSession()).data.session;
  assert(strangerSession?.access_token);
  await stranger.client.realtime.setAuth(strangerSession.access_token);
  const forbidden = stranger.client.channel(`member:${provider.id}`, { config: { private: true } });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Unrelated private-topic denial timed out")), 15000);
    forbidden.subscribe(status => {
      if (status === "SUBSCRIBED") { clearTimeout(timeout); reject(new Error("Unrelated member joined private topic")); }
      else if (status === "CHANNEL_ERROR") { clearTimeout(timeout); resolve(); }
    });
  });
  await stranger.client.removeChannel(forbidden);
  const listing = randomUUID(); listingIds.push(listing);
  const listingBody = {
    type: "request", title: "BTP08 synthetic chat", shop: "Warung", category: "Makanan", area: "Alam Sutera", destination: "PRIVATE BTP08 ADDRESS",
    items: [{ name: "Nasi", specification: "", quantity: 1, unitBudget: 20000 }], fee: 5000, bound: 5000, negotiable: false,
    capacity: 1, spendingCapacity: 150000, start: new Date(Date.now() + 86400000).toISOString(), end: new Date(Date.now() + 90000000).toISOString(), cutoff: new Date(Date.now() + 82800000).toISOString(), status: "active",
  };
  await command(customer, "listings", { operationId: randomUUID(), listingId: listing, version: 0, listing: listingBody });
  const { orderId: order } = await command(provider, "orders", { operationId: randomUUID(), listingId: listing, listingVersion: 1 });
  const send = { action: "send", order, clientId: randomUUID(), body: "Halo, tanpa sambal ya." };
  const guest = await browser.newContext();
  assert.equal((await guest.request.get(`${origin}/api/identity/chat?order=${order}`)).status(), 401);
  await history(stranger, order, 403);
  await command(stranger, "chat", send, 403);
  await command(customer, "chat", send, 403, { Origin: "https://unrelated.invalid" });
  await command(customer, "chat", send, 403, { "X-Beetip-Member": provider.id });
  await command(customer, "chat", { ...send, senderId: provider.id }, 400);
  const duplicate = await Promise.all([command(customer, "chat", send), command(customer, "chat", send)]);
  assert.equal(duplicate[0].message.id, duplicate[1].message.id);
  await expect.poll(() => hints.length, { timeout: 10000 }).toBeGreaterThan(0);
  assert(hints.every(payload => Object.keys(payload).join() === "id" && /^[0-9a-f-]{36}$/.test(payload.id)), "Hints contain only the server-generated transport UUID");
  await command(customer, "chat", { ...send, body: "Changed" }, 409);
  const initial = (await history(provider, order)).page;
  assert.equal(initial.messages.length, 1); assert.equal(initial.unread, 1);
  await Promise.all([command(provider, "chat", { action: "read", order, sequence: 1 }), command(provider, "chat", { action: "read", order, sequence: 0 })]);
  assert.equal((await history(provider, order)).page.readSequence, 1);
  assert.equal((await stranger.client.from("messages").select("*")).data.length, 0);
  assert((await customer.client.from("conversation_reads").select("*")).error);
  checks.push("real Auth, participant-only history/send, raw-table denial, CSRF/actor guards, concurrent exact retry, changed-body conflict, monotonic reads and live content-free private broadcast");

  await Promise.all([customer.page.goto(`${origin}/chat/${order}`), provider.page.goto(`${origin}/chat/${order}`)]);
  const stored = page => page.getByRole("list", { name: "Pesan tersimpan" });
  await expect(stored(provider.page)).toContainText(send.body);
  await expect(customer.page.getByRole("button", { name: "Kirim pesan", exact: true })).toBeDisabled();
  const received = provider.page.waitForResponse(response => response.url().includes("/api/identity/chat?order=") && response.request().method() === "GET", { timeout: 12000 });
  await customer.page.getByLabel("Pesan", { exact: true }).fill("Pesan melalui koneksi langsung");
  await expect(customer.page.getByRole("button", { name: "Kirim pesan", exact: true })).toBeEnabled();
  await customer.page.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  await received;
  await expect(stored(provider.page)).toContainText("Pesan melalui koneksi langsung", { timeout: 12000 });
  checks.push("two actual browser contexts receive a committed message before the 30-second fallback poll");

  let loseResponse = true;
  const attempts = [];
  await customer.page.route("**/api/identity/chat", async route => {
    const input = route.request().postDataJSON();
    if (input?.action !== "send") return route.continue();
    attempts.push(input);
    if (loseResponse) { loseResponse = false; const response = await route.fetch(); assert.equal(response.status(), 200); return route.abort("failed"); }
    return route.continue();
  });
  await customer.page.getByLabel("Pesan", { exact: true }).fill("Respons hilang, pesan tetap satu");
  await customer.page.getByRole("button", { name: "Kirim pesan", exact: true }).click();
  const retry = customer.page.getByRole("button", { name: "Coba kirim pesan ini lagi", exact: true });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(retry).toHaveCount(0);
  assert.deepEqual(attempts[0], attempts[1]);
  assert.equal((await history(provider, order)).page.messages.filter(row => row.body === attempts[0].body).length, 1);
  checks.push("rendered failed attempt retries the original body/client ID after a lost committed response without duplicating the message");

  await provider.context.setOffline(true);
  await command(customer, "chat", { action: "send", order, clientId: randomUUID(), body: "Pesan saat penerima terputus" });
  await provider.context.setOffline(false);
  await expect(stored(provider.page)).toContainText("Pesan saat penerima terputus", { timeout: 15000 });
  for (const width of [390, 768, 1440]) {
    await provider.page.setViewportSize({ width, height: 900 });
    assert(await provider.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
  }
  await provider.page.setViewportSize({ width: 390, height: 844 });
  mkdirSync("test-results/btp08", { recursive: true });
  await provider.page.screenshot({ path: "test-results/btp08/chat-mobile.png", fullPage: true });
  checks.push("offline recipient catches up on reconnect; rendered chat fits 390/768/1440 widths");

  sql(`update public.reservations set expires_at=clock_timestamp()-interval '1 second' where order_id='${order}'::uuid;`);
  await provider.page.reload();
  await expect(provider.page.getByText("Percakapan ditutup. Riwayat tetap dapat dibaca.", { exact: true })).toBeVisible();
  await expect(stored(provider.page)).toContainText(send.body);
  await expect(provider.page.getByRole("button", { name: "Kirim pesan", exact: true })).toHaveCount(0);
  await command(customer, "chat", { action: "send", order, clientId: randomUUID(), body: "Too late" }, 409);
  sql(`update public.conversation_members set revoked_at=clock_timestamp() where conversation_id=(select conversation_id from public.orders where id='${order}'::uuid) and member_id='${provider.id}'::uuid;`);
  await history(provider, order, 403);
  assert.equal((await provider.client.from("messages").select("*").eq("conversation_id", (await customer.client.from("orders").select("conversation_id").eq("id", order).single()).data.conversation_id)).data.length, 0);
  await provider.page.reload();
  await expect(provider.page.getByRole("heading", { name: "Percakapan tidak tersedia", exact: true })).toBeVisible();
  sql(`update public.conversation_members set revoked_at=null where conversation_id=(select conversation_id from public.orders where id='${order}'::uuid) and member_id='${provider.id}'::uuid;`);
  await provider.page.reload();
  await expect(stored(provider.page)).toContainText(send.body);
  const logout = await provider.context.newPage();
  await logout.goto(`${origin}/account`); await logout.getByRole("button", { name: "Keluar", exact: true }).click();
  await expect(stored(provider.page)).toHaveCount(0);
  checks.push("server deadline closes sends and keeps history; live participant revocation denies history/raw reads and clears rendered content; cross-tab logout clears private chat");

  const cronListing = randomUUID(); listingIds.push(cronListing);
  await command(customer, "listings", { operationId: randomUUID(), listingId: cronListing, version: 0, listing: listingBody });
  const { orderId: cronOrder } = await command(stranger, "orders", { operationId: randomUUID(), listingId: cronListing, listingVersion: 1 });
  await Promise.all(fixtures.flatMap(fixture => fixture.context.pages()).map(page => page.close()));
  sql(`update public.reservations set expires_at=clock_timestamp()-interval '1 second' where order_id='${cronOrder}'::uuid;`);
  await expect.poll(() => sql(`select o.state,r.released_at from public.orders o join public.reservations r on r.order_id=o.id where o.id='${cronOrder}'::uuid;`).rows[0]?.state, { timeout: 90000, intervals: [5000] }).toBe("expired");
  const expired = await stranger.context.request.get(`${origin}/api/identity/orders?id=${cronOrder}`);
  assert.equal(expired.status(), 200);
  assert.equal((await expired.json()).order.state, "expired");
  assert((await history(customer, cronOrder)).page.closed);
  checks.push("actual hosted Cron expires a disposable order with every participant tab closed; separate participant projections remain correct");
  console.log(JSON.stringify({ result: "PASS", checks, boundary: "Dedicated development synthetic messages; no email, physical devices, settlement or production release" }));
} finally {
  await browser?.close();
  await Promise.all(fixtures.map(fixture => fixture.client?.removeAllChannels()));
  if (listingIds.length) {
    assert(listingIds.every(id => /^[0-9a-f-]{36}$/.test(id)));
    const ids = listingIds.map(id => `'${id}'::uuid`).join(",");
    sql(`begin;
      create temporary table btp08_orders as select id,conversation_id from public.orders where listing_id in (${ids});
      delete from public.notifications where target_id in (select id from btp08_orders) or target_id in (${ids});
      delete from private.acceptance_notification_intents where order_id in (select id from btp08_orders);
      alter table public.order_terms disable trigger order_terms_immutable;
      delete from public.order_terms where order_id in (select id from btp08_orders);
      alter table public.order_terms enable trigger order_terms_immutable;
      delete from public.reservations where order_id in (select id from btp08_orders);
      delete from public.messages where conversation_id in (select conversation_id from btp08_orders);
      delete from public.orders where id in (select id from btp08_orders);
      delete from public.conversations where id in (select conversation_id from btp08_orders);
      delete from public.listings where id in (${ids});
      ${fixtures.map(fixture => `delete from private.btp08_send_locks where member_id='${fixture.id}'::uuid;`).join("\n")}
      commit;`);
  }
  for (const fixture of fixtures) assert.ifError((await admin.auth.admin.deleteUser(fixture.id)).error);
  console.log("Temporary BTP08 fixtures removed; retained support, operators and audit facts preserved.");
}
