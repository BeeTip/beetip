import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as runWorker } from "../../app/api/jobs/transactional-email/route";
import { POST as receiveWebhook } from "../../app/api/webhooks/brevo/route";
import { proxy } from "../../proxy";
import { addressHash, dispatchTag } from "./security";

vi.mock("server-only", () => ({}));

const token = "fixture-token-set-for-local-tests-only";
const signingKey = "fixture-signing-key-set-for-local-tests";
const address = "approved@example.invalid";
const dispatchId = "f0000000-0000-4000-8000-000000000001";
const localOrigin = "http://127.0.0.1:3107";
const supabaseUrl = "http://127.0.0.1:54921";
const brevoUrl = "https://api.brevo.com/v3/smtp/email";
const rpc = (name: string) => `${supabaseUrl}/rest/v1/rpc/btp11_${name}`;
const claim = { id: dispatchId, lease_token: "f0000000-0000-4000-8000-000000000002" };

function config() {
  vi.stubEnv("APP_ORIGIN", localOrigin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl);
  vi.stubEnv("BEETIP_EMAIL_SUPABASE_SECRET_KEY", "sb_secret_fixture");
  vi.stubEnv("BEETIP_EMAIL_ENABLED", "true");
  vi.stubEnv("BEETIP_EMAIL_AUDIENCE", "allowlist");
  vi.stubEnv("BEETIP_EMAIL_RECIPIENTS", `  ${address.toUpperCase()}  `);
  vi.stubEnv("BEETIP_EMAIL_FROM", "bee@example.invalid");
  vi.stubEnv("BEETIP_EMAIL_BREVO_API_KEY", "fixture-provider-key");
  vi.stubEnv("BEETIP_EMAIL_TAG_SECRET", signingKey);
  vi.stubEnv("BEETIP_EMAIL_JOBS_SECRET", token);
  vi.stubEnv("BEETIP_EMAIL_WEBHOOK_TOKEN", token);
}

function request(body: unknown, authorization = `Bearer ${token}`) {
  return new Request("https://ignored.example.invalid", { method: "POST", headers: { authorization }, body: JSON.stringify(body) });
}

