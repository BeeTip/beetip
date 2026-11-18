import { affiliationInputSchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

export async function GET() {
  try {
    const { client, user } = await protectedClient();
    const fields = "id,member_id,institution,status,decision_code,created_at";
    const [own, queue] = await Promise.all([
      client.from("affiliation_requests").select(fields).eq("member_id", user.id).order("created_at", { ascending: false }).limit(20),
      client.from("affiliation_requests").select(fields).neq("member_id", user.id).eq("status", "pending").order("created_at", { ascending: true }).order("id").limit(50),
    ]);
    if (own.error || queue.error) throw new Error("UNAVAILABLE");
    return reply({ ok: true, memberId: user.id, requests: [...own.data, ...queue.data] });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = affiliationInputSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client } = await protectedClient();
    const input = parsed.data;
    const { data, error } = await client.rpc("affiliation_command", { p_operation_id: input.operationId, p_action: input.action, p_request_id: input.requestId, p_value: input.value });
    if (error) return commandFailure(error);
    return reply({ ok: true, requestId: data });
  } catch (error) { return boundaryFailure(error); }
}
