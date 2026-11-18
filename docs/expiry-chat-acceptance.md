# Reservation expiry and private chat acceptance

Accepted on 18 November 2026 against dedicated development project `rgiptdfjlmwldngapojq` and the local connected production build at `http://127.0.0.1:3108`, using Node 24.22.1. Source candidate `3be74a8e6d680635ccaa6801e4260b8233884315` includes both independently prepared branches, with funding-safe expiry integrated into chat. The final review additionally removed a misleading fixed retry time from the quota error and tightened loopback-only database runner URLs.

## Evidence

| Check | Result |
| --- | --- |
| Fresh PostgreSQL 18 migrations and existing authorization/concurrency regressions | 13 groups passed, including notification SQL and scoped support/MFA checks. |
| Reservation expiry | 10 groups passed: wall-clock lock races, verified funding marker protection, overlapping workers, bounded backlog, failure rollback, sanitized heartbeat and operational rollback. |
| Durable chat | 12 groups passed: serialized late commits, exact retry/body binding, rollback, 129-message pagination, cursors, quotas, access revocation, hints, funded/unpaid deadlines and feature rollback. |
| Unit/components | 67 tests across 13 files passed. |
| Demo | All 16 production-demo Playwright journeys passed. |
| Build and static checks | Connected production build, lint, typecheck, notification-registry parity and staging-helper tests passed. Production dependency audit found no known vulnerabilities. |
| Existing hosted regressions | Real-session order suite passed 4 groups; notification suite passed 5 groups against the integrated schema. |
| Real chat sessions | Guarded harness passed all 6 groups using separate confirmed synthetic Auth accounts and browser contexts. |
| Independent static review | No merge-blocking authorization/concurrency findings in `3be74a8` and runner guards. The quota-copy finding was corrected. |

The real-session harness proved private subscription success and unrelated-topic denial; participant-only API and raw-table reads; CSRF/actor checks; exact concurrent retry; changed-body conflict; monotonic reads; live delivery before the 30-second polling fallback; recovery after a committed response was lost; offline catch-up; expired read-only history; membership revocation; cross-tab logout clearing; and no horizontal overflow at 390, 768 and 1440 pixels. Its final check closed every participant tab and observed the actual hosted Cron expire a disposable order, then verified participant projections and closed chat.

The transport hint has no application content. Supabase adds its own random transport UUID to the empty application payload; the harness checks this explicitly. Test-only platform stand-ins model that envelope, while hosted sessions establish actual WebSocket authorization and delivery.

Early harness runs exposed invalid fixture fee bounds, an incorrect assumption about Supabase's transport envelope and an empty-draft button assertion. Those harness errors were corrected and rerun. One initial subscription returned a transient channel error; subsequent complete real-session runs passed. No delivery guarantee is inferred from Realtime: catch-up and polling remain authoritative recovery paths.

## Hosted schema and preservation

The ordered migrations `20261119000709`, `20261119000800` and `20261119000801` were applied and read back. Types were regenerated from the actual public schema. The named `btp07-reservation-expiry` job is active once per minute and invokes only `private.btp07_run_expiry()`. Read-back observed 18 successful runs and zero failed runs. The Realtime policy permits authenticated SELECT of the caller's private member topic with a live active-member check; ordinary clients have no publication policy. Internal funding and scheduler helpers remain inaccessible to ordinary accounts.

The follow-up Realtime policy migration eliminated its authorization initplan advisory. Remaining performance notices concern existing staff SELECT policies and unused indexes in this small development database. RPC-only tables deliberately have RLS without direct-access policies. Existing disabled [Auth leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and release hardening remain tracked limitations, not claims of production acceptance.

Each hosted harness removed its own synthetic users, listings, orders, conversations, messages, notifications, preferences and intents. Retained accounts, the existing support conversation/message, scoped operator/MFA state, and minimal audit/operation facts are preserved. The immutable order-terms trigger is restored after transactional fixture cleanup. Operational Cron history is intentionally retained.

Final read-back confirmed 3 Auth users, 3 members, 1 support conversation, 1 support message, 1 active staff grant and 1 verified MFA factor. Listings, offers, orders, notifications, preferences, delivery intents, chat email sources, send locks and read cursors were all empty. The immutable trigger was enabled (`O`).

## Runnable scope and remaining gates

[Run and demonstrate BeeTip](running-beetip.md) gives exact PowerShell commands, the synthetic end-to-end demo and the real connected listing-to-order-to-chat walkthrough. [Expiry](connected-expiry.md) and [chat](connected-chat.md) document repeat verification and rollback boundaries. CI now exercises all three isolated PostgreSQL suites alongside the frontend checks.

This establishes local and dedicated-development acceptance. It does not deploy the web candidate or establish physical-device behavior, measured pilot load/latency, active application email, evidence-backed funding, financial settlement, retention approval, recovery rehearsal or production release. Future financial resolution must close conversation sends transactionally. BTP-09 support operations is the next conversation slice; owner operations and real-money gates remain open.
