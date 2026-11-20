import { z } from "zod";
export * from "./notifications";
export * from "./funding";

export const shoppingItemsSchema = z.array(z.object({ name: z.string().trim().min(1).max(100), specification: z.string().max(500), quantity: z.number().int().min(1).max(50), unitBudget: z.number().int().min(1000).max(150000) })).min(1).max(20);
export const creationDraftSchema = z.object({ type: z.enum(["request", "trip"]), title: z.string().max(100), shop: z.string().max(100), category: z.enum(["Minuman", "Makanan", "Belanja"]), area: z.string().max(100), destination: z.string().max(100), start: z.string(), end: z.string(), deadline: z.string(), fee: z.number().int().min(0).max(150000), bound: z.number().int().min(0).max(150000), negotiable: z.boolean(), capacity: z.number().int().min(1).max(3), spendingCapacity: z.number().int().min(1000).max(450000), items: z.array(z.object({ name: z.string().max(100), specification: z.string().max(500), quantity: z.number().int().min(1).max(50), unitBudget: z.number().int().min(1000).max(150000) })).min(1).max(20) });

export const listingSchema = z.object({
  type: z.enum(["request", "trip"]),
  title: z.string().trim().min(4, "Judul minimal 4 karakter").max(100),
  shop: z.string().trim().min(2, "Isi lokasi belanja").max(100),
  category: z.enum(["Makanan", "Minuman", "Belanja"]),
  area: z.string().trim().min(2, "Isi area tujuan").max(100),
  window: z.string().trim().min(2, "Isi waktu pengantaran").max(100),
  item: z.string().trim().min(2, "Isi rincian item").max(500),
  quantity: z.number().int().min(1).max(50),
  budget: z.number().int().min(1000).max(150000, "Maksimal Rp150.000"),
  fee: z.number().int().min(0).max(150000),
  negotiable: z.boolean(),
  bound: z.number().int().min(0).max(150000),
  capacity: z.number().int().min(1).max(3),
  spendingCapacity: z.number().int().min(1000).max(450000),
}).refine(l => !l.negotiable || (l.type === "request" ? l.bound >= l.fee : l.bound <= l.fee), { path: ["bound"], message: "Batas tidak sesuai ongkos yang ditawarkan" });

export type ListingInput = z.infer<typeof listingSchema>;

const amount = z.number().int().nonnegative().safe();
const timestamp = z.number().finite().nonnegative();
const id = z.string().min(1);
const items = z.array(z.object({ name: id, specification: z.string(), quantity: z.number().int().positive().max(50), unitBudget: amount })).min(1).max(20);
const schedule = z.object({ start: timestamp, end: timestamp });
const terms = z.object({ title: id, item: id, quantity: z.number().int().positive(), budget: amount, fee: amount, destination: id, window: id, items: items.optional() });
const cancellationAmounts = z.object({ purchase: amount, fee: amount, refund: amount, reason: id });
const orderSchema = z.object({
  id, listingId: id, customerId: id, providerId: id, terms,
  budget: amount, approvedItem: id,
  state: z.enum(["awaiting_payment", "ready_to_purchase", "purchasing", "approval_required", "purchased", "delivering", "delivery_confirmed", "cancelled"]),
  createdAt: timestamp, reservationUntil: timestamp,
  funding: z.array(z.object({ id, amount, reference: id, status: z.enum(["pending", "verified"]), verifiedBy: id.optional() })),
  receipts: z.array(z.object({ key: id, reference: id, line: id, amount })),
  transfers: z.array(z.object({ id, kind: z.enum(["payout", "refund"]), amount, reference: id, status: z.enum(["review", "ready", "ambiguous", "completed"]), createdBy: id, reviewedBy: id.optional() })),
  amendment: z.object({ item: id, budget: amount, reason: id, status: z.enum(["pending", "approved", "rejected"]) }).optional(),
  dispute: z.object({ reason: id, openedBy: id, resolvedBy: id.optional(), resolution: id.optional() }).optional(),
  confirmation: z.object({ code: z.string().regex(/^\d{6}$/), expiresAt: timestamp, attempts: z.number().int().nonnegative(), used: z.boolean() }).optional(),
  retiredCodes: z.array(z.string().regex(/^\d{6}$/)).optional(),
  confirmedBy: id.optional(), confirmedAt: timestamp.optional(), cancellationRequested: id.optional(),
  cancellationProposal: cancellationAmounts.extend({ id, proposedBy: id }).optional(),
  cancellationAllocation: cancellationAmounts.extend({ reviewedBy: id.optional() }).optional(),
  ratings: z.array(z.object({ authorId: id, score: z.number().int().min(1).max(5), feedback: id })),
});

