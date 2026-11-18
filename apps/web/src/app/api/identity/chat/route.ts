import { chatCommandSchema, chatQuerySchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

function failure(error: { message: string }) {
  if (error.message.startsWith("THROTTLED:")) return reply({ ok: false, code: "THROTTLED", message: "Batas pesan per menit atau jam tercapai. Tunggu sebelum mencoba lagi; pesanmu belum terkirim." }, 429);
  return commandFailure(error);
}

export async function GET(request: Request) {
  try {
    const parsed = chatQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const { data, error } = await client.rpc("btp08_history", { p_order: parsed.data.order, p_before: parsed.data.before, p_after: parsed.data.after });
    if (error) return failure(error);
    return reply({ ok: true, memberId: user.id, page: data });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = chatCommandSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const input = parsed.data;
    const { data, error } = input.action === "send"
      ? await client.rpc("btp08_send", { p_order: input.order, p_client: input.clientId, p_body: input.body })
      : await client.rpc("btp08_read", { p_order: input.order, p_sequence: input.sequence });
    if (error) return failure(error);
    return reply({ ok: true, memberId: user.id, message: data });
  } catch (error) { return boundaryFailure(error); }
}
