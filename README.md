# BeeTip

A two-way community jastip marketplace for verified BINUS Alam Sutera students, staff, and employees. One member account can request purchases and fulfill orders.

## Repository status

Repository foundation only. The application, database migrations, authentication, payments, and deployment are not implemented. No development or build scripts exist yet.

The proposed pilot stack is Next.js, React, TypeScript, Tailwind CSS, and Supabase PostgreSQL, Auth, Storage, and Realtime. The interface targets mobile browsers first, with responsive desktop layouts and a protected administration area in the same application. Native applications remain deferred under the PRD.

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

The empty source directories reserve ownership boundaries for the next scaffolding step. Use pnpm workspaces; add task orchestration only when multiple executable packages justify it.

## Pilot boundary

Payment verification, payouts, and refunds are supervised manual operations. Simulated payments must be labeled. Real funds require a suitable collection and payout arrangement, verified operators, and reconciliation procedures before launch. Delivery confirmation establishes payout eligibility; it does not prove an outgoing transfer.
