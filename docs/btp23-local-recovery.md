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

This exercises one receipt and a data-only restore into the same migration revision. It leaves provider-managed backups, point-in-time recovery, concurrent writes across database and Storage, complete object inventories and metadata, server route and Vercel release verification, scheduler and secret rotation, incident pause, and external reconciliation for separate drills. Owner-approved recovery targets are still pending.
