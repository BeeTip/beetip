import { orderRatingCommandSchema, orderRatingQuerySchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

export async function GET(request: Request) {
  try {
    const parsed = orderRatingQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const { data, error } = await client.rpc("read_order_rating", { p_order_id: parsed.data.orderId });
    if (error) return commandFailure(error);
    return reply({ ok: true, memberId: user.id, rating: data });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = orderRatingCommandSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const input = parsed.data;
    const { data, error } = await client.rpc("submit_order_rating", {
      p_operation_id: input.operationId, p_order_id: input.orderId, p_score: input.score, p_feedback: input.feedback,
    });
    if (error?.message === "CONFLICT: Rating already submitted") {
      return reply({ ok: false, code: "ALREADY_RATED", message: "Penilaian sudah dikirim. Muat ulang penilaian." }, 409);
    }
    if (error?.message === "CONFLICT: Order is not eligible for rating") {
      return reply({ ok: false, code: "CONFLICT", message: "Pesanan belum dapat dinilai. Perbarui status pesanan." }, 409);
    }
    if (error) return commandFailure(error);
    return reply({ ok: true, memberId: user.id, rating: data });
  } catch (error) { return boundaryFailure(error); }
}
