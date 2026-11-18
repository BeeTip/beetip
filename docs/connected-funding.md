# BTP-12 incoming funding

[BeeTip issue #14](https://github.com/BeeTip/beetip/issues/14) adds a connected customer submission and a private finance review queue. The migration is `20261119001000`. It follows BTP-07 expiry, BTP-10 notifications and the BTP-08 notification resolver. The demo uses its existing funding adapter.

## Funding and expiry

The initial funding requirement is the immutable order budget plus its service fee in whole rupiah. A customer starts one draft, uploads an image, and submits it for review. Only the customer can submit or discard their draft. The provider sees the independent funding status and purchase eligibility. Evidence filenames, bank references and reviewer details stay out of the provider’s order and notification data.

The pilot accepts one exact matching bank entry for the order total. A finance operator with live MFA and a collection-account assignment enters the independently checked account, reference and amount, or records a fixed rejection reason. Order counterparties cannot review their own order. References are normalized by uppercasing and removing ASCII spaces and hyphens, then reserved per account when submitted. Rejected entries release the reference so the customer can correct and resubmit. Pending and verified entries hold the reference.

Each mutation binds its action and canonical payload to an actor-scoped operation receipt. Verification locks the receipt, current grants, listing, order, reservation and funding submission. BTP-07 rechecks the deadline against the wall clock after acquiring the capacity locks. The marker, verified record, audit and notification intents commit together. Expired submissions require separate late-money reconciliation and cannot preserve a reservation. The future purchase command must take the same payable-order lock and enforce `private.funding_purchase_ready(order_id)` in its transaction.

## Evidence and notification access

The bucket is private and user roles have no direct bucket access. The application authorizes each upload and download against the caller’s current session, order role and funding state. `BEETIP_FUNDING_STORAGE_SECRET` is a server-only local Supabase secret key for the bucket operations. Downloads use a private, non-cacheable attachment response.

Evidence accepts JPEG or PNG up to 2 MiB and 12 megapixels, decoded and re-encoded with metadata removed. Object names come from database-generated submission UUIDs. Upload retries can replay identical normalized bytes. Replacing a file requires discarding its draft. Finalization checks the stored object and keeps purchasing blocked until bank verification.

The operator queue at `/account/funding` lists pending unexpired submissions for the operator’s assigned accounts. Submission notifies eligible assigned operators. Review outcomes notify both counterparties. Notifications have a fixed summary and no evidence, amounts or references. The inbox rechecks current role, assignment and MFA before showing an operator entry or resolving its queue link. Email intents use the existing pending delivery contract.

Discarded drafts lose download access immediately. Run `rtk proxy node scripts/purge-btp12-funding-drafts.mjs` on a disposable local Supabase stack to remove batches of abandoned uploads through the Storage API. It selects discarded drafts and expired, unsubmitted drafts with a one-hour grace period. Submitted evidence follows the future owner-approved retention policy.

## Local acceptance and operating gates

Funding accounts are disabled by default through the absence of account and customer assignment rows. Only explicit synthetic accounts and customer assignments can open a draft. The reference must begin with `TEST`. The app shows an instruction to use example evidence and avoid sending money. There are no real bank instructions. The first slice uses exact funding and excludes PDF evidence, partial payment, late-money reconciliation and collection setup. Scheduled evidence cleanup, real-money operation and retention require separate owner acceptance.

Run `rtk proxy node scripts/test-btp12-funding.mjs` against disposable loopback PostgreSQL. The harness creates and drops a unique database, applies the migrations, and checks authorization, receipts, normalization, verification and expiry races. For a disposable local Supabase stack, run `rtk proxy node scripts/test-btp12-funding-sessions.mjs` with the local connected app at `http://127.0.0.1:3112`. The session harness seeds synthetic test accounts and exercises real local Auth, MFA, Storage and the mobile-width screens. Reset the disposable stack to remove its fixtures.
