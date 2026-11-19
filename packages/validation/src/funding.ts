import { z } from "zod";

export const fundingIdSchema = z.uuid();
const uuid = fundingIdSchema;
const amount = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const reference = z.string().max(80).refine(value => /^TEST[A-Z0-9]{4,44}$/i.test(value.replace(/[ -]/g, "")));
export const fundingReasons = {
  not_found: "Transfer tidak ditemukan",
  amount_mismatch: "Nominal tidak sesuai",
  evidence_mismatch: "Bukti tidak sesuai",
} as const;
const reason = z.enum(["not_found", "amount_mismatch", "evidence_mismatch"]);

export const fundingCommandSchema = z.object({
  operationId: uuid, id: uuid, action: z.enum(["begin", "submit", "discard", "verify", "reject"]),
  account: uuid.optional(), amount: amount.optional(), reference: reference.optional(), reason: reason.optional(),
}).strict().refine(value => {
  if (value.action === "begin" || value.action === "verify") {
    return value.account !== undefined && value.amount !== undefined && value.reference !== undefined && value.reason === undefined;
  }
  return value.account === undefined && value.amount === undefined && value.reference === undefined &&
    (value.action === "reject") === (value.reason !== undefined);
});
export type FundingCommand = Omit<z.infer<typeof fundingCommandSchema>, "operationId">;

export const fundingQuerySchema = z.discriminatedUnion("view", [
  z.object({ view: z.literal("order"), order: uuid }).strict(),
  z.object({ view: z.literal("queue"), order: uuid.optional(), after: z.iso.datetime({ offset: true }).optional(), afterId: uuid.optional() })
    .strict().refine(value => Boolean(value.after) === Boolean(value.afterId)),
]);

export type FundingView = {
  state: "unpaid" | "draft" | "pending" | "rejected" | "verified";
  payable: boolean;
  purchaseReady: boolean;
  customer: boolean;
  requiredAmount: number;
  accounts: { id: string; label: string }[];
  submission: {
    id: string; accountId: string; reference: string; uploaded: boolean; reason: keyof typeof fundingReasons | null;
  } | null;
};

export type FundingQueueItem = {
  id: string; orderId: string; accountId: string; accountLabel: string; reference: string;
  amount: number; submittedAt: string; expiresAt: string;
};
