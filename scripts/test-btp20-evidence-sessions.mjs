import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";

const workdir = process.env.BEETIP_TEST_LOCAL_STACK;
assert(workdir, "Set BEETIP_TEST_LOCAL_STACK to a disposable local Supabase workdir");
const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3120";
const localOrigin = /^http:\/\/127\.0\.0\.1:\d+$/;
assert.match(origin, localOrigin);
const stack = JSON.parse(execFileSync("rtk", ["proxy", "supabase", "status", "--workdir", workdir, "-o", "json"], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}));
assert.match(stack.API_URL, localOrigin);
const database = new URL(stack.DB_URL);
assert(database.protocol === "postgresql:" && database.hostname === "127.0.0.1" && !database.search);
const sql = new pg.Client({ connectionString: database.href, statement_timeout: 10000 });

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
const sharp = require("sharp");
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(stack.API_URL, stack.SECRET_KEY, options);
const bucket = "affiliation-evidence";
const password = randomBytes(24).toString("base64url");
const members = [];
const paths = [];

async function actor() {
  const email = `btp20-${randomUUID()}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: "Penguji Bukti" },
  });
  assert.ifError(error);
  members.push(data.user.id);
  const jar = new Map();
  const client = createServerClient(stack.API_URL, stack.PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: entries => entries.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signIn.error);
  return { id: data.user.id, client, cookie: () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
}

async function app(actor, suffix, method, status, body, contentType = "application/json") {
  const response = await fetch(`${origin}/api/identity/affiliation${suffix}`, {
    method, body, headers: { Cookie: actor.cookie(), Origin: origin, "Content-Type": contentType },
  });
  assert.equal(response.status, status, `${method} affiliation: expected ${status}`);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response;
}

async function command(actor, action, requestId, value = "") {
  await app(actor, "", "POST", 200, JSON.stringify({ operationId: randomUUID(), action, requestId, value }));
}

async function draft(owner) {
  const id = randomUUID();
  await command(owner, "begin", id, "Kampus Uji");
  const path = `${owner.id}/${id}/evidence`;
  paths.push(path);
  return { id, path, endpoint: `/${id}/evidence` };
}

async function verifyMfa(actor) {
  const enrolled = await actor.client.auth.mfa.enroll({ factorType: "totp" });
  assert.ifError(enrolled.error);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...enrolled.data.totp.secret].map(char => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const code = String((hash.readUInt32BE(hash[hash.length - 1] & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
  const verified = await actor.client.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code });
  assert.ifError(verified.error);
}

const optionsPNG = { contentType: "image/png", upsert: false };
const image = await sharp({ create: { width: 24, height: 12, channels: 3, background: "#FDB900" } })
  .withExif({ IFD0: { ImageDescription: "Metadata sintetis" } }).png().toBuffer();

await sql.connect();
try {
  const owner = await actor();
  const unrelated = await actor();
  const reviewer = await actor();
  const request = await draft(owner);
  const ownerBucket = owner.client.storage.from(bucket);
  const unrelatedBucket = unrelated.client.storage.from(bucket);
  assert((await owner.client.rpc("claim_affiliation_upload", {
    p_request: request.id, p_member: owner.id, p_digest: "0".repeat(64),
  })).error, "Only the server can claim an upload");
  assert((await ownerBucket.upload(request.path, image, optionsPNG)).error, "Draft owner must be denied direct Storage upload");
  assert((await unrelatedBucket.upload(request.path, image, optionsPNG)).error, "Unrelated account must be denied direct Storage upload");
  assert((await ownerBucket.createSignedUploadUrl(request.path)).error, "Draft owner must be denied signed uploads");

  const otherBuckets = [
    ["funding-evidence", randomUUID()],
    ["purchase-receipts", `${owner.id}/${randomUUID()}/${randomUUID()}/${"0".repeat(64)}`],
    ["order-case-evidence", `${owner.id}/${randomUUID()}/${randomUUID()}/${"0".repeat(64)}`],
  ];
  for (const [name, path] of otherBuckets) {
    const storage = owner.client.storage.from(name);
    assert((await storage.upload(path, image, optionsPNG)).error, `Direct uploads must be denied for ${name}`);
  }

  await app(unrelated, request.endpoint, "PUT", 403, image, "image/png");
  await app(owner, request.endpoint, "PUT", 400, Buffer.from("Gambar rusak"), "image/png");
  assert((await ownerBucket.download(request.path)).error, "Rejected uploads must leave no evidence");
  const uploads = await Promise.all([1, 2].map(async () => {
    const response = await app(owner, request.endpoint, "PUT", 200, image, "image/png");
    return (await response.json()).alreadyUploaded;
  }));
  assert.deepEqual(uploads.sort(), [false, true], "Concurrent matching uploads must share one claim");

  const otherImage = await sharp({ create: { width: 24, height: 12, channels: 3, background: "blue" } }).png().toBuffer();
  await app(owner, request.endpoint, "PUT", 409, otherImage, "image/png");
  assert((await ownerBucket.upload(request.path, otherImage, { ...optionsPNG, upsert: true })).error, "Direct overwrite must be denied");
  assert((await ownerBucket.createSignedUrl(request.path, 60)).error, "Owner must use a live authorized download");
  const stored = await ownerBucket.download(request.path);
  assert.ifError(stored.error);
  assert.ifError((await ownerBucket.info(request.path)).error);
  const storedBytes = Buffer.from(await stored.data.arrayBuffer());
  assert((await sharp(image).metadata()).exif);
  assert.equal((await sharp(storedBytes).metadata()).exif, undefined);
  assert.deepEqual(await sharp(storedBytes).raw().toBuffer(), await sharp(image).raw().toBuffer());
  const download = await app(owner, request.endpoint, "GET", 200);
  assert.match(download.headers.get("content-disposition"), /^attachment/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), storedBytes);
  await app(unrelated, request.endpoint, "GET", 403);
  assert((await unrelatedBucket.download(request.path)).error);
  await sql.query("insert into public.staff_roles(member_id, role) values ($1, 'membership_review')", [reviewer.id]);
  const reviewerBucket = reviewer.client.storage.from(bucket);
  await app(reviewer, request.endpoint, "GET", 403);
  await command(owner, "submit", request.id);
  await app(owner, request.endpoint, "PUT", 403, image, "image/png");
  await app(reviewer, request.endpoint, "GET", 403);
  await verifyMfa(reviewer);
  await app(reviewer, request.endpoint, "GET", 200);
  assert.ifError((await reviewerBucket.download(request.path)).error);
  await sql.query("update public.staff_roles set revoked_at = now() where member_id = $1", [reviewer.id]);
  await app(reviewer, request.endpoint, "GET", 403);
  assert((await reviewerBucket.download(request.path)).error);

  await command(owner, "withdraw", request.id);
  const legacy = await draft(owner);
  const fixtureUpload = await admin.storage.from(bucket).upload(legacy.path, image, optionsPNG);
  assert.ifError(fixtureUpload.error);
  const retry = await app(owner, legacy.endpoint, "PUT", 200, image, "image/png");
  assert.equal((await retry.json()).alreadyUploaded, true);
  const legacyDownload = await app(owner, legacy.endpoint, "GET", 200);
  assert.deepEqual(Buffer.from(await legacyDownload.arrayBuffer()), image);
  await command(owner, "submit", legacy.id);
  await command(owner, "withdraw", legacy.id);
  const contested = await draft(owner);
  const images = [image, otherImage];
  const responses = await Promise.all(images.map(body => fetch(`${origin}/api/identity/affiliation${contested.endpoint}`, {
    method: "PUT", body, headers: { Cookie: owner.cookie(), Origin: origin, "Content-Type": "image/png" },
  })));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409], "Only one image can win a concurrent upload");
  const winningImage = images[responses.findIndex(response => response.ok)];
  const contestedDownload = await app(owner, contested.endpoint, "GET", 200);
  assert.deepEqual(await sharp(Buffer.from(await contestedDownload.arrayBuffer())).raw().toBuffer(),
    await sharp(winningImage).raw().toBuffer());
  console.log("PASS: local Auth, Storage and affiliation API enforce validated writes, scoped reads and immutable retries.");
} finally {
  try {
    if (paths.length) assert.ifError((await admin.storage.from(bucket).remove(paths)).error);
    await sql.query("delete from public.staff_roles where member_id = any($1::uuid[])", [members]);
    await sql.query("delete from public.affiliation_requests where member_id = any($1::uuid[])", [members]);
    for (const id of members) assert.ifError((await admin.auth.admin.deleteUser(id)).error);
  } finally {
    await sql.end();
  }
}
