import { createHash } from "node:crypto";
import { handoverCommandSchema, issuedHandoverSchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

const rejections: Record<string, string> = {
  unavailable: "Minta pelanggan membuat kode untuk pesanan ini.",
  invalid: "Kode tidak cocok. Periksa kode untuk pesanan ini.",
  expired: "Kode sudah berakhir. Minta pelanggan membuat kode baru.",
  locked: "Lima percobaan gagal. Minta pelanggan membuat kode baru.",
  replayed: "Serah terima sudah dikonfirmasi.",
};

export async function POST(request: Request) {
  try {
    const parsed = handoverCommandSchema.safeParse(await mutationBody(request, 1024));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const input = parsed.data;
    const p_order = input.orderId;
    if (input.action === "start") {
      const { error } = await client.rpc("start_delivery", { p_order });
      return error ? commandFailure(error) : reply({ ok: true });
    }
    if (input.action === "issue") {
      const { data, error } = await client.rpc("issue_handover_code", { p_order, p_checked: input.checked });
      return error ? commandFailure(error) : reply({ ok: true, ...issuedHandoverSchema.parse(data) });
    }
    const p_digest = createHash("sha256").update(`${p_order}:${input.code}`).digest("hex");
    const { data, error } = await client.rpc("confirm_handover", { p_order, p_digest });
    if (error) return commandFailure(error);
    if (data === "confirmed") return reply({ ok: true });
    if (data && Object.hasOwn(rejections, data)) return reply({ ok: false, code: data, message: rejections[data] }, 409);
    throw new Error("UNAVAILABLE");
  } catch (error) { return boundaryFailure(error); }
}
