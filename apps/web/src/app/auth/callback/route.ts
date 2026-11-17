import { NextResponse } from "next/server";
import { authRedirect } from "@beetip/validation";
import { identityClient } from "../../../server/identity/client";
import { identityConfig } from "../../../server/identity/config";

export async function GET(request: Request) {
  const { origin } = identityConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const client = await identityClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(authRedirect(url.searchParams.get("next")), origin));
  }
  return NextResponse.redirect(new URL("/login?error=confirmation", origin));
}
