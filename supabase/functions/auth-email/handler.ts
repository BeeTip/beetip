type Config = {
  secret: string;
  apiKey: string;
  sender: string;
  recipients: Set<string>;
};

type Verify = (body: string, headers: Record<string, string>) => unknown;
const origin = "https://beetip-campus.vercel.app";
const project = "https://rgiptdfjlmwldngapojq.supabase.co";

export function authEmailConfig(get: (name: string) => string | undefined): Config {
  const secret = get("BEETIP_AUTH_HOOK_SECRET");
  const apiKey = get("BEETIP_BREVO_AUTH_API_KEY");
  const sender = get("BEETIP_AUTH_EMAIL_FROM");
  let values: unknown;
  try { values = JSON.parse(get("BEETIP_AUTH_EMAIL_RECIPIENTS") ?? "null"); }
  catch { throw new Error("Auth mail configuration is invalid"); }
  if (!secret || !apiKey || !sender || !Array.isArray(values) || !values.length || values.length > 50) throw new Error("Auth mail configuration is missing");
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.test(sender) || values.some(value => typeof value !== "string" || !email.test(value))) throw new Error("Auth mail configuration is invalid");
  return { secret, apiKey, sender, recipients: new Set(values.map(value => value.toLowerCase())) };
}

function reply(status: number, message?: string) {
  return Response.json(message ? { error: { http_code: status, message } } : {}, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function createAuthEmailHandler(config: Config, verify: Verify, transport: typeof fetch = fetch) {
  return async (request: Request) => {
    if (request.method !== "POST") return reply(405, "Method not allowed");
    let payload: unknown;
    try {
      const body = await boundedBody(request);
      if (body === null) return reply(413, "Payload too large");
      payload = verify(body, Object.fromEntries(request.headers));
    } catch { return reply(401, "Invalid webhook signature"); }
    const envelope = record(payload);
    const user = record(envelope?.user);
    const data = record(envelope?.email_data);
    const recipient = typeof user?.email === "string" ? user.email.toLowerCase() : "";
    if (!config.recipients.has(recipient)) return reply(403, "Recipient is not approved for staging");
    const action = data?.email_action_type;
    if (action !== "signup" && action !== "recovery") return reply(403, "Email action is not enabled for staging");
    if (typeof data?.token_hash !== "string" || !/^[a-zA-Z0-9_-]{16,512}$/.test(data.token_hash)) return reply(400, "Invalid Auth email payload");
    if (typeof data.redirect_to !== "string") return reply(400, "Invalid Auth email redirect");
    let redirect: URL;
    try { redirect = new URL(data.redirect_to); } catch { return reply(400, "Invalid Auth email redirect"); }
    const next = redirect.searchParams.get("next");
    if (redirect.origin !== origin || redirect.username || redirect.password || redirect.pathname !== "/auth/callback" || redirect.hash
      || [...redirect.searchParams.keys()].some(key => key !== "next") || redirect.searchParams.getAll("next").length > 1
      || (action === "recovery" ? next !== "/auth/password" : next !== null)) return reply(400, "Invalid Auth email redirect");
    const link = new URL("/auth/v1/verify", project);
    link.searchParams.set("token", data.token_hash);
    link.searchParams.set("type", action);
    link.searchParams.set("redirect_to", redirect.href);
    const subject = action === "signup" ? "Confirm your email address" : "Reset your password";
    const label = action === "signup" ? "Confirm email address" : "Reset password";
    try {
      const response = await transport("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": config.apiKey, "Content-Type": "application/json" },
        redirect: "error",
        body: JSON.stringify({ sender: { name: "BeeTip", email: config.sender }, to: [{ email: recipient }], subject,
          textContent: `${subject}\n\n${link.href}`,
          htmlContent: `<h2>${subject}</h2><p><a href="${link.href.replaceAll("&", "&amp;")}">${label}</a></p>` }),
        signal: AbortSignal.timeout(3500),
      });
      if (!response.ok) return reply(503, "Auth email is temporarily unavailable");
    } catch { return reply(503, "Auth email is temporarily unavailable"); }
    return reply(200);
  };
}