function mockTransport(provider: () => Response, skip = false) {
  const transport = vi.fn(async (url: string, options: RequestInit) => {
    if (url === brevoUrl) return provider();
    expect(options.headers).toEqual({ apikey: "sb_secret_fixture", "Content-Type": "application/json" });
    if (url === rpc("claim")) return Response.json([claim]);
    if (url === rpc("prepare")) return Response.json(skip ? null : { address, dispatchId });
    if (url === rpc("finish")) return Response.json(true);
    if (url === rpc("heartbeat") || url === rpc("webhook")) return new Response(null, { status: 204 });
    throw new Error("Unexpected mock request");
  });
  vi.stubGlobal("fetch", transport);
  return transport;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("transactional email routes", () => {
  it("allows the exact routes through the connected-mode proxy", async () => {
    vi.stubEnv("BEETIP_MODE", "connected");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    for (const path of ["/api/jobs/transactional-email", "/api/webhooks/brevo", "/account/email-operations"]) {
      expect((await proxy(new NextRequest(`${localOrigin}${path}`))).headers.get("location")).toBeNull();
    }
    expect((await proxy(new NextRequest(`${localOrigin}/api/jobs/other`))).status).toBe(307);
  });

  it("rejects unauthorized requests and fails closed without a staging list", async () => {
    config();
    const transport = mockTransport(() => { throw new Error("Unexpected send"); });
    expect((await runWorker(request({}, "Bearer wrong"))).status).toBe(401);
    vi.stubEnv("BEETIP_EMAIL_RECIPIENTS", "");
    expect((await runWorker(request({}))).status).toBe(503);
    expect(transport).not.toHaveBeenCalled();
  });

  it("dispatches only the prepared recipient, fixed content and fixed RPCs", async () => {
    config();
    const transport = mockTransport(() => Response.json({ messageId: "<provider@example.invalid>" }, { status: 201 }));
    expect((await runWorker(request({ rpc: "arbitrary", to: "other@example.invalid", body: "PRIVATE MARKER" }))).status).toBe(200);
    expect(transport.mock.calls.map(([url]) => url)).toEqual([rpc("claim"), rpc("prepare"), brevoUrl, rpc("finish"), rpc("heartbeat")]);
    const payload = (index: number) => JSON.parse(String(transport.mock.calls[index][1].body));
    expect(payload(1).p_allowlist).toEqual([addressHash(address)]);
    expect(payload(2)).toMatchObject({
      to: [{ email: address, contactPixelTrackingConsent: false }],
      headers: { IdempotencyKey: dispatchId },
      tags: [dispatchTag(dispatchId, addressHash(address), signingKey), `beetip-email-${dispatchId}`],
    });
    expect(payload(2).textContent).toContain(`${localOrigin}/account/notifications`);
    expect(JSON.stringify(payload(2))).not.toMatch(/PRIVATE MARKER|other@example|ignored\.example/);
    expect(payload(3)).toMatchObject({ p_outcome: "accepted", p_provider_id: "provider@example.invalid" });
  });

  it("skips suppressed submissions without contacting Brevo", async () => {
    config();
    const transport = mockTransport(() => { throw new Error("Unexpected send"); }, true);
    expect((await runWorker(request({}))).status).toBe(200);
    expect(transport.mock.calls.map(([url]) => url)).toEqual([rpc("claim"), rpc("prepare"), rpc("heartbeat")]);
  });

  it.each([
    ["rate_limited", 429, { "Retry-After": "333" }, {}, 333],
    ["duplicate_key", 400, {}, { code: "duplicate_parameter" }, 0],
    ["rejected", 400, {}, { code: "invalid_parameter" }, 0],
    ["transport_uncertain", 502, {}, {}, 0],
    ["transport_uncertain", 201, {}, {}, 0],
  ] as const)("records %s without forwarding provider diagnostics", async (outcome, status, headers, body, delay) => {
    config();
    const transport = mockTransport(() => Response.json({ ...body, message: "PRIVATE DIAGNOSTIC" }, { status, headers }));
    expect((await runWorker(request({}))).status).toBe(200);
    const finish = JSON.parse(String(transport.mock.calls[3][1].body));
    expect(finish).toMatchObject({ p_outcome: outcome, p_provider_id: null, p_retry_seconds: delay });
    expect(JSON.stringify(finish)).not.toContain("PRIVATE DIAGNOSTIC");
  });

  it("quarantines a provider timeout", async () => {
    config();
    const transport = mockTransport(() => { throw new DOMException("Timeout", "TimeoutError"); });
    expect((await runWorker(request({}))).status).toBe(200);
    expect(JSON.parse(String(transport.mock.calls[3][1].body))).toMatchObject({ p_outcome: "transport_uncertain" });
  });

  it("authenticates the callback and binds its signed tag to the address", async () => {
    config();
    const transport = mockTransport(() => { throw new Error("Unexpected send"); });
    const payload = {
      event: "hard_bounce", id: 99, email: address, "message-id": "<provider@example.invalid>",
      tags: [dispatchTag(dispatchId, addressHash(address), signingKey)], reason: "PRIVATE DIAGNOSTIC",
    };
    expect((await receiveWebhook(request(payload, ""))).status).toBe(401);
    expect((await receiveWebhook(request({ ...payload, email: "changed@example.invalid" }))).status).toBe(401);
    expect((await receiveWebhook(request({ ...payload, padding: "x".repeat(16384) }))).status).toBe(400);
    expect((await receiveWebhook(request({ ...payload, tags: [] }))).status).toBe(204);
    expect(transport).not.toHaveBeenCalled();
    expect((await receiveWebhook(request(payload))).status).toBe(204);
    expect((await receiveWebhook(request({ ...payload, event: "request", tags: undefined, tag: JSON.stringify(payload.tags) }))).status).toBe(204);
    expect(JSON.parse(String(transport.mock.calls[0][1].body))).toEqual({
      p_dispatch: dispatchId, p_address_hash: addressHash(address), p_provider_id: "provider@example.invalid", p_event: "hard_bounce",
    });
    expect(JSON.parse(String(transport.mock.calls[1][1].body))).toMatchObject({ p_event: "accepted" });
  });
});
