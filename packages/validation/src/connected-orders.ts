import { z } from "zod";

export const acceptanceCommandSchema = z.object({
  operationId: z.uuid(), listingId: z.uuid(), listingVersion: z.number().int().min(1),
  offerId: z.uuid().optional(), offerVersion: z.number().int().min(1).optional(),
}).strict().refine(value => Boolean(value.offerId) === Boolean(value.offerVersion));
export const orderQuerySchema = z.object({ id: z.uuid() }).strict();
export const ordersPageSchema = z.object({ before: z.iso.datetime({ offset: true }).optional(), beforeId: z.uuid().optional() }).strict().refine(value => Boolean(value.before) === Boolean(value.beforeId));
export type AcceptanceCommand = z.infer<typeof acceptanceCommandSchema>;
export type ConnectedOrder = {
  id: string; state: string; conversationId: string; reservationUntil: string;
  terms: { title: string; shop: string; items: { name: string; specification: string; quantity: number; unitBudget: number }[]; budget: number; fee: number; destination: string; start: string; end: string };
};
