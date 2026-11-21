# Messaging and notification contracts

This reference specifies the connected pilot. The implementation records describe [private order chat](connected-chat.md), [private support operations](connected-support.md), [in-app notifications](notifications.md), and [transactional email](transactional-email.md). Retention jobs remain proposed under their owning issues. The synthetic demo uses browser-local records.

## Conversation ownership

An accepted order creates exactly one order conversation in the acceptance transaction. Its customer and provider can read and send while their accounts are active. An unverified authenticated member may open a support conversation. Support contains its requester and assigned support operators. An order reference on support does not grant the counterparty access to that support thread.

Order conversations become read-only after final financial settlement or final cancellation resolution. Support closure makes its thread read-only until the requester or an authorized operator reopens it. Disputes allow continued communication unless an operator restricts a participant for abuse. Preserve evidence and audit the restriction.

An assigned support operator with MFA can escalate a case. A platform administrator with MFA can explicitly grant the assigned operator read access to the referenced order chat. Each view is audited. Reassignment and resolution clear that case grant. Membership suspension denies new protected reads and writes. Existing downloaded content cannot be remotely erased, so minimize browser retention.

New support threads enter an MFA-protected queue with a fixed category label, case ID, timestamp and version. The first operator claims the thread atomically, creating its membership and audit entry. A platform administrator with MFA can inspect assignment metadata and reassign the case, revoking the previous assignment. Before assignment, the queue receives an in-app alert without message text. After assignment, thread-message notifications go to the requester or the current operator. Recipient rows record the event-time assignment. Reassignment suppresses pending mail for the replaced operator, and dispatch must recheck current access.

## Durable representation

| Record | Required fields and constraints |
| --- | --- |
| `conversations` | UUID, kind `order` or `support`, nullable order ID, state, next sequence counter, created time. Unique order ID for order-kind rows. Support order references may repeat. Kind-specific foreign-key checks. |
| `conversation_members` | Conversation ID, member ID, role, granted and revoked times. Unique pair. Current membership governs reads. |
| `messages` | UUID, conversation ID, sequence, authenticated sender, client message ID, normalized body, created time. Unique conversation sequence and unique conversation/sender/client-ID tuple. Immutable after commit except audited moderation tombstone. |
| `conversation_reads` | Conversation ID, member ID, last read sequence, updated time. Unique pair, monotonic cursor bounded by committed history. |
| `notifications` | UUID, recipient, event ID, event type, internal target reference, created time, read time. Unique event/recipient. |
| `email_deliveries` | UUID, optional unique grouping key, template version, recipient ID, due time, attempt count, lease token and expiry, provider ID, status, last sanitized error. A non-chat event has one delivery. Chat events can share a grouped delivery. |
| `email_delivery_sources` | Delivery ID and notification ID. Unique notification/channel association prevents duplicate logical dispatch while allowing several chat notifications to share a delivery. |

Index messages by `(conversation_id, sequence)`, active memberships by `(member_id, conversation_id)`, notifications by `(recipient_id, created_at, id)`, and due email by `(status, due_at)`. Index support by `(state, assigned_operator_id, updated_at)` and enforce one read row per authorized member.

## Send and catch up

The client creates a UUID before its first send and retains it across retries. The server authenticates the sender, validates a trimmed 1 to 1,000 character plain-text body, and invokes one database command. That transaction locks the conversation row, rechecks active membership and conversation state, allocates the next sequence, inserts the message, and inserts recipient notification intents. Same client ID and body returns the committed message. Same ID with another body returns `CONFLICT`.

Conversation-row serialization ensures that later sequence numbers cannot commit ahead of earlier numbers. A bare global sequence or timestamp would allow reconnect cursors to skip a late commit. Rollback also rolls back the conversation counter. The unique message constraint is a second defense against retries.

Render text as text. Do not interpret HTML or Markdown. Proposed pilot send limits are 10 messages per minute and 100 per hour per account, with bounded IP protection for anonymous Auth endpoints. Enforce quotas atomically in the database, not in function memory. Return a retry delay and preserve the draft on throttling. Values remain configurable and require pilot validation.

