import { describe, expect, it } from "vitest";
import { createSeed, totals } from "../../domain/src/index";
import { demoStorageSchema, listingSchema } from "./index";

describe("persisted demo validation", () => {
  it("accepts fixtures and rejects malformed nested records and unknown personas", () => {
    const state = createSeed();
    expect(demoStorageSchema.safeParse({ state, actorId: "customer" }).success).toBe(true);
    expect(demoStorageSchema.safeParse({ state, actorId: "unknown" }).success).toBe(false);
    expect(demoStorageSchema.safeParse({ state: { ...state, orders: [{ ...state.orders[0], funding: [{ amount: "bad" }] }] }, actorId: "customer" }).success).toBe(false);
    expect(demoStorageSchema.safeParse({ state: { ...state, version: 3 }, actorId: "customer" }).success).toBe(false);
  });
  it("rejects contradictory fee bounds and noninteger money", () => {
    const listing = createSeed().listings[0];
    expect(listingSchema.safeParse(listing).success).toBe(true);
    expect(listingSchema.safeParse({ ...listing, bound: listing.fee + 1 }).success).toBe(false);
    expect(listingSchema.safeParse({ ...listing, fee: 10000.5 }).success).toBe(false);
  });
  it("restores cancellation proposals and approved amounts after reload", () => {
    const state = createSeed();
    const amounts = { purchase: 52000, fee: 3000, refund: 15000 };
    const cancellationProposal = { ...amounts, id: "proposal", proposedBy: "admin1", reason: "Struk diperiksa" };
    const cancellationAllocation = { ...amounts, reviewedBy: "admin2", reason: "Alokasi disetujui" };
    const load = (order: (typeof state.orders)[number]) => demoStorageSchema.parse(JSON.parse(JSON.stringify({
      actorId: "customer", state: { ...state, orders: [order] },
    }))).state.orders[0];

    expect(load({ ...state.orders[0], cancellationRequested: "Pesanan perlu dibatalkan", cancellationProposal }))
      .toMatchObject({ cancellationProposal });
    const restored = load({ ...state.orders[0], state: "cancelled", cancellationProposal, cancellationAllocation });
    expect(restored).toMatchObject({ cancellationAllocation });
    expect(totals(restored)).toMatchObject({ entitlement: 55000, refundDue: 15000 });
  });
});
