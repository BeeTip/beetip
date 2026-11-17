# BeeTip architecture candidate: server command monolith

## Problem

BeeTip currently demonstrates listing, order, funding, delivery, and support flows through a synchronous `DemoService` over one browser's synthetic state. The production pilot needs real accounts, private order and support chat, in-app and email notifications, supervised manual payment operations, and Vercel hosting. That change crosses trust, concurrency, and retry boundaries: local persona checks and storage cannot authorize actions or establish payment truth. Preserve the Indonesian mobile web journeys, two-way participation, immutable accepted terms, integer IDR, per-order fulfillment and settlement, and second-admin review. Never import demo actors, state, payment records, or codes into production authority.

## Usage (caller's view)

Client components use server-rendered read models and a small asynchronous command API. The API accepts domain inputs, not Supabase or HTTP wire types. Reads paginate and redact private fields according to the signed-in actor.

```ts
const order = await beeTip.orders.acceptOffer({ offerId, requestKey });
await beeTip.chat.send({ conversationId, body, requestKey });
const page = await beeTip.chat.history({ conversationId, after: cursor, limit: 40 });
await beeTip.support.reply({ conversationId, body, requestKey });
```

```ts
// Customer accepts a provider offer; terms and capacity are committed atomically.
const accepted = await beeTip.orders.acceptOffer({ offerId, requestKey });
// accepted.orderId and accepted.terms are authoritative; payment instructions are informational.
```

```ts
// Provider subscribes after the durable catch-up page is loaded.
const page = await beeTip.chat.history({ conversationId, after: cursor, limit: 40 });
chatView.merge(page.messages); // merge by stable message ID, never by event arrival order
const subscription = await beeTip.chat.subscribe({ conversationId, onHint: reloadFromCursor });
```

```ts
// Admin records a manually verified incoming transfer; a separate reviewer approves exceptions.
await beeTip.payments.recordIncoming({ orderId, amountIdr, externalReference, requestKey });
```

## Shape

### Recommended whole-system shape

Use a modular monolith inside the existing Next.js application. Server Actions or Route Handlers are transport adapters only. Each feature module owns its command validation, actor authorization, query projection, and database calls. PostgreSQL functions/transactions are the single atomic boundary for invariants spanning rows. Realtime is a delivery hint over durable rows, not a second write path. Supabase Auth supplies identity; an application membership row supplies approval and role. Vercel deploys stateless server code, while Postgres persists all authority.

This chooses server-command ownership over direct browser-to-Supabase domain writes. It keeps framework, storage and transport types private and concentrates policy behind the domain-facing surface, per boundary-discipline and information-leakage. Server modules can still use Supabase for scoped reads and realtime subscriptions. Financial and workflow mutations go through the server command boundary and narrow database transactions.

### Core data structures and access paths

```ts
type Actor = { userId: UserId; membership: 'pending' | 'verified' | 'suspended'; admin: boolean };
type RequestKey = string & { readonly __brand: 'RequestKey' };
type Cursor = { createdAt: string; messageId: string };
type Page<T> = { items: T[]; next: Cursor | null };
type CommandResult<T> = { value: T; replayed: boolean };

interface Orders {
  acceptOffer(input: { offerId: OfferId; requestKey: RequestKey }): Promise<CommandResult<AcceptedOrder>>;
  approveAmendment(input: { amendmentId: AmendmentId; requestKey: RequestKey }): Promise<CommandResult<Order>>;
  confirmDelivery(input: { orderId: OrderId; secret: string; requestKey: RequestKey }): Promise<CommandResult<Order>>;
}
interface Chat {
  history(input: { conversationId: ConversationId; after?: Cursor; limit: number }): Promise<Page<Message>>;
  send(input: { conversationId: ConversationId; body: string; requestKey: RequestKey }): Promise<CommandResult<Message>>;
  markRead(input: { conversationId: ConversationId; through: Cursor }): Promise<void>;
  subscribe(input: { conversationId: ConversationId; onHint: () => void }): Promise<Unsubscribe>;
}
interface Support {
  open(input: { orderId?: OrderId; subject: string; requestKey: RequestKey }): Promise<Conversation>;
  reply(input: { conversationId: ConversationId; body: string; requestKey: RequestKey }): Promise<CommandResult<Message>>;
}
interface Payments {
  recordIncoming(input: { orderId: OrderId; amountIdr: number; externalReference: string; requestKey: RequestKey }): Promise<PaymentEntry>;
  approveAdjustment(input: { adjustmentId: AdjustmentId; requestKey: RequestKey }): Promise<PaymentEntry>;
}
interface BeeTip { orders: Orders; chat: Chat; support: Support; payments: Payments }
```

