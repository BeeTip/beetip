import { acceptanceCommandSchema, orderQuerySchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

export async function POST(request: Request) {
  try {
    const parsed = acceptanceCommandSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const input = parsed.data;
    const { data, error } = await client.rpc("accept_order", { p_operation_id: input.operationId, p_listing_id: input.listingId, p_listing_version: input.listingVersion, p_offer_id: input.offerId, p_offer_version: input.offerVersion });
    if (error) return commandFailure(error);
    return reply({ ok: true, orderId: data });
  } catch (error) { return boundaryFailure(error); }
}

export async function GET(request: Request) {
  try {
    const parsed = orderQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const { data, error } = await client.rpc("read_order", { p_id: parsed.data.id });
    if (error) return commandFailure(error);
    return reply({ ok: true, memberId: user.id, order: data });
  } catch (error) { return boundaryFailure(error); }
}
