# Connected order amendments

The connected demo uses the approved item budget for shopping after simulated checkout. An approved increase still checks trip capacity and requires the customer's consent. The manual top-up procedure below describes the [historical funding workflow](connected-funding.md).

[BeeTip issue #15](https://github.com/BeeTip/beetip/issues/15) adds provider proposals and explicit customer approval or rejection for connected orders. Both parties can open **Perubahan pesanan** in the private order detail. Providers propose a complete replacement shopping list and a reason. The unit budgets and quantities determine the revised maximum item budget in whole rupiah. Customers see the proposed items, reason, item budget and total with the original service fee before deciding. The order still shows its original accepted snapshot and displays the current approved terms and up to 20 recent proposals separately.

## Versions, authorization and capacity

Migration `20261119045011_btp13_order_amendments.sql` follows BTP-12. Existing orders start at terms version 1. Each order has a monotonically increasing proposal revision and at most one pending proposal. The provider must name the current terms version. The customer must name the exact pending proposal ID and the terms version it was based on. Approval advances the terms version and reservation amount together. Rejection preserves the approved terms and reserved amount. The original `order_terms` row and the proposal content and resolved history are immutable.

`GET /api/identity/amendments?id=<order-uuid>` returns the private participant projection. `POST /api/identity/amendments` checks the connected session, same-origin JSON and expected account. Both endpoints use the caller's token. An actor-scoped operation receipt binds the entire canonical command. Exact replay returns the original proposal ID after a decision or version change, and changing the payload under the same operation ID conflicts. The browser holds the full serialized request in memory for retry after a timeout, malformed response or lost response. After a reload, the order view shows the current proposal and decision history.

The transaction locks the receipt, then the capacity-owning listing, order and reservation via `private.btp07_lock_payable_order`. A trip uses its trip listing and a fixed request uses its request listing. Approval replaces this order's reserved amount only if the revised amount and all other active reservations fit within the listing's spending limit. An already funded reservation counts even after its unpaid deadline. Pending proposals leave capacity at the current approved amount, so approval can still encounter a capacity conflict and the customer can reject the proposal. The existing unpaid deadline applies. Both unreviewed and previously verified orders can propose changes while their reservations remain active.

The audit event and `amendment_action` in-app and email intents commit in the same transaction as each change. The proposal goes to the customer. The decision goes to the provider. Notifications retain the safe BTP-10 summary and link to the authorized order. Items, reasons and amounts stay in the private order flow.

## Synthetic funding and purchase gate

The required total is the current approved item budget plus the original fee. The outstanding amount is that total less all verified submissions, floored at zero. A pending amendment blocks purchase eligibility. An approved increase stays blocked until verified funding covers the new total. Rejection restores eligibility if the already-approved total is covered. A future purchase command must take the BTP-07 listing/order/reservation lock before checking `private.funding_purchase_ready(order_id)` in its transaction.

When prior funding preserved the reservation and a balance is still due, both the order list and detail show **Menunggu tambahan dana**. The detail shows an unpaid reservation deadline while the initial payment is still due. The provider opens the proposal editor on demand, and the customer can review a pending proposal directly on the order.

A customer can open one draft or pending submission at a time. A new proof must equal the exact outstanding amount at draft creation and submission. If approval changes that amount while a draft is open, the customer discards it and starts a new draft. Submitted evidence remains reviewable for its exact submitted amount. When that proof is verified, the reservation is preserved and the customer can submit the exact remaining balance, including after the original unpaid deadline. Each top-up uses its own synthetic reference and independently checked MFA review. Lower budgets retain existing verified evidence and can reduce the balance to zero. Handling any excess funds belongs to a separate reconciliation workflow.

## Verification commands

Run the database harnesses using disposable **plain** loopback PostgreSQL. Each command creates and drops only its own unique test database. The helper Auth and Storage schemas stand in for the real services in these SQL checks. Use a distinct disposable Supabase project and ports for the browser harness.

```powershell
$env:BEETIP_LOCAL_DATABASE_URL = 'postgres://postgres@127.0.0.1:55486/postgres'
rtk proxy node scripts/test-btp13-amendments.mjs
rtk proxy node scripts/test-btp12-funding.mjs
rtk proxy node scripts/test-atomic-acceptance.mjs
rtk proxy node --experimental-strip-types scripts/notification-registry.mjs
rtk pnpm test
rtk pnpm lint
rtk pnpm typecheck
```

For real sessions, start the connected production app with its own loopback Supabase URL, publishable key, synthetic Storage secret and matching `APP_ORIGIN`. Point the browser harness to the disposable stack's workdir and the app's origin. It runs BTP-12 and adds the BTP-13 provider/customer proposal and decision flow, lost-response replay, and MFA/Storage top-up. It creates synthetic fixtures only in that stack.

```powershell
$env:BEETIP_TEST_LOCAL_STACK = 'C:/path/to/disposable/btp13-stack'
$env:BEETIP_TEST_URL = 'http://127.0.0.1:3113'
rtk proxy node scripts/test-btp12-funding-sessions.mjs --amendments
```

Email transport and scheduling, hosted migration/application, and real-money operating approval remain integration gates. This flow uses synthetic references and sample images.

Local acceptance covered separate provider, customer, unrelated and finance sessions on a production Next.js build with disposable Supabase. At 390 px, the proposal editor opened on demand, exact retry after a lost response saved one proposal, and both order views showed the top-up status before reverting to verified after MFA review. The database suite checked capacity lock races, recipient authorization and immutable history. Generated public database types matched the applied schema structurally.
