import { demoPaymentSchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../../server/identity/protected";

export async function POST(request: Request) {
  try {
    const parsed = demoPaymentSchema.safeParse(await mutationBody(request, 1024));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const { error } = await client.rpc("confirm_booth_payment", { p_order: parsed.data.orderId });
    if (error?.message === "CONFLICT: Reservation expired or unavailable") {
      return reply({ ok: false, code: "CONFLICT", message: "Reservasi sudah berakhir. Perbarui status pesanan." }, 409);
    }
    return error ? commandFailure(error) : reply({ ok: true });
  } catch (error) { return boundaryFailure(error); }
}
