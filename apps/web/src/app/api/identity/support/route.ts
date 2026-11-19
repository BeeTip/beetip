import { supportCommandSchema, supportInputSchema, supportQuerySchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

function supportFailure(error: { message: string }) {
  if (error.message.startsWith("THROTTLED:")) {
    return reply({ ok: false, code: "THROTTLED", message: "Batas pengiriman tercapai. Tunggu lalu coba lagi dengan pesan yang sama." }, 429);
  }
  return commandFailure(error);
}

export async function GET(request: Request) {
  try {
    const query = supportQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const input = query.data;
    if (input.case) {
      const { data, error } = await client.rpc("btp09_history", {
        p_case: input.case, p_before: input.before, p_order_history: input.history === "order",
      });
      if (error) return supportFailure(error);
      return reply({ ok: true, memberId: user.id, thread: data });
    }
    if (input.view) {
      const { data, error } = await client.rpc("btp09_cases", { p_before: input.queueBefore, p_before_id: input.queueBeforeId });
      if (error) return supportFailure(error);
      return reply({ ok: true, memberId: user.id, workspace: data });
    }
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
    const body = await mutationBody(request);
    const legacy = supportInputSchema.safeParse(body);
    const command = supportCommandSchema.safeParse(body);
    if (!legacy.success && !command.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const expectedMember = request.headers.get("X-Beetip-Member");
    if (expectedMember !== null && expectedMember !== user.id) {
      return reply({ ok: false, code: "SESSION_CHANGED", message: "Sesi berubah. Masuk kembali." }, 403);
    }
    if (command.success && expectedMember === null) throw new Error("PERMISSION");
    if (legacy.success) {
      const { data, error } = await client.rpc("open_support", { p_operation_id: legacy.data.operationId, p_body: legacy.data.body });
      if (error) return supportFailure(error);
      return reply({ ok: true, memberId: user.id, conversationId: data });
    }
    if (!command.success) throw new Error("VALIDATION");
    const input = command.data;
    switch (input.action) {
      case "open": {
        const { data, error } = await client.rpc("btp09_open", {
          p_operation: input.operationId, p_body: input.body, p_category: input.category, p_order: input.order,
        });
        if (error) return supportFailure(error);
        return reply({ ok: true, memberId: user.id, conversationId: data });
      }
      case "send": {
        const { data, error } = await client.rpc("btp09_send", { p_case: input.caseId, p_client: input.clientId, p_body: input.body });
        if (error) return supportFailure(error);
        return reply({ ok: true, memberId: user.id, message: data });
      }
      case "read": {
        const { error } = await client.rpc("btp09_read", { p_case: input.caseId, p_sequence: input.sequence });
        if (error) return supportFailure(error);
        break;
      }
      default: {
        const { error } = await client.rpc("btp09_act", {
          p_case: input.caseId, p_action: input.action, p_version: input.version,
          p_assignee: "assignee" in input ? input.assignee : undefined,
          p_reason: "reason" in input ? input.reason : undefined,
        });
        if (error) return supportFailure(error);
      }
    }
    return reply({ ok: true, memberId: user.id });
  } catch (error) { return boundaryFailure(error); }
}
