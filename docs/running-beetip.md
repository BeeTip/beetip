# Run and demonstrate BeeTip

For the booth, use connected BeeTip with two confirmed booth accounts. The local synthetic demo remains available for rehearsal, including simulated settlement.

## Hosted booth walkthrough

1. Open [BeeTip](https://beetip-campus.vercel.app) in two separate browser profiles and sign in as Nadia Demo and Rizky Demo. The booth laptop's Windows account keeps the credentials in `%LOCALAPPDATA%\BeeTip\booth-credentials.json`. Keep the two sessions open so visitors can start with a listing. Use an inbox you control if showing **Daftar** or **Lupa kata sandi**. The booth accounts use synthetic addresses and are provisioned with confirmed email.
2. As Nadia, open **Buat listing**, choose **Minta dibelikan**, and publish a fixed-fee request. Prefix the title with `[DEMO]`. Enter a future WIB cutoff and delivery window, a shopping budget, a fee, and a sample campus destination.
3. As Rizky, open the published request, select **Lanjut ke penawaran**, check the agreement, and choose **Ambil permintaan harga tetap**. For a shopping trip or a negotiable request, submit an offer from the other session and accept it as the listing owner from **Tinjau penawaran**.
4. Open **Pesanan saya** from both accounts. The order starts at **Siap belanja demo** with a 24-hour reservation. From the order, open **Pesan pesanan**, send a message in each direction, and reload to see saved chat.
5. As Rizky, open **Progres belanja**, add a sample JPEG or PNG receipt with a fresh receipt reference, allocate the items, and select **Selesaikan belanja**. You can reuse the sample image on another booth listing. Start delivery. As Nadia, confirm the goods and generate a handover code. Enter the code in Rizky's session and verify **Diterima** on both sides.

The database marks new orders between the two booth members. Ordinary confirmed users can use listings, offers, chat, and the standard order flow. The payment exception requires both booth accounts. Booth orders record zero incoming funds and continue through the ordinary purchase and handover commands using sample data. Funding, financial dispute review and settlement are outside the booth walkthrough. Support and notifications retain their normal account permissions.

To prepare another pair, create two confirmed synthetic Auth users in the dedicated BeeTip development project, verify their active member records, and add their member IDs to `private.booth_members` through the project administrator. Keep credentials in the booth operator's private storage. Removing the IDs disables new booth orders for those accounts. Suspend the accounts after the event when continued access is unnecessary.

The targeted database regression runs with `node scripts/test-btp15-handover.mjs` on disposable loopback PostgreSQL. It verifies purchase, chat, handover, zero financial rows, and separation from regular accounts. Hosted setup and promotion steps are in the [Vercel runbook](vercel-deployment.md).

The 20 November hosted rehearsal verified that two separate browser sessions could publish and take a request, exchange messages that survived reload, reuse a private sample receipt from an earlier listing, and confirm delivery with a backup code. A separate temporary account confirmed and replaced its password using generated Auth links. The 18 November [onboarding record](public-onboarding.md) covers actual email delivery. See [BTP-21](https://github.com/BeeTip/beetip/issues/23) for deployment and rehearsal evidence.

## Start the full synthetic demo

From the repository root in PowerShell, use Node.js 24.22.1 and the pinned pnpm version:

```powershell
rtk pnpm install --frozen-lockfile
$env:BEETIP_MODE = 'demo'
rtk pnpm dev
```

Open `http://127.0.0.1:3107`. Follow the [README walkthrough](../README.md#demo-walkthrough) using Nadia, Rizky and the two administrators. The persona selector, local records and transfers are synthetic. For a short demo, start with seeded order `BTP-001` and finish when the ledger shows Rp70,000 received, Rp65,000 paid out and Rp5,000 refunded. For a full demo, start from a listing and follow the order through funding, shopping, handover and reconciliation.

Check `node --version` before running the checks below. On Windows, if another Node version is first on `PATH`, run commands under the CI version without changing your system installation. For example, `rtk proxy npm exec --yes --package=node@24.22.1 -- pnpm test`.

To rehearse the same demo from a production build, keep `BEETIP_MODE=demo` set and use `rtk pnpm build` followed by `rtk pnpm --filter @beetip/web start`.

Stop the server before switching modes and rebuild before starting in the new mode. Clear the shell override with `Remove-Item Env:BEETIP_MODE`. To reset only the demo fixtures, use **Reset data lokal** in the demo interface.

## Start the connected application

Follow [development setup](development.md) to configure the ignored `apps/web/.env.local` from `.env.example`. All four settings are required: `BEETIP_MODE=connected`, the exact `APP_ORIGIN`, the dedicated development project's Supabase URL and its publishable key. User requests do not need a service credential. Apply and verify the repository migrations in order against the dedicated development database before running the corresponding feature.

You can also rehearse against a disposable Supabase stack with Docker and the Supabase CLI. In a fresh directory, copy `supabase/config.toml`, `supabase/migrations`, `supabase/functions` and `supabase/templates` under `supabase/`. Give the copy a unique `project_id`, choose free ports and set the Auth site URL and callback URLs to match the local app origin below. Set `enabled = false` under `[db.seed]` in the copy because this walkthrough creates its own synthetic records. Run `rtk proxy supabase start --workdir $stack`, where `$stack` is the absolute path to the fresh directory. Read the API URL and publishable key with `rtk proxy supabase status --workdir $stack` and set them as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` before building. Use the stack's own server-only key for the [synthetic funding storage rehearsal](connected-funding.md#evidence-and-notification-access) and for [affiliation evidence uploads](private-evidence.md#verification-and-operating-gates), which use `BEETIP_AFFILIATION_STORAGE_SECRET`. Stop the copy with `rtk proxy supabase stop --workdir $stack` when finished.

```powershell
$env:BEETIP_MODE = 'connected'
$env:APP_ORIGIN = 'http://127.0.0.1:3108'
rtk pnpm build
rtk pnpm --filter @beetip/web exec next start --hostname 127.0.0.1 --port 3108
```

Use `http://127.0.0.1:3108`. This runs the production build locally. It does not deploy the application. Keep `APP_ORIGIN` identical when starting the server and when running session tests; an incorrect origin correctly blocks mutations. The ordinary development command uses port 3107 instead.

Missing connected configuration shows an unavailable state. It does not fall back to demo personas. Vercel Production rejects demo mode.

With the connected server running, verify anonymous browsing, private response headers and callback handling from a second PowerShell terminal:

```powershell
$env:BEETIP_STAGING_URL = 'http://127.0.0.1:3108'
$env:BEETIP_STAGING_ALLOW_LOCAL = '1'
$env:BEETIP_STAGING_EXPOSURE = 'public'
rtk pnpm test:staging
```

This loopback smoke check requires an available catalog on the configured Supabase stack. An empty catalog is valid. It also verifies that anonymous requests to the support, orders and notification APIs are denied and receive private, uncached responses. Use the walkthrough below to verify authenticated actions.

The disposable stack's local mail inbox captures signup and recovery messages. After installing Chromium for Playwright, verify that both links work in a fresh browser session and that a password reset replaces the previous password.

```powershell
$env:BEETIP_TEST_LOCAL_STACK = $stack
$env:BEETIP_TEST_URL = 'http://127.0.0.1:3108'
rtk proxy node scripts/test-local-auth-email.mjs
```

Set `$stack` in the terminal running the test. The test creates a synthetic account in that stack. Use the [staging Auth procedure](staging.md) to verify external delivery on a deployed candidate.

## Connected walkthrough

Use separate browser profiles for two confirmed synthetic accounts. Use dedicated synthetic accounts for customer, provider and operator actions. Start with the anonymous smoke test before adding fixtures so a failure can be traced to configuration or migrations.

1. Browse `/` without signing in. The public board must exclude private destination and owner fields. An empty board should explain that there are no listings and keep filters and creation discoverable.
2. Sign in as the requester, publish a future request with its budget, service fee, WIB cutoff and delivery window, and review it under **Listing saya**. Optional affiliation must not block ordinary confirmed accounts.
3. As the other account, open the listing and propose an offer. As the requester, review the current version under **Penawaran saya** and accept it. Changes to terms require fresh consent; an unavailable slot must produce an actionable error.
4. Open **Pesanan saya** in both accounts. Both must see the same immutable terms and reservation deadline. Open the order link in a signed-out profile, then sign in as the counterpart and confirm that the same order opens. Repeat as an unrelated account and confirm access is denied. The counterpart receives an in-app notification with the order link.
5. Open **Chat pesanan** from the order, send text in both accounts and refresh to confirm saved history. Disconnect one account, send from the other and reconnect to recover missed messages. Follow [private-chat acceptance](connected-chat.md) for response-loss retry, revoked access and logout checks. Follow [reservation expiry](connected-expiry.md) to verify a disposable unpaid order expires with all tabs closed and retains read-only chat history. Use the guarded synthetic harness rather than altering retained support.
6. Open **Hubungi bantuan** as a member, then claim the case from an MFA-enabled support account. Reply, resolve, and reopen it. Use a separate lead account to rehearse reassignment. [Private support walkthrough](connected-support.md).
7. In a disposable funding rehearsal, upload synthetic evidence from the customer's order and review it with an assigned finance account using MFA. Confirm the order shows funding verified only after the bank review. [Incoming funding walkthrough and configuration](connected-funding.md).
8. As the provider, open **Perubahan pesanan** and propose an increased shopping budget. As the customer, compare the original and proposed amounts, then approve the exact proposal. Confirm purchasing remains blocked until an assigned finance operator verifies the synthetic top-up. [Order amendment walkthrough](connected-amendments.md).
9. Once the order shows **Siap belanja**, open **Progres belanja** as the provider. Add a synthetic receipt, allocate quantities to the order and verify gross, discount and net in both accounts. For a shared trip, open the sibling order and allocate the remaining quantities. Finish shopping after marking any missing items and providing a reason. [Purchase progress walkthrough and receipt Storage configuration](connected-purchases.md).
10. As the provider, start delivery for the completed purchase. As the customer, inspect the goods and generate a handover code. In the provider session, scan the QR or enter the backup code within 60 seconds. Refresh both sessions and confirm the order shows delivery confirmed. [Connected handover walkthrough and device checks](connected-handover.md).
11. Use a separate synthetic order to rehearse cancellation or a partial dispute under **Pembatalan dan sengketa**. Attach a test photo for a dispute. Have one scoped finance operator propose the purchase, service fee and refund amounts, then have a second scoped operator review them. Refresh the order as both participants and verify the decision and held amount. [Case walkthrough and private Storage configuration](connected-order-cases.md).
12. In the disposable transfer rehearsal, use the scoped finance account to open **Pemeriksaan dana → Rekonsiliasi dana**. Compare verified funds with item costs, fees and refunds. Open the trip view for a trip order and download the CSV. After resolving an ambiguous transfer, reload and verify the outstanding balance. [Reconciliation walkthrough and audit checks](connected-reconciliation.md).

## UX acceptance for each slice

Keep the familiar marketplace sequence: browse, understand terms, confirm once, see status, then take the next available action. Preserve the existing Indonesian interface and use explicit IDR amounts and WIB times. Review these behaviors with the feature's actual rendered flow:

| Situation | Expected experience |
| --- | --- |
| Order opened on mobile | The order status, amounts and next available action are easy to find together. Secondary details stay accessible without competing with the primary action. |
| Loading or empty history | A visible status or empty state, with navigation still available. |
| Failed fetch | A clear error and retry control without displaying another account's cached data. |
| Slow or uncertain mutation | A pending state that prevents duplicate submission; retry reuses the original identity and payload. |
| Stale terms or exhausted capacity | A conflict message requiring a refreshed review before acceptance. |
| Proposed order change | Both parties can distinguish the original order, proposed terms and current approved total. The customer sees the amount still due after approval. |
| Offline message | Preserve the in-memory attempt and explain whether it is pending, failed or committed. |
| Expired reservation | Use server-derived status and show the recovery action; do not imply a verified payment. |
| Funding review | Show clearly whether evidence is still a draft, awaiting review or verified. Keep the next step and any amount still due visible on the order. |
| Shared receipt | Show the provider which customer's order is open and how much of each receipt line remains. Show the customer their own item charges, discount and unavailable quantities. |
| Cancellation or dispute | Show the case status and affected amount. Distinguish a proposed allocation from an approved decision and keep the order history available. |
| Logout, account change or suspension | Clear private data and stop protected reads and sends. |
| Narrow viewport or keyboard use | Readable content, reachable controls and focus, labeled fields, no horizontal overflow. |

For a usability rehearsal, ask a tester on their own phone to find an order, explain its status and the amount due, and advance it without coaching. Repeat with a failed or interrupted action. Record where they hesitate, what they believe happened, and whether they can recover. For handover, try both camera scanning and manual code entry on Android and iOS. Browser emulation covers layout and keyboard behavior. Record physical-device and uncoached results separately.

For order history, use an account with at least 21 orders. Open **Pesanan saya**, choose **Muat lebih banyak**, then use **Coba lagi** after a failed load to check that BeeTip returns to the same page. Check that **Jelajahi titipan** takes the user back to the marketplace.

## Repeat validation

Stop the development server on port 3107 before the demo browser suite. Do not run builds or fixture cleanup concurrently against the same application output or shared database.

```powershell
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm test
rtk proxy node --test scripts/check-staging.test.mjs
rtk proxy node scripts/notification-registry.mjs
rtk pnpm audit --prod --audit-level high
rtk pnpm test:e2e
```

The demo browser suite builds and runs its own production server. CI also builds with `BEETIP_MODE=connected` and `VERCEL_ENV=production` without project credentials. For connected browser acceptance, rebuild with the local configuration and start the server as described above. Hosted session harnesses require `BEETIP_TEST_PROJECT_REF=rgiptdfjlmwldngapojq`, the local candidate URL and authorized development test access. For the local chat and funding harnesses, set `BEETIP_TEST_LOCAL_STACK` to the disposable work directory and `BEETIP_TEST_URL` to the app's loopback origin. See [order acceptance](connected-orders.md), [listing acceptance](connected-listings.md), [offer acceptance](connected-offers.md) and [notifications](notifications.md) for their exact commands and evidence.

For BTP-17, use the [synthetic transfer rehearsal](connected-manual-transfers.md) to run the disposable PostgreSQL checks and two-staff local Auth/MFA workflow.

For BTP-18, run the [reconciliation rehearsal](connected-reconciliation.md) for connected order and trip totals, scoped CSV generation and snapshot consistency. For affiliation uploads, run the [private evidence rehearsal](private-evidence.md#verification-and-operating-gates) with local Auth and Storage.

For BTP-19, use the [moderation and ratings rehearsal](btp19-moderation-ratings.md#verification) to verify staff MFA, listing decisions, and private rating behavior in separate connected sessions.

For the isolated database checks, point `BEETIP_LOCAL_DATABASE_URL` at a disposable loopback PostgreSQL 18 instance whose test user can create databases and roles. The database job in [CI](../.github/workflows/ci.yml) lists the current commands. These checks apply fresh migrations and run role and concurrency assertions with local platform stubs. Use the connected acceptance procedures to verify real Supabase Auth, Storage, Realtime and Cron behavior where applicable.

The `fresh-supabase` job in [CI](../.github/workflows/ci.yml) also starts a disposable Supabase database. It checks that every migration applied, public tables have row-level security, the affiliation upload grant is scoped, notification rules match the TypeScript registry, and generated database types match the checked-in schema. Record both database jobs in the release evidence.

## Release boundary

Record the source commit, last migration, target environment and validation results together before promoting a candidate. Use the following evidence for each target.

| Target | Evidence to record |
| --- | --- |
| Synthetic demo | Production build starts with `BEETIP_MODE=demo`, and the browser suite and selected walkthrough pass with synthetic personas. |
| Connected rehearsal | Migrations apply in order, the production build starts with the correct origin, and separate confirmed test accounts complete the implemented journey. Verify authorized staff actions separately with a scoped MFA account. |
| Connected production startup | CI starts the compiled app with identity configuration empty and verifies the [unavailable screens and blocked demo routes](btp21-production-startup.md). |
| Deployment | Verify the deployed revision, target database schema, callback origin and configuration, then rerun the target environment's smoke and session checks. |
| Real-data pilot | Record the approved retention and account data procedures, the exact candidate's staging and device results, and the recovery and settlement rehearsals before collecting real evidence or taking payments. |

Production readiness also requires [staged verification of transactional email and scheduling](transactional-email.md), late-money reconciliation, and approved operating and financial arrangements. Record evidence for [private-data controls](private-evidence.md#verification-and-operating-gates), [release checks](https://github.com/BeeTip/beetip/issues/23), and [recovery and compatible rollback](https://github.com/BeeTip/beetip/issues/25) in the [pilot promotion issue](https://github.com/BeeTip/beetip/issues/26). Use the [deployment runbook](vercel-deployment.md) when promoting a verified candidate.
