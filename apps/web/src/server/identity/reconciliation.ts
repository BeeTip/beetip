import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@beetip/database/types";
import { fundingIdSchema } from "@beetip/validation";
import type { protectedClient } from "./protected";

export const amountLabels = {
  received: "Dana masuk terverifikasi",
  outstanding: "Dana belum diselesaikan",
  item_budget: "Anggaran barang",
  receipt_cost: "Biaya barang sesuai struk",
  unused_budget: "Sisa anggaran barang",
  agreed_fee: "Ongkos jastip disepakati",
  purchase_due: "Penggantian biaya barang yang menjadi hak penyedia",
  purchase_paid: "Penggantian biaya barang terkirim",
  fee_due: "Ongkos jastip yang menjadi hak penyedia",
  fee_paid: "Ongkos jastip terkirim",
  refund_due: "Pengembalian dana yang diperlukan",
  refund_paid: "Pengembalian dana terkirim",
  platform_revenue: "Pendapatan platform",
  disclosed_charges: "Biaya lain yang diungkapkan",
  pending: "Bukti dana masuk menunggu pemeriksaan",
  held: "Dana ditahan karena kasus",
  started: "Transfer dalam proses",
  ambiguous: "Transfer dengan hasil belum pasti",
  unallocated: "Dana tanpa alokasi",
} as const;

export type ReconciliationAmounts = Record<keyof typeof amountLabels, string>;
type ReconciliationOrder = {
  order_id: string;
  trip_id: string | null;
  title: string;
  fulfillment: string;
  money_status: "settled" | "outstanding" | "held" | "ambiguous" | "mismatch";
  amounts: ReconciliationAmounts;
};
type ReconciliationReport = {
  orders: ReconciliationOrder[];
  totals: ReconciliationAmounts | null;
  next_cursor: string | null;
};
type ExportScope = "order" | "trip";
type ExportArgs = Database["public"]["Functions"]["export_reconciliation"]["Args"];
type ReconciliationDatabase = {
  public: Omit<Database["public"], "Functions"> & {
    Functions: {
      read_reconciliation: { Args: { p_scope: "list" | ExportScope; p_id: string | null }; Returns: ReconciliationReport };
      export_reconciliation: { Args: ExportArgs; Returns: { id: string; csv: string } };
    };
  };
};

export function reconciliationClient(client: Awaited<ReturnType<typeof protectedClient>>["client"]) {
  return client as unknown as SupabaseClient<ReconciliationDatabase>;
}

export function reconciliationExportInput(body: unknown): { p_scope: ExportScope; p_id: string } {
  if (!body || typeof body !== "object" || !("scope" in body) || !("id" in body)) throw new Error("VALIDATION");
  const { scope } = body;
  const id = fundingIdSchema.safeParse(body.id);
  if ((scope !== "order" && scope !== "trip") || !id.success) throw new Error("VALIDATION");
  return { p_scope: scope, p_id: id.data };
}
