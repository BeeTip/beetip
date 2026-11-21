# Messaging and notification contracts

This reference specifies the connected pilot. The implementation records describe [private order chat](connected-chat.md), [private support operations](connected-support.md), [in-app notifications](notifications.md). Retention jobs remain proposed under their owning issues. The synthetic demo uses browser-local records.

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

| Event | Recipients | In-app |
| --- | --- | --- |
| Verification decision | Applicant | Immediately |
| Offer received or changed | Listing owner | Immediately |
| Acceptance, expiry, cancellation | Affected customer and provider | Immediately |
| Funding review, amendment action, delivery confirmation | Affected parties and assigned operators | Immediately |
| New order message | Other active participant | Immediately |
| New unassigned support case | Support queue | Immediately |
| New support message | Requester or assigned support operator | Immediately |
| Dispute opened or resolved | Affected parties and assigned reviewer | Immediately |
| Transfer review or outcome | Affected member and assigned financial operators | Immediately |

Business transactions commit their in-app notification records together with the event. Recipients must have current access to the linked order or conversation. Auth handles confirmation and password recovery email separately.

Notification read state is independent of the conversation cursor. A notification read leaves the message history and unread message count intact.

## Retention and operations

The pilot retention target is 90 days after final order resolution for order chat and ordinary receipt photos, and 90 days after closure for support conversations and ordinary case attachments. The clock starts after the last linked case closes. Verification evidence and abandoned uploads follow the shorter windows in the [pilot operating policy](pilot-operating-policy.md). [BTP-20](https://github.com/BeeTip/beetip/issues/22) owns retention enforcement, including audited deletion and message tombstones that preserve sequence positions.

Admin roles need MFA, least-privilege case assignment, and audited access. Publish abuse-reporting and escalation routes with real operating hours. No direct member-to-member inbox, WhatsApp, SMS, push delivery, live location, typing indicator, or chat attachments are required for first release. Revisit those as separate issues after the pilot demonstrates demand.

## Required verification

Test unauthorized history and subscription, unrelated order IDs, self-notification prevention, paused and revoked memberships, settled conversation restrictions, concurrent sends, duplicate keys with changed text, read-cursor races, gaps during subscription, offline retries, paginated catch-up, and account changes. Test in-app delivery, retired application email routes, retention holds, and private-file expiry. Use multiple actual authenticated sessions rather than the demo persona switcher.
