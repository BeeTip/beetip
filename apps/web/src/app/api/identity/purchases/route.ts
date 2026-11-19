import { orderQuerySchema, purchaseCommandSchema, purchaseViewSchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

const messages: Record<string, string> = {
  "CONFLICT: Approved purchase budget exceeded": "Biaya bersih melebihi batas belanja untuk barang atau pesanan ini.",
  "CONFLICT: Receipt line quantity exhausted": "Jumlah pada baris struk sudah dialokasikan. Perbarui status sebelum mencoba lagi.",
  "CONFLICT: Order item quantity exceeded": "Jumlah yang dipilih melebihi sisa barang yang disetujui.",
  "CONFLICT: Receipt reference already recorded": "Nomor struk ini sudah tercatat untuk toko dan tanggal yang sama.",
  "CONFLICT: Receipt image already recorded": "Foto struk ini sudah tercatat. Pilih struk yang sudah tersimpan.",
  "CONFLICT: Purchase funding or approval pending": "Tunggu dana terverifikasi dan keputusan perubahan pesanan.",
  "CONFLICT: Confirm all remaining quantities and provide a reason": "Perbarui status, tandai semua barang yang tersisa, lalu isi alasannya.",
};

export async function GET(request: Request) {
  try {
    const parsed = orderQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const { data, error } = await client.rpc("read_purchase", { p_order: parsed.data.id });
    if (error) return commandFailure(error);
    return reply({ memberId: user.id, orderId: parsed.data.id, purchase: purchaseViewSchema.parse(data) });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = purchaseCommandSchema.safeParse(await mutationBody(request, 32 * 1024));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const input = parsed.data;
    const { data, error } = await client.rpc("record_purchase", { p_order: input.orderId, p_operation_id: input.operationId,
      p_version: input.version, p_action: input.action, p_payload: input.payload });
    if (error) {
      const message = messages[error.message];
      if (message) return reply({ code: "CONFLICT", message }, 409);
      return commandFailure(error);
    }
    return reply({ ok: true, resultId: data });
  } catch (error) { return boundaryFailure(error); }
}