Initial history returns the latest 50 messages in ascending sequence order, an older-page cursor, and a committed high-water mark. Older pages use `beforeSequence`. Reconnect uses `afterSequence`, ascending, in bounded pages. A client subscribes first, fetches history or catch-up second, and merges by message ID. Repeat the fetch if invalidations arrive during catch-up. Continue until the server reports no newer committed rows. Reconnect, visibility changes, and a 30-second visible-tab fallback poll trigger catch-up.

The client labels a local attempt `sending`, `sent`, or `failed`. `sent` means committed to the database. A read marker means a participant acknowledged a displayed sequence. Neither state proves delivery of email or that a human understood a message. Retry keeps the same message ID. A new edit after failure creates a new attempt ID. Keep drafts in memory by default and clear them on account change or logout.

## Realtime and revocation

Use Supabase private Broadcast with authorized per-member topics, `member:<auth-user-id>`. A database event targets the currently authorized recipients with a generic refresh hint. Broadcast payloads contain no body, order ID, address, token, email, or conversation identifier. All content comes from subsequent authenticated reads with current database authorization.

Per-member topics prevent a revoked conversation subscriber from learning subsequent order event timing on an old topic. Broadcast is a performance hint with no delivery guarantee. Missed hints are recovered by catch-up and polling. Disable public channels and deny client publication of authoritative events. [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) governs private joins, while database membership continues to govern content access.

Recheck live membership on every read and send. On `PERMISSION` or suspension, unsubscribe, clear cached messages and pending attempts, and display an access state. JWT validity alone does not establish current application membership. Validate user identity at the server and check current roles in the transaction. Use fresh Auth user checks where session revocation matters. [Supabase server-side Auth guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide).

Ordinary network failures retain drafts for retry. Revocation, logout, and account change clear sensitive drafts and cached history.

## Attachments and evidence

First-release chat is text-only. Receipt, funding, verification, and dispute evidence use dedicated structured uploads linked to their protected workflow records. A chat message cannot approve a substitution, change terms, verify payment, or release a transfer. Those actions require their structured commands and audit history.

Use private buckets and server-authorized upload intents. Limit evidence to validated JPEG, PNG, or PDF up to a proposed 5 MB. Validate signatures as well as declared MIME, use generated object names, strip image metadata, and serve PDF as a download. Finalize only an object that exists and passes validation. Reject executable formats and SVG. Purge abandoned uploads through a job. Short-lived download URLs require a fresh authorization check and must not enter logs or email.

[BTP-12 funding evidence](connected-funding.md) uses authorized JPEG and PNG uploads up to 2 MiB, re-encodes images, and serves private attachments through the application. It includes a bounded local cleanup command for abandoned synthetic drafts.

## Notification rules

| Event | Recipients | In-app | Email |
| --- | --- | --- | --- |
| Verification decision | Applicant | Immediately | Transactional summary |
| Offer received or changed | Listing owner | Immediately | One summary per event |
| Acceptance, expiry, cancellation | Affected customer and provider | Immediately | Transactional summary |
| Funding review, amendment action, delivery confirmation | Affected parties and assigned operators | Immediately | Action-required summary |
| New order message | Other active participant | Immediately | After 60 seconds if still unread, grouped per recipient/conversation window |
| New unassigned support case | Support queue | Immediately | None |
| New support message | Requester or assigned support operator | Immediately | After 60 seconds if still unread |
| Dispute opened or resolved | Affected parties and assigned reviewer | Immediately | Transactional summary |
| Transfer review or outcome | Affected member and assigned financial operators | Immediately | Transactional summary |

Prevent self-notifications. Recheck current recipient access, notification preferences, unread status, and suppression immediately before email. Never include message text, exact address, receipts, bank details, or delivery codes in email. Use a generic subject and a trusted-origin deep link that requires login and renewed authorization. Escape template content and derive links from `APP_ORIGIN`, never from an arbitrary request host.

