# Connected synthetic reconciliation

Open **Pemeriksaan dana → Rekonsiliasi dana** from the connected account dashboard. Choose a funded order to see its fulfillment and money status, the amount verified, the receipt cost, the unused item budget, and the amount due and sent for each component. On a trip order, use **Lihat rekonsiliasi trip** for totals and links to the individual orders. Trip totals include the orders visible to that operator.

The last step, **Unduh CSV**, generates a fresh snapshot for the selected order or trip. Each row contains the order and trip IDs, accepted title, both statuses and whole-rupiah amounts. Text cells are quoted, embedded quotes are doubled, and text starting outside ASCII letters or digits receives an apostrophe to prevent spreadsheet formula evaluation. Each successful generation records the actor, scope, order count, timestamp and SHA-256 of the CSV. The response includes the audit ID in `X-Beetip-Export`. The audit records server generation, including when a response is lost before download.

## Accounting

- Verified incoming funding counts as received. Pending evidence is listed separately. The outstanding balance equals verified incoming funds less completed item reimbursements, jastip fees and refunds. Platform revenue and other disclosed charges are zero in this pilot.
- Due amounts come from receipt allocations and accepted fees or from the latest approved case allocation. Unused item budget is the approved budget less recorded item cost. It can differ from the refund after a dispute or cancellation. Case holds, started transfers and ambiguous transfers are identified within outstanding funds.
- Only completed facts from the BTP-17 synthetic ledger count as sent. Resolving an ambiguous attempt as sent changes the balance. Confirming it was absent releases the reservation without changing completed amounts. The BTP-16 owner-only claim fixture does not count as an outgoing transfer.
- Settlement requires a terminal fulfillment state, exact completion of each required component, zero outstanding and unallocated balance, and no pending funding, open case, or unresolved attempt. Verified funds outside the approved allocation remain outstanding and appear under **Dana tanpa alokasi**. This report has no adjustment command for those funds.

The PRD example settles when Rp70,000 received is matched by Rp55,000 item reimbursement, Rp10,000 jastip fee and Rp5,000 refund. An independently confirmed sibling order can still have amounts held or outstanding.

## Local rehearsal

1. Follow the [disposable Supabase setup](running-beetip.md#start-the-connected-application). Use project ID `beetip_btp18_isolated`, free local ports and the full migration chain through `20261120032656`. Set the exact loopback `APP_ORIGIN`, the loopback Supabase API URL, connected mode, and `BEETIP_SYNTHETIC_TRANSFERS=1` for the app. The application and API require host `127.0.0.1`.
2. Stop any prior app process on the selected port. Start the connected app, for example with `rtk proxy pnpm --filter @beetip/web exec next dev --hostname 127.0.0.1 --port 3118`. Run the two commands below from the repository root. Supply `BEETIP_LOCAL_DATABASE_URL` for disposable loopback PostgreSQL, `BEETIP_TEST_LOCAL_STACK` for the copied Supabase directory, and `BEETIP_TEST_URL` if the app origin differs from `http://127.0.0.1:3118`. Install Playwright Chromium if absent.

```powershell
rtk proxy node scripts/test-btp18-reconciliation.mjs
rtk proxy node scripts/test-btp18-reconciliation-sessions.mjs
```

The SQL harness builds and drops a fresh database. It tests independent handovers and approvals, the PRD and trip totals, partial disputes, both ambiguous outcomes, late funds, export permissions, formula escaping and a transfer completion during export. The browser harness creates disposable accounts, enrolls MFA, checks separate connected sessions and authorization revocation, and verifies the downloaded bytes against their audit hash at a 390px viewport. Stop the disposable stack after the run.

| Interface | Observed red | Green check |
| --- | --- | --- |
| SQL order report | PostgreSQL `42883` for missing `read_reconciliation` | The PRD fixture reports Rp70,000 received, Rp55,000 item reimbursement due, Rp10,000 fee due, and Rp5,000 refund due. |
| SQL export | PostgreSQL `42883` for missing `export_reconciliation` | CSV escapes the formula-shaped title and its SHA-256 matches the private audit row. |
| Connected app | Anonymous export returned HTTP 404 before the route existed | Anonymous export returns 401. MFA and assignment gate the page and download. |
| Connected navigation | The finance link redirected to the account dashboard before the reconciliation page was added to the connected route allowlist | A verified finance operator opens the order and trip views from the finance dashboard. |

The database requires an active finance operator, a verified MFA session and an assigned, enabled synthetic account for each pending or verified submission on the order. An operator cannot access their own order as a participant. The migration adds no account opt-ins. Hosted acceptance, physical Android Chrome and iOS Safari handover acceptance in #17, and approved procedures for late funds and real-money operation remain release gates.