export const demoStorageSchema = z.object({
  actorId: id,
  state: z.object({
    version: z.union([z.literal(1), z.literal(2)]),
    support: z.array(z.object({ id, memberId: id, orderId: id.optional(), status: z.enum(["open", "resolved"]), messages: z.array(z.object({ authorId: id, text: id, at: timestamp })) })).optional(),
    members: z.array(z.object({ id, name: id, verified: z.boolean(), admin: z.boolean() })).min(1),
    listings: z.array(z.object({ id, ownerId: id, type: z.enum(["request", "trip"]), title: id, shop: id, category: z.enum(["Makanan", "Minuman", "Belanja"]), area: id, window: id, cutoff: timestamp, budget: amount, fee: amount, negotiable: z.boolean(), bound: amount, capacity: z.number().int().min(1).max(3), spendingCapacity: amount, item: id, quantity: z.number().int().positive(), closed: z.boolean(), cancelled: z.boolean().optional(), items: items.optional(), schedule: schedule.optional(), destination: id.optional(), moderation: z.enum(["active", "paused", "closed", "removed"]).optional() })),
    offers: z.array(z.object({ id, listingId: id, authorId: id, fee: amount, budget: amount, item: id, quantity: z.number().int().positive(), destination: id, window: id, items: items.optional(), status: z.enum(["active", "withdrawn", "accepted"]) })),
    orders: z.array(orderSchema),
    messages: z.array(z.object({ id, orderId: id, authorId: id, text: id, at: timestamp })),
    audit: z.array(z.object({ operationId: id, actorId: id, type: id, targetId: id, resultId: id.optional(), at: timestamp, detail: id })),
    operations: z.array(id),
  }),
}).refine(data => data.state.members.some(m => m.id === data.actorId), "Persona tidak tersedia");
export { acceptsMutation, accountRedirect, applicationMode, authInputSchema, authRedirect, supportInputSchema, trustedOrigin } from "./identity";
export { affiliationIdSchema, affiliationInputSchema, evidenceType, mfaInputSchema, staffInputSchema, staffRoles } from "./affiliation";
export { boardQuerySchema, connectedListingSchema, listingCommandSchema, ownListingQuerySchema, wibInput, wibTimestamp } from "./connected-listings";
export type { ConnectedListingInput, OwnListing, PublicListing } from "./connected-listings";
export { offerCommandSchema, offerQuerySchema } from "./connected-offers";
export type { OfferCommand, ConnectedOffer, OfferListing } from "./connected-offers";
export { acceptanceCommandSchema, orderQuerySchema, ordersPageSchema } from "./connected-orders";
export type { AcceptanceCommand, ConnectedOrder } from "./connected-orders";
export { amendmentCommandSchema } from "./connected-amendments";
export { purchaseCommandSchema, purchaseEvidenceQuery, purchaseViewSchema } from "./connected-purchase";
export { orderCaseCommandSchema, orderCaseEvidenceQuery, orderCaseQuerySchema, orderCaseQueueSchema, orderCaseViewSchema } from "./order-cases";
export type { OrderCaseCommand, OrderCaseQueue, OrderCaseView } from "./order-cases";
export { handoverCommandSchema, handoverCodePattern, issuedHandoverSchema, type HandoverCommand } from "./connected-handover";
export type { PurchaseCommand, PurchaseView } from "./connected-purchase";
export type { AmendmentCommand, AmendmentItem, AmendmentRecord, AmendmentView } from "./connected-amendments";
export { chatCommandSchema, chatQuerySchema, mergeChat } from "./connected-chat";
export type { ChatMessage, ChatPage } from "./connected-chat";
export { supportCaseActions, supportCategories, supportCommandSchema, supportQuerySchema, supportReferenceSchema } from "./connected-support";
