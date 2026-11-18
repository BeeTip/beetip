import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import { authEmailConfig, createAuthEmailHandler } from "../../../supabase/functions/auth-email/handler";

const secret = Buffer.from("a-test-hook-signing-secret-with-32-bytes").toString("base64");
const env: Record<string, string> = {
  BEETIP_AUTH_HOOK_SECRET: `v1,whsec_${secret}`,
  BEETIP_BREVO_AUTH_API_KEY: "test-brevo-key",
  BEETIP_AUTH_EMAIL_FROM: "sender@example.test",
  BEETIP_AUTH_EMAIL_RECIPIENTS: JSON.stringify(["approved@example.test"]),
};
const config = authEmailConfig(name => env[name]);
const webhook = new Webhook(secret);
const payload = {
  user: { email: "approved@example.test" },
  email_data: { email_action_type: "signup", token_hash: "a".repeat(56), site_url: "https://beetip-campus.vercel.app", redirect_to: "https://beetip-campus.vercel.app/auth/callback" },
};

function signed(body: unknown = payload, timestamp = new Date()) {
  const text = JSON.stringify(body);
  const id = randomUUID();
  return new Request("https://hook.example.test", { method: "POST", body: text, headers: {
    "webhook-id": id, "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)), "webhook-signature": webhook.sign(id, timestamp, text),
  } });
}

function setup() {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 201 }));
  return { transport, handler: createAuthEmailHandler(config, (text, headers) => webhook.verify(text, headers), transport) };
}

describe("staging Auth email hook", () => {
  it("sends a verified approved signup to the fixed provider and development callback", async () => {
    const { handler, transport } = setup();
    expect((await handler(signed())).status).toBe(200);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(options?.redirect).toBe("error");
    const body = JSON.parse(String(options?.body));
    expect(body.to).toEqual([{ email: "approved@example.test" }]);
    expect(body.textContent).toContain("https://rgiptdfjlmwldngapojq.supabase.co/auth/v1/verify?");
    expect(body.textContent).toContain("type=signup");
    expect(body.htmlContent).toContain("&amp;");
  });

  it("constructs links from the fixed project without trusting the hook site_url", async () => {
    for (const site_url of ["https://rgiptdfjlmwldngapojq.supabase.co/auth/v1", "https://unrelated.example.test/?token=untrusted"]) {
      const { handler, transport } = setup();
      expect((await handler(signed({ ...payload, email_data: { ...payload.email_data, site_url } }))).status).toBe(200);
      const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
      const link = new URL(body.textContent.split("\n\n")[1]);
      expect(link.origin).toBe("https://rgiptdfjlmwldngapojq.supabase.co");
      expect(link.pathname).toBe("/auth/v1/verify");
      expect(body.textContent).not.toContain("untrusted");
    }
  });

  it("normalizes recipient case and sends recovery to the password callback", async () => {
    const { handler, transport } = setup();
    const input = { user: { email: "APPROVED@EXAMPLE.TEST" }, email_data: { ...payload.email_data, email_action_type: "recovery", redirect_to: "https://beetip-campus.vercel.app/auth/callback?next=/auth/password" } };
    expect((await handler(signed(input))).status).toBe(200);
    const body = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(body.to[0].email).toBe("approved@example.test");
    expect(body.subject).toBe("Reset your password");
    const link = new URL(body.textContent.split("\n\n")[1]);
    expect(new URL(link.searchParams.get("redirect_to")!).searchParams.get("next")).toBe("/auth/password");
  });

  it("rejects an unapproved recipient before contacting Brevo", async () => {
    const { handler, transport } = setup();
    expect((await handler(signed({ ...payload, user: { email: "unapproved@example.test" } }))).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });

  it("does not send email changes, invitations, or notification actions", async () => {
    const { handler, transport } = setup();
    for (const action of ["email_change", "invite", "magiclink", "password_changed_notification"]) {
      expect((await handler(signed({ user: { ...payload.user, new_email: "unapproved@example.test" }, email_data: { ...payload.email_data, email_action_type: action } }))).status).toBe(403);
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects missing signatures, altered payloads, and expired signed requests", async () => {
    const { handler, transport } = setup();
    expect((await handler(new Request("https://hook.example.test", { method: "POST", body: JSON.stringify(payload) }))).status).toBe(401);
    const original = signed();
    expect((await handler(new Request(original.url, { method: "POST", headers: original.headers, body: JSON.stringify({ ...payload, user: { email: "attacker@example.test" } }) }))).status).toBe(401);
    expect((await handler(signed(payload, new Date(Date.now() - 600000)))).status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects arbitrary origins, callback paths, duplicate parameters, and token injection", async () => {
    const { handler, transport } = setup();
    const variants = [
      { redirect_to: "https://unrelated.example.test/auth/callback" },
      { redirect_to: "https://beetip-campus.vercel.app/admin" },
      { redirect_to: "https://user:password@beetip-campus.vercel.app/auth/callback" },
      { redirect_to: "https://beetip-campus.vercel.app/auth/callback?next=/account&next=/auth/password" },
      { token_hash: "token&redirect_to=https://unrelated.example.test" },
    ];
    for (const change of variants) expect((await handler(signed({ ...payload, email_data: { ...payload.email_data, ...change } }))).status).toBe(400);
    expect(transport).not.toHaveBeenCalled();
  });

  it("bounds unauthenticated bodies and disallows other methods", async () => {
    const { handler, transport } = setup();
    expect((await handler(new Request("https://hook.example.test"))).status).toBe(405);
    expect((await handler(new Request("https://hook.example.test", { method: "POST", body: "x".repeat(65537) }))).status).toBe(413);
    expect(transport).not.toHaveBeenCalled();
  });

  it("fails closed on malformed signed data or missing recipient configuration", async () => {
    const { handler, transport } = setup();
    for (const input of [null, {}, { user: null }, { user: payload.user, email_data: null }]) expect((await handler(signed(input))).status).toBeGreaterThanOrEqual(400);
    expect(transport).not.toHaveBeenCalled();
    for (const change of [{ BEETIP_AUTH_EMAIL_RECIPIENTS: "[]" }, { BEETIP_AUTH_EMAIL_RECIPIENTS: '["bad-address"]' }, { BEETIP_AUTH_EMAIL_RECIPIENTS: "invalid JSON" }, { BEETIP_AUTH_HOOK_SECRET: "" }]) {
      const changed: Record<string, string | undefined> = { ...env, ...change };
      expect(() => authEmailConfig(name => changed[name])).toThrow();
    }
  });

  it("reports provider failures without exposing credentials or retrying the send", async () => {
    for (const response of [new Response(null, { status: 302, headers: { Location: "https://unrelated.example.test" } }), new Response("provider detail", { status: 429 }), new Response("provider detail", { status: 500 })]) {
      const { handler, transport } = setup();
      transport.mockResolvedValue(response);
      const result = await handler(signed());
      expect(result.status).toBe(503);
      expect(await result.text()).not.toMatch(/test-brevo-key|provider detail/);
      expect(transport).toHaveBeenCalledTimes(1);
    }
    const { handler, transport } = setup();
    transport.mockRejectedValue(new Error("sensitive provider failure"));
    const result = await handler(signed());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain("sensitive");
  });
});
