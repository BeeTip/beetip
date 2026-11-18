# BeeTip

A two-way community jastip marketplace centered on Alam Sutera. Anyone can browse; an email-confirmed account can access its dashboard without manual membership approval.

Follow [Run and demonstrate BeeTip](docs/running-beetip.md) for the full synthetic demo, the connected production-build walkthrough, UX acceptance checks and release boundaries.

## Repository status

The current access policy is [public browsing and open onboarding](docs/public-onboarding.md). Visitors can explore without an account, and personalized email confirmation signs new users into their dashboard. Connected slices include [listing publishing and browsing](docs/connected-listings.md), [private versioned offers and owner review](docs/connected-offers.md), [atomic acceptance and reserved orders](docs/connected-orders.md), and [in-app notifications](docs/notifications.md), verified locally against the dedicated development database; web deployment is pending. Connected funding and fulfillment remain later work.

The browser-local demo covers both listing types, negotiation, funding, purchases, chat, handover, disputes, transfers, ratings, and reconciliation with synthetic records. Connected identity provides Supabase email/password access and private support. BTP-03 adds [optional affiliation and scoped staff access](docs/affiliation-staff.md), verified locally against the dedicated development database; its web deployment is pending. Real email confirmation/recovery and assigned support-operator MFA passed acceptance on the existing [public BeeTip deployment](https://beetip-campus.vercel.app). Support operations and connected payment and fulfillment flows remain incomplete.

The demo uses Next.js, React, TypeScript, Tailwind CSS, Radix/shadcn-style primitives, React Hook Form, Zod, and Lucide. The interface targets mobile browsers first, with responsive desktop layouts and a simulated administration area. Supabase PostgreSQL, Auth and private Storage back the connected slices; Realtime remains later work. Native applications remain deferred under the PRD.

## Structure

| Path | Intended responsibility |
| --- | --- |
| `apps/web` | Customer and provider experience, administration, and authenticated server endpoints. |
| `packages/domain` | Framework-independent order rules, money calculations, and state contracts. |
| `packages/validation` | Shared input schemas and API contracts. |
| `packages/database` | Generated database types and database access utilities. |
| `supabase/migrations` | Schema, permissions, constraints, and atomic transaction functions. |
| `docs/PRD.md` | Product requirements and accepted UX decisions. |
| `docs/architecture.md` | Proposed stack, PRD mapping, delivery sequence, and operational gates. |

`packages/database` contains types generated from the migrated development schema. `supabase/migrations` and `supabase/tests` contain the identity/private-support schema and authorization checks. Domain and validation packages contain shared logic. Task orchestration is deferred.

## Local development

Use Node.js 24.22.1, matching CI, and the pinned pnpm version from `package.json`:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:3107. Port 3107 avoids the existing local service on port 3000. Connected mode requires the settings in `apps/web/.env.example`. Follow [development setup](docs/development.md). To run the synthetic demo explicitly in PowerShell, set `$env:BEETIP_MODE = 'demo'` before `pnpm dev`. Geist Sans and SVG illustrations are served locally.

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Browser tests build the production application and start an isolated server on port 3107. Stop the development server before running them. If browser downloads are unavailable, `BEETIP_BROWSER_EXECUTABLE` can point to an existing compatible Chromium executable; CI installs Playwright's pinned browser.

## Demo walkthrough

1. Open Pesanan as Nadia and select `BTP-001`, already being delivered. Check the items and generate a handover code.
2. Open Profil and switch to Rizky. Open the same order and enter the customer's code. Confirmation enables payout but does not complete it.
3. Switch to Admin Maya. Prepare the Rp65,000 payout and record a completed simulated transfer. The ambiguous-result control demonstrates reconciliation before retry.
4. Request the Rp5,000 refund. Switch to Admin Arif to review and complete it. The order now reconciles Rp70,000 received with Rp65,000 payout and Rp5,000 refund.
5. Switch back to Nadia to submit a rating and fictional feedback.

To start a fresh customer request, use the coffee request on Beranda: Rizky offers, Nadia accepts, Nadia records funding, an admin verifies it, and Rizky purchases and delivers. To try a combined trip, create one as Rizky and submit separate offers as Nadia, Salma, and Dimas. The seeded AEON trip already contains three customer orders at different stages.

The interface uses product-facing copy without demo banners. All personas remain fictional, and the account selector is a local testing tool, not login. Progress is stored under `beetip-demo-v2` in this browser, with validated version 1 migration; listing drafts use session storage. Reset data lokal restores fixtures. Corrupt or incompatible records require a visible reset. Blocked storage falls back to memory. Data does not synchronize across browsers or tabs.

QR scanning requires camera permission and localhost or HTTPS. Code entry is always available. Codes last 60 seconds, regeneration invalidates the preceding code, and five failed attempts require regeneration. Physical Android/iOS camera behavior remains a manual device check.

## Workflow and limits

Defaults: three customers per offered jastip, Rp150,000 shopping budget per customer, 15-minute unpaid reservations, and zero platform fees. New listings have explicit WIB deadlines and delivery windows. Legacy order windows remain unchanged. Reserving and checking capacity occur synchronously within the local service; this does not prove database concurrency safety.

Fulfillment and fund movements are separate. Receipt reference plus line allocation cannot be reimbursed twice. Funding, payout, and refund references are unique. Failed confirmation attempts are audited without recording the entered code. Refunds, disputed payouts, and post-purchase cancellation payouts require a second admin review.

Post-purchase cancellation uses a deliberately fixed demo resolution: reimburse approved receipt costs, return the jastip fee and unused funds, and require transfer review. Production policy must support evidence-based partial allocations and independent review before real operation. Demo dispute resolution unblocks the existing allocation with a recorded reason; it is not a live adjudication system.

The CSV ledger includes verified incoming funds, item costs, jastip and platform fees, payment charges, completed payouts/refunds, transfer references, and outstanding funds. Every transfer is simulated; external charges are zero.

## Validation and CI

Domain tests exercise complete request and three-customer trip journeys, bounds, membership checks, purchase funding gates, amendments, duplicate receipt allocation, expiry, code permissions/reuse, cancellations, disputes, transfer retries, and the PRD reconciliation example. Browser tests cover member flows, settlement, persistence/reset, storage failures, mobile/desktop overflow, keyboard entry, and reduced motion. GitHub Actions runs lint, types, domain tests, and production-build browser checks.

## Backend integration boundary

The connected pilot is planned in the [system design](docs/system-design.md), with [messaging contracts](docs/messaging.md), a [sequenced issue backlog](docs/implementation-plan.md), and a [Vercel deployment runbook](docs/vercel-deployment.md). These documents cover real accounts and chat with supervised manual payments. They do not represent a completed backend or deployment.

`ApplicationService` is the typed boundary for queries and mutations. Operations return stable `VALIDATION`, `PERMISSION`, `CONFLICT`, `EXPIRED`, or `INVALID_STATE` failures. Successful mutations use operation identifiers and audit records. `DemoService` implements this interface in the browser.

The entire local dataset is visible to the browser and can be edited through developer tools. Persona checks demonstrate behavior only. Before real use, replace the adapter with authenticated server endpoints, PostgreSQL transactions and constraints, row-level security, private file access, server-held token hashes, rate limits, durable idempotency, expiry jobs, verified SMTP delivery, and actual transfer reconciliation. Do not expose a service credential in the client.

## Pilot boundary

Payment verification, payouts, and refunds are supervised manual operations. Simulated payments must be labeled. Real funds require a suitable collection and payout arrangement, verified operators, and reconciliation procedures before launch. Delivery confirmation establishes payout eligibility; it does not prove an outgoing transfer.

## Member UX upgrade

Use the mobile + button to choose Minta dibelikan or Buka jasa titip. Create a request through three steps with item quantities, maximum prices, WIB delivery selectors, a separate service fee, and review. Jastip saya includes both services you offer and requests you fulfill; Pesanan filters distinguish Saya titip and Saya belikan.

To try immediate acceptance, switch to Rizky and open Tolong belikan roti. Confirm Saya bisa belikan to create the order at its fixed fee. Negotiable requests still need the requester's approval. Shopping remains blocked until funds are verified. Administrators can moderate listings independently of existing orders and reply to support from their inbox. Hubungi bantuan is available from Profile and order details.

Version 1 browser records migrate to version 2 without replacing accepted terms or money records. New drafts use versioned session storage. Support and order chat remain local to one browser; realtime delivery and live maps are documented follow-up work in the PRD and architecture. Friends' uncoached usability retesting remains a human validation step.
