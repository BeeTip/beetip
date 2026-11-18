import { describe, expect, it } from "vitest";
import { boardQuerySchema, connectedListingSchema, listingCommandSchema, wibInput, wibTimestamp } from "./connected-listings";

const listing = { type: "request", title: "Titip makan siang", shop: "Warung dekat kampus", category: "Makanan", area: "Alam Sutera", destination: "Alamat privat", items: [{ name: "Nasi", specification: "Tanpa pedas", quantity: 2, unitBudget: 20000 }], fee: 5000, bound: 5000, negotiable: false, capacity: 1, spendingCapacity: 150000, start: "2026-12-01T12:00:00+07:00", end: "2026-12-01T13:00:00+07:00", cutoff: "2026-12-01T11:00:00+07:00", status: "active" };

describe("connected listings", () => {
  it("accepts both directions and validates IDR totals and capacity", () => {
    expect(connectedListingSchema.safeParse(listing).success).toBe(true);
    expect(connectedListingSchema.safeParse({ ...listing, type: "trip", capacity: 3 }).success).toBe(true);
    for (const change of [{ fee: 0.5 }, { capacity: 2 }, { items: [{ ...listing.items[0], quantity: 8 }] }, { spendingCapacity: 20000 }]) expect(connectedListingSchema.safeParse({ ...listing, ...change }).success).toBe(false);
  });
  it("binds negotiation direction and schedule ordering", () => {
    for (const change of [{ bound: 6000 }, { negotiable: true, bound: 4000 }, { type: "trip", negotiable: true, bound: 6000 }, { cutoff: listing.end }, { end: listing.start }, { start: "2026-12-01T12:00" }]) expect(connectedListingSchema.safeParse({ ...listing, ...change }).success).toBe(false);
  });
  it("rejects actor spoofing and incomplete pagination cursors", () => {
    expect(listingCommandSchema.safeParse({ operationId: crypto.randomUUID(), listingId: crypto.randomUUID(), version: 0, listing, ownerId: crypto.randomUUID() }).success).toBe(false);
    expect(boardQuerySchema.safeParse({ before: listing.start }).success).toBe(false);
    expect(boardQuerySchema.safeParse({ date: "bad" }).success).toBe(false);
    expect(boardQuerySchema.safeParse({ date: "2026-02-31" }).success).toBe(false);
    expect(boardQuerySchema.safeParse({ search: "a".repeat(101) }).success).toBe(false);
  });
  it("uses WIB independent of the host timezone", () => {
    expect(wibTimestamp("2026-12-01T12:00")).toBe("2026-12-01T05:00:00.000Z");
    expect(wibInput("2026-12-01T05:00:00.000Z")).toBe("2026-12-01T12:00");
  });
});
