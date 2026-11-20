import { notificationCommandSchema, orderQuerySchema } from "@beetip/validation";
import { boundaryFailure, reply } from "../../../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../../../server/identity/protected";

const accountTargets = new Set(["/account", "/account/affiliation", "/account/notifications", "/account/offers", "/account/order-cases", "/support"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsed = notificationCommandSchema.safeParse({ action: "read", id: (await params).id });
    if (!parsed.success || parsed.data.action !== "read") throw new Error("VALIDATION");
    const { client } = await protectedClient();
    const { data, error } = await client.rpc("notification_target", { p_id: parsed.data.id });
    if (error) return commandFailure(error);
    const destination = new URL(data, request.url);
    const order = /^\/(?:orders|chat)\/([^/]+)$/.exec(destination.pathname);
    if (!data.startsWith("/") || data.startsWith("//") || destination.origin !== new URL(request.url).origin
      || !(accountTargets.has(destination.pathname) || (order && orderQuerySchema.safeParse({ id: order[1] }).success))) {
      return reply({ ok: false, code: "NOT_FOUND", message: "Tujuan notifikasi sudah tidak tersedia." }, 404);
    }
    return reply({ ok: true, target: destination.pathname + destination.search + destination.hash });
  } catch (error) { return boundaryFailure(error); }
}
