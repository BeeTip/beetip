import { notificationCommandSchema, notificationQuerySchema, type InboxNotification } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

export async function GET(request: Request) {
  try {
    const parsed = notificationQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    const { data, error } = await client.rpc("notification_inbox", { p_before: parsed.data.before, p_before_id: parsed.data.beforeId });
    if (error) return commandFailure(error);
    const result = data as { items: InboxNotification[]; unread: number };
    const items = result.items.slice(0, 20);
    const last = items.at(-1);
    return reply({ ok: true, memberId: user.id, items, unread: result.unread,
      next: result.items.length > 20 && last ? { before: last.created_at, beforeId: last.id } : null });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = notificationCommandSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const { error } = await client.rpc("read_notification", { p_id: parsed.data.id });
    if (error) return commandFailure(error);
    return reply({ ok: true });
  } catch (error) { return boundaryFailure(error); }
}
