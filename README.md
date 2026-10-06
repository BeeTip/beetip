# BeeTip

A two-way community jastip marketplace for verified BINUS Alam Sutera students, staff, and employees. One member account can request purchases and fulfill orders.

## Repository status

Runnable browser-local interactive demo. Both listing types, negotiation, accepted terms, funding review, purchases, amendments, chat, handover, disputes, payouts, refunds, ratings, and reconciliation are implemented using synthetic records. Real authentication, database migrations, payments, and deployment remain unimplemented.

The demo uses Next.js, React, TypeScript, Tailwind CSS, Radix/shadcn-style primitives, React Hook Form, Zod, and Lucide. The interface targets mobile browsers first, with responsive desktop layouts and a simulated administration area. Supabase PostgreSQL, Auth, Storage, and Realtime remain the proposed connected backend. Native applications remain deferred under the PRD.

## Structure

| Path | Intended responsibility |
| --- | --- |
| `apps/web` | Customer and provider experience, administration, and authenticated server endpoints. |
| `packages/domain` | Framework-independent order rules, money calculations, and state contracts. |
| `packages/validation` | Shared input schemas and API contracts. |
| `packages/database` | Generated database types and database access utilities. |
| `supabase/migrations` | Schema, permissions, constraints, and atomic transaction functions. |
| `docs/PRD.md` | Copy of the supplied review-draft PRD. |
| `docs/architecture.md` | Proposed stack, PRD mapping, delivery sequence, and operational gates. |

`packages/database` and `supabase/migrations` reserve ownership boundaries for the connected backend. Domain and validation packages already contain shared logic. Task orchestration is deferred.

## Local development

Use Node.js 22 and the pinned pnpm version from `package.json`:

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:3107. Port 3107 avoids the existing local service on port 3000. No environment variables or external accounts are required. Geist Sans and SVG illustrations are served locally.

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

The interface uses product-facing copy without demo banners. All personas remain fictional, and the account selector is a local testing tool, not login. Progress is stored under `beetip-demo-v1` in this browser; listing drafts use session storage. Reset data lokal restores fixtures. Corrupt or incompatible records require a visible reset. Blocked storage falls back to memory. Data does not synchronize across browsers or tabs.

QR scanning requires camera permission and localhost or HTTPS. Code entry is always available. Codes last 60 seconds, regeneration invalidates the preceding code, and five failed attempts require regeneration. Physical Android/iOS camera behavior remains a manual device check.

## Workflow and limits

Defaults: three customers per trip, Rp150,000 item budget per customer, 15-minute unpaid reservations, and zero platform fees. Demo listings expire after 24 hours. Delivery windows are explicit text agreed in the offer. Reserving and checking capacity occur synchronously within the local service; this does not prove database concurrency safety.

Fulfillment and fund movements are separate. Receipt reference plus line allocation cannot be reimbursed twice. Funding, payout, and refund references are unique. Failed confirmation attempts are audited without recording the entered code. Refunds, disputed payouts, and post-purchase cancellation payouts require a second admin review.

Post-purchase cancellation uses a deliberately fixed demo resolution: reimburse approved receipt costs, return the jastip fee and unused funds, and require transfer review. Production policy must support evidence-based partial allocations and independent review before real operation. Demo dispute resolution unblocks the existing allocation with a recorded reason; it is not a live adjudication system.

The CSV ledger includes verified incoming funds, item costs, jastip and platform fees, payment charges, completed payouts/refunds, transfer references, and outstanding funds. Every transfer is simulated; external charges are zero.

## Validation and CI

Domain tests exercise complete request and three-customer trip journeys, bounds, membership checks, purchase funding gates, amendments, duplicate receipt allocation, expiry, code permissions/reuse, cancellations, disputes, transfer retries, and the PRD reconciliation example. Browser tests cover member flows, settlement, persistence/reset, storage failures, mobile/desktop overflow, keyboard entry, and reduced motion. GitHub Actions runs lint, types, domain tests, and production-build browser checks.

## Backend integration boundary

`ApplicationService` is the typed boundary for queries and mutations. Operations return stable `VALIDATION`, `PERMISSION`, `CONFLICT`, `EXPIRED`, or `INVALID_STATE` failures. Successful mutations use operation identifiers and audit records. `DemoService` implements this interface in the browser.

The entire local dataset is visible to the browser and can be edited through developer tools. Persona checks demonstrate behavior only. Before real use, replace the adapter with authenticated server endpoints, PostgreSQL transactions and constraints, row-level security, private file access, server-held token hashes, rate limits, durable idempotency, expiry jobs, verified SMTP delivery, and actual transfer reconciliation. Do not expose a service credential in the client.

## Pilot boundary

Payment verification, payouts, and refunds are supervised manual operations. Simulated payments must be labeled. Real funds require a suitable collection and payout arrangement, verified operators, and reconciliation procedures before launch. Delivery confirmation establishes payout eligibility; it does not prove an outgoing transfer.
