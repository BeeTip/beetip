import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const build = fileURLToPath(new URL("../apps/web/.next/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(build, "server/app-paths-manifest.json"), "utf8"));
const demoRoutes = ["/admin/page", "/profile/page", "/trips/page", "/trips/[id]/page", "/orders/page"];
const failures = demoRoutes.filter(route => Object.hasOwn(manifest, route));
const demoMarkers = ["beetip-demo-v1", "beetip-demo-v2", "demo-provider.tsx", "Reset data lokal", "Titip Chatime"];
const routes = JSON.parse(readFileSync(join(build, "app-path-routes-manifest.json"), "utf8"));
const retiredRoutes = [
  "/account/funding",
  "/account/transfers",
  "/account/reconciliation",
  "/api/identity/funding",
  "/api/identity/manual-transfers",
  "/api/identity/reconciliation",
  "/account/email-operations",
  "/api/identity/email-operations",
  "/api/jobs/transactional-email",
  "/api/webhooks/brevo",
];

const retired = Object.values(routes).filter(route =>
  retiredRoutes.some(prefix => route === prefix || route.startsWith(`${prefix}/`)),
);
assert.deepEqual([...new Set(retired)].sort(), [], "Connected build emitted retired payment or application email routes");
assert.ok(Object.hasOwn(manifest, "/api/identity/orders/demo-payment/route"), "Connected build is missing the simulated checkout handler");

for (const directory of ["static", "server"]) {
  const root = join(build, directory);
  for (const file of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!file.isFile() || !/\.(?:js|map)$/.test(file.name)) continue;
    const path = join(file.parentPath, file.name);
    const content = readFileSync(path, "utf8");
    const found = demoMarkers.filter(marker => content.includes(marker));
    if (found.length) failures.push(`${relative(build, path)} (${found.join(", ")})`);
  }
}

assert.deepEqual(failures, [], "Connected build emitted demo routes or browser-storage authority");
console.log("Connected build contains simulated checkout and excludes retired payment, application email, and demo routes");
