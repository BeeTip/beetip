# BTP-10 notification inbox

Issue contract: [BeeTip/beetip #12](https://github.com/BeeTip/beetip/issues/12). This implementation was prepared from `29ee27e0b6856ca06272bd7576b0554a2956512c`, whose parent is `88262bfb9b3fe8f8b5954c386d241ee534df4ac2`. Parent-coordinated development acceptance is recorded below. Web deployment remains pending.

## Registry and ownership

`packages/validation/src/notifications.ts` is the typed source for all 20 documented event families, recipient rules, template versions, safe fixed titles, target kinds, email modes and integration flags. `scripts/notification-registry.mjs` generates the marked SQL seed in `20261119000000_notification_inbox.sql`. The registry parity test checks every field and event. Check or regenerate with:

```powershell
rtk proxy node --experimental-strip-types scripts/notification-registry.mjs
rtk proxy node --experimental-strip-types scripts/notification-registry.mjs --write
```

| Implemented source | Event and recipient | Target authorization |
| --- | --- | --- |
| `affiliation_approve`, `affiliation_reject` audit | `affiliation_decided`, applicant | Request still belongs to recipient |
| `offer_saved` audit revision 1 / later | `offer_received` / `offer_changed`, listing owner | Recipient is still an offer party |
| `offer_withdrawn` audit | `offer_withdrawn`, listing owner | Recipient is still an offer party |
| `listing_updated` audit | `listing_changed`, distinct active offer authors | Recipient still has an offer on that listing |
| `support_opened` audit | `support_opened`, current support operators | Open support thread remains unassigned; active support role and verified MFA |
| Active support membership insert/reactivation | `support_assigned`, new assignee and requester | Current non-revoked membership; operators retain support role and MFA |
| `staff_granted`, `staff_revoked` audit | `staff_role_changed`, affected member | Own account; revocation notices remain visible to the affected account |
| BTP-06 acceptance intent | `order_accepted`, counterparties supplied by acceptance | Current customer/provider relationship |

All recipients must remain confirmed, non-anonymous and non-suspended. Hooks exclude the actor before writing. Support content reads additionally require the current session's `aal2`; merely retaining a factor or an old JWT role claim does not grant operator access. Email eligibility checks live staff grants and factor status without requiring an interactive session. Assignment revocation hides the old assignment notification, including its target, and suppresses its email eligibility. Queue alerts stop being visible/eligible once any active support assignment exists.

Triggers run inside the existing authoritative business transaction. A failed notification insert aborts that transaction, leaving no successful business result without its notification records. There is no post-commit HTTP enqueue. Command receipt replays create no new audit events. One event/recipient yields one notification and one intent per channel, protected by unique constraints. The in-app intent is recorded as delivered because the durable inbox record exists, which does not mean that a person read it. Email intents remain pending for BTP-11.

Listing publication, affiliation submission/draft/withdrawal and account bootstrap do not notify their own actor. Existing historical audit facts are not replayed into unsolicited mail. The explicit acceptance-intent backfill is the exception because those rows represent pending delivery work.

## Internal enqueue and acceptance integration

`private.enqueue_notification(event_uuid, event_type, target_uuid, actor_uuid, recipient_uuid_array)` is only callable by trusted database owners/transaction code. It is not granted to members, anonymous clients or exposed as a public RPC. Actor exclusion, current target access and logical uniqueness are enforced internally. An existing event/recipient replay with a different actor/type/target fails rather than silently changing its meaning. Unknown or inactive event mappings fail closed. Empty or currently unauthorized recipient sets create no records.

The caller must derive the actor and recipients from authoritative locked business rows, never from a browser payload. Use one stable event ID for each committed occurrence, with separate IDs for separate changes. Pass the actual actor except when bridging an already-filtered trusted delivery intent.

BTP-06 provides `private.acceptance_notification_intents(order_id,recipient_id,event_type,created_at)`, keyed by order and recipient and already excluding its actor. The later notification migration conditionally installs an AFTER INSERT bridge and consumes existing `order_accepted` intents. It uses the order ID as the stable event and target ID; actor is null because the acceptance intent already filtered it. Replaying the backfill is idempotent. The bridge leaves acceptance intents intact. It does not duplicate the acceptance audit event into another notification.

Apply `20261118062602_atomic_acceptance.sql` before `20261119000000_notification_inbox.sql`. Notification SQL also installs without orders; its order authorization branch uses guarded dynamic SQL and denies access if orders do not exist. If installing notifications before acceptance, the parent must subsequently install the bridge trigger and run the same backfill block, since a table created later cannot acquire a previously skipped trigger automatically. The integrated test exercises the actual BTP-06 `accept_order` command, exact replay, counterpart-only notification, both intents, target permissions and backfill deduplication.

Future order expiry/cancellation, funding, amendments, delivery, dispute, transfer and chat mappings are typed but inactive. As each feature lands, its owner must wire transaction-local events, implement its exact party/assignee resolver and current target permission, activate its registry flag, regenerate SQL and add database parity/access tests. The current order resolver admits counterparties only; it grants no financial-reviewer or support access to an order. Later assigned-operator events require explicit scoped assignment tables before activation. Chat remains inactive until its grouping/read-cursor owner implements the messaging contract. A pending email intent is not permission to send it.

## Inbox and transport

`/account/notifications` provides private notifications, an unread indicator, individual monotonic read actions, retry/empty/error states, keyset pagination and per-event email preferences. GET `/api/identity/notifications` returns at most 20 items and a cursor, using 21-row lookahead. Unread counts use the same live visibility predicate as the inbox. PostgreSQL timestamp precision is preserved in cursors, with UUID ordering for equal timestamps. There is no mark-unread or caller-selected read timestamp. Concurrent read requests preserve the first committed read time via row locking and `coalesce`.

POST accepts only `{action:'read',id}` or `{action:'preference',eventType,email}`. It validates same origin, request size, session, strict schemas and `X-Beetip-Member` account-change protection. SQL independently resolves the actor from `auth.uid()` and the retained Auth session. Direct table writes are revoked. RLS protects notification and preference reads, with explicit grants only to authenticated users. Internal registry/delivery tables have RLS and no member grants. Protected responses are private/no-store.

GET `/api/identity/notifications/:id/target` rechecks the notification owner and its current target permission before returning a fixed internal route. Targets contain no user-provided URLs or sensitive payloads. Destinations retain their own authorization; the notification is not an access capability. Notification reads do not mark conversations read. Support targets currently open `/support`; the support queue/claim UI remains owned by the later support workflow and is not implemented by this inbox. The inbox is directly addressable; the parent can add its account-navigation link alongside BTP-06 to avoid conflicting shared page edits.

The client checks the returned member ID, aborts stale requests, clears cached content on account-change signals, and refreshes on focus/visibility and every 30 seconds while visible. It stores no notification state in localStorage. No realtime publication or email sending is introduced.

## BTP-11 delivery handoff

`private.notification_delivery_intents` stores event, notification, recipient, channel, template version and pending status, uniquely keyed by event/recipient/channel. It is a durable handoff, not the leased provider outbox. BTP-11 must associate each email source exactly once, implement leases/retries/provider reconciliation and preserve these uniqueness keys.

Immediately before dispatch, call `private.notification_email_allowed(notification_id)` from trusted worker transaction code. It checks live recipient/target access, unread notification state and current email preference. It denies chat modes until their separate conversation-read/grouping contract exists. A worker must also recheck its own suppression/bounce policy, which is not represented by these inbox preferences. Keep this helper private, expose only fixed bounded job operations, and derive trusted-origin links from `APP_ORIGIN`. Email should use fixed generic summaries and no message text, addresses, financial details, evidence or codes. No provider delivery success is claimed here.

## Validation and operating gates

An isolated PostgreSQL 18 instance on loopback port 55487 applied the actual base migrations, this migration, its rollback, BTP-06's prepared acceptance migration, then this migration again. Auth/Storage schemas were local stubs; no hosted DB or actual Auth delivery was involved. The SQL suite executes real database commands and RLS with multiple transaction-local session claims. All fixtures roll back and the guarded runner reloads retained user/member/active-role/verified-factor/notification counts afterward. These checks do not establish actual Supabase Auth-session or browser acceptance.

Validation completed: 48 integrated SQL assertions, 55 unit tests across 9 files, registry generation/parity, `pnpm typecheck`, `pnpm lint` without warnings, and `pnpm build`. The standalone schema passed its earlier 38 assertions before acceptance was installed; the later suite adds decision, preference and acceptance checks. Migration rollback and reapplication also passed. The final runner checks listing/offer/conversation/message counts in addition to identity and notification counts.

Run the guarded suite only after the parent has coordinated schema application:

```powershell
# Set a parent-approved connection in the environment without printing credentials.
rtk node scripts/test-connected-notifications.mjs
```

The script requires `BEETIP_NOTIFICATION_DATABASE_URL`. Non-loopback hosts also require `BEETIP_NOTIFICATION_SHARED_DB_APPROVAL=parent-coordinated-btp10` and must identify `rgiptdfjlmwldngapojq`. It applies no schema, inserts only transaction-local test fixtures and performs no user deletion or cleanup. It does not modify retained users or grants. PostgreSQL admin privileges are required for fixture Auth/session inserts and SET ROLE. The parent must inspect the SQL and coordinate its short locks before hosted use. Real multi-account browser sessions, direct REST/RPC access, CSRF, account changes, hosted advisors, migration history/types regeneration and rendered UI remain acceptance gates.

`supabase/rollback/notification_inbox.sql` removes only this feature's triggers, functions, policies/tables and notification data, preserving acceptance intents and business/users/roles. It was executed successfully in isolation. It must precede any downstream worker integration that depends on these objects; do not run it uncoordinated on hosted development. A backup/replay decision for notification data is required before a hosted rollback.

Parent-reported shared baseline remains unverified and untouched here: 3 users, 3 members, 0 listings, 0 offers, 1 conversation, 1 message, 1 active staff grant and 1 verified MFA factor. No push, PR, merge or deployment was performed. Full issue acceptance remains pending the connected checks and later owning-slice integrations above.

Security references checked for implementation: [Supabase changelog](https://supabase.com/changelog.md), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions). The current CLI guidance was read before generating the migration. No hosted schema mutation was used for iteration.

## Integrated development acceptance, 18 November 2026

Implementation `b110a91b2f014a7dd411da8545e25b576d014549` was integrated with BTP-06 at candidate `64a865e`. The parent added the account navigation link, connected-route allowlist and safe login destination, matched existing panel/checkbox styling and hid inactive future email preferences. The registry checker now preserves Windows line endings. The actual acceptance migration precedes the inbox migration and its transactional bridge/backfill. Follow-up `20261119000001_notification_access_indexes.sql` adds the three missing foreign-key indexes identified by hosted advisors. All three versions were read back on dedicated development project `rgiptdfjlmwldngapojq`, and database types were regenerated.

Before retaining schema changes, a standalone hosted transaction passed 42 notification assertions and rolled back the feature schema. The integrated preflight initially combined the two fixture suites without isolation, producing an intent-count assertion failure. Separate savepoints fixed the test composition. The retained integrated schema then passed all 48 notification assertions and 18 acceptance assertions. Original business/identity fixtures were preserved.

`scripts/test-notification-sessions.mjs` passed five groups against the connected local production build using three separate confirmed Auth sessions: login destination and guest/CSRF/actor/account guards; transactional offer events, concurrent exact replay deduplication, no self-notify, raw-table/internal-RPC/write and cross-account target denial; monotonic concurrent reads, persisted preferences, 24 real events paginated without missing or duplicate IDs and exact unread totals; account navigation, rendered pagination/read controls and authorized deep links at 390/768/1440 widths; live suspension and cross-tab logout clearing. The mobile render was inspected. The order harness independently verified one counterpart-only acceptance notification and its authorized order link after exact retry.

```powershell
$env:BEETIP_TEST_PROJECT_REF = 'rgiptdfjlmwldngapojq'
$env:BEETIP_TEST_URL = 'http://127.0.0.1:3108'
rtk proxy node scripts/test-notification-sessions.mjs
```

The combined candidate passed lint, typecheck, 61 unit/component tests, 11 staging-helper tests, connected production build, standalone registry parity and production dependency audit. Post-cleanup read-back found zero temporary notifications/preferences/deliveries/orders/listings/offers and preserved three users, one support conversation/message, one active staff grant and one verified MFA factor. New unindexed-foreign-key findings were resolved. Private tables intentionally have RLS with no member policies/grants. Existing [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and staff-role policy findings remain; unused new indexes are expected before pilot traffic and the delivery worker.

This completes the current in-app slice on development. Email sending, chat read/grouping rules, future event activation, public deployment and real-money release remain with their owning issues. The earlier isolated-only limits above describe the child implementation checkpoint.

Final integrated regressions passed all 16 production-demo browser journeys and the existing connected listing/offer/identity/affiliation suites. A first affiliation UI assertion timed out while its request was pending; the single unchanged rerun passed all seven groups. The fresh isolated migration/concurrency run passed all 13 groups with notification hooks installed. Independent read-only review of `64a865e` found no blocking correctness or authorization issue. It confirmed that actionable unassigned-support queue navigation remains BTP-09; returning `/support` does not implement queue claim or assignment UI and was not claimed as tested actionability.

The final retained-state audit after legacy regressions found three `support_opened` notifications addressed to the original operator for already-deleted temporary support conversations. Only those three exact IDs were removed; their six delivery intents cascaded. Both identity and affiliation regression helpers now delete notifications targeting their own fixture conversation IDs before removing conversations, preserving audit/receipt facts and unrelated records. This cleanup correction changes test helpers only, after the reviewed application candidate.

Both corrected helpers then passed again against the connected development server. Final hosted read-back confirmed zero temporary users, listings, offers, orders, notifications, preferences, delivery intents and acceptance intents, with the original three users/members, one conversation/message, one active staff grant and one verified MFA factor preserved. The accepted-terms guard remained enabled. These reruns did not send email.
