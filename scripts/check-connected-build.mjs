import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const build = fileURLToPath(new URL("../apps/web/.next/", import.meta.url));
const manifest = JSON.parse(readFileSync(join(build, "server/app-paths-manifest.json"), "utf8"));
const demoRoutes = ["/admin/page", "/profile/page", "/trips/page", "/trips/[id]/page", "/orders/page"];
const failures = demoRoutes.filter(route => Object.hasOwn(manifest, route));
const demoMarkers = ["beetip-demo-v1", "beetip-demo-v2", "demo-provider.tsx", "Reset data lokal", "Titip Chatime"];

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
console.log("Connected build excludes demo routes and browser-storage authority");
