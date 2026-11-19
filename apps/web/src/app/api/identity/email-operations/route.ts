import { uuid } from "../../../../server/email/security";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

export async function POST(request: Request) {
  try {
    const body = await mutationBody(request);
    if (!body || typeof body !== "object" || Object.keys(body).length !== 3) throw new Error("VALIDATION");
    const { id, dispatch, action } = body;
    if (typeof id !== "string" || !uuid.test(id) || typeof dispatch !== "string" || !uuid.test(dispatch)
      || !["replay", "reconciled_replay", "close"].includes(action)) throw new Error("VALIDATION");

    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const { error } = await client.rpc("btp11_operator_action", { p_id: id, p_dispatch: dispatch, p_action: action });
    if (error) return commandFailure(error);
    return reply({ ok: true });
  } catch (error) {
    return boundaryFailure(error);
  }
}
