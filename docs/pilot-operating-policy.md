# BeeTip pilot operating policy

The public booth uses synthetic orders. These defaults apply to a future pilot with real participant data and simulated checkout, capped at 50 members, 20 concurrent sessions and 10 active orders. Real payments need separate approval and procedures.

| Data | Retention target |
| --- | --- |
| Order chat and ordinary receipt photos | Up to 90 days after final order resolution and closure of linked cases. |
| Support chat and ordinary case attachments | Up to 90 days after final case closure. |
| Affiliation verification images | Delete as soon as practical after review and within 7 days of a final decision. Keep the decision and minimum audit fields. |
| Abandoned upload drafts and objects | 7 days after the last update. Recheck finalization and holds before deletion. |
| Recovery copies | Keep 7 daily encrypted copies. Reapply verified deletion decisions before reopening a restored service. |

An open dispute or documented legal obligation can hold the minimum necessary data beyond these windows. Record the scope, reason, reviewer and next review date. Re-evaluate expiry when the hold is lifted. The time windows are BeeTip defaults. Handle verified individual requests and applicable legal deadlines separately from scheduled deletion. [Indonesia Personal Data Protection Law, Articles 16 and 42–46](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022?id=fnb)

The BeeTip product owner is accountable for privacy requests and incidents. Use the private support inbox for intake and verify the requester before disclosing data. The product owner or a named backup handles decisions and escalation. A platform administrator uses MFA for session revocation, recovery and other privileged changes. Record decisions and timestamps in a restricted case record. Keep credentials, raw message bodies and receipt photos out of incident logs. Confirm the primary and backup are available before inviting participants.

Use a **24-hour recovery point target** and a **4-hour recovery time target**. Export the database and private objects at least daily and before risky changes. Verify the manifest and object hashes, record the oldest recoverable timestamp across both copies, and treat a missed export as an incident. Measure downtime from detection through database and object restore, application startup, and signed-in checks for orders and private evidence. Restore into an isolated target while keeping the public demo live. [NIST contingency planning guidance](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final) · [Supabase database backup coverage](https://supabase.com/docs/guides/platform/backups)

Before collecting real participant data, verify export and deletion, session revocation, retention and holds in [BTP-20](https://github.com/BeeTip/beetip/issues/22). Confirm the named operators, publish participant-facing privacy terms, and demonstrate the backup schedule and restore procedure for the intended service. These policy targets do not enable purges or change access grants.
