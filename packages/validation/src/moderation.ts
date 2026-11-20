import { z } from "zod";

export const moderationStatuses = ["active", "paused", "closed", "removed"] as const;
export const moderationQuerySchema = z.object({ search: z.string().trim().max(100).default("") }).strict();
export const moderationCommandSchema = z.object({
  operationId: z.uuid(),
  listingId: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(moderationStatuses),
  reason: z.string().trim().min(3).max(500),
}).strict();

export const orderRatingQuerySchema = z.object({ orderId: z.uuid() }).strict();
export const orderRatingCommandSchema = orderRatingQuerySchema.extend({
  operationId: z.uuid(),
  score: z.number().int().min(1).max(5),
  feedback: z.string().trim().max(500),
}).strict();

export type ModerationCommand = z.infer<typeof moderationCommandSchema>;
export type ModerationListing = {
  id: string;
  title: string;
  status: ModerationCommand["status"];
  version: number;
  cutoff: string;
  moderated: boolean;
};
export type OrderRatingCommand = z.infer<typeof orderRatingCommandSchema>;
export type OrderRating = Pick<OrderRatingCommand, "score" | "feedback">;
