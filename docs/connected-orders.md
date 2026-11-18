# Connected atomic acceptance

BTP-06 adds fixed-request taking and listing-owner approval of versioned offers. Both paths call `public.accept_order`, an invoker wrapper over the single invariant owner `private.accept_order`. The actor always comes from the authenticated session. No hosted schema or existing hosted account was changed during implementation.

## Transaction and lock contract

The command binds an operation UUID to the complete canonical JSONB payload: listing ID/revision and optional offer ID/revision. The actor/operation receipt is inserted and locked before any business lock. An identical concurrent retry waits and returns the committed order ID, including after cutoff or listing closure. A changed payload or command conflicts. A business refusal rolls the transaction back, including its incomplete receipt.

Lock order is receipt, capacity-owning listing, offer if supplied, then the two member rows in ascending UUID order. In the current connected schema a trip is a listing with `type='trip'`; there is no separate trip table or link from a request to another trip. A request uses its own listing as capacity owner. A trip order stores that same listing as `trip_id`. Future commands touching multiple listings must lock them in ascending UUID order before offers. Offer mutations already lock listing before offer, so withdrawal/revision and acceptance serialize consistently.

After the locks, database `clock_timestamp()` checks cutoff, including time spent waiting for a lock. Acceptance checks live account/session authorization, both confirmed non-suspended counterparties, listing status and revision, current offer revision and its explicit listing consent, fee bounds, remaining reservation count and total item spending. The listing lock serializes both capacity checks. Listing edits cannot reduce limits below live reservations or change the kind of a listing with orders.

One commit creates the order, insert-only `order_terms`, reservation, order conversation and exactly two participant memberships, sanitized audit fact, counterparty notification intent and receipt result. The snapshot contains accepted item details, budget, fee, destination, listing classification and schedule. A trigger rejects snapshot updates/deletion even by privileged writers. Only participants with current active sessions can read orders, snapshots, reservations or their conversation. Support roles retain the existing scoped role/MFA checks and gain no order access.

`request_id` is unique only for request orders. `offer_id` is unique for any accepted offer. `trip_id` is indexed but deliberately non-unique, allowing several independent trip orders. Accepted offers become terminal for the existing save/withdraw command. A taken request is closed to public browsing. Reservations expire at the earlier of 15 minutes or listing cutoff. Expired trip reservations stop consuming capacity without a cleanup write. Request uniqueness is permanent in this slice; reopening a cancelled request requires an explicit later contract rather than silently creating another order.

This slice has no funding verification, cancellation or expiry worker. Later funding/expiry/amendment commands must lock the same listing before order/reservation changes and preserve verified funding capacity rather than relying on the unpaid reservation deadline. No payment or settlement claim follows from acceptance.

## UI and recovery

`POST /api/identity/orders` validates exact UUID/revision commands, same-origin JSON, body size, confirmed session and the expected-account header. It uses the user's token, never a service credential. `GET` returns a private no-store participant projection. Fixed request taking and negotiated acceptance are available through the listing's offers screen with explicit consent. Accepted orders are discoverable through `Pesanan saya` on the account dashboard and have private snapshot detail pages. Public listing reads and guest browsing keep their existing access policy.

The acceptance component keeps the complete pending command in memory. Network loss, malformed responses and HTTP 502/503 preserve its operation ID and original payload; retry uses those original bytes even if displayed props changed. A 15-second request timeout makes an unknown response recoverable. A definite 400/401/403/409 releases the attempt. Logout/account change removes the existing private-screen boundary and its pending attempts. Full page reload discards the in-memory attempt; the account orders screen reconciles committed orders before another business command. Request/offer uniqueness also prevents duplicate acceptance from a new operation.

## BTP-10 notification boundary

Migration `20261118062602_atomic_acceptance.sql` precedes notification delivery. It owns `private.acceptance_notification_intents` with columns `order_id`, `recipient_id`, `event_type='order_accepted'` and `created_at`, and primary key `(order_id,recipient_id)`. The recipient is the other affected party, excluding the actor. This durable private intent contains no message, address, contact or bank data. Members have no read/write privileges.

BTP-10 should add an idempotent bridge trigger into its common in-app/outbox owner, plus backfill for intents created before that trigger. The bridge must participate in the acceptance transaction, use the intent key as its source deduplication key and recheck recipient access before delivery. No email/network call occurs here. Delivery and in-app notification visibility remain BTP-10 integration gates; this migration alone does not deliver notifications. This boundary and version were sent to the parent during implementation.

## Repeat local validation

The harness refuses non-loopback database URLs, creates a randomly named isolated database, applies every repository migration and drops only that database in `finally`. It supplies minimal test-only Auth/Storage definitions, not real GoTrue/PostgREST/Storage behavior. It creates only its synthetic local accounts. It does not connect to `rgiptdfjlmwldngapojq`.

With a disposable PostgreSQL server running locally:

```powershell
$env:BEETIP_LOCAL_DATABASE_URL = 'postgres://postgres@127.0.0.1:55486/postgres'
rtk proxy node scripts/test-atomic-acceptance.mjs
rtk pnpm test
rtk pnpm typecheck
rtk pnpm lint
rtk pnpm test:e2e
```

The SQL harness runs the existing rollback-only listing/offer suites and `supabase/tests/atomic_acceptance.sql`, then exercises separate PostgreSQL sessions. Its race assertions observe actual `pg_stat_activity` lock waits before releasing the competing transaction. It covers identical concurrent receipts, concurrent changed payloads, final-slot and spending limits, multiple trip orders, competing request offers, accepted-offer withdrawal, moderation/reschedule/cutoff conflicts, wall-clock expiry during lock wait, immutable snapshots, private reads, direct-write denial, and injected final-intent failure with rollback and recovery.

The standalone acceptance SQL suite contains 18 rollback-only assertions and can be run on the dedicated project only after parent coordination. It creates synthetic users/sessions inside its transaction and rolls them back. Do not apply the migration, run shared schema cleanup, or run fixture suites on the hosted project independently.

## Evidence and remaining gates

Local PostgreSQL 18 migration, SQL and true concurrent-session tests passed, including new-table RLS/anonymous RPC denial and preserved support MFA/grant checks. The 58 unit/component tests, lint and typecheck passed. Component tests verify the original operation/payload survives response loss and 502/503, and that a definitive conflict requires renewed consent before a new operation. The connected production build passed with local build-only configuration. All 16 existing demo browser journeys passed against the production demo build; these validate demo regression only. The production dependency audit found no known vulnerabilities.

Real Supabase Auth sessions, hosted migration/application read-back, PostgREST/RLS integration, connected browser flows and notification bridge delivery remain unverified. Docker was unavailable, so this run used plain PostgreSQL with explicit platform stubs. Parent must coordinate hosted acceptance evidence and advisors after integrating BTP-10. Hand-added RPC declarations in `database.types.ts` need regeneration from the integrated schema, including the new tables. No push, PR, merge, hosted deployment or paid provisioning belongs to this implementation.

The SQL security shape follows [Supabase database function guidance](https://supabase.com/docs/guides/database/functions) and [PostgreSQL locking semantics](https://www.postgresql.org/docs/current/explicit-locking.html). The Supabase changelog was checked before implementation; no relevant server function breaking change was identified for this pinned client/CLI setup.
