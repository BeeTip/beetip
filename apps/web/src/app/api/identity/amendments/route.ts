import { amendmentCommandSchema, orderQuerySchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

export async function POST(request: Request) {
  try {
    const parsed = amendmentCommandSchema.safeParse(await mutationBody(request, 48 * 1024));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const input = parsed.data;
    const { data, error } = await client.rpc("amend_order", {
      p_operation_id: input.operationId, p_order: input.orderId, p_action: input.action, p_version: input.version,
      ...(input.action === "propose" ? { p_items: input.items, p_reason: input.reason } : { p_amendment: input.amendmentId }),
    });
    if (error) {
      if (error.message === "CONFLICT: Trip spending capacity full") {
        return reply({ ok: false, code: "CONFLICT", message: "Kapasitas belanja tidak cukup untuk menyetujui usulan ini." }, 409);
      }
      return commandFailure(error);
    }
    return reply({ ok: true, amendmentId: data });
  } catch (error) { return boundaryFailure(error); }
}

export async function GET(request: Request) {
  try {
    const parsed = orderQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const { data, error } = await client.rpc("read_amendments", { p_order: parsed.data.id });
    if (error) return commandFailure(error);
    return reply({ ok: true, memberId: user.id, amendment: data });
  } catch (error) { return boundaryFailure(error); }
}
