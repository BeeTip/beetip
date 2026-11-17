# Protected identity staging

BTP-02 and BTP-22 remain open. This record covers the identity/private-support slice only. Connected marketplace, financial operations, jobs, and production release remain later work.

## Owner decisions, 17 November 2026

The maker approved their existing personal Vercel account and a zero-cost limit. No paid plan, trial, domain purchase, or email subscription is authorized. The maker approved their personal Gmail identity as the first support operator. Approval alone does not grant database access: normal email confirmation, verified MFA, a separate requester's case, and the audited bootstrap remain required.

A separate BeeTip Gmail account was created with the owner completing Google's personal-information and verification steps. Its SMTP app password and actual Auth mail delivery remain pending. Use that account for the authorized signup/recovery test mailbox. Credentials and personal operator addresses are kept outside the repository.

## Verified environment

| Item | Current evidence |
| --- | --- |
| Supabase | `beetip-development`, `rgiptdfjlmwldngapojq`, Singapore, `ACTIVE_HEALTHY` |
| Fixture inventory | Hosted count returned zero Auth users, conversations, and messages before this continuation's tests |
| Vercel account | Owner's personal account; existing personal workspace is on Hobby |
| Staging project | `beetip-campus`, `prj_5UHMD6Jyj1e6J6p5asgxY9NOz8WP` |
| Access protection | Project configuration read back as Vercel Authentication, `deploymentType=all` |
| Build | Next.js, root `apps/web`, outside-root source access enabled, Node `24.x`, pinned root pnpm, Singapore functions |
| Environment | Preview only: connected mode, exact application origin, dedicated development endpoint and publishable key; no privileged application credential |
| Intended stable origin | `https://beetip-campus.vercel.app`; allocation and deployed routing not yet verified |
| Published candidate | None yet |

Hosted migration names match the three identity/support migrations, but their recorded versions are `20261117065537`, `20261117070456`, and `20261117070645`. Repository filenames currently use `20261117065247`, `20261117070440`, and `20261117070601`. Do not replay them or run an unattended database push against this project. Reconcile migration contents and history before a future migration deployment.

## Repeatable anonymous smoke

```powershell
$env:BEETIP_STAGING_URL = 'https://beetip-campus.vercel.app'
$env:BEETIP_STAGING_BYPASS_FILE = 'absolute-path-to-secure-bypass-file'
pnpm test:staging
```

The bypass secret comes from this project's protection-for-automation configuration. It is not the Vercel account access token. The harness sends it only to the supplied origin, does not follow redirects, and excludes it from output. Public requests are checked separately without the bypass. The check fails if a page or support API is reachable publicly, connected login is unavailable, support history is accessible anonymously, private API responses can be cached, cross-origin Auth is accepted, or callbacks leave the configured origin.

Run `node --test scripts/check-staging.test.mjs` for the helper's regression tests. A local connected check can explicitly select `BEETIP_STAGING_URL=http://127.0.0.1:3108` and `BEETIP_STAGING_ALLOW_LOCAL=1`; that run skips deployment protection and is reported as local evidence. It does not establish staging acceptance. Clear the local override before remote checks.

The helper sends no valid signup/recovery operation, creates no user or support record, and proves no email, MFA, login, or authenticated support journey. Use the dedicated real-session harness locally and record the following staging evidence separately.

## Acceptance record to complete

| Gate | Required evidence | State |
| --- | --- | --- |
| Exact deployment | Commit SHA, build/runtime log, workspace resolution, HTTPS URL and stable alias | Pending |
| Protection | Anonymous page/API denial and authorized owner access at the stable alias | Pending deployment |
| Auth configuration | Hosted site URL and exact stable callback/recovery allowlist read back; no broad wildcard | Pending |
| Real mail | Custom SMTP read-back without credentials, received signup confirmation, received recovery link, password change and login | Pending app password |
| Member journey | Confirmed pending account opens support, reloads it, logs out; second real identity cannot read it | Pending staging |
| Operator | Owner approval, verified MFA, audited non-self case assignment, requester/assigned staff access and unrelated/revoked staff denial | Approval recorded; enrollment and case tests pending |
| Scheduler | No scheduler exists in this identity slice; no production job target configured | Later owning issues |

Record failures and cleanup as well as successful checks. Keep issues open until their entire acceptance contract passes. No production promotion or real funds are authorized by this staging record.
