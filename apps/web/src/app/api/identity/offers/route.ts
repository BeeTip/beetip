import { offerCommandSchema, offerQuerySchema, type ConnectedOffer } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

export async function GET(request: Request) {
  try {
    const parsed = offerQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const { listingId, before, beforeId } = parsed.data;
    let listing = null;
    if (listingId) {
      const result = await client.rpc("offer_listing", { p_id: listingId });
      if (result.error) return commandFailure(result.error);
      listing = result.data;
    }
    const { data, error } = await client.rpc("browse_offers", { p_listing_id: listingId, p_before: before, p_before_id: beforeId });
    if (error) throw new Error("UNAVAILABLE");
    const rows = data as unknown as ConnectedOffer[];
    const offers = rows.slice(0, 20);
    const last = offers.at(-1);
    return reply({ ok: true, memberId: user.id, listing, offers, next: rows.length > 20 && last ? { before: last.created_at, beforeId: last.id } : null });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = offerCommandSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const input = parsed.data;
    const { data, error } = await client.rpc("save_offer", { p_operation_id: input.operationId, p_offer_id: input.offerId, p_listing_id: input.listingId, p_version: input.version, p_listing_version: input.listingVersion, p_fee: input.fee, p_action: input.action });
    if (error) return commandFailure(error);
    return reply({ ok: true, offerId: data });
  } catch (error) { return boundaryFailure(error); }
}
