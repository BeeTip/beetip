import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

function checkBuild(t, routes) {
  const fixture = mkdtempSync(join(tmpdir(), "beetip-connected-build-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  const build = join(fixture, "apps", "web", ".next");
  mkdirSync(join(build, "static"), { recursive: true });
  mkdirSync(join(build, "server"));
  const script = join(fixture, "scripts", "check-connected-build.mjs");
  mkdirSync(join(fixture, "scripts"));
  copyFileSync(new URL("./check-connected-build.mjs", import.meta.url), script);
  const appPaths = Object.fromEntries(Object.keys(routes).map(path => [path, `app${path}.js`]));
  writeFileSync(join(build, "server", "app-paths-manifest.json"), JSON.stringify(appPaths));
  writeFileSync(join(build, "app-path-routes-manifest.json"), JSON.stringify(routes));

  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.ifError(result.error);
  return result;
}

const checkout = "/api/identity/orders/demo-payment/route";
const checkoutPath = "/api/identity/orders/demo-payment";

test("the connected artifact gate rejects reintroduced payment subpaths", t => {
  const retired = {
    "/account/transfers/page": "/account/transfers",
    "/account/funding/[id]/page": "/account/funding/[id]",
    "/(connected)/api/identity/manual-transfers/[id]/approve/route": "/api/identity/manual-transfers/[id]/approve",
    "/api/identity/reconciliation/export/route": "/api/identity/reconciliation/export",
  };
  const result = checkBuild(t, { [checkout]: checkoutPath, ...retired });

  assert.equal(result.status, 1, result.stdout || result.stderr);
  for (const route of Object.values(retired)) assert.ok(result.stderr.includes(route), route);
});

test("the connected artifact gate allows simulated checkout and neighboring routes", t => {
  const result = checkBuild(t, {
    [checkout]: checkoutPath,
    "/account/funding-help/page": "/account/funding-help",
  });

  assert.equal(result.status, 0, result.stderr);
});

test("the connected artifact gate requires the simulated checkout handler", t => {
  const result = checkBuild(t, { "/page": "/" });

  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.match(result.stderr, /missing the simulated checkout handler/);
});

test("the connected artifact gate rejects application email routes and retains Auth routes", t => {
  const auth = { "/api/identity/auth/route": "/api/identity/auth", "/auth/confirm/page": "/auth/confirm" };
  const email = {
    "/account/email-operations/page": "/account/email-operations",
    "/api/identity/email-operations/route": "/api/identity/email-operations",
    "/api/jobs/transactional-email/route": "/api/jobs/transactional-email",
    "/api/webhooks/brevo/route": "/api/webhooks/brevo",
  };
  const retired = checkBuild(t, { [checkout]: checkoutPath, ...auth, ...email });
  assert.equal(retired.status, 1, retired.stdout || retired.stderr);
  for (const route of Object.values(email)) assert.ok(retired.stderr.includes(route), route);
  assert.equal(checkBuild(t, { [checkout]: checkoutPath, ...auth }).status, 0);
});
