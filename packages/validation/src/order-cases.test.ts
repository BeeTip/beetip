import { describe, expect, it } from "vitest";
import { orderCaseCommandSchema } from "./order-cases";

const orderId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";
const proof = { kind: "dispute", reason: "Barang tidak sesuai", imageHash: "a".repeat(64) };

describe("order case dispute input", () => {
  it("accepts a demo dispute with proof and no amount", () => {
    const request = { action: "open", orderId, operationId, payload: proof };
    expect(orderCaseCommandSchema.parse(request)).toEqual(request);
  });

  it("accepts legacy amount disputes and rejects partial amount details", () => {
    expect(orderCaseCommandSchema.safeParse({
      action: "open", orderId, operationId, payload: { ...proof, component: "purchase", itemIndex: 0, amount: 500 },
    }).success).toBe(true);
    expect(orderCaseCommandSchema.safeParse({
      action: "open", orderId, operationId, payload: { ...proof, amount: 500 },
    }).success).toBe(false);
  });
});
