import { orderCaseCommandSchema, orderCaseQuerySchema, orderCaseQueueSchema, orderCaseViewSchema } from "@beetip/validation";
import { identityConfig } from "../../../../server/identity/config";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

const messages: Record<string, string> = {
  "VALIDATION: Allocation must conserve verified funds and remain within entitlement": "Jumlah alokasi harus sama dengan dana terverifikasi dan sesuai batas hak tiap pihak.",
  "VALIDATION: Before purchase refund includes the agreed fee": "Sebelum belanja, seluruh ongkos jastip masuk ke pengembalian dana.",
  "VALIDATION: Preserve unchallenged amounts": "Pertahankan alokasi yang berada di luar nominal sengketa.",
  "VALIDATION: Disputed amount exceeds purchased item entitlement": "Nominal sengketa melebihi sisa dana untuk barang yang dipilih.",
  "VALIDATION: Disputed amount exceeds fee entitlement": "Nominal sengketa melebihi sisa ongkos jastip.",
  "VALIDATION: Evidence missing or belongs to another case": "Unggah ulang foto dari formulir kasus ini.",
  "CONFLICT: Proposal changed": "Bukti atau usulan telah diperbarui. Muat ulang dan tinjau usulan terbaru.",
  "CONFLICT: Proposal author no longer authorized": "Petugas pengusul kehilangan akses. Minta usulan baru.",
  "CONFLICT: New case unavailable": "Periksa status pesanan, dana, atau kasus yang masih aktif.",
  "PERMISSION: An independent reviewer is required": "Usulan harus ditinjau oleh petugas lain.",
};

export async function GET(request: Request) {
  try {
    const query = orderCaseQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if ("view" in query.data) {
      const { data, error } = await client.rpc("order_case_queue", { p_after: query.data.after });
      if (error) return commandFailure(error);
      return reply({ memberId: user.id, data: orderCaseQueueSchema.parse(data) });
    }
    const { order } = query.data;
    const { data, error } = await client.rpc("read_order_cases", { p_order: order });
    if (error) return commandFailure(error);
    return reply({ memberId: user.id, orderId: order, data: orderCaseViewSchema.parse(data),
      storageAvailable: !!process.env.BEETIP_CASE_STORAGE_SECRET && !!identityConfig().url });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = orderCaseCommandSchema.safeParse(await mutationBody(request, 8192));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const { orderId, operationId, action, payload } = parsed.data;
    const { data, error } = await client.rpc("order_case_command", {
      p_order: orderId, p_operation_id: operationId, p_action: action, p_payload: payload,
    });
    if (error) {
      const message = messages[error.message];
      if (!message) return commandFailure(error);
      const code = error.message.split(":")[0];
      return reply({ ok: false, code, message }, code === "CONFLICT" ? 409 : code === "PERMISSION" ? 403 : 400);
    }
    return reply({ ok: true, resultId: data });
  } catch (error) { return boundaryFailure(error); }
}
