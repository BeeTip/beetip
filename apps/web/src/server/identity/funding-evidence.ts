import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { identityConfig } from "./config";

const maxBytes = 2 * 1024 * 1024;
const maxPixels = 12_000_000;

export function fundingStorageConfigured() {
  return Boolean(process.env.BEETIP_FUNDING_STORAGE_SECRET?.startsWith("sb_secret_"));
}

export function fundingBucket() {
  const key = process.env.BEETIP_FUNDING_STORAGE_SECRET;
  if (!key?.startsWith("sb_secret_")) throw new Error("UNAVAILABLE");
  return createClient(identityConfig().url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => {
      const timeout = AbortSignal.timeout(15000);
      return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
    } },
  }).storage.from("funding-evidence");
}

export async function validatedFundingImage(request: Request) {
  const contentType = request.headers.get("content-type");
  if (contentType !== "image/png" && contentType !== "image/jpeg") throw new Error("VALIDATION");
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new Error("VALIDATION");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("VALIDATION");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error("VALIDATION");
    }
    chunks.push(value);
  }
  try {
    const image = sharp(Buffer.concat(chunks), { limitInputPixels: maxPixels, failOn: "warning" });
    const metadata = await image.metadata();
    if (`image/${metadata.format}` !== contentType || (metadata.pages ?? 1) !== 1) throw new Error("VALIDATION");
    const bytes = await image.rotate().toFormat(metadata.format === "png" ? "png" : "jpeg").toBuffer();
    if (bytes.length > maxBytes) throw new Error("VALIDATION");
    return { bytes, contentType };
  } catch {
    throw new Error("VALIDATION");
  }
}

export function fundingImageHash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
