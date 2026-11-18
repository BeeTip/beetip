# Private support operations

The connected **Hubungi bantuan** workspace serves confirmed members, including members with pending status. Requesters can open cases, send replies and reopen resolved cases. An order participant can reach the workspace from **Pesan pesanan** with that order attached. The reference stays within the support case and has no effect on order-party access.

## Staff workflow

1. Open **Afiliasi opsional dan keamanan petugas** from the dashboard and complete MFA. A staff assignment is required for queue access.
2. In **Hubungi bantuan**, choose **Ambil kasus** from **Antrean bantuan**. Only one competing claim succeeds. If a case changes before submission, reload the queue.
3. Reply privately, mark the case complete, or provide an operational reason to escalate it. The requester or assigned operator can reopen a resolved case.
4. A platform administrator with MFA can review operational metadata in **Kelola kasus terbuka**. The lead can reassign an open case to an active MFA-enrolled support operator. The replacement takes over the history and future notifications. The previous operator loses access immediately at the database and the workspace clears the case on revalidation.
5. For an escalated case with an order reference, the lead can grant or revoke order-chat reading for the assigned operator. The operator selects **Baca chat pesanan** in the case. Each requested page records a private audit entry. Resolving or reassigning the case removes the grant.

## Storage and access

- The migration upgrades baseline support rows in place in `public.conversations`, `public.conversation_members`, and `public.messages`. It retains original IDs, text, sequences and legacy opening receipts. In the event of multiple active legacy assignees, it retains the newest grant and audits each revoked assignment.
- The ordinary queue response is limited to case ID, category, updated timestamp and case version. Lead metadata adds assignment and escalation state. The lead role alone does not allow message access. Staff order-history access uses the case RPC so the access is audited. Financial roles confer no support or order-chat authority.
- Case actions lock the same conversation row used to send messages and validate the case version. Client message IDs are actor-scoped and retries use the same ID. Cases reuse the order-chat quota and cursor tables. Case pages contain up to 50 messages. Private member hints carry no case or order data. Focus, reconnect and a 30-second visible-tab poll recheck access.
- Queue alerts use the existing in-app inbox. New support replies write the authorized event-time recipient rows and durable email sources. Reassignment suppresses the former operator’s pending case email. Grouped mail dispatch and its final access/read recheck remain a separate release gate.
- The migration depends on BTP-08 shared messaging columns and helpers. Apply a forward repair if BTP-09 is present. The BTP-08 rollback is for the BTP-08 schema before dependent slices are applied.

## Verification

Run `rtk proxy node scripts/test-btp09-support.mjs` against isolated loopback PostgreSQL 18 via `BEETIP_LOCAL_DATABASE_URL`. The runner creates and drops its own database, applies the pre-BTP-09 chain, inserts baseline fixtures and then applies BTP-09. Separate SQL sessions verify claim races, privacy with an order reference, MFA and finance boundaries, mid-session reassignment, notification recipient changes, send/read retries, and order-history audits. The local suite uses the repository’s Auth, Storage and Realtime SQL stand-ins. Connected acceptance also requires real Auth/MFA sessions and observed browser behavior against a disposable Supabase stack.

Local verification passed the BTP-09, BTP-08, BTP-07 and atomic-acceptance SQL suites, 69 unit and component tests, 16 demo browser tests, notification seed parity, lint, type checking and the production build. The component test confirms that order-history revocation removes cached order messages and reassignment clears the support history and composer.
