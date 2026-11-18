# Connected offers and versioned consent

BTP-05 implements private offers for both request and trip listings. Confirmed, non-suspended accounts can create, revise, and withdraw offers. Listing owners review offers from Listing saya; authors return through Penawaran saya. Order acceptance and capacity reservation belong to BTP-06.

## Command and privacy contract

`POST /api/identity/offers` validates an exact command with operation, offer and listing UUIDs, expected offer revision, consented listing revision, integer IDR fee and save/withdraw action. Identity comes from the authenticated session, with the existing same-origin and expected-account guards. A PostgreSQL command locks its operation receipt, then listing, then existing offer. A partial unique index permits one active offer per author/listing. Concurrent updates or withdrawals using the same offer revision produce one winner and one conflict.

An exact operation retry returns its original offer ID without creating a revision. Reusing an operation ID with different values conflicts. Successful writes append immutable offer revisions and sanitized audit facts. Request fees cannot exceed the owner's maximum, trip fees cannot fall below the minimum, and fixed-fee listings require the exact fee. All fees are whole rupiah from zero to Rp150,000. Only authors can mutate offers; owners cannot propose on their own listing or mutate a counterparty's offer.

Every listing edit increments the existing listing revision. Authors must explicitly agree to the latest item details, fee and schedule before creating or revising an offer. This conservatively requires renewed consent for all listing edits, including rescheduling. A stale offer remains visible with a warning and its original terms remain in `offer_revisions`. It is not eligible for future acceptance without renewed consent. BTP-06 must check the current listing revision again under the same listing lock.

Withdrawal checks the current offer revision and its existing fee/consent revision, so authors can withdraw after rescheduling, pause, closure or cutoff without agreeing to new terms. Withdrawn offers are terminal; a subsequent proposal uses a new offer ID. Saving requires an active listing, future cutoff and non-suspended owner. No offer creates an order, reservation, funding obligation, conversation or notification delivery.

RLS permits base offer and revision reads only to the author and listing owner with a live confirmed session. Base tables have no authenticated write grants. Invoker RPC wrappers call private functions with explicit identity checks and empty search paths. `browse_offers` returns a bounded whitelist with listing titles, fee, status, revisions, timestamps and offer references, without addresses, owner/author IDs or contacts. The default inbox contains only the current author's offers; a listing-specific owner inbox includes counterparties. Keyset pages return 20 rows and use creation timestamp plus UUID, with a 21st row to detect continuation.

Private pages use the existing cross-tab account-change boundary and uncached responses. Unknown mutation outcomes keep the original operation and payload for retry; the reload control reconciles durable offers before a new command. Login destinations are restricted to the exact offers route and optional UUID listing filter.

## Repeat verification

The two migrations are applied only to the dedicated development project `rgiptdfjlmwldngapojq`. Their filenames match hosted migration versions, and database types are generated from the applied public schema. Web deployment remains pending.

```powershell
# Run the rollback-only SQL suite against the dedicated development project.
supabase db query --linked --project-ref rgiptdfjlmwldngapojq --file supabase/tests/versioned_offers.sql --output json

# With a connected local server and matching APP_ORIGIN.
$env:BEETIP_TEST_PROJECT_REF = 'rgiptdfjlmwldngapojq'
$env:BEETIP_TEST_URL = 'http://127.0.0.1:3108'
node scripts/test-connected-offers.mjs
```

The guarded harness creates temporary synthetic confirmed and unconfirmed accounts, signs separate owner/author/unrelated browser sessions in with passwords, and removes its listings, offers, revisions and users in `finally`. Audit and operation receipts remain for reconciliation. It does not send mail or exercise payment settlement. Captures are ignored under `test-results/btp05/`.

## Verification, 18 November 2026

Implementation candidate: `fd247f7daed367ba5f3c34b9398b9dca018ac107`. The subsequent acceptance-record commit changes documentation only. BTP-06 is the next implementation issue; public web deployment and BTP-01 operating decisions remain separate.

- The rollback-only database suite passed 30 assertions, including direct-write denial, private offer/history reads, revoked sessions, exact retry, changed-payload conflicts, terminal withdrawal, original-term preservation and tied-timestamp pagination without missing or duplicate rows.
- Six connected groups passed against both Next development and the final connected production build on local port 3109: authentication/CSRF/actor guards, concurrent retry and uniqueness, rescheduling with explicit renewed consent, concurrent update/withdraw, both listing directions and fee bounds, mobile owner review and cross-tab logout. Trip offer creation, request revision, paused withdrawal and owner review use the real UI.
- Lint, typecheck, 52 unit tests, 11 staging-helper tests, the connected production build, production dependency audit and all 16 existing demo browser journeys passed. All eight connected listing regression groups passed against the final production build. No production dependency vulnerabilities were reported.
- Development read-back confirmed the two hosted migration versions match the repository filenames, zero temporary BTP-05 users, zero listings/offers/revisions, and the existing three users plus one support conversation/message preserved. The mobile inbox capture was inspected visually; owner review had no horizontal overflow at 390/768/1440 widths.
- Security and performance advisors found no new offer findings. Existing findings remain: [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), intentionally policy-free private audit/receipt tables, the existing staff-role policies and an unused audit index.

The first connected run exposed a missing route-gate entry for the new offers page. That entry and the safe post-login destination were added before successful reruns. A render-purity lint finding was corrected by recording the fetch completion time in state; the database remains the cutoff authority.

Real orders, reservations, notifications and public deployment remain later work. Owner operating and real-money release decisions remain open.