For chat email, group by recipient, conversation, and a fixed UTC minute window. Enforce a unique grouping key and retain the maximum message sequence for that window. Dispatch no earlier than 60 seconds after the window closes. Claim the window once, recheck the recipient read cursor transactionally, and suppress it if already read or access was revoked. A message committed in a later window creates another group. Reading immediately after the final check can still race with provider submission, so email never promises that a message remains unread.

Message transactions and worker claims lock the same delivery group row. Only pending groups accept another source notification. If a group's claim or suppression already closed it, associate the new message with a fresh pending generation under the same window, keyed by an incremented generation. This prevents a delayed transaction from attaching a notification to already-sent work. Claiming a group checks all committed sources under that lock.

In-app notification read state is independent of message read state. Read markers only advance for committed visible messages belonging to the current member. Marking a notification read does not mark all conversation history read. Unread counts count received, visible messages after the member's cursor.

## Outbox and worker contract

The owning business transaction writes both the durable change and its notification rows. Email intents exist before commit returns. Do not perform an email send or network call inside the database transaction. Notification failure after commit never rolls back an order or hides its in-app notification.

Supabase Cron wakes a protected bounded Vercel job endpoint once per minute. The worker claims at most 10 due deliveries using row locks with skip-locked semantics, a lease token, and a 2-minute lease. An expired claim can be reclaimed before submission begins. An expired in-flight submission goes to reconciliation. Updates require the current lease token. The endpoint uses fixed job RPCs, recipients and copy derived by the service, and grants that exclude ordinary users.

The Supabase secret is broadly privileged at the database level. Its server-only client exposes only the fixed RPCs for email jobs. Lint restricts imports to the worker and webhook routes. The replay interface uses the operator's member session and requires a current platform-admin role and verified MFA.

Retry explicit Brevo rate-limit responses with jittered delays of 1, 5, 15, and 60 minutes, up to 5 attempts including the initial attempt. Apply bounded provider retry hints. Verified permanent bounce and policy events suppress the destination. Operators can inspect sanitized outcomes and authorize replay. Missed scheduler runs leave durable work pending and trigger a heartbeat alert after 5 minutes.

Each Brevo dispatch generation has a stable UUID idempotency key. Ambiguous transport or worker outcomes wait for a provider callback or operator reconciliation. Operator replay of an uncertain dispatch requires a 30-minute wait and confirmation that the earlier request was not accepted. Webhooks use Brevo bearer authentication and a BeeTip-signed dispatch tag bound to the destination. Receipts are unique by dispatch, provider message ID, and normalized outcome. See [transactional email](transactional-email.md) for provider limits and the staged confirmation checklist.

Provider acceptance, recipient-server delivery, bounce, and opened tracking are distinct outcomes. Avoid open tracking for pilot mail. Display an in-app record even when email fails. Do not claim exactly-once email delivery.

## Retention and operations

The pilot retention target is 90 days after final order resolution for order chat and ordinary receipt photos, and 90 days after closure for support conversations and ordinary case attachments. The clock starts after the last linked case closes. Verification evidence and abandoned uploads follow the shorter windows in the [pilot operating policy](pilot-operating-policy.md). [BTP-20](https://github.com/BeeTip/beetip/issues/22) owns retention enforcement, including audited deletion and message tombstones that preserve sequence positions.

Admin roles need MFA, least-privilege case assignment, and audited access. Publish abuse-reporting and escalation routes with real operating hours. No direct member-to-member inbox, WhatsApp, SMS, push delivery, live location, typing indicator, or chat attachments are required for first release. Revisit those as separate issues after the pilot demonstrates demand.

## Required verification

Test unauthorized history and subscription, unrelated order IDs, self-notification prevention, paused and revoked memberships, settled conversation restrictions, concurrent sends, duplicate keys with changed text, read-cursor races, gaps during subscription, offline retries, paginated catch-up, and account changes. Test worker overlap, stale leases, duplicate webhooks, delayed jobs, provider timeout, post-send crash, dead-letter replay, bounce suppression, retention holds, and private-file expiry. Use multiple actual authenticated sessions rather than the demo persona switcher.
