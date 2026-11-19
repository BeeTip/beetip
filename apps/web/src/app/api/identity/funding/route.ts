import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";
import { fundingStorageConfigured } from "../../../../server/identity/funding-evidence";
import { fundingCommandSchema, fundingQuerySchema } from "@beetip/validation";

export async function GET(request: Request) {
  try {
    const parsed = fundingQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const query = parsed.data;
    const { data, error } = query.view === "order"
      ? await client.rpc("funding_view", { p_order: query.order })
      : await client.rpc("funding_queue", { p_order: query.order, p_after: query.after, p_after_id: query.afterId });
    if (error) return commandFailure(error);
    return reply({ ok: true, memberId: user.id, data, storageAvailable: fundingStorageConfigured() });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = fundingCommandSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const { operationId, action, id, account, reference, amount, reason } = parsed.data;
    if (action === "begin" && !fundingStorageConfigured()) throw new Error("UNAVAILABLE");
    const { data, error } = await client.rpc("funding_command", {
      p_operation_id: operationId, p_action: action, p_id: id, p_account: account,
      p_reference: reference, p_amount: amount, p_reason: reason,
    });
    if (error?.message.startsWith("VALIDATION") && (action === "verify" || action === "submit")) {
      const message = action === "verify"
        ? "Akun, referensi, dan nominal pada catatan bank harus sesuai dengan pengajuan."
        : "Unggah gambar bukti yang valid sebelum mengirim pengajuan.";
      return reply({ ok: false, code: "VALIDATION", message }, 400);
    }
    if (error) return commandFailure(error);
    return reply({ ok: true, id: data });
  } catch (error) { return boundaryFailure(error); }
}