The `BeeTip` facade is the only client-importable API. Concrete transport, SQL rows, Supabase clients, and service credentials remain server-only. Client code submits one operation and handles typed domain failures such as `NotVerified`, `Forbidden`, `Conflict`, `Expired`, and `RetryKeyReuse`; it does not orchestrate a multi-call transaction. Return fresh query projections after writes rather than mirroring the whole database in a client store.

### Module ownership

| Module | Owns | Public capability |
| --- | --- | --- |
| `identity` | Auth session resolution, verified membership, admin authority | `requireActor`, membership review commands |
| `marketplace` | Listings, offers, moderation, search projections | paginated board and listing commands |
| `orders` | accepted terms, reservation, amendments, order lifecycle | accept, approve, cancel and confirm commands |
| `chat` | order conversation membership, messages, read cursors | history, send, mark-read, realtime hint subscription |
| `support` | member-owned support conversations and admin inbox | open, reply, resolve and paginated inbox |
| `ledger` | incoming payment evidence, receipt allocations, refund/payout entries, review | record, reconcile, approve and export |
| `notifications` | notification preferences, durable delivery outbox, email attempts | inbox page, mark-seen, enqueue domain event |
| `files` | private object keys, content validation, signed access | upload intents and short-lived download authorization |
| `db` | migrations, SQL functions, row policies, transaction primitives | server-only typed query and command access |

No general `Repository` pass-through layer. A module owns a domain decision and can use the narrow DB helper directly. Routes call one module operation; modules should not call one another through duplicate workflows. Cross-domain changes are coordinated by one explicit transaction function, with a named owner such as `orders.accept_offer` or `ledger.approve_adjustment`.

### Data model and indexes

Use UUID primary keys and `timestamptz` stored in UTC; render WIB in UI. All IDR values are nonnegative integer `bigint` values with checks. Core tables:

- `members(user_id PK references auth.users, status, verified_at, suspended_at)`; `admin_grants(user_id, granted_by, created_at, revoked_at)` with one active grant per user. Verification evidence is a restricted object key plus decision/audit fields, not a public member column.
- `listings(id, owner_id, kind, status, public_area, terms jsonb, expires_at, created_at)`; `offers(id, listing_id, actor_id, status, fee_idr, terms jsonb, created_at)`. Unique active offer `(listing_id, actor_id)` enforced with a partial unique index.
- `orders(id, request_id, provider_id, customer_id, trip_id nullable, status, terms_snapshot jsonb, reserved_budget_idr, expires_at, created_at)`; accepted snapshot rows are insert-only. Trip capacity is represented by committed order reservations, not a duplicated mutable counter.
- `order_amendments(id, order_id, proposed_by, prior_version, terms, status)` with at most one pending amendment per order. Approval compares `prior_version` before advancing the accepted version.
- `conversations(id, kind, order_id nullable, support_owner_id nullable, status, created_at)`; `conversation_members(conversation_id, user_id, revoked_at)`; `messages(id, conversation_id, sender_id, client_request_id, body, created_at)`; `read_cursors(conversation_id, user_id, message_id, updated_at)`.
- `payment_entries(id, order_id, kind, amount_idr, external_reference, idempotency_scope, status, created_by, created_at)`; `receipt_allocations(receipt_id, order_id, amount_idr, item_key)` unique `(receipt_id, item_key)`; `adjustment_reviews(entry_id, reviewer_id, decision)` prohibits author reviewing own exception.
- `notifications(id, user_id, kind, payload, created_at, seen_at)`; `email_outbox(id, notification_id, recipient, template_key, payload, status, attempts, available_at, lease_until, sent_at, provider_id)` unique on the source notification and email channel.
- `command_receipts(actor_id, command, request_key, payload_hash, result jsonb, created_at)` unique `(actor_id, command, request_key)`.

Index dominant paths: board `(status, kind, expires_at, created_at desc)` with public-safe columns; member order lists `(customer_id, created_at desc)` and `(provider_id, created_at desc)`; trip orders `(trip_id, status)`; messages `(conversation_id, created_at, id)`; cursors primary key `(conversation_id, user_id)`; admin support inbox `(status, updated_at desc)`; outbox `(status, available_at)`; payment lookup `(order_id, created_at)` and unique normalized external reference where policy permits. Use keyset pagination by `(created_at,id)`, not offsets, for growing conversations and inboxes.

