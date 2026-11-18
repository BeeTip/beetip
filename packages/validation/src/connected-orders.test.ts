import { describe, expect, it } from "vitest";
import { acceptanceCommandSchema, orderQuerySchema, ordersPageSchema } from "./connected-orders";

const id = "00000000-0000-4000-8000-000000000001";
const fixed = { operationId: id, listingId: id, listingVersion: 1 };
describe("acceptance boundary", () => {
  it("accepts fixed commands and revision-bound offers", () => {
    expect(acceptanceCommandSchema.safeParse(fixed).success).toBe(true);
    expect(acceptanceCommandSchema.safeParse({ ...fixed, offerId: id, offerVersion: 2 }).success).toBe(true);
  });
  it("rejects spoofed actors, incomplete offer references and invalid revisions", () => {
    for (const extra of [{ actorId: id }, { offerId: id }, { offerVersion: 1 }, { listingVersion: 0 }, { offerId: id, offerVersion: 1.5 }]) {
      expect(acceptanceCommandSchema.safeParse({ ...fixed, ...extra }).success).toBe(false);
    }
    expect(orderQuerySchema.safeParse({ id: "other" }).success).toBe(false);
    expect(ordersPageSchema.safeParse({ beforeId: id }).success).toBe(false);
  });
});
