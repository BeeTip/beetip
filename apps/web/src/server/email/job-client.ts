import "server-only";
import { trustedOrigin } from "@beetip/validation";
import type { SendResult } from "./brevo";

export type Claim = { id: string; lease_token: string };
type Submission = { address: string; dispatchId: string };
export type WebhookEvent = "accepted" | "delivered" | "hard_bounce" | "soft_bounce" | "blocked" | "invalid" | "spam" | "unsubscribed";

export function emailJobClient() {
  const url = trustedOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  const configuredKey = process.env.BEETIP_EMAIL_SUPABASE_SECRET_KEY;
  if (!configuredKey?.startsWith("sb_secret_")) throw new Error("Email database unavailable");
  const key = configuredKey;

  async function rpc<Result>(
    name: "btp11_claim" | "btp11_prepare" | "btp11_finish" | "btp11_webhook" | "btp11_heartbeat",
    args: Record<string, unknown> = {},
  ): Promise<Result> {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error("Email database unavailable");
    if (response.status === 204) return undefined as Result;
    return response.json() as Promise<Result>;
  }

  return {
    claim: () => rpc<Claim[]>("btp11_claim"),
    prepare: (claim: Claim, allowlist: string[] | null) => rpc<Submission | null>("btp11_prepare", {
      p_id: claim.id, p_lease: claim.lease_token, p_allowlist: allowlist,
    }),
    finish: (claim: Claim, result: SendResult) => rpc<boolean>("btp11_finish", {
      p_id: claim.id, p_lease: claim.lease_token, p_outcome: result.outcome,
      p_provider_id: result.providerId ?? null, p_retry_seconds: result.retrySeconds ?? 0,
    }),
    webhook: (dispatch: string, hash: string, messageId: string, event: WebhookEvent) => rpc<void>("btp11_webhook", {
      p_dispatch: dispatch, p_address_hash: hash, p_provider_id: messageId, p_event: event,
    }),
    heartbeat: () => rpc<void>("btp11_heartbeat"),
  };
}
