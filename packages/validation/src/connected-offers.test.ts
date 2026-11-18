import { describe, expect, it } from "vitest";
import { offerCommandSchema, offerQuerySchema } from "./connected-offers";
import { accountRedirect } from "./identity";

const command = { operationId: "00000000-0000-4000-8000-000000000001", offerId: "00000000-0000-4000-8000-000000000002", listingId: "00000000-0000-4000-8000-000000000003", version: 0, listingVersion: 1, fee: 5000, action: "save" };
describe("connected offer boundary", () => {
  it("accepts creation, revision and withdrawal with explicit versions", () => {
    expect(offerCommandSchema.safeParse(command).success).toBe(true);
    expect(offerCommandSchema.safeParse({ ...command, version: 2, action: "withdraw" }).success).toBe(true);
  });
  it("rejects spoofed actors, fractional or out of range fees and missing consent revisions", () => {
    for (const change of [{ authorId: command.offerId }, { fee: 0.5 }, { fee: -1 }, { fee: 150001 }, { listingVersion: 0 }, { action: "withdraw" }, { version: -1 }]) {
      expect(offerCommandSchema.safeParse({ ...command, ...change }).success).toBe(false);
    }
  });
  it("requires complete pagination cursors and bounded UUID filters", () => {
    expect(offerQuerySchema.safeParse({}).success).toBe(true);
    expect(offerQuerySchema.safeParse({ listingId: command.listingId }).success).toBe(true);
    expect(offerQuerySchema.safeParse({ before: new Date().toISOString() }).success).toBe(false);
    expect(offerQuerySchema.safeParse({ listingId: "invalid" }).success).toBe(false);
  });
  it("preserves offer destinations after login without allowing external or injected URLs", () => {
    const destination = `/account/offers?listing=${command.listingId}`;
    expect(accountRedirect(destination)).toBe(destination);
    expect(accountRedirect("/account/offers")).toBe("/account/offers");
    expect(accountRedirect(destination + "&next=https://unrelated.invalid")).toBe("/account");
    expect(accountRedirect("//unrelated.invalid")).toBe("/account");
  });
});
