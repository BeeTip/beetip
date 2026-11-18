import { z } from "zod";

const sequence = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const chatQuerySchema = z.object({
  order: z.uuid(), before: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().refine(value => value.before === undefined || value.after === undefined);
export const chatCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), order: z.uuid(), clientId: z.uuid(), body: z.string().max(1000).trim().min(1) }).strict(),
  z.object({ action: z.literal("read"), order: z.uuid(), sequence }).strict(),
]);
export type ChatMessage = { id: string; sequence: number; senderId: string; clientId: string; body: string; createdAt: string };
export type ChatPage = { messages: ChatMessage[]; highWater: number; readSequence: number; older: number | null; after: number; hasMore: boolean; unread: number; closed: boolean };
export function mergeChat(previous: ChatMessage[], incoming: ChatMessage[]) {
  return [...new Map([...previous, ...incoming].map(row => [row.id, row])).values()].sort((a, b) => a.sequence - b.sequence);
}
