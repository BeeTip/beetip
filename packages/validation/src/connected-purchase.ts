import { z } from "zod";

const money = z.number().int().min(0);
const index = z.number().int().min(0).max(19);
const line = z.number().int().min(1).max(40);
const date = z.iso.date();
const receiptHeader = z.object({ merchant: z.string().trim().min(1).max(100), reference: z.string().trim().min(1).max(80), date });
const command = z.object({ orderId: z.uuid(), operationId: z.uuid(), version: z.number().int().min(1) });

export const purchaseCommandSchema = z.discriminatedUnion("action", [
  command.extend({ action: z.literal("receipt"), payload: receiptHeader.extend({
    discount: money.max(4_000_000_000), imageHash: z.string().regex(/^[a-f0-9]{64}$/),
    lines: z.array(z.object({ label: z.string().trim().min(1).max(100), quantity: z.number().int().min(1).max(1000), gross: money.min(1).max(100_000_000) }).strict()).min(1).max(40),
  }).strict() }).strict(),
  command.extend({ action: z.literal("allocate"), payload: z.object({ receipt: z.uuid(),
    entries: z.array(z.object({ line, item: index, quantity: z.number().int().min(1).max(50) }).strict()).min(1).max(40),
  }).strict() }).strict(),
  command.extend({ action: z.literal("finish"), payload: z.object({ unavailable: z.array(index).max(20), note: z.string().trim().max(400) }).strict() }).strict(),
]);

export const purchaseEvidenceQuery = z.object({ order: z.uuid(), key: z.uuid() }).strict();
export const purchaseViewSchema = z.object({
  version: z.number().int().min(1), provider: z.boolean(), ready: z.boolean(), budget: money, spent: money,
  customerName: z.string().nullable(), tripOrders: z.array(z.object({ id: z.uuid(), name: z.string(), state: z.string() })),
  state: z.enum(["purchasing", "purchased", "purchase_partial", "purchase_unavailable"]).nullable(), note: z.string().nullable(),
  items: z.array(z.object({ index, name: z.string(), specification: z.string(), quantity: money, unitBudget: money, purchased: money, unavailable: money })),
  allocations: z.array(receiptHeader.extend({ id: z.uuid(), receipt: z.uuid(), line, label: z.string(), item: index, quantity: money, gross: money, discount: money, net: money })),
  receipts: z.array(receiptHeader.extend({ id: z.uuid(), discount: money,
    lines: z.array(z.object({ line, label: z.string(), gross: money, remaining: money })),
  })),
});

export type PurchaseView = z.infer<typeof purchaseViewSchema>;
export type PurchaseCommand = z.infer<typeof purchaseCommandSchema>;
