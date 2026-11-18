# Private connected order chat

BTP-08 adds private text conversations to the orders created by atomic acceptance. Both participants can open **Pesan pesanan** from their order. The synthetic demo keeps its existing local chat adapter. Support replies and queue assignment remain BTP-09.

## Durable messages and access

`20261119000800_btp08_connected_chat.sql` extends the existing messages with a client UUID and adds private read cursors, account send locks and delayed email-source records. `btp08_send`, `btp08_history` and `btp08_read` authenticate each command through the existing live account/session and conversation-membership checks. Unrelated members, revoked participants, suspended accounts and anonymous clients cannot read or send. Clients cannot write the underlying tables or read the internal cursors directly. Staff financial or support grants do not automatically grant order-chat access.

A send accepts trimmed plain text of 1 through 1,000 characters. The UI creates a UUID before sending and retains the exact UUID and text across an uncertain-response retry. The database binds the UUID to the normalized body for that sender/conversation. Exact replay returns the committed message; a changed body conflicts. No HTML or Markdown is interpreted.

Send transactions lock the account send guard, listing, order, reservation, conversation and current membership before checking the deadline and allocating a sequence. Conversation serialization makes sequences commit in order, including concurrent senders. A rollback restores the counter, message, notification and transport hint together. Per-account limits of 10 new messages per minute and 100 per hour are enforced under the account lock. Exact committed retries do not consume another quota slot. A throttle response preserves the attempt and gives a retry delay.

## History, recovery and reads

Initial history returns the latest 50 messages in ascending sequence order, an older-page cursor and a committed high-water mark. Earlier history uses `before`; catch-up uses `after` in ascending pages of at most 50. The UI merges by stable message ID and continues through every catch-up page. Loading older messages does not move the newer-message cursor.

The browser subscribes to its authorized private `member:<UUID>` topic before initial fetching. Broadcasts request a refresh and contain no message text, order ID, address, amount or participant record. Supabase adds a random transport UUID to the empty payload. The subscription is only a hint: database history remains authoritative. Reconnect, online, focus and visibility changes fetch missed messages; a visible-tab fallback checks every 30 seconds. A subscription failure does not discard committed history or prevent bounded catch-up.

The read action acknowledges the highest displayed sequence. Its database cursor only increases and cannot exceed committed history. Unread counts include counterpart messages above that cursor. A read acknowledgment does not establish email delivery or human understanding.

Drafts and pending attempts stay in memory. Account changes, logout, permission denial and component cleanup clear private state and abort pending requests. Failed or timed-out sends remain visibly unconfirmed and can retry the original attempt. Successful sends appear as **Tersimpan**. The interface includes initial loading, empty history, failed history retry, closed history, older pagination and explicit read controls. Times use WIB.

## Expiry, funding and final closure

The [BTP-07 deadline contract](connected-expiry.md) also governs new sends. An unpaid reservation at or beyond its server deadline is read-only even before the worker marks the order expired. Released, expired and cancelled orders retain authorized history. A verified reservation remains writable after its original unpaid deadline; its marker is not a browser payment assertion. Existing committed sends can still be reconciled by exact retry after closure.

Current order states do not include final financial settlement. Future settlement/cancellation commands must close the conversation in the same transaction as final resolution. Sends check `conversations.status` under its lock, so setting the existing closed status blocks new text. BTP-08 does not implement settlement or reopen an expired order.

## Notifications and email boundary

Each new message creates one counterpart-only in-app notification and durable channel intents. Notification access rechecks current conversation membership; a revoked member loses the notification target as well as message access. The authorized order target contains the chat link.

`private.btp08_email_sources` associates a notification with its conversation sequence and unread window. The minute boundary plus one minute is its earliest proposed send time. These records are inputs for BTP-11, not an active email worker. The existing email-dispatch helper continues denying chat delivery until grouping, live read-cursor checks, suppression and provider recovery are implemented. No application email is sent by this feature. Chat attachments, typing indicators and a direct member inbox remain outside this slice.

`20261119000801_btp08_private_hint_initplan.sql` wraps policy lookups in scalar subqueries to avoid per-row authorization-function evaluation. It preserves the same private topic and live identity predicates.

## Repeat verification

[The integration record](expiry-chat-acceptance.md) records the accepted source, dedicated-development migrations, real separate sessions, actual Cron and remaining release gates.

Use Node 24.22.1 and an isolated loopback PostgreSQL 18 instance:

```powershell
$env:BEETIP_LOCAL_DATABASE_URL = 'postgres://postgres@127.0.0.1:55486/postgres'
rtk proxy node scripts/test-btp08-chat.mjs
rtk proxy node scripts/test-btp07-expiry.mjs
rtk proxy node scripts/test-atomic-acceptance.mjs
```

These runners create random temporary databases, apply the complete ordered migration chain and drop their own databases. Test-only Auth, Storage and Realtime stand-ins are explicit. The chat suite verifies real PostgreSQL lock waits, late-commit catch-up, exact retry/body binding, rollback, 129-message pagination, monotonic cursors, quotas, unrelated/revoked/suspended/deleted-session denial, transport-payload privacy, funded versus unpaid expiry and feature rollback. CI runs all three suites on PostgreSQL 18. Stand-ins do not prove hosted Auth or live WebSocket behavior.

For real separate Auth sessions, start the connected production build with the matching origin, then run the guarded browser harness:

```powershell
$env:BEETIP_TEST_PROJECT_REF = 'rgiptdfjlmwldngapojq'
$env:BEETIP_TEST_URL = 'http://127.0.0.1:3108'
rtk proxy node scripts/test-chat-sessions.mjs
```

It refuses other projects and nonlocal web candidates, uses synthetic confirmed accounts without sending email, checks live private subscription access, API guards, concurrent retry/read state, rendered response-loss recovery, reconnect catch-up, expiration and logout, and deletes only its own fixtures. It preserves retained accounts, support, staff/MFA and audit facts. Screenshots are ignored verification artifacts.

## Rollback and release

`supabase/rollback/btp08_connected_chat.sql` is a destructive feature rollback for isolated verification. It removes this feature's notification/read/retry metadata and functions while preserving message history and restoring the prior target helper. Back up feature records before considering it on a shared environment; an application rollback alone does not reverse schema or external effects. Prefer a compatible forward repair after real conversations exist.

Development schema and local browser acceptance must be recorded separately from public web deployment. Physical devices, measured pilot latency/load, support operations, transactional application email, retention approval, recovery rehearsal and real-money release remain owning-slice gates. See [running BeeTip](running-beetip.md) and [the deployment runbook](vercel-deployment.md).
