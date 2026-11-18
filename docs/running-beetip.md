# Run and demonstrate BeeTip

Use the synthetic demo for the complete shopping, handover and settlement walkthrough. Use connected mode to demonstrate the implemented account and marketplace slices with separate real test accounts. Connected funding, purchasing, handover and settlement still require their implementation issues before a complete real-order journey can run.

## Start the full synthetic demo

From the repository root in PowerShell, use Node.js 24.22.1 and the pinned pnpm version:

```powershell
rtk pnpm install --frozen-lockfile
$env:BEETIP_MODE = 'demo'
rtk pnpm dev
```

Open `http://127.0.0.1:3107`. Follow the [README walkthrough](../README.md#demo-walkthrough) using Nadia, Rizky and the two administrators. Check that the customer can understand the next action, recover a failed action and reconcile the simulated amounts. The persona selector, local records and transfers are synthetic. A demo completed in one browser does not prove connected authorization, cross-device synchronization or actual bank transfers.

Stop the server before switching modes. Clear the shell override with `Remove-Item Env:BEETIP_MODE`. To reset only the demo fixtures, use **Reset data lokal** in the demo interface.

## Start the connected application

Follow [development setup](development.md) to configure the ignored `apps/web/.env.local` from `.env.example`. All four settings are required: `BEETIP_MODE=connected`, the exact `APP_ORIGIN`, the dedicated development project's Supabase URL and its publishable key. User requests do not need a service credential. Apply and verify the repository migrations in order against the dedicated development database before running the corresponding feature.

```powershell
$env:BEETIP_MODE = 'connected'
$env:APP_ORIGIN = 'http://127.0.0.1:3108'
rtk pnpm build
rtk pnpm --filter @beetip/web exec next start --hostname 127.0.0.1 --port 3108
```

Use `http://127.0.0.1:3108`. This runs the production build locally. It does not deploy the application. Keep `APP_ORIGIN` identical when starting the server and when running session tests; an incorrect origin correctly blocks mutations. The ordinary development command uses port 3107 instead.

Missing connected configuration shows an unavailable state. It does not fall back to demo personas. Vercel Production rejects demo mode.

## Connected walkthrough

Use separate browser profiles for two confirmed synthetic accounts. Do not use retained operator accounts as customer fixtures.

1. Browse `/` without signing in. The public board must exclude private destination and owner fields. An empty board should explain that there are no listings and keep filters and creation discoverable.
2. Sign in as the requester, publish a future request with its budget, service fee, WIB cutoff and delivery window, and review it under **Listing saya**. Optional affiliation must not block ordinary confirmed accounts.
3. As the other account, open the listing and propose an offer. As the requester, review the current version under **Penawaran saya** and accept it. Changes to terms require fresh consent; an unavailable slot must produce an actionable error.
4. Open **Pesanan saya** in both accounts. Both must see the same immutable terms and reservation deadline; an unrelated account must not see the order. The counterpart receives an in-app notification with an authorized order link.
5. Open **Chat pesanan** from the order, send text in both accounts and refresh to confirm saved history. Disconnect one account, send from the other and reconnect to recover missed messages. Follow [private-chat acceptance](connected-chat.md) for response-loss retry, revoked access and logout checks. Follow [reservation expiry](connected-expiry.md) to verify a disposable unpaid order expires with all tabs closed and retains read-only chat history. Use the guarded synthetic harness rather than altering retained support.
6. Stop before sending money. Connected payment verification and fulfillment are later slices. The order screen must accurately explain the available next action and the current payment limitation.

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
| Logout, account change or suspension | Clear private data and stop protected reads and sends. |
| Narrow viewport or keyboard use | Readable content, reachable controls and focus, labeled fields, no horizontal overflow. |

These are review criteria. Browser emulation does not establish physical-device usability or user satisfaction. Uncoached pilot feedback remains part of release validation.

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

The demo browser suite builds and runs its own production server. Rebuild in connected mode before connected browser acceptance. The session harnesses require `BEETIP_TEST_PROJECT_REF=rgiptdfjlmwldngapojq`, the local candidate URL and authorized development test access. They create and remove only their own fixtures. See [order acceptance](connected-orders.md), [listing acceptance](connected-listings.md), [offer acceptance](connected-offers.md) and [notifications](notifications.md) for exact commands and evidence.

## Release boundary

The checked-in application, the migrated development database and the public Vercel deployment are separate candidates. Record the exact source and migration versions for each. A merged change does not update the public deployment by itself.

Production readiness requires the remaining connected financial and support slices, staging acceptance, real-device checks, backup/restore and compatible rollback rehearsal, and approved operating and financial arrangements. [BTP-21](https://github.com/BeeTip/beetip/issues/23), [BTP-23](https://github.com/BeeTip/beetip/issues/25) and [BTP-24](https://github.com/BeeTip/beetip/issues/26) track those gates. Use the [deployment runbook](vercel-deployment.md) when promoting a verified candidate. Current feature evidence supports only the environments explicitly recorded there.
