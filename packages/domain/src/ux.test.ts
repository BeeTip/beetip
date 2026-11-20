import { describe, expect, it } from "vitest";
import { createSeed, DemoService, itemBudget, itemSummary, migrateState, type Command } from "./index";

const now = 1000000;
function setup() {
  const state = createSeed(now); let n = 0;
  const service = (actor: string) => new DemoService(state, actor, () => now);
  const run = (actor: string, c: Command, id = `ux-${++n}`) => service(actor).execute(c, id);
  return { state, service, run };
}
describe("UX workflow contracts", () => {
  it("takes a fixed request once, preserves private instructions, and retries safely", () => {
    const h = setup(); const c = { type: "takeRequest" as const, listingId: "request-fixed" };
    expect(h.service("provider").queryListings().find(l => l.id === c.listingId)?.destination).toBeUndefined();
    expect(h.run("customer", c).ok).toBe(false); expect(h.run("unverified", c).ok).toBe(false);
    const result = h.run("provider", c, "take-1"); expect(result.ok).toBe(true);
    expect(h.run("provider", c, "take-1")).toEqual(result);
    expect(h.run("customer2", c).ok).toBe(false);
    expect(h.state.orders.filter(o => o.listingId === c.listingId)).toHaveLength(1);
    expect(h.state.orders.at(-1)?.terms.destination).toBe("Lobby kampus, meja resepsionis");
    expect(h.run("provider", { type: "takeRequest", listingId: "request-coffee" }).ok).toBe(false);
  });
  it("moderation blocks offers and acceptance but leaves existing fulfillment usable", () => {
    const h = setup(); const l = h.state.listings.find(l => l.id === "trip-kfc")!;
    const offer = { type: "offer" as const, listingId: l.id, fee: l.fee, budget: 20000, item: "Ayam", quantity: 1, destination: "Lobby", window: l.window };
    const r = h.run("customer", offer); if (!r.ok) throw new Error(r.message);
    expect(h.run("customer", { type: "moderateListing", listingId: l.id, status: "paused", reason: "Review" }).ok).toBe(false);
    expect(h.run("admin1", { type: "moderateListing", listingId: l.id, status: "paused", reason: "Review" }).ok).toBe(true);
    expect(h.run("customer3", offer).ok).toBe(false);
    expect(h.run("customer2", { type: "accept", offerId: r.value }).ok).toBe(false);
    expect(h.run("provider", { type: "startPurchase", orderId: "BTP-002" }).ok).toBe(true);
    expect(h.run("admin1", { type: "moderateListing", listingId: l.id, status: "active", reason: "Reviewed" }).ok).toBe(true);
    expect(h.run("customer2", { type: "accept", offerId: r.value }).ok).toBe(true);
  });
  it("requires valid scheduling to reopen legacy expired listings and preserves terms", () => {
    const h = setup(); const l = h.state.listings[1]; l.cutoff = now - 1; delete l.schedule;
    const terms = structuredClone(h.state.orders[0].terms);
    expect(h.run("admin1", { type: "moderateListing", listingId: l.id, status: "active", reason: "Reopen" }).ok).toBe(false);
    expect(h.run("admin1", { type: "moderateListing", listingId: l.id, status: "active", reason: "Reopen", cutoff: now + 1000, schedule: { start: now + 2000, end: now + 3000 } }).ok).toBe(true);
    expect(h.state.orders[0].terms).toEqual(terms);
  });
  it("requires renewed consent when an administrator reschedules an unaccepted offer", () => {
    const h = setup(); const l = h.state.listings[1];
    const offer = { type: "offer" as const, listingId: l.id, item: "Ayam", quantity: 1, budget: 20000, fee: l.fee, destination: "Lobby", window: l.window };
    const result = h.run("customer", offer); if (!result.ok) throw new Error(result.message);
    expect(h.run("admin1", { type: "moderateListing", listingId: l.id, status: "active", reason: "Jadwal berubah", cutoff: now + 1000, schedule: { start: now + 2000, end: now + 3000 } }).ok).toBe(true);
    expect(h.run("customer2", { type: "accept", offerId: result.value })).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(h.run("customer", { ...offer, window: l.window }).ok).toBe(true);
    expect(h.run("customer2", { type: "accept", offerId: result.value }).ok).toBe(true);
  });
  it("validates item totals and stores an immutable item snapshot", () => {
    const h = setup(); const items = [{ name: "Kopi", specification: "Tanpa gula", quantity: 2, unitBudget: 20000 }, { name: "Roti", specification: "", quantity: 1, unitBudget: 10000 }];
    const listing = { ...h.state.listings.find(l => l.id === "request-fixed")!, items, item: itemSummary(items), quantity: 3, budget: itemBudget(items) };
    expect(h.run("customer", { type: "createListing", listing: { ...listing, budget: 1 } }).ok).toBe(false);
    const created = h.run("customer", { type: "createListing", listing }); if (!created.ok) throw new Error(created.message);
    expect(h.run("provider", { type: "takeRequest", listingId: created.value }).ok).toBe(true);
    h.state.listings.at(-1)!.items![0].name = "Changed";
    expect(h.state.orders.at(-1)?.terms.items?.[0].name).toBe("Kopi");
    const order = structuredClone(h.state.orders.at(-1));
    expect(h.run("provider", { type: "cancelListing", listingId: created.value })).toMatchObject({ ok: false, code: "PERMISSION" });
    expect(h.run("customer", { type: "cancelListing", listingId: created.value }).ok).toBe(true);
    expect(h.run("customer2", { type: "takeRequest", listingId: created.value }).ok).toBe(false);
    expect(h.state.orders.at(-1)).toEqual(order);
  });
  it("support permits unverified help, denies unrelated members, and audits replies", () => {
    const h = setup(); const opened = h.run("unverified", { type: "supportOpen", text: "Bagaimana verifikasi?" }, "support-1"); if (!opened.ok) throw new Error(opened.message);
    expect(h.run("unverified", { type: "supportOpen", text: "Bagaimana verifikasi?" }, "support-1")).toEqual(opened);
    expect(h.service("customer").querySupport()).toEqual([]);
    expect(h.run("customer", { type: "supportReply", threadId: opened.value, text: "Intruder" }).ok).toBe(false);
    expect(h.run("admin1", { type: "supportReply", threadId: opened.value, text: "Hubungi petugas kampus." }).ok).toBe(true);
    expect(h.service("unverified").querySupport()[0].messages).toHaveLength(2);
    expect(h.run("unverified", { type: "supportStatus", threadId: opened.value, status: "resolved" }).ok).toBe(false);
    expect(h.run("admin1", { type: "supportStatus", threadId: opened.value, status: "resolved" }).ok).toBe(true);
    expect(h.run("unverified", { type: "supportReply", threadId: opened.value, text: "More" }).ok).toBe(false);
    expect(h.run("customer2", { type: "supportOpen", orderId: "BTP-001", text: "Private" }).ok).toBe(false);
  });
  it("migration preserves legacy financial records and delivery text", () => {
    const legacy = createSeed(now); legacy.version = 1; delete legacy.support; delete legacy.listings[0].schedule;
    const migrated = migrateState(legacy); expect(migrated.version).toBe(2); expect(migrated.orders).toEqual(legacy.orders); expect(migrated.listings).toEqual(legacy.listings);
  });
});
