import { chatCommandSchema, chatQuerySchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

// Temporary narrow RPC interface until the parent regenerates database types.
type ChatRpc = (name: "btp08_history" | "btp08_send" | "btp08_read", args: Record<string, string | number | null>) => Promise<{ data: unknown; error: { message: string } | null }>;

function failure(error: { message: string }) {
  if (error.message.startsWith("THROTTLED:")) return reply({ ok: false, code: "THROTTLED", retryAfter: 60, message: "Batas pesan tercapai. Tunggu 60 detik lalu coba lagi." }, 429);
  return commandFailure(error);
}

export async function GET(request: Request) {
  try {
    const parsed = chatQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const rpc = client.rpc.bind(client) as unknown as ChatRpc;
    const { data, error } = await rpc("btp08_history", { p_order: parsed.data.order, p_before: parsed.data.before ?? null, p_after: parsed.data.after ?? null });
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
    const rpc = client.rpc.bind(client) as unknown as ChatRpc;
    const input = parsed.data;
    const { data, error } = input.action === "send"
      ? await rpc("btp08_send", { p_order: input.order, p_client: input.clientId, p_body: input.body })
      : await rpc("btp08_read", { p_order: input.order, p_sequence: input.sequence });
    if (error) return failure(error);
    return reply({ ok: true, memberId: user.id, message: data });
  } catch (error) { return boundaryFailure(error); }
}
