import { moderationCommandSchema, moderationQuerySchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

const conflicts: Record<string, string> = {
  "CONFLICT: Stale listing version": "Listing sudah berubah. Muat ulang sebelum menyimpan.",
  "CONFLICT: Listing already has this moderation status": "Status listing sudah sesuai.",
  "CONFLICT: Use a future schedule within 90 days": "Pemilik perlu memperbarui jadwal sebelum listing dibuka kembali.",
  "CONFLICT: Listing owner unavailable": "Akun pemilik belum dapat membuka listing.",
  "CONFLICT: Customer or spending capacity full": "Kuota pesanan atau kapasitas belanja masih penuh.",
  "CONFLICT: Request already accepted": "Permintaan ini sudah memiliki pesanan.",
};

export async function GET(request: Request) {
  try {
    const parsed = moderationQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const { data, error } = await client.rpc("listing_moderation_queue", { p_search: parsed.data.search });
    if (error) return commandFailure(error);
    return reply({ ok: true, memberId: user.id, listings: data });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = moderationCommandSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const input = parsed.data;
    const { error } = await client.rpc("moderate_listing", {
      p_operation_id: input.operationId, p_listing_id: input.listingId, p_version: input.version,
      p_status: input.status, p_reason: input.reason,
    });
    const message = error && conflicts[error.message];
    if (message) return reply({ ok: false, code: "CONFLICT", message }, 409);
    if (error) return commandFailure(error);
    return reply({ ok: true, memberId: user.id });
  } catch (error) { return boundaryFailure(error); }
}
