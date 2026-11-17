# BeeTip connected pilot: candidate Terra

## Problem

The current system is a synchronous browser-local demo: `DemoProvider` owns synthetic state and `DemoService` checks a selected persona, with no trusted identity or shared transaction isolation. The connected pilot needs authenticated accounts, private conversations, durable notifications and supervised money operations while preserving integer IDR, immutable accepted terms, capacity limits and separate fulfillment and money states. Existing demo data and its synchronous interface are not a production boundary. The following is a proposal, not an implementation or evidence of pilot readiness.

## Usage (caller's view)

```ts
// Server route: authenticated session is resolved by the adapter.
const result = await bee.orders.accept({ offerId, operationId });
if (result.kind === 'accepted') navigate(`/orders/${result.orderId}`);
else showDomainError(result.reason);

// Conversation screen: history is authoritative; events trigger catch-up.
const page = await bee.chat.listMessages({ conversationId, before: null, limit: 50 });
const stop = bee.chat.watch({ conversationId, after: page.highWatermark,
  onChange: () => refreshMessages(), onState: setConnectionState });
const sent = await bee.chat.send({ conversationId, text, clientMessageId });

// Admin review: the identity comes from the session, never the form.
const review = await bee.transfers.review({ transferId, decision: 'approve', operationId });
```

All calls may fail with an authentication, authorization, validation, conflict or unavailable error. Interfaces return domain objects, not framework or database wire types. A retry retains its operation ID and identical payload. Callers retain unsent chat text until a matching durable message is acknowledged; they display pending and failed states.

## Shape

**Recommend shape A: domain-owned server operations with transactional database commands.** Next.js handles session and boundary validation, then calls domain-specific server modules. Each mutation that changes a shared invariant is one narrowly granted database transaction. Read paths use authorized queries and cursor pages. PostgreSQL owns durable state; Supabase Auth supplies identity, Storage holds private evidence, and Realtime is only a wake-up signal. The database is the source of truth, including for authorization. No separate backend deployment or message broker is needed.

```ts
type Id = string & { readonly __id: unique symbol };
type OperationId = string & { readonly __operationId: unique symbol };
type Cursor = string & { readonly __cursor: unique symbol };
type Result<T> = Promise<T>; // boundary errors are typed exceptions
type AcceptResult = { kind: 'accepted'; orderId: Id } |
  { kind: 'refused'; reason: 'expired' | 'unavailable' | 'capacity' | 'ineligible' };
type Message = { id: Id; conversationId: Id; senderId: Id; text: string; createdAt: string };
type MessagePage = { items: Message[]; nextBefore: Cursor | null; highWatermark: Cursor | null };
type ConnectionState = 'connecting' | 'connected' | 'offline' | 'revoked';
interface Bee {
  orders: { accept(input: { offerId: Id; operationId: OperationId }): Result<AcceptResult> };
  chat: {
    listMessages(input: { conversationId: Id; before: Cursor | null; limit: number }): Result<MessagePage>;
    send(input: { conversationId: Id; text: string; clientMessageId: OperationId }): Result<Message>;
    watch(input: { conversationId: Id; after: Cursor | null; onChange(): void;
      onState(state: ConnectionState): void }): () => void;
  };
  transfers: { review(input: { transferId: Id; decision: 'approve' | 'reject';
    operationId: OperationId }): Result<{ status: 'approved' | 'rejected' }> };
}
```

This is a boundary sketch, not a complete product API. Server operations validate inputs and session, then execute a single owned command; database transactions recheck actor and mutable conditions. The interface hides locking, idempotency and event delivery without exposing transport or requiring callers to coordinate stages. Validation occurs at the boundary and invariants remain in the owner, per boundary discipline.

| Owner | Proposed responsibility |
| --- | --- |
| `apps/web` | Screens, session-bound server routes, UI state and input parsing; no demo service in connected routes. |
| `packages/domain` | Pure rules, value types, calculations and transition decisions; no credentials or transport objects. |
| `packages/validation` | Shared input schemas; server validates independently. |
| `server/orders` | Listings, offers, acceptance, amendments, fulfillment and capacity commands. |
| `server/money` | Funding evidence, verified payments, allocations, transfers, disputes and reconciliation. |
| `server/chat` | Conversation authorization, history, send, cursor and realtime wake-up. |
| `server/notifications` | In-app inbox, preferences and delivery outbox processing. |
| Database migrations | Tables, constraints, RLS, restricted transactional functions and indexes. |

