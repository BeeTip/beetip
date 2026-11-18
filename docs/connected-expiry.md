# Connected reservation expiry

BTP-07 adds `20261119000709_btp07_reservation_expiry.sql` after the integrated notification migrations. Baseline is merge `930f22f714a3537d9c4b7f0b4fe63d4800ea9f32`, containing required `acc4f9920b6cf33e033ad19503426218758a8d7d`. This document extends the acceptance contract in [connected-orders.md](connected-orders.md), specifically its earlier statement that no expiry worker exists.

Parent integration subsequently passed dedicated-development Cron and real-session acceptance. [The integration record](expiry-chat-acceptance.md) supersedes the implementation-only hosted gates below; web deployment and future evidence-backed funding remain pending.

## Deadline and capacity

An unpaid reservation is unusable at `expires_at <= clock_timestamp()`. `read_order` and `browse_orders` derive `expired` even if cleanup has never run. Both public wrappers are volatile because time can advance within a transaction. A browser timestamp never decides expiry. The detail screen refreshes the server projection every 30 seconds, offers a manual refresh, times out a stalled request after 15 seconds and offers a read-only retry on failure. An order/account change remounts its private state. Unknown states have an explicit unavailable label.

Acceptance already excludes overdue unpaid reservations from capacity. Its capacity query and the listing-edit guard now preserve reservations with `funding_verified_at`, including after the original unpaid deadline. Immutable snapshots, receipt recovery and request/offer uniqueness remain intact. Replaying a committed acceptance returns its original order ID even after expiry, allowing response-loss reconciliation; that replay does not revive the reservation. A new acceptance on the same request or offer remains refused. Expiry does not automatically reopen a request or reactivate an accepted offer.

## Funding transaction contract

[BTP-12](connected-funding.md) integrates the private helpers into the synthetic incoming-funding command. The helpers have no `PUBLIC`, `anon` or `authenticated` execute grants.

The funding command authorizes its operator and checks the bank entry, binds its operation receipt, and calls `private.btp07_preserve_verified_funding(order_id)` in the transaction that persists the verified funding record and audit. A failure rolls back the marker. Its timestamp records the database verification decision. Evidence arriving after the deadline needs a separate late-money reconciliation or refund policy and cannot restore capacity.

Lock order is operation receipt if applicable, capacity-owning listing, order, reservation. `private.btp07_lock_payable_order` acquires those business locks and checks the wall clock after all waits. It rejects expired/cancelled/released orders even if cleanup is delayed. Future amendment, purchase or other reservation-sensitive commands must use this guard or preserve its exact contract. It permits an existing verified reservation after its unpaid deadline, while further funding sufficiency and fulfillment checks remain the future command's responsibility. Commands spanning multiple capacity owners must lock listings in ascending UUID order before orders/reservations. BTP-07 workers use `SKIP LOCKED` for each business lock so workers cannot deadlock with each other while traversing different listings.

Verification wins only if the locked verification decision occurs before the deadline. Once its marker commits, expiry skips that reservation permanently and acceptance/listing edits continue counting it. Expiry wins when it commits the release first, or when verification reaches the lock after the deadline. `released_at` and verified funding are mutually exclusive by constraint. The expiry update, `orders.state='expired'` and one sanitized `reservation_expired` audit fact commit together. Repeated jobs preserve the original release timestamp. Refund handling belongs to the cancellation and settlement workflows.

## Cron, job audit and recovery

`private.btp07_expire_reservations(limit)` accepts 1 through 500, defaults to 100, bounds candidate count and releases at most that many orders. Candidates are oldest overdue unpaid reservations first. Busy listings/orders/reservations are skipped for later attempts. Cancelled and verified orders do not consume the batch. The helper is owner-only.

The named job `btp07-reservation-expiry` runs `private.btp07_run_expiry()` every minute. Re-scheduling the same name replaces its definition. A transaction advisory lock `(707,9)` prevents overlapping scheduled runs. An overlapping invocation returns zero and writes an `overlap` run fact without waiting on the winning heartbeat. Separate direct maintenance batches remain safe through business locks and rechecks. A normal run can release 100 orders per minute; downtime is caught up by repeated bounded runs. Sustained arrivals above that rate require an operator capacity decision. A locked oldest batch can defer progress until the blocking transaction finishes.

`private.btp07_expiry_runs` records start, finish, status, count and SQLSTATE only. `private.btp07_expiry_heartbeat` records last attempt, last successful completion and last status. Both have RLS and no client privileges. Raw exception messages, JWTs, bank evidence, addresses and contacts are excluded. An exception rolls back the whole batch subtransaction and commits a sanitized failure run. The next run retries the same still-unreleased work. A crash, cancellation, timeout or outer transaction rollback may prevent recording a heartbeat, so stale success is itself an alert condition. Operator-only log retention should be configured with the project's audit retention policy; BTP-07 does not delete audit history.

