import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { identityConfig, identityConfigured, mode } from "./server/identity/config";

export async function proxy(request: NextRequest) {
  if (mode() === "demo") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path === "/api/jobs/transactional-email" || path === "/api/webhooks/brevo") return NextResponse.next();
  const connected = path === "/account/funding"
    || path === "/account/order-cases"
    || path === "/account/transfers"
    || path === "/account/email-operations"
    || path === "/" || ["/drink.svg", "/food.svg", "/bag.svg"].includes(path) || /^\/listings\/[^/]+$/.test(path) || path === "/account" || path === "/account/affiliation" || path === "/support" || path === "/login"
    || /^\/(orders|chat)\/[^/]+$/.test(path) || path === "/chat" || path === "/account/orders" || path === "/account/listings" || path === "/account/offers" || path === "/account/notifications" || path === "/api/listings" || path.startsWith("/auth/") || path.startsWith("/api/identity/");
  if (!connected) return NextResponse.redirect(new URL("/account", request.url));
  let response = NextResponse.next({ request });
  if (identityConfigured()) {
    const config = identityConfig();
    const client = createServerClient(config.url, config.key, { cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, headers) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    } });
    await client.auth.getClaims();
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/|fonts/).*)"] };
