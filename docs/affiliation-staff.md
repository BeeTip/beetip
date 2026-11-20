# Optional affiliation and scoped staff access

BTP-03 implements optional affiliation requests at `/account/affiliation`. The [public-access policy](public-onboarding.md) remains authoritative: visitors browse without signing in, and email confirmation activates ordinary account access automatically. Neither a missing request nor a rejection or withdrawal changes `members.status`. This slice does not publish real listings, enable orders or move funds.

## Request and evidence contract

An active, email-confirmed account creates a draft with a bounded institution name, uploads one PNG/JPEG up to 2 MB, then submits it for review. The application checks size, MIME and file signatures; the private Storage bucket also restricts size and MIME. Evidence is insert-only, bound to the actor and draft UUID, and cannot be replaced after submission. Exact upload retries compare bytes; different bytes conflict. A user can resume submission after a lost response or withdraw the request before starting another. Only one draft, pending request or approved badge can be active per account.

Affiliation states are `draft`, `pending`, `approved`, `rejected` and `withdrawn`. An independent MFA-authenticated membership reviewer approves with `matched`, or rejects with `unreadable` or `not_matched`. Self-review fails. The owner sees its latest 20 requests independently of the review queue. Reviewers process the oldest 50 pending requests, with deterministic ID ordering; decisions drain this queue so historical decisions cannot bury pending work. Refresh loads subsequent work. Badge state is shown privately on the affiliation page; public sample projections contain no member or evidence data.

