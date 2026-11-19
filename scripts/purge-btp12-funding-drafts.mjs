import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import pg from "pg";

const status = JSON.parse(execFileSync("rtk", ["proxy", "supabase", "status", "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}));
const api = new URL(status.API_URL);
const db = new URL(status.DB_URL);
assert(api.protocol === "http:" && api.hostname === "127.0.0.1" && !api.search);
assert(db.protocol === "postgresql:" && db.hostname === "127.0.0.1" && !db.search);
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const bucket = createClient(api.origin, status.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  .storage.from("funding-evidence");
const client = new pg.Client({ connectionString: db.href, statement_timeout: 10000 });
try {
  await client.connect();
  const { rows } = await client.query(`
    select o.name from storage.objects o
      join private.funding_submissions f on o.name=f.id::text
      join private.funding_accounts a on a.id=f.account_id
      join public.reservations r on r.order_id=f.order_id
    where o.bucket_id='funding-evidence' and a.environment='synthetic'
      and o.created_at<now()-interval '1 hour' and (
        (f.state='discarded' and f.discarded_at<now()-interval '1 hour')
        or (f.state='draft' and r.funding_verified_at is null and r.expires_at<now()-interval '1 hour')
      )
    order by o.created_at,o.name limit 100`);
  if (rows.length) {
    const { error } = await bucket.remove(rows.map(row => row.name));
    if (error) throw new Error("Local Storage did not complete the purge");
  }
  console.log(`Processed ${rows.length} synthetic abandoned uploads.`);
} finally {
  await client.end();
}
