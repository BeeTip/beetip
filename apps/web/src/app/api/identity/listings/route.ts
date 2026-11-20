import { listingCommandSchema, ownListingQuerySchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";
import { ownListing } from "../../../../server/listings";

export async function GET(request: Request) {
  try {
    const parsed = ownListingQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const { id, before, beforeId } = parsed.data;
    let query = client.from("listings").select("*").eq("owner_id", user.id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(21);
    if (id) query = query.eq("id", id);
    if (before && beforeId) query = query.or(`created_at.lt.${before},and(created_at.eq.${before},id.lt.${beforeId})`);
    const { data, error } = await query;
    if (error) throw new Error("UNAVAILABLE");
    const listings = data.slice(0, 20).map(ownListing);
    const last = listings.at(-1);
    return reply({ ok: true, memberId: user.id, listings, next: data.length > 20 && last ? { before: last.created_at, beforeId: last.id } : null });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = listingCommandSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const input = parsed.data;
    if (input.version === 0 && input.listing.status !== "active") throw new Error("VALIDATION");
    if (input.listing.status !== "closed" && input.listing.negotiable) throw new Error("VALIDATION");
    const { data, error } = await client.rpc("save_listing", { p_operation_id: input.operationId, p_listing_id: input.listingId, p_version: input.version, p_listing: input.listing });
    if (error) return commandFailure(error);
    return reply({ ok: true, listingId: data });
  } catch (error) { return boundaryFailure(error); }
}