Migration installs pg_cron and the job when the extension is available. A plain PostgreSQL installation without pg_cron emits `BTP07: pg_cron unavailable; expiry schedule NOT installed`. This is an explicit incomplete scheduling gate, never a successful Cron acceptance. Hosted installation or scheduling errors fail the migration. A parent operator must verify the actual job and two completed scheduled runs before accepting automation.

Operator read-back after the parent applies the reviewed integrated schema:

```sql
select jobname,schedule,command,active from cron.job where jobname='btp07-reservation-expiry';
select * from private.btp07_expiry_heartbeat;
select started_at,finished_at,status,released_count,error_code
from private.btp07_expiry_runs order by finished_at desc limit 20;
select count(*) as overdue_unpaid
from public.reservations r join public.orders o on o.id=r.order_id
where o.state='awaiting_payment' and r.released_at is null
  and r.funding_verified_at is null and r.expires_at<=clock_timestamp();
```

Alert when the job is missing/inactive, last status is failed, no heartbeat exists after installation, last success is over three minutes old, or oldest overdue work continues increasing. Inspect pg_cron's `job_run_details` under operator access for infrastructure failures. Manual recovery calls the owner-only batch in short transactions, at most 500 per call, until the backlog drains. Check long-held locks before increasing batch size. Run/audit rows are private operational facts, not a public health endpoint.

`supabase/rollback/btp07_reservation_expiry.sql` is a non-destructive operational rollback: it waits for the scheduled-run advisory lock and removes only this named schedule. It retains terminal orders, the funding marker, capacity guards, private manual recovery functions and audit history. A destructive schema down-migration would discard financial protections and is deliberately excluded. Redeploying the web alone does not pause database jobs. Resume with the same named `cron.schedule` statement after fixing the cause.

## Repeat local validation

Use Node 24.22.1, the frozen pnpm lockfile, and an explicitly disposable loopback PostgreSQL 18 server. No rtk installation is needed by either JavaScript harness or CI. `rtk` below is this Windows workspace's shell prefix only.

```powershell
$env:BEETIP_LOCAL_DATABASE_URL = 'postgres://postgres@127.0.0.1:55486/postgres'
rtk proxy node scripts/test-btp07-expiry.mjs
rtk proxy node scripts/test-atomic-acceptance.mjs
rtk pnpm test
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test:e2e
```

The BTP-07 harness rejects non-loopback URLs and connection-query overrides, creates its own randomly named `btp07_*` database, applies every sorted migration, and drops only that database in `finally`. It uses the repository's explicit test-only Auth/Storage stubs. It never stops its PostgreSQL server or reads project credentials. It covers private privileges/RLS, invalid batch bounds, delayed-job command/read/list guards, receipt replay, exactly-once release/audit, verification before deadline, expiry before verification, actual lock-wait deadline passage, funded capacity preservation, concurrent bounded workers, scheduled-run overlap, downtime catch-up, injected audit failure and heartbeat recovery. UI tests cover server authority, refresh, stalled reads, retry and account isolation.

On 18 November 2026, Node 24.22.1 and isolated plain PostgreSQL 18 passed all 10 reported BTP-07 groups, including rollback read-back, plus all 13 existing atomic-acceptance regression groups. All 65 unit/component tests, lint, typecheck and 16 production-demo Playwright journeys passed. The temporary databases were dropped and only this worker's own temporary server on port 55487 was stopped. The parent server was not stopped. Local platform stubs and direct function calls do not establish actual pg_cron, PostgREST or real-session connected acceptance.

## Integration and hosted acceptance gates

Shared order edits are limited to `apps/web/src/components/connected-order.tsx` and `apps/web/src/app/account/orders/page.tsx`, plus a new shared label helper and component tests. The migration replaces `private.accept_order`, `private.guard_reserved_listing`, `private.read_order` and `private.browse_orders`; it preserves their signatures and authorization. Integrate any BTP-08 projection changes without dropping the derived state, reservation join or volatile wrappers. Parent owns regenerated database types and all hosted schema work.

After independent review, the parent must apply only the integrated migration to the dedicated development project, regenerate types, run advisors, read back function ACLs/RLS and job definition, and observe two real Cron completions. Use disposable synthetic orders to prove expiry with all browser tabs closed, correct participant views, private job-table denial and backlog catch-up. Repeat real-session order acceptance, list pagination and detail reads, including response-loss replay and unauthorized users. Future evidence-backed funding acceptance must prove the helper and real funding record share a transaction. Preserve retained users/accounts and existing support/MFA data. No hosted mutation, deployment, real bank verification, production release or live Cron acceptance is claimed by this implementation.

Official references checked during implementation: [Supabase Cron quickstart](https://supabase.com/docs/guides/cron/quickstart), [Supabase changelog](https://supabase.com/changelog.md), and [PostgreSQL SELECT locking](https://www.postgresql.org/docs/current/sql-select.html). Current Cron documentation specifies named-job replacement and `cron.unschedule`; PostgreSQL documents `SKIP LOCKED` for queue-like consumers. No relevant Cron breaking change was found in the checked changelog.
