import "server-only";
import { applicationMode, trustedOrigin } from "@beetip/validation";

export function mode() {
  return applicationMode(process.env.BEETIP_MODE, process.env.VERCEL_ENV);
}

export function identityConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const origin = process.env.APP_ORIGIN;
  if (!url || !key || !origin) throw new Error("Connected identity configuration is missing");
  if (key.startsWith("sb_secret_")) throw new Error("A publishable key is required");
  return { url: trustedOrigin(url), key, origin: trustedOrigin(origin) };
}

export function identityConfigured() {
  try { identityConfig(); return true; } catch { return false; }
}
