# Connected purchase progress and shared receipts

[BTP-14](https://github.com/BeeTip/beetip/issues/16) adds **Progres belanja** to the connected order detail and reflects purchase progress in the private order list. Providers can enter a receipt and photo, apply one or more lines to the current order, and finish after accounting for every approved item. The provider's progress panel identifies the current customer and links to the other orders on that trip so the provider can allocate remaining receipt quantities. A fixed request uses the same screen and limits its receipts to that request. Customers see current approved items, purchased quantities, unavailability, and their own receipt calculations.

## Allocation rules

Migration `20261119053928_btp14_shared_receipts.sql` follows BTP-13 and BTP-11. The originally requested version sorts before BTP-13, which supplies the approved version and funding check.

The provider records the merchant, receipt number, date, each physical receipt line in printed order, and one shared discount in whole rupiah. Enter a line's gross after any line-specific markdown and before the shared discount. A printed row has one identity even when labeled the same as another row. The receipt namespace is provider, normalized merchant, Jakarta purchase date, and normalized reference. Merchant normalization folds case and repeated whitespace. References fold case and remove whitespace and hyphens, retaining letters, digits, slashes, periods and underscores. The same normalized image can be finalized only once per provider. The purchase date must be between order acceptance and today, inclusive, in Jakarta.

The database distributes the shared discount proportionally across lines using differences between cumulative whole-rupiah shares in line order. Within each line it follows the gross value assigned to each quantity, using cumulative rounding again. Fully allocating the receipt conserves its original gross, discount and net. The order displays each allocation as gross minus discount equals net. The database rejects quantities beyond the physical line or approved item, a net above the item's unit budget times quantity, and a running net total above the order budget. The service fee stays separate. A failed row rolls back its whole allocation batch.

Each write binds the actor, order, version and complete payload to an operation ID. Exact retries return the committed result and reuse with changed data conflicts. The transaction locks the existing payable listing, order and reservation, the order totals, and the relevant receipt and lines. It rechecks active provider assignment, current approved terms and verified synthetic funding, including top-ups. Pending proposals block purchase writes. After an allocation, an amendment can change other items while preserving already-purchased rows at the same positions. Finalizing records each missing quantity with an explanation and locks that order's purchase history. Sibling trip orders continue independently.

## Evidence and access

The server-only `BEETIP_RECEIPT_STORAGE_SECRET` selects the private `purchase-receipts` bucket. Uploads accept decoded JPEG or PNG up to 2 MiB and 12 megapixels, strip metadata, and store normalized bytes under the provider, anchor order, operation ID and content hash. Finalizing a receipt requires the exact object at that prefix. Another order cannot attach that upload. The provider can download a finalized original through an order on the same listing. Customers see their own allocation details because an original image can contain other customers' purchases. Authenticated and anonymous clients have no direct access to the bucket or ledger tables. Abandoned uploads require a separate retention and cleanup policy.

Order progress distinguishes waiting for funds or approval, ready, shopping in progress, all purchased, partially unavailable and entirely unavailable. The provider explicitly confirms missing quantities and can retry an uncertain response while the order detail remains open. Receipt corrections after saving, staff evidence review, and actual transfers belong to later workflows. The receipt calculations record purchase facts and can support later settlement.

## Local verification

Use a dedicated disposable Supabase project with its own loopback ports, apply the migrations, and start the connected production build with its local publishable key, receipt Storage secret and matching `APP_ORIGIN`. The harness requires the isolated stack workdir and creates synthetic fixtures through local Auth and PostgreSQL. It installs verified funding fixture records to exercise the purchase gate. BTP-12 and BTP-13 cover the separate verification and consent flows.

```powershell
$env:BEETIP_TEST_LOCAL_STACK = 'C:/path/to/disposable/btp14-stack'
$env:BEETIP_TEST_URL = 'http://127.0.0.1:3114'
rtk proxy node scripts/test-btp14-purchases.mjs
rtk pnpm test
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm build
```

The harness checks separate provider and customer sessions at 390 px, private proof access, duplicate and wrong-order proof, expired or unpaid authorization, a lost-response replay, same-trip multi-line allocations, a lock race, conserved rounding and partial completion. Hosted application and migration acceptance, evidence retention, user testing, and real-money operation remain operating gates.