Modules expose only their public entry points; enforce import boundaries in lint/build. One owner performs each state change. Pure calculation is shared, while database constraints and commands remain authoritative under concurrency.

### Data and transactional invariants

- `profiles` references Auth users; `membership_verifications` records affiliation status independently. Separate `staff_roles` grants narrowly scoped support, finance and administrator capabilities; never trust user-editable profile flags.
- `listings`, `offers`, `trips`, `orders`, immutable `order_terms` and reservation rows model the marketplace. Index active listings by status and deadline, participant orders by actor and time, and reservations by trip and status. Acceptance locks the relevant listing and trip in a stable order, rechecks verified actor, ownership, offer, deadline using database time, capacity and customer limit, and atomically creates the order, snapshot, reservation, audit and notification intent. Unique constraints protect one accepted request and offer. Expiry releases a reservation exactly once; acceptance always checks expiry even if cleanup is late.
- `payment_records`, `receipt_allocations`, `transfer_requests`, `transfer_reviews` and append-only `audit_events` keep funding, fulfillment, payouts and refunds distinct. Use nonnegative integer IDR and foreign keys. Lock the receipt and its allocations before checking the approved total, and lock transfer and unsettled allocation when reviewing. Enforce a different authorized reviewer from the initiator. Freeze only the disputed unsettled allocation. An ambiguous external transfer stays unresolved pending human reconciliation; retries never imply a second external transfer.
- An `operations` unique key `(actor_id, operation_id)` stores a canonical request hash and result in the same transaction as each mutation. Same key and hash returns the prior result; a changed payload is rejected. Restrict retention according to the lifetime of retry and financial audit obligations.
- Conversations have a type, optional order reference, membership rows with revocation, messages with stable IDs, server timestamps and per-user read cursors. Unique `(conversation_id, sender_id, client_message_id)` deduplicates sends. Index messages by `(conversation_id, created_at, id)` and membership by `(user_id, conversation_id)`; use the same tuple for deterministic pagination. Read cursors advance monotonically per member, never mark another member's messages read.
- Every committed business event that needs notification inserts recipient-specific in-app records and email outbox intents in the same transaction. A unique event/recipient/channel key prevents duplicate logical notifications. Index pending outbox work by due time and status.

### Authorization and private chat

RLS is enabled on exposed tables, including storage metadata. Public listing projections exclude private addresses and evidence. Members can read order and conversation data only through current participant membership; support threads belong to their requester and explicitly authorized support staff. Unverified authenticated members may seek support, but transactional commands require approved membership. Staff permissions are checked server-side and in database policies or restricted commands; staff support access does not imply finance access. Restrict direct writes to immutable terms, audit, financial records, membership and roles. Elevated functions, if needed, have fixed search paths, explicit actor and role checks, minimal execution grants and tests; a service credential is server-only and never substitutes for actor authorization. Private file paths are linked to authorized records and access is checked before issuing short-lived access; avoid logging URLs or secrets.

Persist a message before notifying subscribers. On subscribe or reconnect, establish the subscription, then fetch authoritative messages after the last durable cursor and merge by message ID; repeat catch-up after any gap or channel error. A subscription event contains no sensitive message body and triggers an authorized refetch. On revocation, deny subsequent history and send requests immediately, unsubscribe when detected, clear displayed cached conversation data and report `revoked`; never rely on an already open channel as proof of current membership. Test revocation during a live connection, offline writes, duplicate events and reconnect races. Drafts remain local to the session without persisting sensitive content by default.

### Durable jobs and operations

