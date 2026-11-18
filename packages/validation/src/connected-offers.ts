import { z } from "zod";

export const offerCommandSchema = z.object({
  operationId: z.uuid(), offerId: z.uuid(), listingId: z.uuid(),
  version: z.number().int().min(0), listingVersion: z.number().int().min(1),
  fee: z.number().int().min(0).max(150000), action: z.enum(["save", "withdraw"]),
}).strict().refine(value => value.action !== "withdraw" || value.version > 0);
export const offerQuerySchema = z.object({ listingId: z.uuid().optional(), before: z.iso.datetime({ offset: true }).optional(), beforeId: z.uuid().optional() }).strict().refine(value => Boolean(value.before) === Boolean(value.beforeId));
export type OfferCommand = z.infer<typeof offerCommandSchema>;
export type ConnectedOffer = { id: string; listing_id: string; listing_title: string; version: number; listing_version: number; fee: number; status: string; created_at: string; own: boolean };
export type OfferListing = { id: string; title: string; type: "request" | "trip"; version: number; fee: number; bound: number; negotiable: boolean; start: string; end: string; cutoff: string; status: string; isOwner: boolean };
