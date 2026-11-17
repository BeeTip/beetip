import { supportInputSchema } from "@beetip/validation";
import { identityClient } from "../../../../server/identity/client";
import { mode } from "../../../../server/identity/config";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";

export async function GET() {
  try {
    if (mode() !== "connected") throw new Error("UNAVAILABLE");
    const client = await identityClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user || !user.email_confirmed_at || user.is_anonymous) return reply({ ok: false, message: "Masuk untuk membuka bantuan." }, 401);
    const { data: member } = await client.from("members").select("status").eq("id", user.id).single();
    if (!member || member.status === "suspended") throw new Error("PERMISSION");
    const { data, error: queryError } = await client.from("conversations")
      .select("id,status,created_at,messages(id,sequence,sender_id,body,created_at)")
      .eq("kind", "support").order("created_at", { ascending: false }).limit(20)
      .order("sequence", { referencedTable: "messages", ascending: true }).limit(50, { referencedTable: "messages" });
    if (queryError) throw new Error("UNAVAILABLE");
    return reply({ ok: true, memberId: user.id, threads: data });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const input = supportInputSchema.safeParse(await mutationBody(request));
    if (!input.success) throw new Error("VALIDATION");
    const client = await identityClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user || !user.email_confirmed_at || user.is_anonymous) return reply({ ok: false, message: "Masuk untuk mengirim bantuan." }, 401);
    const { data, error: commandError } = await client.rpc("open_support", { p_operation_id: input.data.operationId, p_body: input.data.body });
    if (commandError) {
      const code = ["VALIDATION", "PERMISSION", "CONFLICT"].find(value => commandError.message.startsWith(value));
      if (code) return reply({ ok: false, code, message: code === "CONFLICT" ? "Permintaan sudah digunakan untuk pesan lain. Muat ulang sebelum mengirim pesan baru." : code === "PERMISSION" ? "Akses bantuan tidak diizinkan." : "Periksa pesan bantuan." }, code === "CONFLICT" ? 409 : code === "PERMISSION" ? 403 : 400);
      throw new Error("UNAVAILABLE");
    }
    return reply({ ok: true, conversationId: data });
  } catch (error) { return boundaryFailure(error); }
}