### Atomic invariants and authorization

Each command gets actor identity from the verified server session, never a client actor ID. The server checks verified membership and, for privileged commands, a currently active admin grant. The transaction rechecks security-sensitive membership/role state before commit. Suspending or revoking membership immediately blocks subsequent commands and chat reads; existing history remains available to participants only according to product policy, while new sends require active membership. Removing a user from a conversation revokes future reads and subscriptions. A cached signed URL is short-lived, so private objects must not be exposed by permanent URLs.

Every privileged read and write has an explicit SQL policy as defense in depth. RLS protects direct authenticated Supabase access; browser credentials never contain service role secrets. Mutations that need multi-row atomicity use server-only transaction functions with restricted execute grants and explicit actor arguments bound to the authenticated user. Elevated database functions validate caller identity, use a fixed safe search path, and never rely on UI visibility. Public listing projections omit exact handover addresses and verification data.

`orders.accept_offer` locks the listing/trip row (`FOR UPDATE` or a conditional version update), rechecks owner, status, expiry against database time, verified actor, fee bounds, member/order limits and aggregate active reserved budget, then inserts order plus immutable terms, reserves capacity, closes a request when applicable, writes audit and outbox rows, and stores the idempotent result in the same transaction. This makes simultaneous final-slot attempts serialize; reservation expiry is enforced in acceptance even if a cleanup job has not run. An expiry job releases an eligible reservation with conditional status transition so capacity is released once.

`command_receipts` bind a stable key to actor, command and canonical payload hash. A retry with the same key and hash returns its committed result. A retry with different content returns `RetryKeyReuse`. The receipt and domain mutation commit together. Payment records are append-only evidence; status projections derive from entries and decisions. External transfer references and manual reconciliation remain explicit. An ambiguous payout is not retried until account records resolve whether the first transfer succeeded.

### Messaging, cursors and reconnect

An order acceptance transaction creates the conversation and the customer/provider membership rows. Support creation establishes owner membership and, where the order is visible to that actor, an order reference; administrators receive inbox capability through policy, not broad access to all conversation history by default. Every history query, send, read-cursor update, and realtime subscription checks active membership and conversation kind.

`send` validates and normalizes the body at the boundary, then in one transaction inserts the message using `(sender_id, conversation_id, client_request_id)` uniqueness, advances no read cursor, and inserts inbox notification plus email outbox events for the other participant(s). The stable database message ID and timestamp define order. Realtime `INSERT` events only prompt a refresh. On reconnect the client first fetches `history(after: lastDurableCursor)`, merges by message ID, then subscribes and repeats catch-up after reconnect events. This closes the gap between snapshot and subscription. Sort by `(created_at,id)` and keyset paginate. Unread count is derived from messages after that user's cursor; mark-read advances monotonically to an existing authorized message. Keep unsent draft content local and show failed/retry state; never label an uncommitted message as delivered.

### Jobs and email recovery

The transaction that changes domain state writes the in-app notification and `email_outbox` row, so a crash cannot commit an order without durable notification intent. A scheduled Vercel invocation or protected worker claims due rows using a lease (`FOR UPDATE SKIP LOCKED`), records attempts and a lease expiry, calls the email provider, and then marks sent. On timeout/crash, the lease expires and retry resumes. Use a provider idempotency key when available; otherwise use a stable message identifier and accept that provider submission can be ambiguous, recording uncertainty rather than falsely marking delivery. Backoff transient failures, dead-letter permanent failures for admin visibility, and retain in-app notifications regardless of email outcome. Jobs also expire reservations and sweep stale leases. Job endpoints require a secret and rate limits; database row claims make concurrent invocations safe.

## Synthesis decision

Independent candidate. The design prefers a Next.js server-command modular monolith, with PostgreSQL transaction functions for the small set of cross-row invariants and RLS as a second boundary. The principal alternative is browser-to-Supabase command centric operation. See below for the tradeoff; no other candidate was synthesized into this document.

## Tradeoffs accepted

