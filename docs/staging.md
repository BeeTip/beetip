# Protected identity staging

Historical acceptance record. The maker subsequently requested [public browsing and open onboarding](public-onboarding.md), replacing the deployment authentication gate, recipient cohort and manual membership gate at this origin. Consult the newer record for the live policy and revisions.

BTP-02 and BTP-22 passed acceptance on 18 November 2026. This record covers the identity/private-support slice only. Connected marketplace, financial operations, jobs, and production release remain later work.

## Owner decisions, 17 November 2026

The maker approved their existing personal Vercel account and a zero-cost limit. No paid plan, trial, domain purchase, or email subscription is authorized. The maker approved their personal Gmail identity as the first support operator. Approval alone does not grant database access: normal email confirmation, verified MFA, a separate requester's case, and the audited bootstrap remain required.

A separate BeeTip Gmail account was created with the owner completing Google's personal-information and verification steps. The owner reports that Google app passwords are unavailable, so Gmail SMTP is not the selected route. Keep the mailbox as the authorized signup/recovery recipient. Credentials and personal operator addresses are kept outside the repository.

Brevo Free is configured as the Auth email provider. Its account usage panel confirms the Free plan and 300 daily emails. It supplies its own credentials, so Google app passwords are unnecessary. The verified Gmail sender is rewritten to a `brevosend.com` address; no custom domain was purchased. The owner completed the required postal-address and phone verification. Contact details and credentials remain outside Git. [Free plan](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), [sender verification](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email), [sender-domain rewriting](https://help.brevo.com/hc/en-us/articles/16045394674066-Troubleshooting-Domain-authentication).

The initial custom SMTP setup used `smtp-relay.brevo.com:587` and a dedicated SMTP key. A Management API read-back confirmed the exact host, port, sender, six-emails-per-hour cap, and unchanged confirmation, password, TOTP, session, and callback settings. No paid plan or trial was selected. The SMTP key is separate from the Google password and from Brevo API keys.

Actual SMTP signup confirmation, recovery, password replacement, and new-password login passed. To enforce BTP-22's recipient restriction across Auth email paths, the [signed Auth email hook](../supabase/functions/auth-email/README.md) adds a server-side allowlist before sending through Brevo's HTTPS API. Its restricted API key has only the Transactional email resource enabled. The initial hook source is `5837d23`; the hosted-payload correction is `0630a02`. This Auth-only hook does not implement the later application notification outbox.

## Verified environment

| Item | Current evidence |
| --- | --- |
| Supabase | `beetip-development`, `rgiptdfjlmwldngapojq`, Singapore, `ACTIVE_HEALTHY` |
| Fixture inventory | Earlier temporary session fixtures were removed and zero counts verified. The later real-mail acceptance creates a retained requester, approved operator, and synthetic designated support case; these are not temporary confirmed fixtures. |
| Vercel account | Owner's personal account; existing personal workspace is on Hobby |
| Staging project | `beetip-campus`, `prj_5UHMD6Jyj1e6J6p5asgxY9NOz8WP` |
| Access protection | Project configuration read back as Vercel Authentication, `deploymentType=all` |
| Build | Next.js, root `apps/web`, outside-root source access enabled, Node `24.x`, pinned root pnpm, Singapore functions |
| Environment | Both Vercel slots in this isolated staging project use connected mode, the exact staging origin, dedicated development endpoint and publishable key; no privileged application credential |
| Stable origin | [beetip-campus.vercel.app](https://beetip-campus.vercel.app), HTTPS and protection verified |
| Published candidate | `ab612da4d5ba02ffe95a881365d2c9510532b0ad`, deployment `dpl_BJrF9YvcsUJxJ1LXWncV2MGW1wtf`, `READY` |

Vercel rejected an initial Preview deployment because a project's first deployment must use its Production slot. This slot belongs only to the isolated staging project. All domains remain protected and all services are nonproduction. It does not represent production marketplace release. No Git integration or paid feature was enabled. The build resolved all five workspace projects, detected pinned `pnpm@10.18.3` and Next.js 16.4.5, compiled successfully, and completed in 43 seconds. Build execution was in `iad1`; functions are configured separately near the Singapore database.

Repository migration filenames now match the existing hosted versions: `20261117065537`, `20261117070456`, and `20261117070645`. Before renaming the three files, each repository SQL file matched its hosted migration statements after BOM, CRLF, and outer-whitespace normalization. SHA-256 pairs matched: `5ff1e91bbc68f402631028ac0b2c0199262c3e0b0206115437cf5626b7da7550`, `a71ccf0486b52b5fd011492a5a40ec568918df1bbef025733b53cc9ccc1b81d1`, and `852bd9717cbeef728c42dd9234dc77c26c77e3409b031d82a719ee12d0b25058`, respectively. No migration was replayed, no SQL content changed, and hosted history was not rewritten.

## Repeatable anonymous smoke

```powershell
$env:BEETIP_STAGING_URL = 'https://beetip-campus.vercel.app'
$env:BEETIP_STAGING_BYPASS_FILE = 'absolute-path-to-secure-bypass-file'
pnpm test:staging
```

The bypass secret comes from this project's protection-for-automation configuration. It is not the Vercel account access token. The harness sends it only to the supplied origin, does not follow redirects, and excludes it from output. Public requests are checked separately without the bypass. Vercel's authentication challenge or exact SSO redirect must appear; the application's own anonymous `401` cannot count as deployment protection. The check fails if a page or support API is reachable publicly, connected login is unavailable, support history is accessible anonymously, private API responses can be cached, cross-origin Auth is accepted, or callbacks leave the configured origin.

Run `node --test scripts/check-staging.test.mjs` for the helper's regression tests. A local connected check can explicitly select `BEETIP_STAGING_URL=http://127.0.0.1:3108` and `BEETIP_STAGING_ALLOW_LOCAL=1`; that run skips deployment protection and is reported as local evidence. It does not establish staging acceptance. Clear the local override before remote checks.

The helper sends no valid signup/recovery operation, creates no user or support record, and proves no email, MFA, login, or authenticated support journey. Use the dedicated real-session harness locally and record the following staging evidence separately.

For the guarded connected harness, set `BEETIP_TEST_PROJECT_REF=rgiptdfjlmwldngapojq`, `BEETIP_TEST_URL=https://beetip-campus.vercel.app`, and `BEETIP_STAGING_BYPASS_FILE` before running `node scripts/test-connected-identity.mjs`. Only that exact remote origin is accepted. Protection credentials are used once per browser context to establish a domain-scoped cookie; they are not attached to unrelated browser destinations. The administration key remains restricted to the dedicated development database and is never sent to Vercel.

## Verification recorded on 17 November 2026

The anonymous staging smoke passed all five check groups. Eight helper regression tests cover public access, Vercel SSO redirects, application-denial false positives, configuration failures, private caching, callback origins, and cross-origin Auth. Independent review found the anonymous-API false positive; it was corrected and tested before recording staging PASS.

The connected staging harness passed all seven check groups with two real Auth sessions: pending membership, concurrent exact retries and changed-payload conflicts, cross-account isolation, origin/actor rejection, persisted reload and mobile width, cross-tab logout, and demo-route gating. These were admin-confirmed temporary accounts. They establish staging session behavior, not real mail delivery. Cleanup removed both users and all public support fixtures, and a fresh hosted query confirmed all three counts were zero. The mobile screenshot is kept locally at `test-results/connected-staging-support.png`.

The CLI reported Auth configuration as up to date while a Management API read-back still showed localhost callbacks and no custom SMTP. Treat that CLI response as insufficient configuration evidence. Hosted Auth changes require an exact field-level read-back. Repository `supabase/config.toml` remains the local development configuration; do not push it unattended over staging settings.

## Real email and operator acceptance

The first signup email reached Gmail Spam. Its link expired during a roughly four-hour owner pause, and the failed expired-link attempts are retained as failures. A fresh signup email then confirmed the requester through the actual received, Brevo-rewritten link and reached the pending-member account page. The recovery email reached Inbox; its actual link opened the password page, changing the password succeeded, the previous password was rejected, and the new password signed in. The requester created and reloaded the designated synthetic support case on protected staging.

The maker-approved operator's normal signup confirmation also arrived in Spam and completed successfully. The owner scanned the TOTP enrollment QR and supplied an authenticator code; Supabase verified the factor and issued an `aal2` session. The checked-in owner bootstrap assigned only the support role and the designated non-self case, recording the named approval source. Real-session reads allowed the requester and assigned `aal2` operator, denied an `aal1` token and an unassigned case, and denied access immediately after audited support-role revocation. The owner bootstrap restored the original approved role, and access was rechecked.

Public signup was closed after these enrollment checks. The first immediate denial probe raced Auth configuration propagation and created one unconfirmed synthetic record; the later probe checked the Auth service's public settings before requesting signup and was denied before user creation. A closed signup cohort is not an SMTP recipient filter. The signed send hook independently rejects unapproved recipients and unsupported mail actions before a provider request.

Brevo rewrites sender domains and click links on the free route. The inspected tracking page offered anonymous tracking, not complete tracking disablement; no claim is made that tracking was removed. Spam placement, expiry, and provider limits remain launch-operational limitations. Passing these development flows does not establish production deliverability or production release approval.

## Signed hook acceptance, 18 November 2026

Hosted Auth hook activation and signing-secret presence were read back without exposing credentials. The two exact approved recipient addresses are stored only in the Edge secret store. Public signup remains closed. Function `auth-email` version 5 is ACTIVE with gateway JWT verification disabled because the function verifies Standard Webhooks signatures itself. Its source is `0630a02`; the deployment artifact SHA-256 is `c2be4f3eb8cf4378e2f6d804e6834ede7a51aaad5f989ccbb981193772c98c6f`.

Initial post-activation recovery requests failed with HTTP 400 before provider access: the hosted hook supplied the Supabase service origin in `site_url`, rather than the application origin assumed by the first implementation. The correction ignores this unused payload field and constructs links from the fixed development project and strictly validated staging callback. A regression proves payload URLs cannot change the generated destination. Temporary diagnostic logging was removed; only fixed validation-error messages can be logged.

After that correction, a normal recovery request through protected staging reached the approved mailbox's Inbox. The actual received link opened the password page, password replacement succeeded, the old password was rejected, and the new password signed in. Live direct checks denied GET (405), unsigned and altered requests (401), a correctly signed unapproved recipient (403), and email-change mail (403). Denied requests never reach the provider. Retained SMTP configuration is not an authorized outage bypass: keep the hook enabled while repairing failures.

Final validation passed 39 unit tests, lint, typecheck, eight staging-helper tests, all five anonymous staging smoke groups, and all seven connected staging groups after hook activation and signup closure. The latter used temporary admin-confirmed accounts and sent no email. The earlier 33 database assertions and 16 demo journeys remain the baseline evidence; they were not rerun for the email-only correction.

Cleanup removed the unconfirmed signup propagation probe and the extra unassigned synthetic case. A fresh hosted read confirmed zero `example.invalid` users, one retained conversation and message, one active support role, one support assignment, and one verified MFA factor. Three confirmed Auth accounts remain: the approved requester, approved operator, and a pre-existing account with no support case, preserved untouched. Minimal private audit and operation facts remain for reconciliation.

## Acceptance record

| Gate | Required evidence | State |
| --- | --- | --- |
| Exact deployment | Commit SHA, build/runtime log, workspace resolution, HTTPS URL and stable alias | Recorded above; Node major configured as 24.x, patch not printed in the build log |
| Protection | Anonymous page/API denial and authorized owner access at the stable alias | Anonymous and automation checks passed; the owner Vercel identity also passed SSO and reached the connected login page |
| Auth configuration | Hosted site URL and exact stable callback/recovery allowlist read back; no broad wildcard | Passed via Management API read-back; localhost development callbacks retained explicitly |
| Real mail | Provider read-back without credentials, received signup confirmation, received recovery link, password change and login | SMTP signup/recovery passed; active signed-hook recovery and recipient-denial checks also passed, with the placement limitations above |
| Member journey | Confirmed pending account opens support, reloads it, logs out; second real identity cannot read it | Real-mail confirmed pending requester support passed; earlier two-session and logout checks remain linked above |
| Operator | Owner approval, verified MFA, audited non-self case assignment, requester/assigned staff access and unrelated/revoked staff denial | Passed; approved support-only role restored and rechecked |
| Scheduler | No scheduler exists in this identity slice; no production job target configured | Later owning issues |

This record includes failures and cleanup as well as successful checks. BTP-02 and BTP-22 acceptance is complete for this identity slice. No production promotion or real funds are authorized by this staging record.
