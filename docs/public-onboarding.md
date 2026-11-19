# Public browsing and self-service accounts

Anyone can browse BeeTip, create an account, confirm their email and use their dashboard without manual membership approval. The 18 November acceptance below covers the original public sample catalog and open onboarding build. The 19 November [booth walkthrough](running-beetip.md#hosted-booth-walkthrough) adds connected listing publishing, acceptance, chat and delivery to the deployment scope.

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

The hosted migration and 33 rollback-only authorization assertions passed. Local and hosted public browsing and connected support checks, 41 unit tests, 10 smoke-helper regressions, lint, typecheck, the production build and all 16 demo browser regressions passed. These checks do not establish readiness for real transactions, funds or unrestricted production volume.

## Deployed acceptance, 18 November 2026

Web source `872bf9371ff14f6e57f91047eb657377f83d03ca` is READY as Vercel deployment `dpl_HsnHMobNQTC4vWfmiEB867GGKJG1` at [beetip-campus.vercel.app](https://beetip-campus.vercel.app). The same source's signed Auth email function is ACTIVE version 6, artifact SHA-256 `2a584ee4b4792c996cbc1589c891ffc3fa67394607d7eaf84d60a5e3b0c43528`. Public project access, enabled signup, retained confirmation/signing requirements and exact callbacks were read back. Provider and web plans remain free; no Git push occurred.

A normal signup using a new plus-address delivered to the approved test mailbox sent the personalized greeting `Halo, Demo Alex!`. Password login before confirmation was denied. Opening the actual received confirmation link in a fresh browser context signed the user directly into the named dashboard with active access. Reload retained the session; private support returned 200. Logout returned to public browsing and private support returned 401. No administrator confirmed or approved that user.

The actual received recovery link also worked in a fresh context: password replacement reached the dashboard, the previous password was rejected and the new password signed in. The temporary onboarding account was removed after acceptance; retained owner/requester accounts were not replaced. Supabase's advisor still reports leaked-password protection disabled; the private audit/receipt tables deliberately have no client policies. No paid upgrade was selected.

The hosted anonymous smoke passed all five groups without a bypass. The public catalog browser harness passed search, categories, details, signup intent and layout checks at three widths. The connected session harness passed all seven groups against the public candidate and removed its temporary users and cases. Existing requester/operator identities, support case, staff grant and MFA were preserved.

Final cleanup read-back confirmed three retained users, zero temporary users, one conversation/message, one active staff grant and one verified MFA factor. The BTP-03/BTP-04 source contracts now distinguish optional affiliation badges from email-confirmed account access and public browsing.

The demo regression runner cleared earlier local artifacts because its default output directory was the entire ignored `test-results` folder. Prior written acceptance remains historical evidence, but those local artifacts are no longer available. Playwright now writes only to `test-results/playwright`; fresh hosted catalog, support and onboarding captures were generated afterward.
