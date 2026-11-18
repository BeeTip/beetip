import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const connection = process.env.BEETIP_NOTIFICATION_DATABASE_URL;
assert(connection, "Set BEETIP_NOTIFICATION_DATABASE_URL to the parent-approved database connection");
const url = new URL(connection);
assert(["postgres:", "postgresql:"].includes(url.protocol));
const local = ["127.0.0.1", "localhost"].includes(url.hostname);
if (!local) {
  assert.equal(process.env.BEETIP_NOTIFICATION_SHARED_DB_APPROVAL, "parent-coordinated-btp10", "Shared DB tests require explicit parent coordination");
  assert(url.hostname === "db.rgiptdfjlmwldngapojq.supabase.co" ||
    (url.hostname.endsWith(".pooler.supabase.com") && url.username === "postgres.rgiptdfjlmwldngapojq"), "Only approved dev project allowed");
}
const psql = process.env.BEETIP_PSQL ?? "C:/Program Files/PostgreSQL/18/bin/psql.exe";
const environment = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1), PGSSLMODE: local ? "disable" : "require" };
const run = args => execFileSync("rtk", ["proxy", psql, "-X", "-v", "ON_ERROR_STOP=1", ...args], { env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const baseline = () => run(["-Atc", "select jsonb_build_array((select count(*) from auth.users),(select count(*) from public.members),(select count(*) from public.staff_roles where revoked_at is null),(select count(*) from auth.mfa_factors where status='verified'),(select count(*) from public.notifications),(select count(*) from public.listings),(select count(*) from public.offers),(select count(*) from public.conversations),(select count(*) from public.messages))"]);
const before = baseline();
try {
  const output = run(["-f", new URL("../supabase/tests/notification_inbox.sql", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")]);
  console.log(output);
} catch (error) {
  console.error(error.stderr?.toString() ?? "Database assertions failed");
  process.exitCode = 1;
} finally {
  assert.equal(baseline(), before, "Retained users, members, roles, MFA and notifications must be preserved after rollback");
}
