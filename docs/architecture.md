# Proposed pilot architecture

Decision date: 6 October 2026. Status: browser-local demo implemented; the connected pilot architecture below remains the next integration step.

## Implemented foundation

The monorepo now has a Next.js application, mobile-first cream-and-amber tokens, local SVG illustrations, self-hosted Geist Sans, shared TypeScript domain logic, shared Zod validation, and a versioned synthetic browser adapter. All member routes and a simulated admin area are connected. The reference payment-method strip was replaced with manual-funding instructions; QR codes appear only after the customer checks goods and requests confirmation.

The demo demonstrates both listing journeys, immutable accepted terms, funding gates, amendment consent, receipt allocation, separate trip-order confirmations, disputes, second-admin transfer review, ambiguous-transfer recovery, CSV reconciliation, chat, ratings, and feedback. Reservations expire during local operation and when persisted records are restored. Tests run against domain rules and a production build.

The adapter stores readable synthetic records in one browser and has no trusted security boundary or multi-user transaction isolation. It cannot establish authentic identity, real payment evidence, independent reviewers, protected addresses, or server token secrecy. Database concurrency, private storage, live funds, email delivery, and physical camera compatibility remain integration or device-validation gates.

For post-purchase cancellation, the demo reimburses approved purchased goods and returns the fee and remainder after review. The connected implementation must replace that default with the PRD's evidence-based allocation policy. Listing cutoff defaults to 24 hours; delivery windows are text terms. There is no scheduler, notification service, native app, PWA cache, or deployment in this milestone.

## Product constraints

The PRD requires mobile web, Indonesian copy, integer IDR amounts, two-way listings, negotiation, combined trips, private chat, receipt allocation, manual fund reconciliation, delivery confirmation, disputes, and administration. It explicitly defers native apps, continuous location tracking, automated settlement, and stored balances.

A five-member team with no initial budget should prioritize a complete supervised pilot. The highest engineering risks are transaction correctness and authorization rather than native rendering performance.

## Stack

| Layer | Recommendation | Reason |
| --- | --- | --- |
| Application | Next.js App Router, React, TypeScript | One deployable application for member flows, desktop administration, and server endpoints. |
| Styling | Tailwind CSS and selected shadcn/ui components | Mobile-first layouts with accessible web form and dialog primitives. |
| Forms | React Hook Form and Zod | Complex item requests and negotiated offers with shared validation. Server validation remains mandatory. |
| Database | Supabase PostgreSQL | Relational orders, receipts, money records, and transactional capacity acceptance. |
| Identity | Supabase Auth plus application membership verification | Authentication and approval of community affiliation are separate checks. |
| Files | Supabase private Storage buckets | Receipts and verification evidence require participant-specific access and short-lived signed URLs. Public listing images need separate validated access rules. |
| Chat | Persisted PostgreSQL messages plus Supabase Realtime | Durable private order history with realtime delivery and reconnect fetching. |
| Backend | Next.js Route Handlers and PostgreSQL transaction functions | Central authorization and workflow orchestration; atomic mutations execute in the database. |
| Delivery evidence | Browser camera QR scanning and backup code entry | QR generation and validation remain server-controlled. Camera support must be checked on actual pilot devices. |
| Payments | Manual ledger and supervised admin operations | Matches the pilot scope; no live gateway dependency in the first scaffold. |
| Quality | Vitest, Playwright, database integration and authorization tests, GitHub Actions | Test the PRD acceptance criteria, including concurrent acceptance and wrong-user access. |
| Workspace | pnpm workspaces | Small monorepo with reusable domain and validation packages. Turborepo can be added later if useful. |

Use Server Components for initial reads and Client Components for interaction. Add TanStack Query only where chat, polling, or repeated client reads justify it. Avoid introducing a separate API deployment or global state library until the product needs one.

## React Native assessment

React Native with Expo and Expo Router is a valid option when installable Android and iOS apps are a committed deliverable. Expo supports Android, iOS, and web routes and components. Mobile layout alone does not require React Native.

For this PRD, responsive Next.js is the recommended starting point because members can open a link immediately and administrators need browser-based reconciliation tools. An Expo app would introduce native release and device validation work before the pilot has established demand. If native becomes mandatory, use Expo for `apps/mobile`, retain the web administration experience, and share domain rules, schemas, and API contracts. Web UI components are not automatically reusable native components.

Add a web manifest and installation guidance after the main journeys work. Cache public shell assets only. Financial writes, acceptance, amendments, and confirmation require a live server response; do not claim offline completion or store private transaction pages in a general-purpose offline cache.

## Transaction and privacy design

