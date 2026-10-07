import { describe, expect, it } from "vitest";
import { createSeed } from "../../domain/src/index";
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
});
