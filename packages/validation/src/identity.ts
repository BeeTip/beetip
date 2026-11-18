import { z } from "zod";

const email = z.string().trim().email().max(254);
const password = z.string().min(12).max(128);
export const authInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("signup"), email, password, name: z.string().trim().min(1).max(80), next: z.string().max(100).optional() }).strict(),
  z.object({ action: z.literal("login"), email, password: z.string().min(1).max(128), next: z.string().max(100).optional() }).strict(),
  z.object({ action: z.literal("recover"), email }).strict(),
  z.object({ action: z.literal("password"), password }).strict(),
  z.object({ action: z.literal("signout") }).strict(),
]);
export const supportInputSchema = z.object({ operationId: z.string().uuid(), body: z.string().trim().min(1).max(1000) }).strict();

export function applicationMode(value: string | undefined, deployment?: string) {
  if (value === "demo" && deployment !== "production") return "demo";
  if (value === undefined || value === "connected") return "connected";
  throw new Error("Invalid application mode");
}

export function trustedOrigin(value: string) {
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((!local && url.protocol !== "https:") || !["http:", "https:"].includes(url.protocol)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid application origin");
  return url.origin;
}

export function authRedirect(value: string | null) {
  return value === "/auth/password" ? value : "/account";
}

export function accountRedirect(value: string | null | undefined) {
  return value === "/listings/new" || value === "/support" ? value : "/account";
}

export function acceptsMutation(origin: string | null, expected: string, contentType: string | null) {
  return origin === expected && contentType?.split(";")[0].trim().toLowerCase() === "application/json";
}
