import assert from "node:assert/strict";
import { test } from "node:test";
import { checkStaging } from "./check-staging.mjs";

const origin = "https://beetip-staging.example";
const bypass = "test-only-bypass";
const privateHeaders = { "Cache-Control": "private, no-store" };
function fixture(change = () => undefined) {
  return async (url, options) => {
    assert.equal(options.redirect, "manual");
    assert.equal(url.origin, origin);
    const replacement = change(url, options);
    if (replacement) return replacement;
    if (!options.headers["x-vercel-protection-bypass"]) return new Response("<title>Authentication Required</title>", { status: 401, headers: { "Content-Type": "text/html" } });
    assert.equal(options.headers["x-vercel-protection-bypass"], bypass);
    if (url.pathname === "/login") return new Response("<h1>Masuk ke BeeTip</h1>", { headers: privateHeaders });
    if (url.pathname === "/api/identity/support") return Response.json({ ok: false }, { status: 401, headers: privateHeaders });
    if (url.pathname === "/api/identity/auth") {
      assert.equal(options.headers.Origin, "https://unrelated.invalid");
      return Response.json({ ok: false, code: "PERMISSION" }, { status: 403, headers: privateHeaders });
    }
    const location = url.pathname.startsWith("/auth/") ? "/login?error=confirmation" : url.pathname === "/admin" ? "/account" : "/login";
    return new Response(null, { status: 307, headers: { Location: new URL(location, origin).href } });
  };
}

test("checks public protection separately from the authenticated Vercel bypass", async () => {
  const result = await checkStaging({ origin, bypass, request: fixture() });
  assert.equal(result.result, "PASS");
  assert.equal(result.checks.length, 5);
});

test("recognizes Vercel's SSO redirect without following it or forwarding the bypass", async () => {
  const result = await checkStaging({ origin, bypass, request: fixture((url, options) => {
    if (!options.headers["x-vercel-protection-bypass"]) return new Response(null, { status: 302, headers: { Location: "https://vercel.com/sso-api?url=beetip-staging.example" } });
  }) });
  assert.equal(result.result, "PASS");
});

test("refuses unsafe origins or missing protection credentials before any request", async () => {
  for (const target of ["http://beetip.example", "https://user:password@beetip.example", `${origin}/path`, `${origin}?secret=value`]) {
    await assert.rejects(checkStaging({ origin: target, bypass, request: () => assert.fail("Unexpected request") }));
  }
  await assert.rejects(checkStaging({ origin, request: () => assert.fail("Unexpected request") }));
});

test("fails if the login or API is publicly reachable", async () => {
  for (const path of ["/login", "/api/identity/support"]) {
    await assert.rejects(checkStaging({ origin, bypass, request: fixture((url, options) => {
      if (url.pathname === path && !options.headers["x-vercel-protection-bypass"]) return new Response("public");
    }) }));
  }
});

test("does not mistake the application's anonymous API denial for deployment protection", async () => {
  await assert.rejects(checkStaging({ origin, bypass, request: fixture((url, options) => {
    if (url.pathname === "/api/identity/support" && !options.headers["x-vercel-protection-bypass"]) return Response.json({ ok: false }, { status: 401, headers: privateHeaders });
  }) }));
});

test("fails on unavailable login configuration, cached private data, or exposed support", async () => {
  for (const [path, response] of [
    ["/login", new Response("Layanan akun belum tersedia", { headers: privateHeaders })],
    ["/login", new Response("Masuk ke BeeTip", { headers: { "Cache-Control": "public" } })],
    ["/api/identity/support", Response.json({ ok: true, threads: [] }, { headers: privateHeaders })],
  ]) {
    await assert.rejects(checkStaging({ origin, bypass, request: fixture((url, options) => {
      if (url.pathname === path && options.headers["x-vercel-protection-bypass"]) return response;
    }) }));
  }
});

test("fails if an invalid callback redirects to another origin", async () => {
  await assert.rejects(checkStaging({ origin, bypass, request: fixture(url => {
    if (url.pathname === "/auth/callback") return new Response(null, { status: 307, headers: { Location: "https://unrelated.invalid/login?error=confirmation" } });
  }) }));
});

test("fails if cross-origin Auth is accepted", async () => {
  await assert.rejects(checkStaging({ origin, bypass, request: fixture(url => {
    if (url.pathname === "/api/identity/auth") return Response.json({ ok: true }, { headers: privateHeaders });
  }) }));
});
