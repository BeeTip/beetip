# BTP-23 local recovery rehearsal

Run from the exact BeeTip Git revision you want to rehearse. Prerequisites are Git, Node.js 22, local Docker, and Supabase CLI 2.114.0, the version used by BeeTip CI. The rehearsal creates its own two Supabase projects, chooses unused local ports, and uses local synthetic credentials and data. It needs no application server or package install.

```powershell
node scripts/test-btp23-recovery.mjs
```

The rehearsal creates a connected demo order, confirms its simulated checkout, and records a synthetic PNG in the private `purchase-receipts` bucket. It exports `public`, `private`, and `auth` data and separately downloads the PNG. It stops the source and starts a fresh target, applies the same repository migrations, checks the migration versions, and restores the database data. Each included table's row count and sorted row digest must match the source. The target starts from the migration baseline, and the comparison also catches a conflicting baseline row that a restore insert skipped. Supabase manages the Auth migration history on each stack. The expiry scheduler's run and heartbeat tables are excluded because the local scheduler can write fresh telemetry during startup.

The object backup is tied to the durable receipt path and SHA-256. The target Storage API recreates the object metadata at the original path. The test uses new target logins to compare the order and receipt with the source, resolves the provider's evidence path through the application RPC, and verifies the downloaded bytes. It also checks evidence denial for the customer and an unrelated member, verifies the bucket is private, and requests both Storage URLs anonymously.

Supabase database backups exclude Storage bytes. Store a separate copy of those bytes and verify them against the restored application references. [Supabase database backups](https://supabase.com/docs/guides/platform/backups)

Run `node scripts/test-btp23-recovery.mjs --database-only` to reproduce the failure control. The database checks and restored account reads should pass, then the command should exit with status 1 at `Download private receipt returned HTTP 400`.

The script prints the candidate Git commit and marks a dirty worktree. The recovery point is the start of the database dump after fixture writes have finished. The elapsed recovery time starts before the source stops and ends after target verification. It includes local target provisioning and migrations. These timings are for one fixture and a quiescent source.

The final line prints the temporary artifact directory. Keep `database.sql`, `receipt.png`, and `manifest.json` together if retaining evidence. The database export contains synthetic Auth rows, including password hashes and session records. Keep the artifacts local and delete them when they are no longer needed. The script removes only its own generated Docker projects and volumes.

This exercises one receipt and a data-only restore into the same migration revision. The combined rehearsal at `66254ffa9a1245b36b6599b9facc1cf6effcc373` restored 81 matching tables and an identical private receipt in 73.845 seconds. The backup point was 420 ms before the simulated outage with no intervening fixture writes. The [pilot targets](pilot-operating-policy.md) also require a repeatable backup cadence and a service recovery drill. These local results measure fixture recovery only.

## Pause connected demo acceptance and checkout

Use a privileged database session on the approved project after migration `20261121015951_btp23_demo_incident_pause.sql` is installed. Record the project, application revision, operator, incident ID, reason, and UTC timestamps in the incident record. Run the pause as a standalone transaction and confirm it committed.

```sql
insert into private.demo_incident_pause default values on conflict do nothing;
select exists (select 1 from private.demo_incident_pause) as paused;
```

The pause takes effect at commit. It waits for transactions that have already reached the guarded write to finish. From an authorized synthetic test session, verify that a valid new acceptance and the first simulated checkout of an unexpired pending order return HTTP 503 with the pause message. Keep the original operation ID and acceptance payload for any retry. Read the pending order and order history, retry a known committed acceptance with its original ID and payload, and retry a known confirmed checkout. Check that the retries return the existing results and add no audit events. Pending orders keep their original reservation deadlines and may expire while paused.

Record affected order and operation IDs and reconcile BeeTip audit, email provider outcomes, and any external bank records before authorizing recovery. Confirm ambiguous outcomes with provider or bank evidence before repeating an external operation. Keep the pause active during a compatible app rollback and recheck it on any restored environment before admitting traffic. A restored database reflects the pause state at the backup point.

After the incident lead approves resumption, run and verify the resume as a standalone transaction on the same project.

```sql
delete from private.demo_incident_pause where active;
select exists (select 1 from private.demo_incident_pause) as paused;
```

Expect `paused = false`. Verify a valid synthetic acceptance, an unexpired pending checkout, and the resulting order and audit entries. Record the resumption time and verification outcomes. The local PostgreSQL rehearsal runs these database checks through `node scripts/test-atomic-acceptance.mjs` with `BEETIP_LOCAL_DATABASE_URL` pointed at a disposable loopback cluster.
