import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export async function checkStaging({ origin, bypass, allowLocal = false, exposure = "protected", request = fetch }) {
  const target = new URL(origin);
  const local = allowLocal && target.protocol === "http:" && target.hostname === "127.0.0.1";
  assert(target.protocol === "https:" || local, "Staging requires HTTPS");
  assert(!target.username && !target.password && target.pathname === "/" && !target.search && !target.hash, "Supply only the staging origin");
  assert(["protected", "public"].includes(exposure), "Explicitly select a supported exposure policy");
  assert(local || exposure === "public" || bypass, "A deployment-protection bypass secret is required for staging checks");
  const checked = [];
  async function send(path, options = {}, protectedAccess = true) {
    return request(new URL(path, target), {
      ...options,
      headers: { ...options.headers, ...(protectedAccess && bypass ? { "x-vercel-protection-bypass": bypass } : {}) },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });
  }
  function privateResponse(response, requirePrivate = true) {
    const cache = response.headers.get("cache-control") ?? "";
    assert(cache.includes("no-store") && (!requirePrivate || cache.includes("private")), "Identity responses must be private and uncached");
  }
  function redirectedTo(response, path) {
    assert([302, 303, 307, 308].includes(response.status), "Expected an application redirect");
    assert.equal(new URL(response.headers.get("location"), target).href, new URL(path, target).href, "Unexpected callback or route destination");
  }
  if (!local && exposure === "protected") {
    for (const path of ["/login", "/api/identity/support"]) {
      const response = await send(path, {}, false);
      const location = response.headers.get("location");
      const destination = location ? new URL(location, target) : null;
      const sso = [302, 307].includes(response.status) && destination?.origin === "https://vercel.com" && destination.pathname === "/sso-api";
      const challenge = [401, 403].includes(response.status) && response.headers.get("content-type")?.includes("text/html") && (await response.text()).includes("Authentication Required");
      assert(sso || challenge, "Expected the Vercel authentication gate, not the application's anonymous denial");
    }
    checked.push("deployment protection denies public page and API access");
  }
  if (exposure === "public") {
    for (const path of ["/", "/listings/contoh-kopi"]) {
      const response = await send(path, {}, false);
      assert.equal(response.status, 200, "Public catalog and sample details must not require sign-in");
      assert((await response.text()).toLowerCase().includes("contoh listing"), "Public samples must be labeled");
    }
    checked.push("public catalog and sample details available without sign-in");
  }
  const login = await send("/login");
  assert.equal(login.status, 200, "Connected login must be available behind deployment protection");
  privateResponse(login, false);
  assert((await login.text()).includes("Masuk ke BeeTip"), "Connected login is missing or configuration is unavailable");
  checked.push("connected login and private response headers");
  const history = await send("/api/identity/support");
  assert.equal(history.status, 401, "Support history must require an application session");
  privateResponse(history);
  assert.equal((await history.json()).ok, false);
  checked.push("anonymous support history denied");
  const denied = await send("/api/identity/auth", {
    method: "POST",
    headers: { Origin: "https://unrelated.invalid", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "recover", email: "denied@example.invalid" }),
  });
  assert.equal(denied.status, 403, "Cross-origin Auth requests must be denied before contacting the mail provider");
  privateResponse(denied);
  assert.equal((await denied.json()).code, "PERMISSION");
  checked.push("cross-origin Auth denied");
  for (const path of ["/auth/callback?next=https://unrelated.invalid", "/auth/confirm"]) {
    redirectedTo(await send(path), "/login?error=confirmation");
  }
  redirectedTo(await send("/admin"), "/account");
  redirectedTo(await send("/account"), "/login");
  checked.push("callback origin, connected route gating, and anonymous account redirect");
  return { result: "PASS", scope: local ? "local connected smoke" : `${exposure} staging anonymous smoke`, origin: target.origin, checks: checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const bypass = process.env.BEETIP_STAGING_BYPASS_FILE
      ? readFileSync(process.env.BEETIP_STAGING_BYPASS_FILE, "utf8").trim()
      : process.env.BEETIP_STAGING_BYPASS;
    console.log(JSON.stringify(await checkStaging({
      origin: process.env.BEETIP_STAGING_URL,
      bypass,
      allowLocal: process.env.BEETIP_STAGING_ALLOW_LOCAL === "1",
      exposure: process.env.BEETIP_STAGING_EXPOSURE ?? "protected",
    })));
  } catch {
    console.error("Staging smoke failed. Check the target, deployment protection, connected configuration, Auth redirects, and private response headers. No email or authenticated journey was verified.");
    process.exitCode = 1;
  }
}
