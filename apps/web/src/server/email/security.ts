import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
export const emailAddress = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function matches(actual: string, expected: string) {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function authorized(request: Request, secret: string | undefined) {
  return !!secret && secret.length >= 32 && matches(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

export function addressHash(address: string) {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
}

export function dispatchTag(dispatchId: string, hash: string, secret: string) {
  const signature = createHmac("sha256", secret).update(`btp11:${dispatchId}:${hash}`).digest("hex").slice(0, 32);
  return `btp11-${dispatchId}-${signature}`;
}

export function verifiedDispatch(tag: string, hash: string, secrets: string[]) {
  const dispatchId = tag.slice(6, 42);
  return uuid.test(dispatchId) && secrets.some(secret => matches(tag, dispatchTag(dispatchId, hash, secret)))
    ? dispatchId : null;
}

export function providerId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^<([^<>]+)>$/, "$1");
  return /^[!-~]{1,240}$/.test(normalized) ? normalized : null;
}
