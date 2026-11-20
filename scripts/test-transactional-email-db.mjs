import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.BEETIP_LOCAL_DATABASE_URL);
assert(["postgres:", "postgresql:"].includes(url.protocol)
  && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.search && !url.hash,
  "Use an isolated loopback PostgreSQL server");
const name = `btp11_${randomUUID().replaceAll("-", "")}`;
const target = new URL(url);
target.pathname = `/${name}`;
const admin = new pg.Client({ connectionString: url.href });
const clients = [];
let created = false;

async function connect(role) {
  const client = new pg.Client({ connectionString: target.href, statement_timeout: 10000 });
  await client.connect();
  clients.push(client);
  if (role) await client.query(`set role ${role}`);
  return client;
}

const value = async (client, sql, values = []) => (await client.query(sql, values)).rows[0]?.result;
const pass = message => console.log(`PASS ${message}`);
const hash = address => createHash("sha256").update(address).digest("hex");

try {
  await admin.connect();
  for (const role of ["anon", "authenticated"]) {
    await admin.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='${role}') then create role ${role}; end if; end $$`);
  }
  await admin.query(`create database ${name} encoding 'UTF8' template template0`);
  created = true;
  const owner = await connect();
  await owner.query(readFileSync(new URL("../supabase/tests/local_platform.sql", import.meta.url), "utf8"));
  const migrations = new URL("../supabase/migrations/", import.meta.url);
  const files = readdirSync(migrations).filter(file => file.endsWith(".sql")).sort();
  const migration = files.find(file => file.endsWith("_btp11_transactional_email.sql"));
  assert(migration);
  async function migrate(file) {
    await owner.query(readFileSync(new URL(file, migrations), "utf8"));
  }
  for (const file of files.filter(file => file < migration)) await migrate(file);

  async function member(label, staffRole) {
    const id = randomUUID();
    const session = randomUUID();
    const address = `btp11-${label}@example.invalid`;
    await owner.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, address]);
    await owner.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, id]);
    if (staffRole) {
      await owner.query("insert into public.staff_roles(member_id,role) values($1,$2)", [id, staffRole]);
      await owner.query("insert into auth.mfa_factors(id,user_id,status) values($1,$2,'verified')", [randomUUID(), id]);
    }
    return { id, session, address };
  }

  async function actor(member, aal = "aal1") {
    const client = await connect("authenticated");
    await client.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: member.id, session_id: member.session, role: "authenticated", aal }),
    ]);
    return client;
  }

  async function summary(member, event = randomUUID()) {
    await owner.query("select private.enqueue_notification($1,'staff_role_changed',$2,null,array[$2]::uuid[])", [event, member.id]);
    return event;
  }

  const requester = await member("requester");
  const support = await member("support", "support");
  const replacement = await member("replacement", "support");
  const lead = await member("lead", "platform_admin");
  const preMigration = await summary(requester);
  await summary(requester, preMigration);
  await migrate(migration);
  for (const file of files.filter(file => file > migration)) await migrate(file);
  const worker = await connect("service_role");
  const overlap = await connect("service_role");
  const anon = await connect("anon");
  const requesterClient = await actor(requester);
  const supportClient = await actor(support, "aal2");
  const leadClient = await actor(lead, "aal2");
  const leadAal1 = await actor(lead);

  const claim = async client => (await client.query("select * from public.btp11_claim()")).rows;
  const prepare = (row, allowlist = null) => value(worker, "select public.btp11_prepare($1,$2,$3) result",
    [row.id, row.lease_token, allowlist]);
  const finish = (row, outcome, provider = null, delay = 0) => value(worker,
    "select public.btp11_finish($1,$2,$3,$4,$5) result", [row.id, row.lease_token, outcome, provider, delay]);
  const hook = (dispatch, recipient, provider, event) => worker.query("select public.btp11_webhook($1,$2,$3,$4)",
    [dispatch, hash(recipient.address), provider, event]);
  const operatorQueue = client => value(client, "select public.btp11_operator_queue() result");
  const action = (row, dispatch, command) => leadClient.query("select public.btp11_operator_action($1,$2,$3)",
    [row.id, dispatch, command]);
  const status = row => value(owner, "select status result from private.email_deliveries where id=$1", [row.id]);
  const dueNow = row => owner.query("update private.email_deliveries set due_at=clock_timestamp() where id=$1", [row.id]);
  const expire = row => owner.query("update private.email_deliveries set lease_until=clock_timestamp()-interval '1 second' where id=$1", [row.id]);
  const idForEvent = event => value(owner, `select s.delivery_id result from private.email_delivery_sources s
    join public.notifications n on n.id=s.notification_id where n.event_id=$1`, [event]);

  const migratedDelivery = await idForEvent(preMigration);
  assert(migratedDelivery);
  assert.equal(await value(owner, "select count(*)::int result from private.email_deliveries"), 1);
  await assert.rejects(claim(anon), /permission denied/);
  await assert.rejects(claim(requesterClient), /permission denied/);
  await assert.rejects(worker.query("select * from private.email_deliveries"), /permission denied/);
  await assert.rejects(operatorQueue(requesterClient), /PERMISSION/);
  await assert.rejects(operatorQueue(leadAal1), /PERMISSION/);
  await assert.rejects(operatorQueue(supportClient), /PERMISSION/);
  pass("historical pending intent is backfilled once and privilege grants isolate jobs and MFA platform operators");

  await worker.query("begin");
  const [first] = await claim(worker);
  assert.equal(first.id, migratedDelivery);
  assert.deepEqual(await claim(overlap), []);
  await worker.query("commit");
  await expire(first);
  const [reclaimed] = await claim(overlap);
  assert.notEqual(reclaimed.lease_token, first.lease_token);
  assert.equal(await prepare(first), null);
  assert.equal(await finish(first, "accepted", "stale@example.invalid"), false);
  const dispatch = await prepare(reclaimed, [hash(requester.address)]);
  assert.equal(dispatch.address, requester.address);
  await expire(reclaimed);
  assert.equal(await finish(reclaimed, "accepted", "stale@example.invalid"), false);
  assert.deepEqual(await claim(worker), []);
  assert.equal(await status(reclaimed), "uncertain");
  await assert.rejects(action(reclaimed, dispatch.dispatchId, "replay"), /CONFLICT/);
  await assert.rejects(action(reclaimed, dispatch.dispatchId, "reconciled_replay"), /CONFLICT/);
  await hook(dispatch.dispatchId, support, "wrong@example.invalid", "delivered");
  assert.equal(await status(reclaimed), "uncertain");
  await hook(dispatch.dispatchId, requester, "accepted@example.invalid", "accepted");
  assert.equal(await status(reclaimed), "accepted");
  await hook(dispatch.dispatchId, requester, "accepted@example.invalid", "delivered");
  await hook(dispatch.dispatchId, requester, "accepted@example.invalid", "delivered");
  assert.equal(await status(reclaimed), "delivered");
  assert.equal(await value(owner, "select count(*)::int result from private.email_webhook_receipts where event_type='delivered'"), 1);
  pass("overlapping workers skip locked rows, stale tokens fail, and a post-acceptance crash reconciles via duplicate-safe callbacks");

  const allowlistId = await idForEvent(await summary(requester));
  const [unlisted] = await claim(worker);
  assert.equal(unlisted.id, allowlistId);
  assert.equal(await prepare(unlisted, [hash(support.address)]), null);
  assert.equal(await status(unlisted), "suppressed");

  const beforeOptOut = await idForEvent(await summary(requester));
  const [optOut] = await claim(worker);
  assert.equal(optOut.id, beforeOptOut);
  await requesterClient.query("select public.set_notification_preference('staff_role_changed',false)");
  assert.equal(await prepare(optOut), null);
  await requesterClient.query("select public.set_notification_preference('staff_role_changed',true)");
  const beforeRead = await summary(requester);
  const [read] = await claim(worker);
  await requesterClient.query("select public.read_notification(id) from public.notifications where event_id=$1", [beforeRead]);
  assert.equal(await prepare(read), null);
  assert.equal(await status(read), "suppressed");

  const supportCase = await value(requesterClient, "select public.btp09_open($1,'private case','general',null) result", [randomUUID()]);
  assert.equal(await value(owner, "select count(*)::int result from private.email_deliveries where status='queued'"), 0);
  await supportClient.query("select public.btp09_act($1,'claim',0)", [supportCase]);
  const [assignment] = await claim(worker);
  assert(assignment);
  await owner.query("update public.members set status='suspended' where id=$1", [requester.id]);
  assert.equal(await prepare(assignment), null);
  await owner.query("update public.members set status='approved' where id=$1", [requester.id]);
  pass("staging allowlist, changed preference, in-app read, suspension and in-app-only support queue gate delivery at preparation");

  const fixedWindow = "2000-01-01T00:01:00Z";
  async function chatSource(sequence) {
    const event = randomUUID();
    await owner.query("select private.enqueue_notification($1,'support_message',$2,$3,array[$4]::uuid[])",
      [event, supportCase, requester.id, support.id]);
    await owner.query(`insert into private.btp08_email_sources
      select id,$2,$3,$4::timestamptz,$4::timestamptz+interval '1 minute' from public.notifications where event_id=$1`,
    [event, supportCase, sequence, fixedWindow]);
    return idForEvent(event);
  }
  const grouped = await chatSource(2);
  assert.equal(await chatSource(3), grouped);
  assert.equal(await value(owner, "select max_sequence::int result from private.email_deliveries where id=$1", [grouped]), 3);
  assert.equal(await value(owner, "select (due_at-window_end=interval '1 minute') result from private.email_deliveries where id=$1", [grouped]), true);
  const [closedGroup] = await claim(worker);
  const generation = await chatSource(4);
  assert.notEqual(generation, grouped);
  await owner.query("insert into public.conversation_reads(conversation_id,member_id,last_sequence) values($1,$2,3)", [supportCase, support.id]);
  assert.equal(await prepare(closedGroup), null);
  const [revokedGroup] = await claim(worker);
  assert.equal(revokedGroup.id, generation);
  await leadClient.query("select public.btp09_act($1,'reassign',1,$2,'shift coverage')", [supportCase, replacement.id]);
  assert.equal(await prepare(revokedGroup), null);
  assert.equal(await status(revokedGroup), "suppressed");
  for (const item of await claim(worker)) {
    const submission = await prepare(item, []);
    assert.equal(submission, null);
  }
  pass("same-window sources group once, late sources roll into a new group, and a read or replaced support assignment suppresses mail");

  const acceptedId = await idForEvent(await summary(requester));
  const [acceptedJob] = await claim(worker);
  assert.equal(acceptedJob.id, acceptedId);
  const acceptedDispatch = await prepare(acceptedJob);
  await finish(acceptedJob, "accepted", "awaiting-event@example.invalid");
  assert.equal((await operatorQueue(leadClient)).items.some(item => item.id === acceptedId), false);
  await owner.query("update private.email_deliveries set updated_at=now()-interval '49 hours' where id=$1", [acceptedId]);
  const staleAcceptance = await operatorQueue(leadClient);
  assert.equal(staleAcceptance.needsAttention, true);
  assert.equal(staleAcceptance.items.find(item => item.id === acceptedId)?.replay_ready, false);
  await assert.rejects(action(acceptedJob, acceptedDispatch.dispatchId, "replay"), /CONFLICT/);
  await action(acceptedJob, acceptedDispatch.dispatchId, "close");
  await hook(acceptedDispatch.dispatchId, requester, "awaiting-event@example.invalid", "accepted");
  assert.equal(await status(acceptedJob), "suppressed");
  await hook(acceptedDispatch.dispatchId, requester, "awaiting-event@example.invalid", "delivered");
  assert.equal(await status(acceptedJob), "delivered");
  pass("accepted sends missing a final callback enter a close-only queue and still record late delivery");

  const rateId = await idForEvent(await summary(requester));
  let rateDispatch;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const [job] = await claim(worker);
    assert.equal(job.id, rateId);
    const submission = await prepare(job);
    rateDispatch ??= submission.dispatchId;
    assert.equal(submission.dispatchId, rateDispatch);
    assert.equal(await finish(job, "rate_limited", null, 7200), true);
    assert.equal(await status(job), attempt === 5 ? "dead_letter" : "retry");
    if (attempt < 5) {
      assert.equal(await value(owner, "select (due_at>clock_timestamp()+interval '119 minutes') result from private.email_deliveries where id=$1", [job.id]), true);
      assert.deepEqual(await claim(worker), []);
      await dueNow(job);
    }
  }
  const rateRow = (await operatorQueue(leadClient)).items.find(item => item.id === rateId);
  await action(rateRow, rateDispatch, "replay");
  await assert.rejects(action(rateRow, rateDispatch, "replay"), /CONFLICT/);
  const [replayedRate] = await claim(worker);
  const replayedDispatch = await prepare(replayedRate);
  assert.notEqual(replayedDispatch.dispatchId, rateDispatch);
  assert.equal(await finish(replayedRate, "transport_uncertain"), true);
  await owner.query("update private.email_deliveries set updated_at=clock_timestamp()-interval '31 minutes' where id=$1", [rateId]);
  await action(replayedRate, replayedDispatch.dispatchId, "reconciled_replay");
  const [reconciled] = await claim(worker);
  await hook(replayedDispatch.dispatchId, requester, "reconciled@example.invalid", "accepted");
  assert.equal(await prepare(reconciled), null);
  assert.equal(await status(reconciled), "accepted");
  await hook(replayedDispatch.dispatchId, requester, "different@example.invalid", "hard_bounce");
  assert.equal(await status(reconciled), "accepted");
  await hook(replayedDispatch.dispatchId, requester, "reconciled@example.invalid", "hard_bounce");
  await hook(replayedDispatch.dispatchId, requester, "reconciled@example.invalid", "accepted");
  await hook(replayedDispatch.dispatchId, requester, "reconciled@example.invalid", "delivered");
  assert.equal(await status(reconciled), "dead_letter");
  await assert.rejects(action(reconciled, replayedDispatch.dispatchId, "replay"), /CONFLICT/);
  await action(reconciled, replayedDispatch.dispatchId, "close");
  await summary(requester);
  const [bounced] = await claim(worker);
  assert.equal(await prepare(bounced), null);
  assert.equal(await status(bounced), "suppressed");
  assert.equal(await value(owner, "select count(*)::int result from private.audit_events where target_id=$1 and event_type like 'email_%'", [rateId]), 3);
  pass("capped retries respect provider hints, audited replay uses a fresh key, late acceptance cancels a queued replay, and hard bounce blocks future mail");

  const corrected = await member("corrected");
  const correctedId = await idForEvent(await summary(corrected));
  const [originalJob] = await claim(worker);
  assert.equal(originalJob.id, correctedId);
  const originalSubmission = await prepare(originalJob);
  assert.equal(await finish(originalJob, "transport_uncertain"), true);
  await owner.query("update private.email_deliveries set updated_at=clock_timestamp()-interval '31 minutes' where id=$1", [correctedId]);
  const newAddress = "btp11-corrected-new@example.invalid";
  await owner.query("update auth.users set email=$2 where id=$1", [corrected.id, newAddress]);
  await action(originalJob, originalSubmission.dispatchId, "reconciled_replay");
  const [correctedReplay] = await claim(worker);
  assert.equal(correctedReplay.id, correctedId);
  await hook(originalSubmission.dispatchId, corrected, "old-address@example.invalid", "hard_bounce");
  await hook(originalSubmission.dispatchId, corrected, "old-address@example.invalid", "hard_bounce");
  assert.equal(await status(correctedReplay), "leased", "the old address's bounce must leave the corrected replay claim intact");
  assert.equal(await value(owner, "select count(*)::int result from private.email_webhook_receipts where dispatch_id=$1 and event_type='hard_bounce'", [originalSubmission.dispatchId]), 1);
  assert.equal(await value(owner, "select reason result from private.email_suppressions where address_hash=$1", [hash(corrected.address)]), "hard_bounce");
  const correctedSubmission = await prepare(correctedReplay, [hash(newAddress)]);
  assert.equal(correctedSubmission.address, newAddress);
  assert.notEqual(correctedSubmission.dispatchId, originalSubmission.dispatchId);
  assert.equal(await finish(correctedReplay, "accepted", "new-address@example.invalid"), true);
  assert.equal(await status(correctedReplay), "accepted");
  pass("duplicate late hard bounces suppress the original address while an authorized replay reaches the corrected address");

  await owner.query("update private.email_budget set submissions=100");
  await summary(support);
  const [budget] = await claim(worker);
  assert.equal(await prepare(budget), null);
  assert.equal(await status(budget), "retry");
  assert.equal(await value(owner, "select attempts result from private.email_deliveries where id=$1", [budget.id]), 0);
  assert.equal(await value(owner, "select monitoring_since result from private.email_worker_health"), null);
  assert.equal((await operatorQueue(leadClient)).missedScheduler, false);
  await owner.query("update private.email_worker_health set monitoring_since=now()-interval '6 minutes'");
  assert.equal((await operatorQueue(leadClient)).missedScheduler, true);
  await worker.query("select public.btp11_heartbeat()");
  assert.equal((await operatorQueue(leadClient)).missedScheduler, false);
  await owner.query("update private.email_deliveries set due_at=now()-interval '6 minutes' where id=$1", [budget.id]);
  assert.equal((await operatorQueue(leadClient)).overdue, true);
  const [budgetReclaimed] = await claim(worker);
  assert.equal(budgetReclaimed.id, budget.id);
  await owner.query("update public.staff_roles set revoked_at=clock_timestamp() where member_id=$1", [lead.id]);
  await assert.rejects(operatorQueue(leadClient), /PERMISSION/);
  pass("daily budget defers work, missed scheduler and overdue work surface, and role revocation denies an existing AAL2 session");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Transactional email verification failed");
  process.exitCode = 1;
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  if (created) await admin.query(`drop database ${name}`);
  await admin.end();
}
