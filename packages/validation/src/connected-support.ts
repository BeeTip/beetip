import { z } from "zod";

export const supportCategories = {
  general: "Bantuan umum",
  account: "Akun",
  order: "Pesanan",
} as const;

export const supportCaseActions = {
  claim: "Ambil kasus",
  reassign: "Alihkan petugas",
  resolve: "Tandai selesai",
  reopen: "Buka kembali",
  escalate: "Eskalasi ke pengelola",
  grant_order: "Izinkan baca chat pesanan",
  revoke_order: "Cabut izin chat pesanan",
} as const;

export const supportReferenceSchema = z.string().uuid();
const caseId = supportReferenceSchema;
const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const body = z.string().max(1000).trim().min(1);
const category = z.enum(["general", "account", "order"]);
const version = z.number().int().nonnegative().max(2147483647);
const reason = z.string().max(200).trim().min(1);

export const supportCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), operationId: caseId, body, category, order: caseId.optional() }).strict(),
  z.object({ action: z.literal("send"), caseId, clientId: caseId, body }).strict(),
  z.object({ action: z.literal("read"), caseId, sequence }).strict(),
  z.object({ action: z.enum(["claim", "resolve", "reopen"]), caseId, version }).strict(),
  z.object({ action: z.enum(["escalate", "grant_order", "revoke_order"]), caseId, version, reason }).strict(),
  z.object({ action: z.literal("reassign"), caseId, version, reason, assignee: caseId }).strict(),
]);

export const supportQuerySchema = z.object({
  view: z.literal("cases").optional(),
  case: caseId.optional(),
  before: z.coerce.number().pipe(sequence).optional(),
  history: z.literal("order").optional(),
  queueBefore: z.iso.datetime({ offset: true }).optional(),
  queueBeforeId: caseId.optional(),
}).strict().refine(value =>
  (value.case ? !value.view && !value.queueBefore && !value.queueBeforeId : !value.before && !value.history)
  && Boolean(value.queueBefore) === Boolean(value.queueBeforeId)
  && (!value.queueBefore || value.view === "cases")
);
