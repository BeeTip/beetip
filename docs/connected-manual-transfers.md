# Connected synthetic transfer review

Migration `20261121004000` removed connected transfer commands. The procedure records [revision f4cb229](https://github.com/BeeTip/beetip/blob/f4cb229/docs/connected-manual-transfers.md).

Open **Pemeriksaan dana** from the account dashboard and choose **Transfer dan pengembalian dana**. The queue is scoped to connected finance staff with verified MFA and a synthetic account assignment. Order participants cannot operate or read the staff transfer ledger for their own order.

1. Open an eligible delivered or case-cancelled order. Select an available item, fee or refund, then enter a whole IDR amount and a note.
2. Refunds and payouts on orders with cancellation or dispute history require another authorized operator to approve. A change to the order's allocation or case context invalidates the approval path. Close the stale request and prepare a fresh one. If the reviewer loses authorization before start, a new request needs a current reviewer.
3. The initiator selects **Mulai simulasi transfer** to reserve the selected amount. The account can have one attempt in progress or awaiting reconciliation. Completion requires a synthetic reference beginning with `TEST`. Use fabricated references and notes throughout.
4. Record **terkirim**, **tidak dikirim** or **hasil belum pasti**. An uncertain result retains the reservation and blocks further starts on that account. A scoped operator must compare the synthetic account records and record the matching statement entry or the record used to establish that the transfer was absent. A confirmed completion consumes the allocation. A confirmed absence releases it.
5. If the response disappears, use **Periksa operasi**. The browser stores the operation ID for that order in the current tab's session storage, including through reload. An unfound receipt allows resubmission of the same request and operation ID. A receipt confirms the database change. The current order view then reloads from the database.

## Ledger contract

- The request, decisions and outcomes are separate append-only records. Account scope, MFA and current role grants are checked on the server and database. Operation receipts are keyed by actor and operation ID and reject reuse with a different command or payload.
- Commands serialize on the order row shared with funding and case commands, then lock the synthetic account and any existing request. BTP-16 case review reads committed transfer allocations including started and ambiguous attempts. Holds reduce available entitlement for the relevant component and item. Other accounts can continue independently.
- Outbound completed references are normalized and unique per synthetic account. The incoming funding reference ledger has its own namespace. Transfer facts retain the simulated outcome, actor identities, and notes.
- The web page and API require `BEETIP_SYNTHETIC_TRANSFERS=1`, connected mode and both app and Supabase API on `127.0.0.1`. The migration enables zero synthetic accounts by default. The rehearsal creates a private account opt-in with disposable data.

## Rehearsal

Run `rtk proxy node scripts/test-btp17-transfers.mjs` with `BEETIP_LOCAL_DATABASE_URL` pointing to disposable loopback PostgreSQL. The runner creates and drops its own database and applies the full migration chain. CI runs this harness in its PostgreSQL job. It covers independent reviews, MFA and account boundaries, stale state and revocation, concurrent commands, account reference uniqueness, cancellation and dispute holds, both ambiguous outcomes, and operation lookup.

For the browser harness, follow the [disposable Supabase setup](running-beetip.md#start-the-connected-application) using project ID `beetip_btp17_isolated`. Choose free API, database, mail and app ports. Set the app's connected mode, publishable key, `APP_ORIGIN`, and `BEETIP_SYNTHETIC_TRANSFERS=1`. Set `BEETIP_TEST_LOCAL_STACK` to the copied workspace and `BEETIP_TEST_URL` to the app origin (default `http://127.0.0.1:3117`). Run `rtk proxy node scripts/test-btp17-transfer-sessions.mjs`. It creates its own connected participants, verified synthetic funding and two finance staff, then walks through a cancellation refund in separate 390px Chromium sessions with real local MFA. It discards a successful start response to exercise recovery, reconciles an uncertain result, and verifies live role revocation. Dispose of that Supabase stack after the run.

## Red and green evidence

| Slice | Red | Green |
| --- | --- | --- |
| Refund preparation | The disposable SQL fixture reached the public command and PostgreSQL returned `42883` for the missing RPC. | The first synthetic refund stored exactly one preparation and replay returned the same request ID. |
| Approval and outcomes | The initiator's approval test received the preparation-only validation error where an independent-review denial was expected. | The SQL harness passed approvals, revocation, operation lookup, account blocking, and reconciliation. |
| Ambiguous reconciliation | The SQL harness showed that a whitespace-only statement record could close an ambiguous attempt. | Both the SQL command and API reject whitespace-only records. |
| Scoped staff read model | The queue call returned `42883` before the queue and ledger RPCs existed. | The harness confirmed queue membership and different actions for the initiator and independent reviewer. |
| Connected UI | Vitest could not resolve the transfer screen import before implementation. | The UI tests passed approval replay lookup after reload and the required account-record inputs for reconciliation. |

Physical Android Chrome and iOS Safari handover acceptance in #17, hosted acceptance, a real payout policy and approval to handle money remain operating gates. The rehearsal exercises the connected synthetic path.
