import { NextResponse } from "next/server";
import { identityClient } from "../../../server/identity/client";
import { identityConfig } from "../../../server/identity/config";
import { accountRedirect } from "@beetip/validation";

export async function GET(request: Request) {
  const { origin } = identityConfig();
  const url = new URL(request.url);
  const token = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (token && (type === "signup" || type === "recovery")) {
    const client = await identityClient();
    const { error } = await client.auth.verifyOtp({ token_hash: token, type });
    if (!error) return NextResponse.redirect(new URL(type === "recovery" ? "/auth/password" : accountRedirect(url.searchParams.get("next")), origin));
  }
  return NextResponse.redirect(new URL("/login?error=confirmation", origin));
}