- We accept an explicit server command/API boundary and async client migration in exchange for one place to enforce identity, membership, validation, idempotency, and response redaction.
- We accept PostgreSQL function/transaction code that needs careful review in exchange for atomic acceptance, money evidence, reviews, and outbox writes without partial state.
- We accept durable outbox delivery as at-least-once with visible ambiguity in exchange for crash recovery; exactly-once email delivery is not assumed.
- We accept separate module-owned SQL and projections in exchange for avoiding a generic repository abstraction that callers must coordinate.
- We accept Supabase Realtime as a hint and explicit cursor catch-up in exchange for durable ordering and reconnect correctness.
- We accept hosting and provider limits as deployment concerns, not architectural guarantees; free tiers, email quotas, backups, and Vercel plan eligibility require current owner verification.

## Alternatives considered

### Browser-to-Supabase transaction/RLS centric

The browser calls Supabase for queries, realtime and domain commands. RLS is the primary authorization boundary; transaction functions implement accept, payment and chat writes. This has fewer Next.js handlers and a short browser-to-database call path, but it exposes transport/storage contracts to components and spreads knowledge of retries, role checks, event outcomes and error translation across browser code. A single command facade can mitigate the shallow-module problem, yet service role needs and complex admin workflows naturally pull logic back into server code. It is viable if all writes are expressible through narrow invoker-safe functions and tested RLS; this candidate keeps a server command boundary because payment operations, membership revocation, email enqueue and immutable snapshots need consistent orchestration.

### Next.js server command modular monolith (chosen)

Callers see a small domain API and do not coordinate Supabase transactions or transport concerns. The server owns request validation and command outcomes; Postgres still owns atomic constraints. It adds server code and requires disciplined limits on elevated credentials, but hides more policy behind a smaller interface and keeps the complete pilot in one deployable unit.

### Separate API/worker service

A dedicated service could isolate jobs and API scaling, but creates a second deployment, runtime and operational ownership path for a five-member, no-budget team. It exposes configuration and release coordination to maintainers without making transaction policy simpler. Revisit if sustained jobs, queue volume, or independent scaling requires it.

## Implementation reconciliation

No implementation deviations accepted. This document is a planning candidate and does not change production authority or migration behavior.

## Open questions and risks

- Which verified membership evidence and domains are acceptable for students, staff, and employees, and what retention period applies to submitted evidence?
- Who owns the Supabase project, Vercel project, domain, SMTP account, backups, and account recovery for the team?
- Does the intended real-money collection and payout arrangement permit this supervised marketplace flow, and who is authorized to reconcile and approve it?
- Which email provider offers a tested idempotency contract or message lookup for ambiguous timeouts, and what quota/cost is acceptable?
- What legal/accountability review and incident process is required before real users, private addresses, receipts, or chat are stored?
- Does the chosen Vercel plan permit the intended pilot use and scheduled invocation characteristics at implementation time?
- Which user-facing policy governs retention and read access to conversation history after a member is suspended or leaves a transaction?

## Vercel isolation, release and rollback

Keep Route Handlers stateless and short-lived; do not depend on process memory, local disk persistence, singleton locks, or in-process timers. Database transactions and leases coordinate across concurrent function instances. Keep Auth and database secrets in server-only environment variables and separate preview credentials/data from production. Preview deployments must use isolated non-production projects and synthetic data; prohibit service-role access to production from previews. A scheduled job endpoint is authenticated, idempotent, and safe to run concurrently.

Use backward-compatible expand/migrate/contract releases: deploy additive schema first, deploy code that can read old and new representations, backfill with resumable checkpoints, then remove obsolete schema only after rollback window closes. Never run a destructive migration as an automatic consequence of a preview deploy. A rollback changes application code while preserving committed ledger/audit facts; corrective transactions append compensating entries. Verify the restored application against the current schema and retain a documented database backup/restore procedure before accepting live payment evidence. A Vercel rollback cannot reverse committed database state.

Dependency order: (1) production/demo module boundary and async client contract; (2) Supabase project ownership, Auth and membership model; (3) migrations, RLS and private storage; (4) command receipt/idempotency and transaction primitives; (5) listing and atomic acceptance; (6) order lifecycle, amendments and evidence; (7) private chat, read cursors and realtime catch-up; (8) in-app notifications and leased email outbox; (9) admin payment/review and reconciliation; (10) scheduled expiry/outbox recovery; (11) isolated preview and release/restore procedure; (12) pilot readiness checks including manual-funds operating approval, SMTP delivery and real-device camera validation. Real-money operation remains blocked until its external collection and payout arrangement is confirmed.

## Next implementation step

Create the production-only `identity` and `db` boundary with migrations for members, command receipts, and RLS, then convert one complete request acceptance journey to the asynchronous server command contract without importing demo state.
