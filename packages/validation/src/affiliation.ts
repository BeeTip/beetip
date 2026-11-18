import { z } from "zod";

export const staffRoles = ["membership_review", "support", "finance_operation", "finance_review", "platform_admin"] as const;
export const affiliationIdSchema = z.string().uuid();
const operation = { operationId: z.string().uuid(), requestId: z.string().uuid() };
export const affiliationInputSchema = z.discriminatedUnion("action", [
  z.object({ ...operation, action: z.literal("begin"), value: z.string().trim().min(2).max(100) }).strict(),
  z.object({ ...operation, action: z.enum(["submit", "withdraw"]), value: z.literal("") }).strict(),
  z.object({ ...operation, action: z.literal("approve"), value: z.literal("matched") }).strict(),
  z.object({ ...operation, action: z.literal("reject"), value: z.enum(["unreadable", "not_matched"]) }).strict(),
]);
export const staffInputSchema = z.object({ operationId: z.string().uuid(), memberId: z.string().uuid(), role: z.enum(staffRoles), grant: z.boolean(), reason: z.enum(["owner_approved", "duty_changed", "access_removed"]) }).strict();
export const mfaInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll") }).strict(),
  z.object({ action: z.literal("verify"), factorId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).strict(),
]);
export function evidenceType(bytes: Uint8Array) {
  if (bytes.length < 12 || bytes.length > 2097152) return null;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  return null;
}
