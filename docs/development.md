# Develop the connected identity slice

BTP-02 implements real Auth and private support creation. It remains open until email confirmation/recovery delivery and a protected Vercel staging candidate are validated. Support replies, realtime, notifications, affiliation review, and connected marketplace flows belong to later issues.

## Development project

The owner approved `beetip-development` in organization `BurgerMcd`, Singapore, at the tool's quoted $0/month. The [development dashboard](https://supabase.com/dashboard/project/rgiptdfjlmwldngapojq) reports project reference `rgiptdfjlmwldngapojq`. This is a dedicated development environment, not production.

Three migrations create pending members, scoped staff roles, private support, operation receipts, audit, bounded RPC input, and access-path indexes. Actual generated database types live in `packages/database/src/database.types.ts`. User-editable Auth metadata supplies display names only. Authenticated SQL commands derive identity from `auth.uid()` and require a current Auth session.

Auth is configured for `http://127.0.0.1:3107`, callback/confirmation routes, email confirmation, 12-character minimum passwords, one-minute email throttling, and enabled TOTP MFA. Anonymous sign-in is disabled. The hosted config was pushed and read back as up to date. The `private` schema is not an exposed Data API schema. No operator identity has been assigned.

The initial generated config push changed MFA/email defaults as well. A corrective push restored TOTP enrollment/verification, the existing email throttle and OTP length, and disabled unused vector storage. No paid service was provisioned.

## Configure the application

Copy `apps/web/.env.example` to `apps/web/.env.local`. Set `BEETIP_MODE=connected`, the exact `APP_ORIGIN`, development Supabase URL, and its active publishable key. The current workspace already has an ignored local file. No privileged key is needed by the application.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open `/login`. A confirmed user sees pending affiliation on `/account` and can create a private support thread at `/support`. Pending affiliation does not permit transactions. Unmigrated demo routes redirect to `/account` in connected mode. Missing configuration displays an unavailable state rather than loading demo personas.

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

The harness refuses any other project and nonlocal application URLs. It uses the authenticated Supabase CLI to retrieve the development administration key in memory. It creates two temporary, email-confirmed `example.invalid` test accounts without sending email. It deletes their public support fixtures and Auth users in `finally`. Minimal private audit and operation facts remain for reconciliation. It never prints keys, passwords, or sessions.

The test checks real password sign-in, pending membership, support persistence, two-session privacy, concurrent exact retries, changed-payload conflicts, CSRF and actor spoofing, mobile overflow, cross-tab logout, and connected route gating. A screenshot is written to ignored `test-results/connected-support.png`. Admin-created confirmed fixtures do not prove real signup confirmation or recovery email delivery.

The [database setup](../supabase/README.md) documents 33 rollback-only authorization assertions and the audited first-operator procedure. Staff reads require verified MFA, `aal2`, a live support role, and an explicit case assignment. Routine MFA/assignment UI is later work.

## Verification recorded on 17 November 2026

The production build, lint, typecheck, 29 unit tests, 16 existing demo browser journeys, and the connected real-session harness passed. The hosted SQL assertions passed all 33 checks. A fresh hosted query confirmed zero temporary users, conversations, and messages after cleanup. Security review found provider-outage reporting, stale cross-tab history, and an editable pending draft issue; all were corrected. Generated types were retrieved from the applied schema.

## Remaining acceptance evidence

Configure and verify custom SMTP before inviting participants. The default Supabase mail service is restricted and does not establish onboarding deliverability. Test actual signup confirmation and password recovery using an approved mailbox and sender configuration. Record the protected Vercel staging URL and candidate commit under BTP-22. Keep BTP-02 open until those checks pass.

The implementation was committed in `2069764`; dependency integration and the Next.js security patch are preserved through `7a7c665`. Continue from local `main`, which contains unpublished required commits. The earlier uncommitted-status wording is obsolete. See [staging progress and acceptance](staging.md) for the current environment and remaining evidence.
