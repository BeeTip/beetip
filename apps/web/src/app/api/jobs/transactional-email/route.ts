import { applicationMode, trustedOrigin } from "@beetip/validation";
import { brevoSender } from "../../../../server/email/brevo";
import { emailJobClient } from "../../../../server/email/job-client";
import { addressHash, authorized, emailAddress } from "../../../../server/email/security";

export const runtime = "nodejs";
export const maxDuration = 30;

function settings() {
  const apiKey = process.env.BEETIP_EMAIL_BREVO_API_KEY;
  const sender = process.env.BEETIP_EMAIL_FROM?.trim();
  const signingKey = process.env.BEETIP_EMAIL_TAG_SECRET;
  const origin = trustedOrigin(process.env.APP_ORIGIN ?? "");
  if (!apiKey || !sender || !emailAddress.test(sender) || !signingKey || signingKey.length < 32) {
    throw new Error("Email configuration unavailable");
  }
  const audience = process.env.BEETIP_EMAIL_AUDIENCE ?? "allowlist";
  if (audience !== "allowlist" && (audience !== "public" || process.env.VERCEL_ENV !== "production")) {
    throw new Error("Email audience unavailable");
  }
  const recipients = (process.env.BEETIP_EMAIL_RECIPIENTS ?? "").split(",").map(address => address.trim()).filter(Boolean);
  if (audience === "allowlist" && (!recipients.length || recipients.length > 100 || recipients.some(address => !emailAddress.test(address)))) {
    throw new Error("Email allowlist unavailable");
  }
  return { apiKey, sender, origin, signingKey, allowlist: audience === "public" ? null : recipients.map(addressHash) };
}

export async function POST(request: Request) {
  if (!authorized(request, process.env.BEETIP_EMAIL_JOBS_SECRET)) {
    return Response.json({ ok: false }, { status: 401 });
  }
  if (process.env.BEETIP_EMAIL_ENABLED !== "true") return Response.json({ ok: false }, { status: 503 });

  try {
    if (applicationMode(process.env.BEETIP_MODE, process.env.VERCEL_ENV) !== "connected") {
      return Response.json({ ok: false }, { status: 503 });
    }
    const config = settings();
    const send = brevoSender(config);
    const jobs = emailJobClient();
    const claims = (await jobs.claim()).slice(0, 10);
    let failed = 0;

    for (let offset = 0; offset < claims.length; offset += 5) {
      const results = await Promise.allSettled(claims.slice(offset, offset + 5).map(async claim => {
        const submission = await jobs.prepare(claim, config.allowlist);
        if (submission) {
          const result = await send(submission.address, submission.dispatchId);
          await jobs.finish(claim, result);
        }
      }));
      failed += results.filter(result => result.status === "rejected").length;
    }

    if (!failed) await jobs.heartbeat();
    return Response.json({ ok: failed === 0, claimed: claims.length, failed }, { status: failed ? 503 : 200 });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
