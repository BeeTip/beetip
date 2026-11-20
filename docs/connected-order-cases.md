# Connected cancellation and dispute cases

Participants open cases under **Pembatalan dan sengketa** on the private order page. Finance staff work from **Pemeriksaan kasus pesanan**. Staff need an active finance grant, a verified MFA factor, an AAL2 session, and an enabled operator grant for every account that verified funds on the order. Participants can submit case evidence and cannot review their own orders under a staff grant.

## Pilot contract

| Case or decision | Connected behavior |
| --- | --- |
| Funded cancellation before purchase | Hold the order's unsettled allocation during review. An approved resolution allocates all verified funds to a refund. |
| Cancellation after an approved purchase | Review receipts, return options, and work completed. Reimbursable purchase cost is capped at the approved net receipt allocation. The fee is capped at the agreed amount. |
| Problem with a purchased item or fee | After purchase progress is finalized, hold a specified amount of one item's remaining approved cost or the agreed fee. Review can preserve the hold's allocation or refund some or all of that amount. |
| Proposal and second review | Record the explicit purchase, fee, and refund amounts alongside a rationale. The total equals verified funds. Another scoped staff member can approve or return the proposal. New evidence requires a fresh proposal. An approved dismissal closes the case with its original allocation. |

One case can be active per order. Additional reports can be attached to the active case or filed separately after resolution. Orders with a pending funding check wait for reconciliation before a case can open. Unpaid orders remain covered by reservation expiry. Approved cancellation changes the order state and makes its order chat read-only. It retains the verified funding and reservation records for reconciliation.

The isolated demo records the before-purchase full refund allocation when a cancellation is requested. After purchase, it requires explicit amounts and a second administrator's approval before recording the cancellation. Existing demo cancellation records keep their historical totals.

Case photos use a private bucket with server-only `BEETIP_CASE_STORAGE_SECRET`. The upload path binds the submitter, order, operation ID and normalized content hash. The server applies the [shared evidence upload checks](private-evidence.md) and verifies access again before sending private attachments. Finalization checks the stored object and binds it to the case in the same transaction. A dispute requires a photo. A participant can attach a photo to a cancellation or add up to eight total images while a case is active. Notifications carry only workflow summaries and link to authorized views.

The order row serializes holds, reviews and the owner-only synthetic claim rehearsal. Claims consume capacity by order and allocation component, including the item index for purchased costs. They do not record a bank outcome. The case approval records an allocation and preserves any amounts already committed. BTP-17 owns actual transfer requests, ambiguous outcomes, reconciliation, and replacement of the rehearsal claims with its authoritative records. Hosted real-session verification, evidence retention and abandoned upload cleanup, reviewer staffing, and approval for real funding or transfer operations remain operating gates.

## Local rehearsal

Run from the repository root. The SQL harness defaults to disposable PostgreSQL on `127.0.0.1:55491` and accepts a loopback `BEETIP_LOCAL_DATABASE_URL`. Its isolated test database applies the full migration chain and closes after the assertions. The browser harness needs a dedicated local Supabase stack and connected app with matching `APP_ORIGIN`. Supply the stack's own publishable key and server-only Storage secret for case and receipt evidence. The harness creates synthetic login accounts, enrolls two TOTP factors and uses a pre-verified funding fixture. Keep those fixtures in the disposable stack.

```powershell
rtk proxy node scripts/test-btp16-cases.mjs
rtk proxy pnpm exec vitest run packages/domain/src/domain.test.ts
rtk proxy pnpm exec vitest run apps/web/src/components/connected-order.test.tsx
rtk proxy pnpm exec vitest run packages/validation/src/notifications.test.ts
$env:BEETIP_TEST_LOCAL_STACK = $stack
rtk proxy node scripts/test-btp16-case-sessions.mjs
```

The SQL red runs failed first on the missing cancellation RPC, then on the missing proposal, evidence, transfer claim, and cancellation guard behavior as each test was added. Green runs verified replay, receipt-bound claims, conservation, independent review, a stale proposal after new evidence, scoped notifications, live revocation, and the hold/claim race while a confirmed sibling order retained its entitlement.

The domain red run exposed the fixed demo cancellation formula. The connected UI red run found the missing cancellation action. The notification registry red run found missing case events. Their focused runs passed with 16 domain, 5 connected order, and 5 registry tests. The real-session test exposed a staff queue redirect and passed after the queue was added to connected routing. At 390px it verified local Auth and TOTP, decode and metadata stripping in Storage, private attachments, case creation, two-person approval, reload, notification, and live role revocation.

`rtk proxy pnpm test` passed all 84 tests. `rtk proxy pnpm typecheck`, `rtk proxy pnpm lint`, and the connected `rtk proxy pnpm build` passed. The real-session harness passed against both the development server and the production build served with `rtk proxy pnpm --filter @beetip/web exec next start --hostname 127.0.0.1 --port 3116`. BTP-12, BTP-13 and BTP-15 SQL harnesses passed using the same disposable PostgreSQL server. `rtk proxy supabase gen types --workdir $stack --local --schema public` matched the four new RPC signatures. `rtk proxy supabase db advisors --workdir $stack --local --level warn --fail-on error` reported only the existing permissive SELECT policy warning on `staff_roles`.
