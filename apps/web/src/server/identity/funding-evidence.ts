import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@beetip/database/types";
import { identityConfig } from "./config";

export function fundingStorageConfigured() {
  return Boolean(process.env.BEETIP_FUNDING_STORAGE_SECRET?.startsWith("sb_secret_"));
}

export function fundingBucket() {
  return privateEvidenceBucket("funding-evidence", process.env.BEETIP_FUNDING_STORAGE_SECRET);
}

export function privateEvidenceBucket(bucket: string, key: string | undefined) {
  return privateEvidenceClient(key).storage.from(bucket);
}

export function privateEvidenceClient(key: string | undefined) {
  if (!key?.startsWith("sb_secret_")) throw new Error("UNAVAILABLE");
  return createClient<Database>(identityConfig().url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      const timeout = AbortSignal.timeout(15000);
      return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    } },
  });
}

export function fundingImageHash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
