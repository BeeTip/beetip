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
    if (url.pathname === "/api/identity/orders") {
      assert.match(url.searchParams.get("id"), /^[0-9a-f-]{36}$/);
    }
    if (["/api/identity/support", "/api/identity/orders", "/api/identity/notifications"].includes(url.pathname)) {
      return Response.json({ ok: false }, { status: 401, headers: privateHeaders });
    }
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

test("public mode permits catalog access while preserving private API denial", async () => {
  const request = fixture();
  const result = await checkStaging({ origin, exposure: "public", catalog: "samples", request: (url, options) => {
    assert.equal(options.headers["x-vercel-protection-bypass"], undefined);
    if (url.pathname === "/" || url.pathname.startsWith("/listings/")) return new Response("Contoh listing");
    return request(url, { ...options, headers: { ...options.headers, "x-vercel-protection-bypass": bypass } });
  } });
  assert.equal(result.result, "PASS");
  assert.equal(result.scope, "public staging anonymous smoke");
});

test("public mode rejects a gated catalog or missing sample labels", async () => {
  for (const response of [new Response(null, { status: 302 }), new Response("real listings")]) {
    await assert.rejects(checkStaging({ origin, exposure: "public", catalog: "samples", request: () => response }));
  }
});

test("public connected mode checks board availability and private-field exclusion", async () => {
  const request = fixture();
  for (const destination of [undefined, "private address"]) {
    const run = checkStaging({ origin, exposure: "public", request: (url, options) => {
      if (url.pathname === "/") return new Response("Mau titip apa hari ini?");
      if (url.pathname === "/api/listings") return Response.json({ ok: true, listings: destination ? [{ destination }] : [] }, { headers: privateHeaders });
      return request(url, { ...options, headers: { ...options.headers, "x-vercel-protection-bypass": bypass } });
    } });
    if (destination) await assert.rejects(run); else assert.equal((await run).result, "PASS");
  }
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

test("fails if anonymous connected order or inbox data is exposed or cached", async () => {
  for (const path of ["/api/identity/orders", "/api/identity/notifications"]) {
    for (const response of [
      Response.json({ ok: true }, { headers: privateHeaders }),
      Response.json({ ok: false }, { status: 401, headers: { "Cache-Control": "public" } }),
    ]) {
      await assert.rejects(checkStaging({ origin, bypass, request: fixture(url => {
        if (url.pathname === path) return response;
      }) }));
    }
  }
});

test("fails if cross-origin Auth is accepted", async () => {
  await assert.rejects(checkStaging({ origin, bypass, request: fixture(url => {
    if (url.pathname === "/api/identity/auth") return Response.json({ ok: true }, { headers: privateHeaders });
  }) }));
});
