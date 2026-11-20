import { z } from "zod";

const id = z.uuid();
const note = z.string().trim().min(1).max(1000);
const amount = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const itemIndex = z.number().int().min(0).max(999999999);
const component = z.enum(["purchase", "fee", "refund"]);
const state = z.enum(["prepared", "approved", "started", "ambiguous", "completed", "not_sent"]);
const simpleAction = z.enum(["approve", "start", "abandon", "not_sent", "ambiguous"]);
const nextAction = z.enum([...simpleAction.options, "completed", "resolve_completed", "resolve_not_sent"]);
const base = { orderId: id, operationId: id };
const target = { transferId: id, version: z.number().int().min(1).max(5), note };
const reference = z.string().trim().max(64).refine(value => /^TEST[A-Z0-9]{4,44}$/i.test(value.replace(/[ -]/g, "")));
const record = z.string().trim().min(1).max(160);

export const manualTransferCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...base, action: z.literal("prepare"), payload: z.union([
    z.strictObject({ component: z.literal("purchase"), itemIndex, amount, note }),
    z.strictObject({ component: z.enum(["fee", "refund"]), amount, note }),
  ]) }),
  z.strictObject({ ...base, action: simpleAction, payload: z.strictObject(target) }),
  z.strictObject({ ...base, action: z.literal("completed"), payload: z.strictObject({ ...target, reference }) }),
  z.strictObject({ ...base, action: z.literal("resolve_completed"), payload: z.strictObject({ ...target, record, reference }) }),
  z.strictObject({ ...base, action: z.literal("resolve_not_sent"), payload: z.strictObject({ ...target, record }) }),
]);

export const manualTransferQuerySchema = z.union([
  z.strictObject({ order: id, before: id.optional() }),
  z.strictObject({ view: z.literal("queue"), after: id.optional() }),
  z.strictObject({ operation: id }),
]);
export const manualTransferReceiptSchema = z.object({ orderId: id, transferId: id }).nullable();
export const manualTransferQueueSchema = z.array(z.object({
  orderId: id, title: z.string(), accountLabel: z.string(), latestState: state.nullable(),
})).max(30);
export const manualTransferViewSchema = z.object({
  title: z.string(), accountLabel: z.string(), accountBlocked: z.boolean(), blockingOrderId: id.nullable(),
  options: z.array(z.object({ component, itemIndex: itemIndex.nullable(), label: z.string().nullable(), amount })),
  history: z.array(z.object({
    id, component, itemIndex: itemIndex.nullable(), itemLabel: z.string().nullable(), amount, independentReview: z.boolean(), preparedBy: id,
    state, version: target.version, allocationChanged: z.boolean(), actions: z.array(nextAction),
    facts: z.array(z.object({ state, actorId: id, note, at: z.string(), reference: z.string().nullable(), accountRecord: record.nullable() })).max(5),
  })).max(30),
});
export type ManualTransferCommand = z.infer<typeof manualTransferCommandSchema>;
export type ManualTransferView = z.infer<typeof manualTransferViewSchema>;
export type ManualTransferQueue = z.infer<typeof manualTransferQueueSchema>;
