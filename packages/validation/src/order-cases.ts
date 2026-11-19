import { z } from "zod";

const id = z.uuid();
const reason = z.string().trim().min(1).max(1000);
const photo = z.string().regex(/^[a-f0-9]{64}$/);
const index = z.number().int().min(0).max(2147483647);
const amount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const outcome = z.enum(["resolve", "dismiss"]);
const kind = z.enum(["cancellation", "dispute"]);
const base = { operationId: id, orderId: id };
const amounts = { purchase: amount, fee: amount, refund: amount };
const dispute = { kind: z.literal("dispute"), reason, imageHash: photo, amount: amount.min(1) };

export const orderCaseCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...base, action: z.literal("open"), payload: z.union([
    z.strictObject({ kind: z.literal("cancellation"), reason, imageHash: photo.optional() }),
    z.strictObject({ ...dispute, component: z.literal("purchase"), itemIndex: index }),
    z.strictObject({ ...dispute, component: z.literal("fee") }),
  ]) }),
  z.strictObject({ ...base, action: z.literal("evidence"), payload: z.strictObject({ caseId: id, reason, imageHash: photo }) }),
  z.strictObject({ ...base, action: z.literal("propose"), payload: z.strictObject({ caseId: id, outcome, ...amounts, reason }) }),
  z.strictObject({ ...base, action: z.literal("review"), payload: z.strictObject({
    caseId: id, proposalId: id, decision: z.enum(["approve", "return"]), reason,
  }) }),
]);

export const orderCaseQuerySchema = z.union([
  z.strictObject({ order: id }),
  z.strictObject({ view: z.literal("queue"), after: id.optional() }),
]);
export const orderCaseEvidenceQuery = z.strictObject({ order: id, key: id });

const allocation = z.object(amounts);
export const orderCaseViewSchema = z.object({
  access: z.enum(["member", "reviewer"]),
  verified: amount,
  held: allocation,
  allocation,
  unheld: allocation,
  canCancel: z.boolean(),
  canDispute: z.boolean(),
  items: z.array(z.object({ index, name: z.string(), available: amount })),
  case: z.object({
    id, kind, reason, itemIndex: index.nullable(),
    state: z.enum(["open", "resolved", "dismissed"]),
    evidence: z.array(z.object({ id, note: reason })).max(8),
    proposal: z.object({
      id, reason, allocation, outcome,
      status: z.enum(["pending", "returned", "stale", "approved"]),
      canReview: z.boolean(),
      reviewReason: reason.nullable(),
    }).nullable(),
  }).nullable(),
});
export const orderCaseQueueSchema = z.array(z.object({ id, orderId: id, title: z.string(), kind, openedAt: z.string() })).max(30);
export type OrderCaseCommand = z.infer<typeof orderCaseCommandSchema>;
export type OrderCaseView = z.infer<typeof orderCaseViewSchema>;
export type OrderCaseQueue = z.infer<typeof orderCaseQueueSchema>;
