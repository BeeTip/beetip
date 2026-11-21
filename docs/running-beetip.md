# Run and demonstrate BeeTip

Use connected BeeTip with two separate confirmed accounts to demonstrate the marketplace and realtime chat. The browser-local demo is also available for a single-device rehearsal.

## Hosted booth walkthrough

1. Open [BeeTip](https://beetip-campus.vercel.app) in two separate browser profiles and sign in as Nadia Demo and Rizky Demo. The booth laptop's Windows account keeps the credentials in `%LOCALAPPDATA%\BeeTip\booth-credentials.json`. Keep the two sessions open so visitors can start with a listing. Use an inbox you control if showing **Daftar** or **Lupa kata sandi**. The booth accounts use synthetic addresses and are provisioned with confirmed email.
2. As Nadia, open **Buat listing**, choose **Minta dibelikan**, and publish a fixed-fee request. Prefix the title with `[DEMO]`. Enter a future WIB cutoff and delivery window, a shopping budget, a fee, and a sample campus destination.
3. As Rizky, open the published request, select **Lanjut ke penawaran**, check the agreement, and choose **Ambil permintaan harga tetap**. For a shopping trip or a negotiable request, submit an offer from the other session and accept it as the listing owner from **Tinjau penawaran**.
4. Open **Pesanan saya** from both accounts. New demo orders start at **Menunggu pembayaran demo** with a 24-hour reservation. As Nadia, check the total and select **Simulasikan pembayaran**. The order advances to **Siap belanja demo** without a bank transfer or an approval step. As Rizky, select **Perbarui status** to see the update immediately. Open **Pesan pesanan**, send a message in each direction, and reload to verify it was saved.
5. As Rizky, open **Progres belanja**, add a sample JPEG or PNG receipt with a fresh receipt reference, allocate the items, and select **Selesaikan belanja**. You can reuse the sample image on another booth listing. Start delivery. As Nadia, confirm the goods and generate a handover code. Enter the code in Rizky's session and verify **Diterima** on both sides.

Every new connected order uses simulated checkout. Only its customer can confirm it. Retries keep one confirmation and create zero funding or transfer records. Use sample data and receipts. Support and notifications retain their normal account permissions.

To prepare another pair, register or provision two confirmed synthetic accounts and verify both can sign in. Keep any shared booth credentials in the operator's private storage.

The [handover rehearsal](connected-handover.md#verification) verifies the simulation through the SQL and connected-browser harnesses, including an interrupted response, purchase and handover, and zero financial rows. Hosted setup and rollout steps are in the [Vercel runbook](vercel-deployment.md#booth-deployment).

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

You can also rehearse against a disposable Supabase stack with Docker and the Supabase CLI. In a fresh directory, copy `supabase/config.toml`, `supabase/migrations`, `supabase/functions` and `supabase/templates` under `supabase/`. Give the copy a unique `project_id`, choose free ports and set the Auth site URL and callback URLs to match the local app origin below. Set `enabled = false` under `[db.seed]` in the copy because this walkthrough creates its own synthetic records. Run `rtk proxy supabase start --workdir $stack`, where `$stack` is the absolute path to the fresh directory. Read the API URL and publishable key with `rtk proxy supabase status --workdir $stack` and set them as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` before building. Set the stack's server-only secret as `BEETIP_RECEIPT_STORAGE_SECRET` for sample receipts, `BEETIP_CASE_STORAGE_SECRET` for case attachments, and `BEETIP_AFFILIATION_STORAGE_SECRET` for [affiliation evidence](private-evidence.md#verification-and-operating-gates). Stop the copy with `rtk proxy supabase stop --workdir $stack` when finished.

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
5. Open **Pesan pesanan** in both accounts. Each message should appear in the other account without a refresh. Reload to verify history. Disconnect one account, send from the other and reconnect to recover missed messages. Follow [private-chat acceptance](connected-chat.md) for response-loss retry, revoked access and logout checks.
6. Open **Hubungi bantuan** as a member, then claim the case from an MFA-enabled support account. Reply, resolve, and reopen it. Use a separate lead account to rehearse reassignment. [Private support walkthrough](connected-support.md).
7. As the customer, select **Simulasikan pembayaran**. The order moves to **Siap belanja demo** immediately. The provider can refresh status to see the change. An unused reservation can still [expire](connected-expiry.md) and retains its read-only chat history.
8. As the provider, open **Perubahan pesanan** and propose a substitution or increased shopping budget. As the customer, compare the original and proposed terms, then approve the exact proposal. The approved terms apply when the provider records the purchase.
9. Once the order shows **Siap belanja**, open **Progres belanja** as the provider. Add a synthetic receipt, allocate quantities to the order and verify gross, discount and net in both accounts. For a shared trip, open the sibling order and allocate the remaining quantities. Finish shopping after marking any missing items and providing a reason. [Purchase progress walkthrough and receipt Storage configuration](connected-purchases.md).
10. As the provider, start delivery for the completed purchase. As the customer, inspect the goods and generate a handover code. In the provider session, scan the QR or enter the backup code within 60 seconds. Refresh both sessions and confirm the order shows delivery confirmed. [Connected handover walkthrough and device checks](connected-handover.md).
11. After handover, submit a private rating from each participant and check that the other participant cannot see it. Use a separate order for cancellation or a dispute under **Pembatalan dan sengketa**. Attach a sample photo to a dispute and rehearse an assigned reviewer proposing a resolution and a second reviewer deciding it.

## UX acceptance for each slice

Keep the familiar marketplace sequence: browse, understand terms, confirm once, see status, then take the next available action. Preserve the existing Indonesian interface and use explicit IDR amounts and WIB times. Review these behaviors with the feature's actual rendered flow:

| Situation | Expected experience |
| --- | --- |
| Order opened on mobile | The order status, amounts and next available action are easy to find together. Secondary details stay accessible without competing with the primary action. |
| Loading or empty history | A visible status or empty state, with navigation still available. |
| Failed fetch | A clear error and retry control without displaying another account's cached data. |
| Slow or uncertain mutation | A pending state that prevents duplicate submission; retry reuses the original identity and payload. |
| Stale terms or exhausted capacity | A conflict message requiring a refreshed review before acceptance. |
| Proposed order change | Both parties can distinguish the original order, proposed terms and current approved total. |
| Offline message | Preserve the in-memory attempt and explain whether it is pending, failed or committed. |
| Expired reservation | Use server-derived status and show the recovery action; do not imply a verified payment. |
| Simulated checkout | Show the amount, label it as simulated, and show the new order status immediately after confirmation. |
| Shared receipt | Show the provider which customer's order is open and how much of each receipt line remains. Show the customer their own item charges, discount and unavailable quantities. |
| Cancellation or dispute | Show the case status, distinguish a proposal from an approved decision, and keep order history available. |
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

The demo browser suite builds and runs its own production server. CI also builds connected production without project credentials to check that it fails closed. For the complete connected demo, build and start the app with the disposable stack, set `BEETIP_TEST_LOCAL_STACK` to the stack directory and `BEETIP_TEST_URL` to the matching app origin, then run `rtk proxy node scripts/test-connected-demo.mjs`. The harness uses separate signed-in sessions for publishing, offering, checkout, realtime chat, purchase, and handover. For affiliation uploads, run the [private evidence rehearsal](private-evidence.md#verification-and-operating-gates).

The same rehearsal provisions 50 confirmed synthetic members and runs three bursts of 20 simultaneous chat sends across 10 active orders. It requires a chat acknowledgment p95 of at most 2 seconds, checks all 60 messages in order through the authenticated history API, and verifies their durable email intents. Loopback timing measures the connected application and database on the runner. Hosted load, provider delivery latency, and physical camera checks have separate acceptance criteria.

For BTP-19, use the [moderation and ratings rehearsal](btp19-moderation-ratings.md#verification) to verify staff MFA, listing decisions, and private rating behavior in separate connected sessions.

For the isolated database checks, point `BEETIP_LOCAL_DATABASE_URL` at a disposable loopback PostgreSQL 18 instance whose test user can create databases and roles. The database job in [CI](../.github/workflows/ci.yml) lists the current commands. These checks apply fresh migrations and run role and concurrency assertions with local platform stubs. Use the connected acceptance procedures to verify real Supabase Auth, Storage, Realtime and Cron behavior where applicable.

The `fresh-supabase` job in [CI](../.github/workflows/ci.yml) also starts a disposable Supabase database. It checks that every migration applied, public tables have row-level security, the affiliation upload grant is scoped, notification rules match the TypeScript registry, and generated database types match the checked-in schema. Record both database jobs in the release evidence.

Follow the [local recovery rehearsal](btp23-local-recovery.md) to verify that a backup restores both the database and a private receipt on a second disposable stack.

## Release boundary

The current release target is a synthetic demo. Use synthetic listings, order details, receipts, and affiliation documents on both the local and hosted demo. Every new connected order uses one-click simulated checkout. Migration `20261121004000` removes executable funding, transfer, and reconciliation commands while preserving any historical records. It converts active unpaid orders only when no funding record exists, retaining their original reservation deadline.

Record the source commit, last migration, target environment and validation results together before promoting a candidate. Use the following evidence for each target.

| Target | Evidence to record |
| --- | --- |
| Synthetic demo | Production build starts with `BEETIP_MODE=demo`, and the browser suite and selected walkthrough pass with synthetic personas. |
| Connected rehearsal | Migrations apply in order, the production build starts with the correct origin, and separate confirmed test accounts complete the implemented journey. Verify authorized staff actions separately with a scoped MFA account. |
| Connected production startup | CI starts the compiled app with identity configuration empty and verifies the [unavailable screens and blocked demo routes](btp21-production-startup.md). |
| Deployment | Verify the deployed revision, target database schema, callback origin and configuration, then rerun the target environment's smoke and session checks. |
| Real-data pilot | Before collecting real evidence, record the approved retention and account data procedures, named operators, the exact candidate's staging and device results, and a hosted recovery rehearsal against approved recovery targets. |

The [manual-payment pilot](https://github.com/BeeTip/beetip/issues/26) was closed as not planned. Any future paid pilot would need a separate release and acceptance for settlement.

Before hosting the demo, verify the exact candidate with separate sessions and the [deployment runbook](vercel-deployment.md). Record [release checks](https://github.com/BeeTip/beetip/issues/23), [recovery checks](https://github.com/BeeTip/beetip/issues/25), and any [transactional email](transactional-email.md) results for the target environment.