1. Accepting an offer must lock or conditionally update the relevant request and trip in one PostgreSQL transaction. Recheck membership, ownership, terms, expiry, customer count, and total reserved purchase capacity, then create immutable accepted terms and audit records together.
2. Keep fulfillment, incoming payments, payouts, refunds, and disputes separate. Use auditable money movements rather than a single mutable paid flag. Store money as integer rupiah with validated nonnegative amounts and constraints. Never treat reimbursement as platform revenue.
3. Verify actual incoming payments before enabling purchase. Receipt allocation must prevent duplicate reimbursement, including across shared receipts. Additional purchase budgets require explicit approval and verified funding.
4. Enforce row-level security on exposed tables and storage. Public listings must exclude exact addresses. Check permissions inside every server mutation. Service credentials are server-only and must not replace actor authorization.
5. Database functions should default to invoker security. Any necessary elevated function needs explicit caller checks, restricted execution privileges, a controlled search path, and tests for unauthorized callers. Protect immutable terms, audit events, and money records from direct client edits.
6. Generate short-lived random confirmation tokens server-side, store token hashes, rate-limit backup attempts, and bind confirmation to the assigned provider and order. Consume tokens atomically with the state transition. Repeated scans must not create another confirmation or entitlement.
7. Require independent second-admin review for refunds, disputed payouts, and exceptional adjustments. Record external transfer references and idempotency keys. An ambiguous outgoing transfer remains unresolved until account records are checked.
8. Freeze only the unsettled disputed allocation. Reconciliation exports must account for incoming funds, provider transfers, refunds, fees, and outstanding amounts per order.
9. Expiring reservations need a database-backed expiry rule and an actual scheduled cleanup mechanism before the pilot. Acceptance must reject expired reservations even if cleanup is delayed. Release capacity once, with race-safe checks.

## Mobile interaction requirements

- Design for narrow screens first, with bottom navigation for board, orders, chat, and account. Both listing types share the board with clear labels and filters.
- Use generous touch targets, readable inputs, safe-area spacing, and predictable back navigation. Indonesian copy and localized IDR displays are defaults.
- Preserve recoverable form drafts without retaining sensitive identity or payment evidence in persistent browser storage.
- Compress and validate images, paginate the board, and render clear loading, empty, error, and unavailable states on slow connections.
- QR scanning requires HTTPS and camera permission. Backup entry is part of the main flow. Validate camera access, uploads, and keyboard behavior on Android Chrome and iOS Safari.
- Desktop layouts expand into useful board and administration panels. Authorization applies regardless of viewport or route visibility.

## Hosting and zero-budget constraints

Supabase Free currently lists 500 MB database storage, 1 GB file storage, and pausing after one week of inactivity. These are prototype constraints rather than permanent operating guarantees. Confirm email delivery, backup and recovery, project ownership, storage usage, and realtime limits before the pilot.

Vercel Hobby is restricted to personal, non-commercial use. Do not assume a marketplace pilot qualifies merely because platform fees are waived. Hosting remains undecided until permitted use, current cost, runtime compatibility, and team ownership are verified. Next.js can be deployed to a compatible Node.js hosting environment; Vercel is not an architectural requirement.

Supabase's default authentication email service is restricted and unsuitable as an assumed participant onboarding channel. Configure and test an appropriate custom SMTP service before recruiting real members. Authentication does not automatically establish access to an approved institutional domain or verified affiliation.

No hosting account, database project, SMTP service, deployment, or payment arrangement is created by this repository foundation.

## Scaffold and delivery sequence

1. Generate the Next.js TypeScript application, configure Tailwind and validation, add mobile navigation, Indonesian copy, environment examples, and CI. Pin installed versions and commit the lockfile.
2. Implement database migrations, Auth, affiliation approval, row-level security, and private uploads. Add tests for unverified and unrelated users.
3. Build both listing types, negotiation bounds, atomic acceptance, terms snapshots, and capacity expiry. Test races at the final trip slot.
4. Implement private order chat, consent for substitutions and price changes, receipts, and separate fulfillment and money transitions.
5. Build trip management, manual verification, delivery codes, disputes, second-reviewer actions, payouts, refunds, and reconciliation exports.
6. Validate every PRD acceptance criterion and the complete multi-customer journey. Deploy a simulated pilot first; real money remains gated by suitable fund operations.

The first software milestone should be one complete, authorized customer request journey. Then extend it to provider trips with three independently confirmed and reconciled orders.

## Sources

- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js progressive web apps](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [Expo Router platforms and routing](https://docs.expo.dev/router/introduction/)
- [Supabase database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase authentication rate limits and email restrictions](https://supabase.com/docs/guides/auth/rate-limits)
- [Vercel Hobby permitted use](https://vercel.com/docs/plans/hobby)
