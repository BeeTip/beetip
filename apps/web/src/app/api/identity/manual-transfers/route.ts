import {
  manualTransferCommandSchema, manualTransferQuerySchema, manualTransferQueueSchema,
  manualTransferReceiptSchema, manualTransferViewSchema,
} from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { syntheticTransfersEnabled } from "../../../../server/identity/manual-transfers";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

const conflicts: Record<string, string> = {
  "CONFLICT: Account has an unresolved transfer": "Selesaikan transfer yang belum pasti pada akun ini sebelum memulai transfer lain.",
  "CONFLICT: Allocation changed": "Alokasi berubah. Tutup permintaan ini dan siapkan permintaan baru.",
  "CONFLICT: Reviewer no longer authorized": "Akses petugas peninjau telah dicabut. Siapkan permintaan baru.",
  "CONFLICT: Initiator no longer authorized": "Akses petugas pengusul telah dicabut. Siapkan permintaan baru.",
  "CONFLICT: Insufficient unheld entitlement": "Nominal melebihi sisa alokasi yang tersedia.",
  "CONFLICT: Reference already in use": "Referensi sudah dipakai pada akun ini.",
};

export async function GET(request: Request) {
  try {
    if (!syntheticTransfersEnabled()) throw new Error("UNAVAILABLE");
    const query = manualTransferQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if ("view" in query.data) {
      const { data, error } = await client.rpc("manual_transfer_queue", { p_after: query.data.after });
      if (error) return commandFailure(error);
      return reply({ memberId: user.id, data: manualTransferQueueSchema.parse(data) });
    }
    if ("operation" in query.data) {
      const { data, error } = await client.rpc("manual_transfer_operation", { p_operation_id: query.data.operation });
      if (error) return commandFailure(error);
      return reply({ memberId: user.id, data: manualTransferReceiptSchema.parse(data) });
    }
    const { order, before } = query.data;
    const { data, error } = await client.rpc("read_manual_transfers", { p_order: order, p_before: before });
    if (error) return commandFailure(error);
    return reply({ memberId: user.id, orderId: order, data: manualTransferViewSchema.parse(data) });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    if (!syntheticTransfersEnabled()) throw new Error("UNAVAILABLE");
    const command = manualTransferCommandSchema.safeParse(await mutationBody(request));
    if (!command.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const { orderId, operationId, action, payload } = command.data;
    const { data, error } = await client.rpc("manual_transfer_command", {
      p_order: orderId, p_operation_id: operationId, p_action: action, p_payload: payload,
    });
    if (error) {
      const message = conflicts[error.message];
      return message ? reply({ ok: false, code: "CONFLICT", message }, 409) : commandFailure(error);
    }
    return reply({ memberId: user.id, orderId, transferId: data });
  } catch (error) { return boundaryFailure(error); }
}
