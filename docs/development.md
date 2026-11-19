# Develop BeeTip in connected mode

[Run and demonstrate BeeTip](running-beetip.md) covers the current connected walkthrough and disposable local stack. Under the [public onboarding policy](public-onboarding.md), visitors can browse and email-confirmed users can use ordinary marketplace features. [Affiliation review](affiliation-staff.md) is optional. The dated acceptance sections record the earlier identity slice.

## Development project

The owner approved `beetip-development` in organization `BurgerMcd`, Singapore, at the tool's quoted $0/month. The [development dashboard](https://supabase.com/dashboard/project/rgiptdfjlmwldngapojq) reports project reference `rgiptdfjlmwldngapojq`. This is a dedicated development environment, not production.

Three migrations create pending members, scoped staff roles, private support, operation receipts, audit, bounded RPC input, and access-path indexes. Actual generated database types live in `packages/database/src/database.types.ts`. User-editable Auth metadata supplies display names only. Authenticated SQL commands derive identity from `auth.uid()` and require a current Auth session.

Initial Auth configuration used `http://127.0.0.1:3107`, callback/confirmation routes, email confirmation, 12-character minimum passwords, one-minute email throttling, and enabled TOTP MFA. Anonymous sign-in is disabled. A later field-level Management API read confirmed those settings, while also showing that the CLI's up-to-date response alone did not establish a requested staging/SMTP change. See [the current staging record](staging.md) for exact hosted callbacks, Brevo Free, the signed recipient guard, and real mail acceptance. The `private` schema is not an exposed Data API schema. The maker-approved operator completed verified TOTP enrollment and the audited support-only, designated-case bootstrap; unrelated and revoked access were denied.

The initial generated config push changed MFA/email defaults as well. A corrective push restored TOTP enrollment/verification, the existing email throttle and OTP length, and disabled unused vector storage. No paid service was provisioned.

## Configure the application

If `apps/web/.env.local` is absent, copy `apps/web/.env.example` to that path. Set `BEETIP_MODE=connected`, the exact `APP_ORIGIN`, the development or disposable local Supabase URL, and its active publishable key. Keep existing environment files out of Git. Sign-in and ordinary marketplace requests use the user's session. Follow the feature runbook for server-only keys used by synthetic funding storage or background jobs.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open `/login`. A confirmed user can publish listings from `/account` and contact private support. Access to staff queues requires the appropriate assignment and MFA. Unmigrated demo routes redirect to `/account` in connected mode. Missing configuration displays an unavailable state.

The local app never imports a whole real dataset. Read projections are RLS-filtered. Protected responses are private and uncached. Support retries reuse an operation ID and body. A changed payload conflicts. Logout/account changes clear private support caches across tabs, with visibility/focus revalidation as a fallback.

To explore existing synthetic marketplace flows, use explicit demo mode.

```powershell
$env:BEETIP_MODE = 'demo'
pnpm dev
```

Remove that shell override before connected work with `Remove-Item Env:BEETIP_MODE`. Vercel Production refuses demo mode. CI and the existing browser suite explicitly select demo mode so fixtures cannot silently become identity authority.

## Verify connected sessions

Keep a connected application server on port 3108 with `APP_ORIGIN=http://127.0.0.1:3108`. Use another shell for the guarded test. Its local target override does not alter the hosted project's configured email callback origin.

```powershell
$env:BEETIP_MODE = 'connected'
$env:APP_ORIGIN = 'http://127.0.0.1:3108'
pnpm --filter @beetip/web exec next dev --hostname 127.0.0.1 --port 3108
```

```powershell
$env:BEETIP_TEST_PROJECT_REF = 'rgiptdfjlmwldngapojq'
node scripts/test-connected-identity.mjs
```

The harness refuses any other database project. It accepts local application URLs and the exact protected staging origin documented in [staging](staging.md), with a required automation bypass file for staging. It uses the authenticated Supabase CLI to retrieve the development administration key in memory. It creates two temporary, email-confirmed `example.invalid` test accounts without sending email. It deletes their public support fixtures and Auth users in `finally`. Minimal private audit and operation facts remain for reconciliation. It never prints keys, passwords, or sessions.

The test checks real password sign-in, pending membership, support persistence, two-session privacy, concurrent exact retries, changed-payload conflicts, CSRF and actor spoofing, mobile overflow, cross-tab logout, and connected route gating. A screenshot is written to ignored `test-results/connected-support.png`. Admin-created confirmed fixtures do not prove real signup confirmation or recovery email delivery.

The [database setup](../supabase/README.md) documents 33 rollback-only authorization assertions and the audited first-operator procedure. Staff reads require verified MFA, `aal2`, a live support role, and an explicit case assignment. Routine MFA/assignment UI is later work.

## Verification recorded on 17 November 2026

The production build, lint, typecheck, 29 unit tests, 16 existing demo browser journeys, and the connected real-session harness passed. The hosted SQL assertions passed all 33 checks. A fresh hosted query confirmed zero temporary users, conversations, and messages after cleanup. Security review found provider-outage reporting, stale cross-tab history, and an editable pending draft issue; all were corrected. Generated types were retrieved from the applied schema.

## Staging acceptance completed on 18 November 2026

Real received signup and recovery links, password replacement, old-password rejection, new-password login, pending-member private support, and MFA-gated assigned operator reads passed. [Protected staging acceptance](staging.md) records exact deployment and hook revisions, recipient-denial checks, preserved failures, cleanup, and delivery limitations. The final email-hook suite totals 39 passing unit tests; lint, typecheck, eight smoke-helper tests, five anonymous staging groups and seven connected staging groups also passed. Signup is closed after approved enrollment, and the signed hook independently restricts Auth mail recipients. No paid service was selected.

The implementation was committed in `2069764`; dependency integration and the Next.js security patch are preserved through `7a7c665`. The deployed web candidate is `ab612da`; the signed email guard and payload correction are `5837d23` and `0630a02`. Continue from local `main`, which contains unpublished required commits. Later slices must update staging evidence as they add capabilities.
