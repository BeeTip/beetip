import { notificationCommandSchema } from "@beetip/validation";
import { boundaryFailure, reply } from "../../../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../../../server/identity/protected";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsed = notificationCommandSchema.safeParse({ action: "read", id: (await params).id });
    if (!parsed.success || parsed.data.action !== "read") throw new Error("VALIDATION");
    const { client } = await protectedClient();
    const { data, error } = await client.rpc("notification_target", { p_id: parsed.data.id });
    if (error) return commandFailure(error);
    if (!data.startsWith("/") || data.startsWith("//")) throw new Error("UNAVAILABLE");
    return reply({ ok: true, target: data });
  } catch (error) { return boundaryFailure(error); }
}
