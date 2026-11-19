# Run and demonstrate BeeTip

For a presentation, start with the synthetic demo. It runs without Supabase credentials and covers shopping, handover and settlement end to end. Use connected mode to demonstrate real sign-in, orders, private chat, support and synthetic incoming funding with separate test accounts. Connected purchasing, handover and settlement remain release work.

## Start the full synthetic demo

From the repository root in PowerShell, use Node.js 24.22.1 and the pinned pnpm version:

```powershell
rtk pnpm install --frozen-lockfile
$env:BEETIP_MODE = 'demo'
rtk pnpm dev
```

Open `http://127.0.0.1:3107`. Follow the [README walkthrough](../README.md#demo-walkthrough) using Nadia, Rizky and the two administrators. The persona selector, local records and transfers are synthetic. For a short demo, start with seeded order `BTP-001` and finish when the ledger shows Rp70,000 received, Rp65,000 paid out and Rp5,000 refunded. For a full demo, start from a listing and follow the order through funding, shopping, handover and reconciliation.

To rehearse the same demo from a production build, keep `BEETIP_MODE=demo` set and use `rtk pnpm build` followed by `rtk pnpm --filter @beetip/web start`.

Stop the server before switching modes. Clear the shell override with `Remove-Item Env:BEETIP_MODE`. To reset only the demo fixtures, use **Reset data lokal** in the demo interface.

## Start the connected application

Follow [development setup](development.md) to configure the ignored `apps/web/.env.local` from `.env.example`. All four settings are required: `BEETIP_MODE=connected`, the exact `APP_ORIGIN`, the dedicated development project's Supabase URL and its publishable key. User requests do not need a service credential. Apply and verify the repository migrations in order against the dedicated development database before running the corresponding feature.

You can also rehearse against a disposable Supabase stack with Docker and the Supabase CLI. In a fresh directory, copy `supabase/config.toml`, `supabase/migrations`, `supabase/functions` and `supabase/templates` under `supabase/`. Give the copy a unique `project_id`, choose free ports and set the Auth site URL and callback URLs to match the local app origin below. Run `rtk proxy supabase start --workdir $stack`, where `$stack` is the absolute path to the fresh directory. Use that stack's API URL and publishable key in the app. Use the stack's own server-only key for the [synthetic funding storage rehearsal](connected-funding.md#evidence-and-notification-access). Stop the copy with `rtk proxy supabase stop --workdir $stack` when finished.

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

This loopback smoke check requires an available catalog on the configured Supabase stack. An empty catalog is valid. Use the walkthrough below to verify authenticated actions.

The disposable stack's local mail inbox captures signup and recovery messages. After installing Chromium for Playwright, verify that both links work in a fresh browser session and that a password reset replaces the previous password.

```powershell
$env:BEETIP_TEST_LOCAL_STACK = $stack
$env:BEETIP_TEST_URL = 'http://127.0.0.1:3108'
rtk proxy node scripts/test-local-auth-email.mjs
```

Set `$stack` in the terminal running the test. The test creates a synthetic account in that stack. Use the [staging Auth procedure](staging.md) to verify external delivery on a deployed candidate.

## Connected walkthrough

Use separate browser profiles for two confirmed synthetic accounts. Do not use retained operator accounts as customer fixtures.

1. Browse `/` without signing in. The public board must exclude private destination and owner fields. An empty board should explain that there are no listings and keep filters and creation discoverable.
2. Sign in as the requester, publish a future request with its budget, service fee, WIB cutoff and delivery window, and review it under **Listing saya**. Optional affiliation must not block ordinary confirmed accounts.
3. As the other account, open the listing and propose an offer. As the requester, review the current version under **Penawaran saya** and accept it. Changes to terms require fresh consent; an unavailable slot must produce an actionable error.
4. Open **Pesanan saya** in both accounts. Both must see the same immutable terms and reservation deadline; an unrelated account must not see the order. The counterpart receives an in-app notification with an authorized order link.
5. Open **Chat pesanan** from the order, send text in both accounts and refresh to confirm saved history. Disconnect one account, send from the other and reconnect to recover missed messages. Follow [private-chat acceptance](connected-chat.md) for response-loss retry, revoked access and logout checks. Follow [reservation expiry](connected-expiry.md) to verify a disposable unpaid order expires with all tabs closed and retains read-only chat history. Use the guarded synthetic harness rather than altering retained support.
6. Open **Hubungi bantuan** as a member, then claim the case from an MFA-enabled support account. Reply, resolve, and reopen it. Use a separate lead account to rehearse reassignment. [Private support walkthrough](connected-support.md).
7. In a disposable funding rehearsal, upload synthetic evidence from the customer’s order and review it with an assigned finance account using MFA. Confirm the order shows funding verified only after the bank review. [Incoming funding walkthrough and configuration](connected-funding.md).

## UX acceptance for each slice

Keep the familiar marketplace sequence: browse, understand terms, confirm once, see status, then take the next available action. Preserve the existing Indonesian interface and use explicit IDR amounts and WIB times. Review these behaviors with the feature's actual rendered flow:

| Situation | Expected experience |
| --- | --- |
| Loading or empty history | A visible status or empty state, with navigation still available. |
| Failed fetch | A clear error and retry control without displaying another account's cached data. |
| Slow or uncertain mutation | A pending state that prevents duplicate submission; retry reuses the original identity and payload. |
| Stale terms or exhausted capacity | A conflict message requiring a refreshed review before acceptance. |
| Offline message | Preserve the in-memory attempt and explain whether it is pending, failed or committed. |
| Expired reservation | Use server-derived status and show the recovery action; do not imply a verified payment. |
| Funding review | Show clearly whether evidence is still a draft, awaiting review or verified. Keep the next step and any amount still due visible on the order. |
| Logout, account change or suspension | Clear private data and stop protected reads and sends. |
| Narrow viewport or keyboard use | Readable content, reachable controls and focus, labeled fields, no horizontal overflow. |

For a usability rehearsal, ask a tester on their own phone to find an order, explain its status and the amount due, and advance it without coaching. Repeat with a failed or interrupted action. Record where they hesitate, what they believe happened, and whether they can recover. For handover, try both camera scanning and manual code entry on Android and iOS. Browser emulation covers layout and keyboard behavior. Record physical-device and uncoached results separately.

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

The demo browser suite builds and runs its own production server. Rebuild in connected mode before connected browser acceptance. Hosted session harnesses require `BEETIP_TEST_PROJECT_REF=rgiptdfjlmwldngapojq`, the local candidate URL and authorized development test access. For the local chat and funding harnesses, set `BEETIP_TEST_LOCAL_STACK` to the disposable work directory and `BEETIP_TEST_URL` to the app's loopback origin. See [order acceptance](connected-orders.md), [listing acceptance](connected-listings.md), [offer acceptance](connected-offers.md) and [notifications](notifications.md) for their exact commands and evidence.

For the isolated database checks, point `BEETIP_LOCAL_DATABASE_URL` at a disposable loopback PostgreSQL 18 instance whose test user can create databases and roles. The database job in [CI](../.github/workflows/ci.yml) lists the current commands. These checks apply fresh migrations and run role and concurrency assertions with local platform stubs. Use the connected acceptance procedures to verify real Supabase Auth, Storage, Realtime and Cron behavior where applicable.

## Release boundary

Record the source commit, last migration, target environment and validation results together before promoting a candidate. Use the following evidence for each target.

| Target | Evidence to record |
| --- | --- |
| Synthetic demo | Production build starts with `BEETIP_MODE=demo`, and the browser suite and selected walkthrough pass with synthetic personas. |
| Connected rehearsal | Migrations apply in order, the production build starts with the correct origin, and separate confirmed test accounts complete the implemented journey. Verify authorized staff actions separately with a scoped MFA account. |
| Deployment | Verify the deployed revision, target database schema, callback origin and configuration, then rerun the target environment's smoke and session checks. |

Production readiness requires connected fulfillment and settlement, transactional application email, funding evidence retention and late-money reconciliation, staging acceptance, real-device checks, backup/restore and compatible rollback rehearsal, and approved operating and financial arrangements. [BTP-21](https://github.com/BeeTip/beetip/issues/23), [BTP-23](https://github.com/BeeTip/beetip/issues/25) and [BTP-24](https://github.com/BeeTip/beetip/issues/26) track release validation and promotion. Use the [deployment runbook](vercel-deployment.md) when promoting a verified candidate.