Evidence downloads use authenticated Storage reads through a private, uncached attachment response, with permission checked again by Storage RLS. Policies allow the authenticated file/metadata operations required by the SDK and deny signed download/upload capabilities, public downloads, object listing, updates and deletion by clients. This prevents an issued signed link from continuing to work after grant revocation or suspension. The application holds no service key. Already downloaded copies cannot be remotely erased. [Supabase's operation-aware helpers](https://supabase.com/docs/guides/storage/schema/helper-functions) distinguish these Storage actions.

The app validates and normalizes JPEG or PNG with the [shared evidence upload checks](private-evidence.md). If an upload response is lost, retrying the same image also works for a readable draft saved before normalization. The existing authenticated Storage upload policy still permits a draft owner to upload directly. Moving all uploads behind server validation remains part of [BTP-20](https://github.com/BeeTip/beetip/issues/22).

Withdrawal removes the active badge/request and preserves evidence and decision history. The owner and currently authorized membership reviewers retain evidence access for review history, including withdrawn requests. Before collecting a real cohort's documents, approve retention and permitted evidence in [BTP-01](https://github.com/BeeTip/beetip/issues/3) and complete deletion, legal holds and account-data requests in BTP-20. Verification used synthetic images only.

## Staff authority

| Role | Authority in this slice |
| --- | --- |
| `membership_review` | Read submitted affiliation history/evidence and decide another account's pending request |
| `support` | Read only explicitly assigned support cases; no affiliation evidence |
| `finance_operation` | Separate grant only; no affiliation or support-history access |
| `finance_review` | Separate grant only; cannot coexist with financial operation on the same account |
| `platform_admin` | Grant/revoke a specific staff role for another account; no implicit affiliation or support-history access |

Staff operations and protected staff reads require a current confirmed, nonanonymous Auth identity, live session, nonsuspended member, `aal2`, verified MFA factor and live database role. User metadata and stale token role claims confer no authority. MFA enrollment and challenge/verification UI upgrades a normal login session without granting any role. Active grants can only be given to confirmed, nonsuspended accounts with verified MFA. Platform actors cannot alter their own roles. The staff page always fetches its own grants separately from the latest 100 other grants, and known account UUIDs can be granted/revoked without downloading all profiles.

The first platform operator uses [the database-owner bootstrap](../supabase/bootstrap-platform-operator.sql), after an explicit named owner decision. In one owner SQL session set `beetip.bootstrap_operator_id` to that normally registered account's UUID and `beetip.bootstrap_reason` to a 10 to 200 character approval reference without evidence or private identifiers, then run the script. It serializes bootstrap, refuses an existing active platform operator and requires confirmed identity plus verified MFA. It appends a private audit event and grants only `platform_admin`. Routine changes use `set_staff_role`; support assignment remains a separate command/procedure in its owning slice. No retained operator received a new role during this implementation. A real platform/reviewer appointment remains an owner operating decision.

`affiliation_command` and `set_staff_role` derive actors from `auth.uid()`, validate inputs in SQL and bind operation receipts to actor, UUID and payload hash. Current permissions are checked before replay. Changes and audit/receipt facts commit atomically. Audit contains action, target, actor and fixed decision/reason codes, never uploaded bytes or institution text. Events are `affiliation_begin`, `affiliation_submit`, `affiliation_withdraw`, `affiliation_approve`, `affiliation_reject`, `staff_granted` and `staff_revoked`. BTP-10/BTP-11 own notification intent and delivery; these events do not claim a working notification outbox.

The browser clears private rows on account events even while hidden, ignores late mutation/enrollment results from earlier account generations, and checks identity on focus/visibility refresh when storage events are unavailable. Parallel affiliation/staff reads must identify the same account. Visibility/focus and a 30-second visible-tab refresh recheck access. Every API and Storage read/write independently enforces current authority.

## Verification, 18 November 2026

Implementation candidate: `006302eb390c88fabf082b1bbdc8a7cd0811b95b` on local `main`. Source and required unpublished history are preserved; no Git push occurred. [Issue #5](https://github.com/BeeTip/beetip/issues/5) is closed with all four criteria and exact candidate evidence; the roadmap marks BTP-03 complete and BTP-04 next. Both issue bodies were reloaded and compared exactly after saving.

Three additive migrations were applied only to development project `rgiptdfjlmwldngapojq`: `20261118011036_optional_affiliation_staff`, `20261118012325_affiliation_authenticated_downloads`, and `20261118013134_affiliation_authenticated_metadata`. Local versions match hosted migration read-back. Database types were regenerated from that schema. Auth defaults, public signup, callbacks, member default, email hook, retained users and existing support assignments were preserved.

| Check | Evidence |
| --- | --- |
| SQL authorization | `supabase/tests/optional_affiliation_staff.sql`: 57 rollback-only assertions; existing identity/support script: 33 assertions passed with a verified staff-factor fixture |
| Real sessions | `scripts/test-connected-affiliation.mjs`: seven groups passed using temporary confirmed identities, real TOTP enrollment/verification UI and real private Storage uploads |
| Authorization and retries | Owner/unrelated/guest separation; CSRF and forged actor rejection; exact concurrent replay; changed-payload conflict; distinct scoped grants; same-session revocation and suspension; signed-link denial |
| UI regressions | Approval/rejection and continued support access; oldest pending work and own draft survive 105 newer historical rows; mobile layout; cross-tab logout; hidden event, delayed enrollment and focus identity-change clearing |
| Existing public/identity behavior | Public catalog harness passed home/details, filters, account intent, private API denial and 390/768/1440 layouts; existing connected identity harness passed seven groups; the unchanged public deployment passed all five anonymous smoke groups after the schema additions |
| Repository checks | 44 unit tests, 10 staging-helper regressions, lint, typecheck, production build and all 16 demo browser regressions passed |
| Owner bootstrap | Six rollback-only checks using the actual bootstrap script: missing inputs, unconfirmed identity, missing MFA, audited scoped success, existing-platform refusal and nonowner refusal |

The guarded fixture harness accepts only the dedicated development project and local connected application origins. It retrieves development administration authority in memory, creates four temporary accounts without sending mail, and removes only those accounts, their Storage objects, requests and support fixtures in `finally`. Private audit/receipt facts remain. Real email delivery and confirmation acceptance remain recorded at [the deployed public candidate](public-onboarding.md); these fixtures do not prove fresh email delivery.

Final hosted read-back confirmed three retained Auth users, one retained conversation/message, one active staff grant and one verified MFA factor. Temporary users, affiliation requests, evidence objects and diagnostic database functions were all zero. Security advisors returned only the existing leaked-password warning and two intentional private-table RLS-without-policy informational findings.

Repeat the SQL scripts through the dedicated project's owner connection in rollback transactions. With a connected app on `http://127.0.0.1:3108`, set `BEETIP_TEST_PROJECT_REF=rgiptdfjlmwldngapojq` and run `node scripts/test-connected-affiliation.mjs` and `node scripts/test-connected-identity.mjs`. Run `BEETIP_TEST_URL=http://127.0.0.1:3108 node scripts/test-public-catalog.mjs` using the equivalent PowerShell environment assignments. Local captures are under ignored `test-results/btp03/`; Playwright writes only to `test-results/playwright`.

The first operation-restricted policy passed SQL checks but the real Storage download failed because its authenticated metadata preflight also needs `object.get_authenticated_info`. The additive metadata correction preserves signing denial. Temporary diagnostic database objects were removed. Review also found hidden-tab/late-MFA-response handling and mixed-history queue truncation; fixes and behavioral regressions are included. A test assertion initially expected a revoked reviewer to lose its own draft, and was corrected to require loss of reviewer scope while preserving ordinary account access.

No Git push, Vercel deployment, new paid service, retained-account role expansion or production release is included. The public web deployment remains the previously accepted `872bf93` candidate until this source is separately deployed. Leaked-password protection remains disabled; private audit/receipt tables intentionally have no client policies. Those existing advisor findings are unchanged.
