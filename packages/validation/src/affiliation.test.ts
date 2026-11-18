import { describe, expect, it } from "vitest";
import { affiliationInputSchema, evidenceType, mfaInputSchema, staffInputSchema } from "./affiliation";

const operationId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
describe("optional affiliation boundaries", () => {
  it("accepts separate bounded requests and fixed review reasons", () => {
    expect(affiliationInputSchema.parse({ operationId, requestId, action: "begin", value: "  Kampus  " }).value).toBe("Kampus");
    expect(affiliationInputSchema.safeParse({ operationId, requestId, action: "approve", value: "matched" }).success).toBe(true);
    expect(affiliationInputSchema.safeParse({ operationId, requestId, action: "reject", value: "private student number" }).success).toBe(false);
    expect(affiliationInputSchema.safeParse({ operationId, requestId, action: "submit", value: "", memberId: requestId }).success).toBe(false);
    expect(affiliationInputSchema.safeParse({ operationId, requestId, action: "begin", value: "x".repeat(101) }).success).toBe(false);
  });
  it("rejects invented grants, role spoofing, and malformed MFA codes", () => {
    const grant = { operationId, memberId: requestId, role: "membership_review", grant: true, reason: "owner_approved" };
    expect(staffInputSchema.safeParse(grant).success).toBe(true);
    expect(staffInputSchema.safeParse({ ...grant, role: "admin" }).success).toBe(false);
    expect(staffInputSchema.safeParse({ ...grant, actorId: operationId }).success).toBe(false);
    expect(mfaInputSchema.safeParse({ action: "verify", factorId: requestId, code: "123456" }).success).toBe(true);
    expect(mfaInputSchema.safeParse({ action: "verify", factorId: requestId, code: "12345a" }).success).toBe(false);
  });
  it("bounds evidence and checks signatures rather than filenames", () => {
    expect(evidenceType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]))).toBe("image/png");
    expect(evidenceType(new Uint8Array([255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("image/jpeg");
    expect(evidenceType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(evidenceType(new Uint8Array(2097153))).toBeNull();
    expect(evidenceType(new Uint8Array(0))).toBeNull();
  });
});
