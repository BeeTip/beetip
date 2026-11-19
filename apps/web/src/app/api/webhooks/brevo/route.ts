import { emailJobClient, type WebhookEvent } from "../../../../server/email/job-client";
import { addressHash, authorized, emailAddress, providerId, verifiedDispatch } from "../../../../server/email/security";

export const runtime = "nodejs";
export const maxDuration = 10;

const events: ReadonlyMap<string, WebhookEvent> = new Map([
  ["request", "accepted"],
  ["delivered", "delivered"],
  ["hard_bounce", "hard_bounce"], ["hardBounce", "hard_bounce"],
  ["soft_bounce", "soft_bounce"], ["softBounce", "soft_bounce"],
  ["blocked", "blocked"], ["invalid", "invalid"], ["invalid_email", "invalid"],
  ["spam", "spam"], ["unsubscribed", "unsubscribed"],
]);

async function readEvent(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let content = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        return null;
      }
      content += decoder.decode(value, { stream: true });
    }
    const data = JSON.parse(content + decoder.decode());
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function correlationTag(data: Record<string, unknown>) {
  let tags: unknown = data.tags ?? data.tag;
  if (typeof tags === "string") {
    try { tags = JSON.parse(tags); } catch { return undefined; }
  }
  return Array.isArray(tags)
    ? tags.find((value): value is string => typeof value === "string" && value.startsWith("btp11-"))
    : undefined;
}

export async function POST(request: Request) {
  if (!authorized(request, process.env.BEETIP_EMAIL_WEBHOOK_TOKEN)) return new Response(null, { status: 401 });
  const secrets = [process.env.BEETIP_EMAIL_TAG_SECRET, process.env.BEETIP_EMAIL_PREVIOUS_TAG_SECRET]
    .filter((secret): secret is string => !!secret && secret.length >= 32);
  if (!secrets.length) return new Response(null, { status: 503 });

  const data = await readEvent(request);
  if (!data) return new Response(null, { status: 400 });
  const tag = correlationTag(data);
  const event = typeof data.event === "string" ? events.get(data.event) : undefined;
  if (!tag || !event) return new Response(null, { status: 204 });
  const messageId = providerId(data["message-id"]);
  if (!messageId || typeof data.email !== "string" || data.email.length > 254 || !emailAddress.test(data.email.trim())) {
    return new Response(null, { status: 400 });
  }
  const hash = addressHash(data.email);
  const dispatch = verifiedDispatch(tag, hash, secrets);
  if (!dispatch) return new Response(null, { status: 401 });

  try {
    await emailJobClient().webhook(dispatch, hash, messageId, event);
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