A scheduled authenticated endpoint invokes a bounded worker that claims due outbox rows with a lease, records attempts, and sends email through a configured provider. Each attempt has a stable delivery key where supported. Success marks delivered; transient failure uses capped backoff; expired leases are reclaimed; permanent or exhausted failures are visible to operators for retry. Delivery is at least once: a crash after provider acceptance can duplicate email unless the provider honors the key. In-app records remain available regardless of email failure. Monitor oldest pending age, failures and scheduler heartbeat; alert an operator and provide a documented manual replay. A separate bounded sweep expires reservations, but correctness does not depend on it running on time. Secure the scheduler endpoint with a server-only secret and reject unauthenticated requests.

### Release and recovery

Use Vercel for the Next.js application, with separate development, preview and production configuration and separate Supabase projects or equivalent hard isolation. Preview builds must never use production service keys, write to production data or send real participant email. Validate required server and public variables at startup; keep privileged keys and email credentials server-only. CI runs lint, types, unit tests, database migration and RLS integration tests, concurrency tests, and production build and browser journeys against isolated test services. Apply backward-compatible expand migrations before deploying code, verify health and critical journeys, then contract schema only after old code is retired. Keep tested database backups and a restore runbook. Application rollback uses a previously verified deployment only while its schema remains compatible; database rollback is a separate reviewed operation, and irreversible data migrations require a recovery plan. Confirm Vercel plan eligibility, scheduler frequency and execution limits, email deliverability, cost and project ownership before pilot use.

## Synthesis decision

Candidate-level recommendation is shape A. It concentrates authorization, atomic business commands and notification intent at the durable boundary while keeping the web application deployable as one unit. Final cross-candidate synthesis remains for the parent architect.

## Tradeoffs accepted

- We accept SQL transaction functions and database integration tests in exchange for enforceable concurrency and atomic outbox writes.
- We accept eventual email delivery and possible duplicate provider delivery in exchange for a small durable worker and recoverable failure handling.
- We accept a server round trip for protected actions in exchange for trusted sessions and consistent permission checks.

## Alternatives considered

**Shape B: application service plus direct database transaction layer.** Next.js server modules own complete workflows and use a server-side PostgreSQL connection and transaction library for locks, writes, audit and outbox. Browser reads still use RLS; application mutations explicitly authorize the session inside each transaction. This is viable with a supported pooled connection, restrictive database roles and a server runtime capable of the transaction pattern. It hides SQL details behind domain methods but exposes connection lifecycle and authorization discipline across all mutation owners, and its privileged database access creates a broader bypass risk. It loses to A for this small team because database commands provide a narrower invariant boundary; it remains useful if transaction logic becomes substantially more complex.

Both shapes were screened for shallow interfaces, duplicate writers, transport leakage, pass-through layers and hand-synced policies. Both require one mutation path per invariant, restricted internals and tests that enforce authorization; neither should add a parallel client write path.

## Implementation reconciliation

No implementation decisions or deviations have been accepted yet. Reconcile approved changes to these contracts before handing an implementation unit onward.

## Open questions and risks

- What collection account, external transfer procedure and independent reviewers will operate the manual money workflow? This blocks real funds.
- What verification evidence, retention period, support access policy, operating hours and escalation contact will the team approve?
- Which email provider and Vercel plan can support the pilot's expected usage and permitted activity, and who owns them?
- What restore objectives and notification retry thresholds are appropriate for the actual pilot?

## Implementation units and dependency order

1. Establish isolated environments, migrations, session handling, staff roles, RLS test harness and deployment checks.
2. Add profiles and verification, private storage policies, then listings and offers with authorized reads.
3. Add atomic acceptance, capacity, immutable terms, idempotency and expiry, with concurrent race tests.
4. Add conversation membership, durable messages, support inbox, pagination, reconnect and revocation tests.
5. Add funding, receipts, allocations, delivery confirmation, disputes, dual review and reconciliation, with financial race and authorization tests.
6. Add transactional notification intents, in-app inbox, email worker, scheduler monitoring and replay; notification events can be added alongside their owning workflows.
7. Replace demo callers feature by feature with asynchronous connected flows, then run end-to-end pilot rehearsals and recovery exercises. Real funds remain gated on an approved operating arrangement.

## Next implementation step

Create isolated environments and the first migration and authorization test harness after the parent architecture synthesis.
