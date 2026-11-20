import { z } from "zod";

const rupiah = z.number().int().min(0).max(150000);
export const connectedShoppingItems = z.array(z.object({
  name: z.string().trim().min(1).max(100),
  specification: z.string().trim().max(200),
  quantity: z.number().int().min(1).max(50),
  unitBudget: rupiah.min(1000),
}).strict()).min(1).max(20);

export const connectedListingSchema = z.object({
  type: z.enum(["request", "trip"]),
  title: z.string().trim().min(4).max(100),
  shop: z.string().trim().min(2).max(100),
  category: z.enum(["Makanan", "Minuman", "Belanja"]),
  area: z.string().trim().min(2).max(100),
  destination: z.string().trim().min(2).max(200),
  items: connectedShoppingItems,
  fee: rupiah,
  bound: rupiah,
  negotiable: z.boolean(),
  capacity: z.number().int().min(1).max(3),
  spendingCapacity: z.number().int().min(1000).max(450000),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  cutoff: z.iso.datetime({ offset: true }),
  status: z.enum(["active", "paused", "closed"]),
}).strict().superRefine((value, context) => {
  const budget = value.items.reduce((sum, item) => sum + item.quantity * item.unitBudget, 0);
  if (budget > 150000 || budget > value.spendingCapacity) context.addIssue({ code: "custom", path: ["items"], message: "Batas belanja Rp150.000 dan kapasitas belanja harus dipenuhi." });
  if ((!value.negotiable && value.bound !== value.fee) || (value.negotiable && (value.type === "request" ? value.bound < value.fee : value.bound > value.fee))) context.addIssue({ code: "custom", path: ["bound"], message: "Batas negosiasi tidak sesuai ongkos jasa." });
  if (value.type === "request" && value.capacity !== 1) context.addIssue({ code: "custom", path: ["capacity"], message: "Permintaan dibelikan memiliki satu pembeli." });
  if (Date.parse(value.cutoff) > Date.parse(value.start) || Date.parse(value.end) <= Date.parse(value.start)) context.addIssue({ code: "custom", path: ["start"], message: "Penutupan harus sebelum pengantaran, dan akhir setelah awal." });
});

export const listingCommandSchema = z.object({ operationId: z.uuid(), listingId: z.uuid(), version: z.number().int().min(0), listing: connectedListingSchema }).strict();
export const ownListingQuerySchema = z.object({ id: z.uuid().optional(), before: z.iso.datetime({ offset: true }).optional(), beforeId: z.uuid().optional() }).strict().refine(value => Boolean(value.before) === Boolean(value.beforeId));
export const boardQuerySchema = z.object({
  type: z.enum(["all", "request", "trip"]).default("all"),
  category: z.enum(["Semua", "Makanan", "Minuman", "Belanja"]).default("Semua"),
  search: z.string().trim().max(100).default(""),
  date: z.iso.date().optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  beforeId: z.uuid().optional(),
  id: z.uuid().optional(),
}).strict().refine(value => Boolean(value.before) === Boolean(value.beforeId));

export type ConnectedListingInput = z.infer<typeof connectedListingSchema>;
export type PublicListing = Omit<ConnectedListingInput, "destination" | "status"> & { id: string; version: number; created_at: string; budget: number; status: ConnectedListingInput["status"] | "removed" };
export type OwnListing = PublicListing & { destination: string; moderated: boolean };

export function wibInput(value: string) { return new Date(value).toLocaleString("sv-SE", { timeZone: "Asia/Jakarta" }).slice(0, 16).replace(" ", "T"); }
export function wibTimestamp(value: string) { return new Date(`${value}:00+07:00`).toISOString(); }
