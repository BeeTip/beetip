import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  candidateRevision, checkLocalTools, dumpDatabase, excludedTables, prepareStack, restoreDatabase, sql, startStack, stopStack,
} from "./btp23-recovery-local.mjs";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABgAAAAgCAIAAACHPC9vAAAAJklEQVR4nGP8u5OBKoCJOsaMGjRq0KhBowaNGjRq0KhBowYNtEEAyGEB9lmsFd4AAAAASUVORK5CYII=",
  "base64",
);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const bucket = "/storage/v1/object/purchase-receipts/";
const args = process.argv.slice(2);
const databaseOnly = args[0] === "--database-only";
assert(args.length === 0 || (args.length === 1 && databaseOnly), "Expected only the optional --database-only flag");
const scratch = await mkdtemp(join(tmpdir(), "beetip-btp23-"));
const dbFile = join(scratch, "database.sql");
const objectFile = join(scratch, "receipt.png");
const manifestFile = join(scratch, "manifest.json");
const stacks = [];

function request(stack, path, { method = "GET", token, privileged = false, body } = {}) {
  const key = privileged ? stack.serviceRole : stack.publishable;
  const headers = { apikey: key };
  if (privileged || token) headers.Authorization = `Bearer ${token ?? key}`;
  if (body !== undefined) headers["Content-Type"] = Buffer.isBuffer(body) ? "image/png" : "application/json";
  return fetch(stack.origin + path, {
    method, headers, body: Buffer.isBuffer(body) || body === undefined ? body : JSON.stringify(body),
    redirect: "error", signal: AbortSignal.timeout(15_000),
  });
}

async function checked(response, label) {
  assert(response.ok, `${label} returned HTTP ${response.status}`);
  return response;
}

async function rpc(stack, token, name, body) {
  const response = await checked(await request(stack, `/rest/v1/rpc/${name}`, {
    method: "POST", token, body,
  }), name);
  return response.status === 204 ? undefined : response.json();
}

async function user(stack, role) {
  const email = `recovery-${role}-${randomUUID()}@example.invalid`;
  const password = randomUUID() + "aA1!";
  const response = await checked(await request(stack, "/auth/v1/admin/users", {
    method: "POST", privileged: true, body: { email, password, email_confirm: true },
  }), "Create synthetic account");
  const { id } = await response.json();
  assert.match(id, /^[0-9a-f-]{36}$/);
  return { id, email, password };
}

async function login(stack, { email, password }) {
  const response = await checked(await request(stack, "/auth/v1/token?grant_type=password", {
    method: "POST", body: { email, password },
  }), "Sign in with synthetic account");
  const { access_token: token } = await response.json();
  assert.equal(typeof token, "string");
  return token;
}

async function upload(stack, path, bytes) {
  await checked(await request(stack, bucket + path, {
    method: "POST", privileged: true, body: bytes,
  }), "Upload private receipt");
}

async function download(stack, path) {
  const result = await checked(await request(stack, bucket + path, { privileged: true }),
    "Download private receipt");
  return Buffer.from(await result.arrayBuffer());
}

function snapshot(stack) {
  return sql(stack, `
    select format(
      'select %L, count(*), encode(sha256(convert_to(coalesce(string_agg(row_data, E''\\n'' order by row_data collate "C"), ''''), ''UTF8'')), ''hex'') from (select to_jsonb(t)::text as row_data from %I.%I t) rows',
      schemaname || '.' || tablename, schemaname, tablename)
    from pg_tables where schemaname in ('public', 'private', 'auth')
      and schemaname || '.' || tablename not in (${excludedTables.map(table => `'${table}'`).join(", ")})
    order by schemaname, tablename
    \\gexec
  `).split(/\r?\n/);
}

function migrationHistory(stack) {
  return sql(stack, "select version from supabase_migrations.schema_migrations order by version;");
}

