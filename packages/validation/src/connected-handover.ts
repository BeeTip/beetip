import { z } from "zod";

const orderId = z.uuid().transform(value => value.toLowerCase());
export const handoverCodePattern = /^[0-9A-F]{12}$/;
const code = z.string().max(32).transform(value => value.replace(/[\s-]/g, "").toUpperCase()).pipe(z.string().regex(handoverCodePattern));

export const handoverCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), orderId }).strict(),
  z.object({ action: z.literal("issue"), orderId, checked: z.literal(true) }).strict(),
  z.object({ action: z.literal("confirm"), orderId, code }).strict(),
]);
export const issuedHandoverSchema = z.object({ code: z.string().regex(handoverCodePattern), expiresAt: z.iso.datetime({ offset: true }) }).strict();
export type HandoverCommand = z.input<typeof handoverCommandSchema>;
