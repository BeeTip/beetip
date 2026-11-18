# Public browsing and self-service accounts

The maker changed the access policy on 18 November 2026: anyone can browse BeeTip, create an account, confirm their email and use their dashboard without manual membership approval. The selected scope is a public sample catalog and open onboarding, not real listing publishing or marketplace transactions.

## Access and privacy

Home, search, category/type filters and sample details are public. Four labeled examples use a small public projection without member records, orders, private handover details or browser demo state. Samples cannot create orders or collect payments. Account prompts appear at account actions; browsing remains available after logout and when identity configuration is unavailable.

Personalized single-use confirmation links establish a session and open the dashboard, including in a fresh browser context. Supported signup/login return destinations are `/account`, `/support` and `/listings/new`; recovery always opens the password page. Other destinations fall back to the dashboard or are rejected. Names are bounded and HTML-escaped.

Migration `20261118003457_open_account_access` changes the member default to `approved` and audits activation of existing pending members. That schema value now means normal account access, not verified campus affiliation. Suspended members stay suspended. Email confirmation, live sessions, client status-write denial, scoped staff grants, MFA and explicit support assignments remain enforced. Any future affiliation badge is optional and must not restore a general access gate.

## Hosted configuration

Public Vercel access replaces the earlier deployment-wide authentication gate at the owner's request. Hosted Auth signup is enabled. The signed email hook uses `BEETIP_AUTH_EMAIL_AUDIENCE=public`; isolated reproduction defaults to `allowlist`. Both modes require Standard Webhooks signatures. Public mode validates recipients and still rejects unsupported Auth mail actions. The fixed BeeTip confirmation origin never comes from payload URLs. Exact callbacks support only the named return destinations, without wildcards.

Confirmed email, 12-character passwords, same-origin JSON mutations, private no-store responses, disabled anonymous Auth and staff TOTP remain in place. No privileged credential is deployed to the browser or web application. No paid plan or domain was added. Brevo Free quotas, sender/link rewriting, Spam placement and uncertain-send duplicates remain operational limits. The six-emails-per-hour Auth cap is retained; open signup does not promise unlimited delivery.

## Repeatable checks

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `node --test scripts/check-staging.test.mjs`. Set `BEETIP_TEST_URL` to localhost or the exact BeeTip origin and run `node scripts/test-public-catalog.mjs` for guest browsing, filters, details, signup intent, private API denial, missing-listing 404s, images, runtime errors and 390/768/1440-pixel layouts. The guarded connected harness still checks session isolation and private support, removing only its temporary fixtures.

Set `BEETIP_STAGING_EXPOSURE=public` and `BEETIP_STAGING_URL=https://beetip-campus.vercel.app` before `pnpm test:staging`. No bypass is needed in public mode. Protected mode remains the explicit default for isolated candidates.

The hosted migration and 33 rollback-only authorization assertions passed. Local public browsing and connected support checks, 41 unit tests and 10 smoke-helper regressions passed. Final deployed revisions and actual received-email acceptance follow after deployment. These checks do not establish readiness for real transactions, funds or unrestricted production volume.