try {
  checkLocalTools();
  const candidate = candidateRevision();
  console.log(`Candidate ${candidate.commit}${candidate.dirty ? " with local changes" : ""}`);
  const source = await prepareStack(scratch, "source");
  stacks.push(source);
  startStack(source);
  const customer = await user(source, "customer");
  const provider = await user(source, "provider");
  const unrelated = await user(source, "unrelated");
  const customerToken = await login(source, customer);
  const providerToken = await login(source, provider);
  const listing = randomUUID();
  sql(source, `
    insert into public.listings(id,owner_id,type,title,shop,category,area,destination,items,budget,fee,bound,
      negotiable,capacity,spending_capacity,start_at,end_at,cutoff_at,status)
    values('${listing}','${customer.id}','request','Synthetic recovery order','Warung','Makanan','Alam Sutera','Kampus',
      '[{"name":"Nasi","specification":"","quantity":1,"unitBudget":20000}]',20000,5000,5000,false,1,150000,
      now()+interval '1 day',now()+interval '25 hours',now()+interval '23 hours','active');
  `);
  const order = await rpc(source, providerToken, "accept_order", {
    p_operation_id: randomUUID(), p_listing_id: listing, p_listing_version: 1,
  });
  await rpc(source, customerToken, "confirm_booth_payment", { p_order: order });
  const operation = randomUUID();
  const hash = sha256(image);
  const intent = await rpc(source, providerToken, "purchase_evidence_path", {
    p_order: order, p_key: operation, p_upload: true,
  });
  const path = `${provider.id}/${order}/${operation}/${hash}`;
  assert.equal(`${intent}/${hash}`, path);
  await upload(source, path, image);
  const receipt = await rpc(source, providerToken, "record_purchase", {
    p_operation_id: operation, p_order: order, p_version: 1, p_action: "receipt",
    p_payload: {
      merchant: "Warung Recovery", reference: "RECOVERY-01", imageHash: hash, discount: 0,
      date: sql(source, "select (clock_timestamp() at time zone 'Asia/Jakarta')::date;"),
      lines: [{ label: "Nasi", quantity: 1, gross: 20000 }],
    },
  });
  const expectedOrder = await rpc(source, providerToken, "read_order", { p_id: order });
  const expectedPurchase = await rpc(source, providerToken, "read_purchase", { p_order: order });
  assert.equal(expectedOrder.boothDemo, true);
  assert.equal(expectedPurchase.receipts[0].id, receipt);
  const migrations = migrationHistory(source);
  assert(migrations.length > 0);
  const expectedSnapshot = snapshot(source);
  const backupStarted = performance.now();
  const recoveryPoint = new Date();
  const dump = dumpDatabase(source);
  const object = await download(source, path);
  assert.equal(sha256(object), hash);
  await writeFile(dbFile, dump);
  await writeFile(objectFile, object);
  await writeFile(manifestFile, JSON.stringify({
    candidate, recoveryPoint: recoveryPoint.toISOString(), migrations: migrations.split(/\r?\n/),
    databaseHash: sha256(dump), tableDigests: expectedSnapshot, path, hash,
  }, null, 2));
  const backupMs = Math.round(performance.now() - backupStarted);
  console.log(`PASS captured database and private receipt at ${recoveryPoint.toISOString()} (${backupMs} ms)`);
  const recoveryPointAgeMs = Date.now() - recoveryPoint.getTime();
  const restoreStarted = performance.now();
  stopStack(source);
  stacks.pop();
  const target = await prepareStack(scratch, "target");
  stacks.push(target);
  startStack(target);
  assert.notEqual(target.origin, source.origin);
  assert.equal(migrationHistory(target), migrations, "Restore target migration history differs");
  console.log(`PASS target applied the same ${migrations.split(/\r?\n/).length} BeeTip migrations`);
  assert.equal(sql(target, "select count(*) from auth.users;"), "0", "Restore needs a fresh target");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const database = await readFile(dbFile);
  assert.equal(sha256(database), manifest.databaseHash);
  restoreDatabase(target, database);
  const actualSnapshot = snapshot(target);
  const expectedRows = new Set(expectedSnapshot);
  const actualRows = new Set(actualSnapshot);
  const changedTables = [...new Set([
    ...expectedSnapshot.filter(row => !actualRows.has(row)),
    ...actualSnapshot.filter(row => !expectedRows.has(row)),
  ].map(row => row.split("|", 1)[0]))];
  assert.equal(changedTables.length, 0, `Restored table rows differ: ${changedTables.join(", ")}`);
  console.log(`PASS row counts and hashes match across ${expectedSnapshot.length} tables after restoring the database`);

  const targetProvider = await login(target, provider);
  const targetCustomer = await login(target, customer);
  const targetUnrelated = await login(target, unrelated);
  for (const participant of [targetProvider, targetCustomer]) {
    assert.deepEqual(await rpc(target, participant, "read_order", { p_id: order }), expectedOrder);
  }
  assert.deepEqual(await rpc(target, targetProvider, "read_purchase", { p_order: order }), expectedPurchase);
  const evidence = { p_order: order, p_key: receipt, p_upload: false };
  const restoredPath = await rpc(target, targetProvider, "purchase_evidence_path", evidence);
  assert.equal(restoredPath, manifest.path);
  console.log("PASS restored accounts can sign in and read the demo order and receipt metadata");
  if (!databaseOnly) {
    const missing = await request(target, bucket + restoredPath, { privileged: true });
    assert.equal(missing.status, 400, "The database-only target must be missing the object");
    await missing.body?.cancel();
    const objectBackup = await readFile(objectFile);
    assert.equal(sha256(objectBackup), manifest.hash, "Private object backup checksum differs");
    await upload(target, restoredPath, objectBackup);
  }
  const restored = await download(target, restoredPath);
  assert.equal(sha256(restored), manifest.hash, "Restored private object bytes differ");
  for (const token of [targetCustomer, targetUnrelated]) {
    const denied = await request(target, "/rest/v1/rpc/purchase_evidence_path", {
      method: "POST", token, body: evidence,
    });
    assert.equal(denied.status, 400);
    assert.match((await denied.json()).message, /^PERMISSION:/);
  }
  assert.equal(sql(target, "select public from storage.buckets where id='purchase-receipts';"), "f",
    "Receipt bucket must remain private");
  for (const route of [bucket, "/storage/v1/object/public/purchase-receipts/"]) {
    const direct = await request(target, route + restoredPath);
    assert([400, 401, 403, 404].includes(direct.status), "Anonymous download must be denied");
    await direct.body?.cancel();
  }
  console.log("PASS private receipt SHA-256 matched, customer, unrelated and anonymous access denied");
  console.log(`PASS recovery verified in ${Math.round(performance.now() - restoreStarted)} ms including target startup`);
  console.log(`Recovery point was ${recoveryPointAgeMs} ms before the simulated outage, with no intervening fixture writes`);
} finally {
  try {
    for (const stack of stacks.reverse()) stopStack(stack);
  } finally {
    console.log(`Synthetic recovery artifacts: ${scratch}`);
  }
}
