import { boardQuerySchema, type PublicListing } from "@beetip/validation";
import { identityClient } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";
import { boundaryFailure, reply } from "../../../server/identity/http";

export async function GET(request: Request) {
  try {
    if (mode() !== "connected" || !identityConfigured()) throw new Error("UNAVAILABLE");
    const parsed = boardQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const query = parsed.data;
    const client = await identityClient();
    const { data, error } = await client.rpc("browse_listings", { p_type: query.type, p_category: query.category, p_search: query.search, p_day: query.date, p_before: query.before, p_before_id: query.beforeId, p_id: query.id });
    if (error) throw new Error("UNAVAILABLE");
    const rows = data as unknown as PublicListing[];
    const listings = rows.slice(0, 20);
    const last = listings.at(-1);
    return reply({ ok: true, listings, next: rows.length > 20 && last ? { before: last.created_at, beforeId: last.id } : null });
  } catch (error) { return boundaryFailure(error); }
}
