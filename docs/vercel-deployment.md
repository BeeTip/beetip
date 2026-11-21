# Deploy the connected BeeTip pilot

This is the deployment runbook. The existing public sample deployment and accepted account flows are recorded in [public onboarding](public-onboarding.md); [staging progress](staging.md) retains the earlier protected identity candidate. Later connected marketplace slices have separate local and development-database evidence and are not deployed merely by merging their source. The complete production marketplace has not been released. Follow [the implementation plan](implementation-plan.md) and [runnable walkthrough](running-beetip.md) before executing this runbook.

## Booth deployment

The booth uses the existing public `beetip-campus` deployment on Vercel and the dedicated `beetip-development` Supabase project. Deploy from the exact repository commit after applying its pending migrations and verifying the migration history. Keep the connected mode and exact public application origin. Provide `BEETIP_RECEIPT_STORAGE_SECRET` as a sensitive server-side Vercel variable for private sample receipt upload and download. Keep signup, email confirmation, recovery, and application access based on normal Supabase Auth.

Provision the two synthetic booth accounts and follow the [booth walkthrough](running-beetip.md#hosted-booth-walkthrough) against the hosted alias with separate sessions. Verify guest browsing, anonymous private API denial, publication, acceptance, chat history, sample receipt upload and allocation, and delivery confirmation. Record the exact deployed revision and rehearsal evidence. The booth uses the Vercel project's Production slot for its stable alias. Marketplace launch and payment operations remain under the release plan below.

Deploy the app with simulated checkout before applying the demo-only database migrations in order. Migration `20261121004000` enables checkout for every new connected order and removes prior payment commands. Migration `20261121004100` enables demo ratings and case resolution. Confirm separate ordinary accounts can publish, offer, accept, chat live, simulate payment, purchase, and confirm handover. Check that checkout produced zero funding or transfer records and that retired API routes are unavailable. Select a rollback app revision that works with the new schema and has no payment collection UI.

Git pushes to the production branch can build and promote the booth app automatically. Keep the affiliation credential unset until the database has the additive claim migration `20261121001900`. The app continues to use the existing draft Storage policy during this period. Deploy the matching app revision with its server-only `BEETIP_AFFILIATION_STORAGE_SECRET` and verify an owner can upload a synthetic image and an assigned reviewer can read it. Then apply `20261121002000` to remove the old draft upload policy. Verify a direct draft Storage insert is denied and repeat the app upload and read checks. Application rollback after policy removal needs a release that supports server-side affiliation uploads. [Private evidence rehearsal](private-evidence.md#verification-and-operating-gates).

## Establish ownership and cost

1. Record the Vercel team owner, Supabase owner, backup operator, email-domain owner, and two independent financial operators.
2. Select a Vercel plan that supports the private organization repository and intended marketplace use. Budget for Pro unless Vercel explicitly confirms another suitable arrangement. Confirm current seats, usage, and spend controls before purchase. [Vercel pricing](https://vercel.com/pricing) and [terms](https://vercel.com/legal/terms) govern the account.
3. Record the Supabase plan, database region, storage quota, Realtime quota, backup method, and pause behavior. Do not promise zero ongoing cost. Record the email provider's domain, sending limits, retention, and usage budget.
4. Choose the production hostname and a separate staging hostname. Verify domain ownership before changing DNS.

## Separate the environments

| Environment | Application | Database and files | Email | Money |
| --- | --- | --- | --- | --- |
| Local | Next.js on port 3107 | Local Supabase or dedicated development project, synthetic seeds | Test inbox or provider test mode | Synthetic |
| Preview and staging | Protected Vercel preview, stable staging alias for Auth callbacks | Dedicated nonproduction Supabase project or isolated branch | Recipient allowlist and test sender | Synthetic |
| Production | Production Vercel project and verified hostname | Dedicated production Supabase project | Verified domain and production credentials | Manual operations only after readiness approval |

Preview builds must never receive production database, storage, email, or job credentials. Shared staging data means preview mutations can collide. Serialize destructive staging tests or allocate isolated branches per run. Untrusted fork previews receive no secrets. Synthetic demo storage is never an import source for production.

## Configure secrets

Create an environment example with names and descriptions during implementation. Validate required values at startup. Keep actual values in the platform's encrypted configuration.

| Proposed setting | Visibility | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser | Environment-specific project endpoint |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser | Public client identifier, always paired with authorization |
| `APP_ORIGIN` | Server | Exact trusted origin for links, redirects, and mutation checks |
| `SUPABASE_SECRET_KEY` | Restricted server job runtime | Privileged outbox and operational tasks, never ordinary user commands |
| `RESEND_API_KEY`, `EMAIL_FROM` | Server worker | Transactional application email, proposed provider |
| `EMAIL_WEBHOOK_SECRET` | Server webhook | Verify provider delivery and bounce events |
| `JOBS_SECRET` | Worker and scheduler secret stores | Authenticate scheduled dispatch requests |
| SMTP host, port, user, password, sender | Supabase Auth settings | Signup, verification, and password recovery delivery |

Use the appropriate supported Supabase key form when provisioning. Never expose privileged keys through a `NEXT_PUBLIC_` name. A database connection string, if required for CI migrations, belongs only in the protected migration job. Rotate worker and webhook secrets with overlap and audit. Do not log secret values.

## Prepare Supabase

1. Pin a supported Supabase CLI version and document Windows prerequisites. Use local Docker where available, or an isolated hosted test project when local containers are unavailable.
2. Apply versioned migrations to a fresh test database. Generate database types and fail CI on drift.
3. Prove RLS, RPC grants, and private Storage policies using anonymous, pending, approved, suspended, unrelated, participant, support-admin, and financial-admin identities.
4. Configure Auth site URL and exact callback allowlists. Use the stable staging alias for staging callbacks. Validate safe relative redirect targets. Enable email confirmation and test session refresh, expiry, logout, and recovery.
5. Configure custom SMTP and verified sender DNS. Test delivery to real pilot mailbox providers without link tracking rewriting Auth links. Supabase's default SMTP is intended for restricted nonproduction use. [SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp).
6. Create private evidence buckets with size, content-type, ownership, and retention limits. Test upload finalization and short-lived authorized downloads.
7. Disable public Realtime channels. Authorize private per-member invalidation topics. Deploy the transactional notification triggers and test reconnect fetching.
8. Enable Supabase Cron for expiry and outbox wakeups. Store the authenticated worker URL and credentials in secret storage. Deploy bounded worker execution and inspect scheduler run records. [Supabase Cron](https://supabase.com/docs/guides/cron) supports SQL jobs and HTTP invocation.
9. Restore a database export and its companion private-object backup into an isolated environment. Measure against the [pilot targets](pilot-operating-policy.md) of at most 24 hours of data loss and 4 hours to restore service. Use encrypted exports on the Free plan and retain a manifest that binds the database and object copies.

## Configure the Vercel build

1. Connect the private `BeeTip/beetip` repository to the authorized Vercel team.
2. Set the framework preset to Next.js and the Root Directory to `apps/web`. Include files outside the root so workspace packages and the root lockfile remain available. Vercel documents monorepo root selection and workspace detection in [Using monorepos](https://vercel.com/docs/monorepos).
3. Use Node.js 24 to match current CI, which pins 24.22.1. Vercel manages the patch version within `24.x`; record the deployed build's actual runtime. Use the root `packageManager` pin, currently `pnpm@10.18.3`.
4. Use `pnpm install --frozen-lockfile` for installation and `pnpm build` from the configured application root. The app's build script runs `next build`. Keep the framework's output directory default. Confirm the remote build includes both workspace packages.
5. Set scoped Preview and Production variables independently. Verify the deploy log shows the expected package-manager and runtime versions without printing values.
6. Keep production promotion manual until all checks and the release record pass. Configure deployment protection for nonproduction URLs.
7. Select a function region near the chosen database region. Use request-scoped Supabase clients and HTTPS APIs for user queries. If a future task introduces direct SQL connections, explicitly configure the supported pooler and connection limits.

The owner requires zero spending for current personal staging. Hobby does not support Git integration with this private organization repository. Keep the repository private and inspect the permitted local-source deployment route for personal, noncommercial testing. Do not enable a paid trial or upgrade. Production marketplace hosting eligibility remains unresolved. Use Vercel Authentication with All Deployments protection for the staging project, including any easy-to-remember alias. Password Protection is a separate paid feature and is not selected. [Git restrictions](https://vercel.com/docs/git#using-hobby-teams), [Hobby eligibility](https://vercel.com/docs/plans/hobby), [deployment protection](https://vercel.com/docs/deployment-protection).

## Validate the release candidate

Run from the repository root after the implementation issues introduce database checks.

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Run the migration, authorization, concurrency and real-session checks documented by the implemented slices. `scripts/test-atomic-acceptance.mjs` creates a fresh isolated plain PostgreSQL database, applies repository migrations and verifies real lock races using test platform stubs; CI runs it against PostgreSQL 18. It cannot establish hosted Auth, Storage, Cron or Realtime acceptance. The guarded session harnesses and hosted read-back in the feature records supply that separate evidence. Generate types from the actual migrated target and inspect their diff. Existing demo browser tests are synthetic persona tests and cannot satisfy connected-pilot acceptance.

On demo staging, use separate authenticated browser sessions for customer, provider, unrelated member, support operator, and two assigned case reviewers. Exercise both listing types, final-slot races, simulated checkout, amendments, shared receipts, delivery confirmation, cancellation, disputes, and ratings. Test chat during network loss, tab duplication, session expiry, retries, and membership suspension. Inspect private downloads with an unrelated account.

Test signup and recovery email, in-app notification links, application email delivery, signed duplicate webhook events, bounce suppression, outbox retry, and a worker crash after provider acceptance. Test narrow mobile layouts, keyboard use, Android Chrome and iOS Safari camera access, permission refusal, manual code fallback, and image upload. Record real-device results separately from browser emulation.

Proposed pilot load is 50 approved members, 20 concurrent sessions, and 10 simultaneous active orders. These are test assumptions, not measured demand or provider capacity guarantees. Target a durable chat send acknowledgment within 2 seconds at the 95th percentile and notification dispatch within 2 minutes under that load. Record the test environment and failures before changing a target.

## Promote production

1. Record the exact commit, approved decisions, CI run, migration versions, smoke evidence, backup, and rollback target.
2. Apply additive production migrations through one protected migration job. Do not run migrations in the Vercel application build. Keep the previous application compatible during rollout.
3. Deploy the verified commit with production-scoped settings. Confirm HTTPS, domain routing, Auth callbacks, security headers, and private response cache controls.
4. Enable the production scheduler exactly once. Verify fresh expiry and outbox heartbeats, successful worker authentication, and a test notification to an authorized operator.
5. Smoke-test real account login and cross-device chat using designated test accounts. Keep financial operations in synthetic testing until the manual collection and payout arrangement is approved.
6. Publish service hours, support escalation, approved affiliation method, privacy and retention policy, and cancellation terms before inviting participants. Confirm named operators can access the minimum required controls.
7. Open a capped real-money pilot only when the financial readiness issue is complete. Record the first day's reconciliation and support review.

## Recover or roll back

Disable new acceptances and sensitive financial mutations if money or authorization correctness is uncertain. Preserve existing orders, evidence, and audit records. Pause email dispatch if recipient privacy or duplicate delivery is uncertain. Inspect pending and ambiguous deliveries before resuming.

Revert to the recorded compatible Vercel deployment. Application rollback does not reverse database migrations or external email sends. Prefer an additive forward repair for schema faults. Restore a database or objects only under the incident operator's reviewed plan, after preserving newer records and reconciling external bank transfers. Never repeat an ambiguous transfer to repair a software failure.

Alert on failed or stale job heartbeats, oldest pending notification age over 5 minutes, dead-letter deliveries, authorization failures, abnormal send rate, storage growth, and unreconciled financial amounts. Logs contain request IDs, operation IDs, event IDs, and outcomes, with message bodies, exact addresses, codes, and payment evidence redacted.

## Platform checks

Vercel hosts the web application and finite request handlers. Supabase owns realtime connections and durable data. Use database scheduling for expiry and email dispatch rather than depending on a browser tab. Vercel's documented legacy Hobby cron interval is daily, which is unsuitable for minute-scale notification polling. [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing). Recheck current platform limits when provisioning because provider offerings can change.
