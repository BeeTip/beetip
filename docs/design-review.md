# Architecture comparison and review

Reviewed 17 November 2026. Two independent candidates were produced by Terra and Luna. A separate Terra reviewer cross-judged both candidates against the same five criteria. The parent read both full designs and selected the base. These reviews assess documents, not implemented security or runtime performance.

## Evidence

The [Terra candidate](design-candidates/terra.md) compares database-owned transaction commands with application-owned direct SQL transactions. The [Luna candidate](design-candidates/luna.md) compares a Next.js command monolith with a browser-centric RLS/RPC design and a separate API service. Both use the [current-system grounding](current-system.md).

| Criterion, 1 to 5 | Terra | Luna |
| --- | --- | --- |
| Authorization and single mutation ownership | 4 | 3 |
| Atomic capacity, money, and retries | 4 | 4 |
| Ordered messaging and recovery | 3 | 2 |
| Interface depth and async migration | 4 | 5 |
| Isolated release and recovery | 5 | 4 |

## Decision and grafts

Use Luna's feature-owned server-command organization. Add Terra's scoped staff grants, financial allocation locks, authenticated transactional commands, and explicit lease recovery. The [selected system design](system-design.md) is authoritative. Candidate sketches are retained as alternatives and must not be implemented verbatim.

Both candidates used timestamp message cursors that could skip a transaction committed late. The selected messaging design serializes sequence allocation and commit within each conversation. Subscribe before catch-up and repeat on invalidation. Per-member hints contain no content or conversation identifiers. All reads recheck current permission.

Reject broad boolean administrator authority and actor parameters that are not bound to authenticated database identity. Standard commands use user-scoped RPCs. Direct table mutations cannot compete with the transaction owner. Support operators need explicit case assignments and event-time recipient snapshots with dispatch-time rechecks.

Grouped chat email has one unique recipient/conversation/minute key, a delay after window closure, a maximum message sequence, and a read-cursor suppression check. Ordinary failed sends retain drafts, while account change and access revocation clear sensitive caches. The job key remains a broadly privileged server secret, with explicit module isolation rather than a false claim of narrow database privileges.

## Red-flag screen

| Red flag | Selected constraint |
| --- | --- |
| Shallow modules and pass-through wrappers | A caller submits one command. Feature modules hide authorization, projection, and persistence policy. No generic repository layer. |
| Information leakage | Public contracts use domain values. SQL rows, credentials, and framework objects remain private. |
| Temporal decomposition | Modules own domain decisions rather than separate load/validate/save stages. |
| Split ownership and duplicate mutation paths | One transactional command owns each invariant. Protected direct writes are revoked. |
| Importable internals | Explicit package exports, server-only markers, and CI import checks. |
| Hand-synced mappings | Generate event recipient/template mappings from one typed registry and fail on uncovered event variants. |

## Verification status

Grounding was checked against current source, tests, README, PRD, repository history, and repository visibility. Supabase Auth, SMTP, Realtime, Cron, Vercel monorepo configuration and cron limitations, and proposed Resend idempotency were checked against official documentation. Remaining provider settings, operating policies, credentials, and actual plan capacity are implementation gates. No application or database implementation was performed during this design pass.

Reopen the architecture if unrelated features repeatedly bypass a command owner, require whole-state browser downloads, duplicate financial calculations without parity checks, or cannot reconcile a shared transaction contract. Record accepted deviations in the existing system design before closing the affected issue.

## Backlog verification

The published [roadmap](https://github.com/BeeTip/beetip/issues/2) links 24 open work issues. A fresh GitHub read-back matched all titles, user outcomes, 102 acceptance criteria, parent references, and blocking URLs against the local catalog. The dependency graph has no cycles. Twenty relative links across eight new Markdown documents resolve locally, and those documents contain no em dash characters. `git diff --check` passed.

These are documentation and tracker checks. Application tests, database tests, deployment, and physical-device verification were not run because no runtime implementation changed. Existing application and browser-test working-tree edits were left untouched. Planning documents remain local and uncommitted until a separate repository publishing step.
