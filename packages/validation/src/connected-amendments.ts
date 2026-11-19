import { z } from "zod";
import { connectedShoppingItems } from "./connected-listings";

const base = { operationId: z.uuid(), orderId: z.uuid(), version: z.number().int().min(1).max(2147483647) };
export const amendmentCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("propose"), items: connectedShoppingItems, reason: z.string().trim().min(1).max(400) }).strict()
    .refine(value => value.items.reduce((total, item) => total + item.quantity * item.unitBudget, 0) <= 150000),
  z.object({ ...base, action: z.enum(["approve", "reject"]), amendmentId: z.uuid() }).strict(),
]);

export type AmendmentCommand = z.infer<typeof amendmentCommandSchema>;
export type AmendmentItem = z.infer<typeof connectedShoppingItems>[number];
export type AmendmentRecord = {
  id: string; revision: number; baseVersion: number; items: AmendmentItem[]; budget: number; reason: string;
  state: "pending" | "approved" | "rejected";
};
export type AmendmentView = {
  version: number; provider: boolean; editable: boolean; items: AmendmentItem[]; budget: number; fee: number;
  history: AmendmentRecord[];
};
