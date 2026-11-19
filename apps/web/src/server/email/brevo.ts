import "server-only";
import { addressHash, dispatchTag, providerId } from "./security";

export type SendResult = {
  outcome: "accepted" | "rate_limited" | "rejected" | "transport_uncertain" | "duplicate_key";
  providerId?: string;
  retrySeconds?: number;
};

function retrySeconds(header: string | null) {
  if (!header) return 0;
  const seconds = /^\d+$/.test(header) ? Number(header) : Math.ceil((Date.parse(header) - Date.now()) / 1000);
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 0), 86400) : 0;
}

export function brevoSender(config: { apiKey: string; sender: string; origin: string; signingKey: string }) {
  const link = `${config.origin}/account/notifications`;
  const subject = "Ada pembaruan di BeeTip";
  const textContent = `Masuk ke BeeTip untuk melihat pembaruan Anda.\n\n${link}`;
  const href = link.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const htmlContent = `<p>Masuk ke BeeTip untuk melihat pembaruan Anda.</p><p><a href="${href}">Buka notifikasi BeeTip</a></p>`;
  return async function send(address: string, dispatchId: string): Promise<SendResult> {
    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": config.apiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: { email: config.sender, name: "BeeTip" },
          to: [{ email: address, contactPixelTrackingConsent: false }],
          subject,
          textContent,
          htmlContent,
          headers: { IdempotencyKey: dispatchId },
          tags: [dispatchTag(dispatchId, addressHash(address), config.signingKey), `beetip-email-${dispatchId}`],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(3500),
      });
      if (response.status === 429) return { outcome: "rate_limited", retrySeconds: retrySeconds(response.headers.get("retry-after")) };
      if (response.status === 201) {
        const data = await response.json();
        const id = providerId(data?.messageId);
        return id ? { outcome: "accepted", providerId: id } : { outcome: "transport_uncertain" };
      }
      if ([400, 401, 402, 403, 404, 422].includes(response.status)) {
        const data = await response.json().catch(() => null);
        return { outcome: data?.code === "duplicate_parameter" ? "duplicate_key" : "rejected" };
      }
      return { outcome: "transport_uncertain" };
    } catch {
      return { outcome: "transport_uncertain" };
    }
  };
}
