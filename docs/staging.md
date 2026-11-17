# Protected identity staging

BTP-02 and BTP-22 remain open. This record covers the identity/private-support slice only. Connected marketplace, financial operations, jobs, and production release remain later work.

## Owner decisions, 17 November 2026

The maker approved their existing personal Vercel account and a zero-cost limit. No paid plan, trial, domain purchase, or email subscription is authorized. The maker approved their personal Gmail identity as the first support operator. Approval alone does not grant database access: normal email confirmation, verified MFA, a separate requester's case, and the audited bootstrap remain required.

A separate BeeTip Gmail account was created with the owner completing Google's personal-information and verification steps. The owner reports that Google app passwords are unavailable, so Gmail SMTP is not the selected route. Keep the mailbox as the authorized signup/recovery recipient. Credentials and personal operator addresses are kept outside the repository.

Brevo's Free SMTP service is the alternative being configured. Its published free allowance is 300 email sends per day. It supplies its own SMTP credentials, so Google app passwords are unnecessary. A Gmail sender must be verified, and Brevo may rewrite its visible sender domain to `brevosend.com`; a custom domain is not being purchased. Account onboarding requires the owner's real contact postal address. Keep that address and provider credentials outside the repository. [Free plan](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans), [sender verification](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email), [sender-domain rewriting](https://help.brevo.com/hc/en-us/articles/16045394674066-Troubleshooting-Domain-authentication).

Brevo registration through the BeeTip Google identity reached the required postal-address form. Address, postal code, city, and country await owner entry. The plan-selection step, sender verification, and SMTP credential generation have not been completed. No payment details, paid plan, or trial were selected. Hosted Supabase SMTP remains unchanged; this registration does not establish mail-delivery acceptance.

After onboarding, select Free, verify the BeeTip sender, and use the account's SMTP login and a newly generated SMTP key with `smtp-relay.brevo.com:587`. The SMTP key is not the Google password or a Brevo API key. Preserve exact callback URLs, email confirmation, session rules, and TOTP settings. Start with the staging-only rate cap of six emails per hour, then read back the hosted fields without exposing credentials. Verify received signup and recovery emails, changed-password login, and operator enrollment before marking the mail gate complete.

## Verified environment

| Item | Current evidence |
| --- | --- |
| Supabase | `beetip-development`, `rgiptdfjlmwldngapojq`, Singapore, `ACTIVE_HEALTHY` |
| Fixture inventory | Hosted counts returned zero Auth users, conversations, and messages before and after this continuation's connected staging harness |
| Vercel account | Owner's personal account; existing personal workspace is on Hobby |
| Staging project | `beetip-campus`, `prj_5UHMD6Jyj1e6J6p5asgxY9NOz8WP` |
| Access protection | Project configuration read back as Vercel Authentication, `deploymentType=all` |
| Build | Next.js, root `apps/web`, outside-root source access enabled, Node `24.x`, pinned root pnpm, Singapore functions |
| Environment | Both Vercel slots in this isolated staging project use connected mode, the exact staging origin, dedicated development endpoint and publishable key; no privileged application credential |
| Stable origin | [beetip-campus.vercel.app](https://beetip-campus.vercel.app), HTTPS and protection verified |
| Published candidate | `ab612da4d5ba02ffe95a881365d2c9510532b0ad`, deployment `dpl_BJrF9YvcsUJxJ1LXWncV2MGW1wtf`, `READY` |

Vercel rejected an initial Preview deployment because a project's first deployment must use its Production slot. This slot belongs only to the isolated staging project. All domains remain protected and all services are nonproduction. It does not represent production marketplace release. No Git integration or paid feature was enabled. The build resolved all five workspace projects, detected pinned `pnpm@10.18.3` and Next.js 16.4.5, compiled successfully, and completed in 43 seconds. Build execution was in `iad1`; functions are configured separately near the Singapore database.

Hosted migration names match the three identity/support migrations, but their recorded versions are `20261117065537`, `20261117070456`, and `20261117070645`. Repository filenames currently use `20261117065247`, `20261117070440`, and `20261117070601`. Do not replay them or run an unattended database push against this project. Reconcile migration contents and history before a future migration deployment.

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

## Acceptance record to complete

| Gate | Required evidence | State |
| --- | --- | --- |
| Exact deployment | Commit SHA, build/runtime log, workspace resolution, HTTPS URL and stable alias | Recorded above; Node major configured as 24.x, patch not printed in the build log |
| Protection | Anonymous page/API denial and authorized owner access at the stable alias | Anonymous gate and authorized automation passed; owner's Vercel login access remains a manual check |
| Auth configuration | Hosted site URL and exact stable callback/recovery allowlist read back; no broad wildcard | Passed via Management API read-back; localhost development callbacks retained explicitly |
| Real mail | Custom SMTP read-back without credentials, received signup confirmation, received recovery link, password change and login | Brevo Free onboarding in progress; SMTP not yet configured |
| Member journey | Confirmed pending account opens support, reloads it, logs out; second real identity cannot read it | Passed using admin-confirmed temporary accounts; actual signup/recovery pending |
| Operator | Owner approval, verified MFA, audited non-self case assignment, requester/assigned staff access and unrelated/revoked staff denial | Approval recorded; enrollment and case tests pending |
| Scheduler | No scheduler exists in this identity slice; no production job target configured | Later owning issues |

Record failures and cleanup as well as successful checks. Keep issues open until their entire acceptance contract passes. No production promotion or real funds are authorized by this staging record.
