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
- Queue alerts use the existing in-app inbox. New support replies write the authorized event-time recipient rows and durable email sources. Reassignment suppresses the former operator’s pending case email. Grouped mail dispatch rechecks current access and read state. Hosted provider delivery remains a separate release gate.
- The migration depends on BTP-08 shared messaging columns and helpers. Apply a forward repair if BTP-09 is present. The BTP-08 rollback is for the BTP-08 schema before dependent slices are applied.

## Verification

Run `rtk proxy node scripts/test-btp09-support.mjs` against isolated loopback PostgreSQL 18 via `BEETIP_LOCAL_DATABASE_URL`. The runner creates and drops its own database, applies the pre-BTP-09 chain, inserts baseline fixtures and then applies BTP-09. Separate SQL sessions verify claim races, privacy with an order reference, MFA and finance boundaries, mid-session reassignment, notification recipient changes, send/read retries, and order-history audits. The local suite uses the repository’s Auth, Storage and Realtime SQL stand-ins. Connected acceptance also requires real Auth/MFA sessions and observed browser behavior against a disposable Supabase stack.

The initial implementation passed the BTP-09, BTP-08, BTP-07 and atomic-acceptance SQL suites, 69 unit and component tests, 16 demo browser tests, notification seed parity, lint, type checking and the production build. The integrated rehearsal applied both support and funding migrations on disposable Supabase. Separate browser sessions verified legacy support history, requester isolation, MFA queue access, claiming, replying and reassignment. The previous operator's open session lost access after reassignment.

### Issue #11 follow-up

The follow-up started from main at `91f5bb9525d1c06299607ec3d75399ff6d6b561e`, with the BTP-08 prerequisite closed. In the support thread, closing order history cancels any pending page. A workspace refresh cancels pending history pages and clears cached order history if the case version or access changes. Opening order history again goes through the audited read. The focused component tests cover a delayed response after dismissal, a version change with access still reported, explicit grant revocation, and loss of case access.

- Isolated PostgreSQL 18.1 passed all six checks in `scripts/test-btp09-support.mjs`. The full migration chain preserved legacy case and message IDs, allowed exactly one competing claimant, retained pending-member access, denied the order counterparty and finance role, and audited reassignment and order reads. The same run verified that the former operator loses access without signing out and that subsequent replies target the replacement.
- A Chromium rehearsal on a disposable Supabase 17 stack used six separate browser sessions with synthetic accounts. The pending requester opened an order-linked case. The order counterparty, AAL1 support operator, AAL2 finance operator and unassigned AAL2 administrator were denied the relevant private reads or claim. An MFA support operator claimed, replied and escalated. The lead granted order access, and opening it wrote one audit row. After reassignment, the old operator's open tab automatically cleared the support history, draft and order history. The replacement read the existing support replies and received subsequent notifications. The replacement resolved the case, and the pending requester reopened it.
- The follow-up passed all 82 unit and component tests across 15 files, plus lint, type checking and the production build.
- Local acceptance satisfies the issue's implementation criteria. The rehearsal used the local Auth, TOTP, PostgREST and Realtime services. Staging deployment, provider delivery, and the owner decisions for support operations and retention remain release gates.
