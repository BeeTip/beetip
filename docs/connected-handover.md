# Connected handover

The assigned provider can start delivery for a funded order after shopping is complete and at least one item was purchased. An all-unavailable purchase stays in its purchase outcome. The order detail and list show delivery status, while the purchase section preserves the receipt and item outcome.

The customer checks quantity and condition, then generates a 12-character hexadecimal backup code and an on-device QR. The assigned provider can scan the QR or enter the code using the labeled field. The camera needs a secure context and permission. Manual entry is available throughout.

Each code expires after 60 seconds according to PostgreSQL. A new code immediately replaces the old one and starts a fresh attempt budget. Five incorrect submissions for an active code require a replacement from the customer. Code issuance and confirmation serialize on the same order row. Confirmation updates the challenge, order state, and audit in one transaction. Shipment and receipt do not release funds or change simulated funding balances.

The customer screen times the display from the start of the issuance request using elapsed browser time. This keeps an incorrect device clock from hiding a fresh code or extending its display. The display can end early by the time it takes for the request to reach PostgreSQL and for PostgreSQL to issue the code.

The issuance response is private and uncached. The interface holds the code and QR in memory. The mutation API hashes the submitted code before calling PostgreSQL. PostgreSQL stores a separate salted hash bound to the order and both participants. Audit records contain actor, order, event, and a fixed reason for authorized confirmation rejections. Requests from unauthorized callers receive a generic permission response. Keep handover bodies, RPC payloads, screenshots and traces out of operational logging and test artifacts.

## Verification

- Run `rtk proxy node scripts/test-btp15-handover.mjs` against disposable loopback PostgreSQL with `BEETIP_LOCAL_DATABASE_URL`. CI runs this SQL suite with platform stand-ins.
- Run `rtk proxy node scripts/test-btp15-handover-sessions.mjs` with `BEETIP_TEST_LOCAL_STACK` pointing to an isolated Supabase CLI work directory and `BEETIP_TEST_URL` pointing to the matching connected loopback app. Apply all migrations and configure the app with the local receipt storage secret before running. The test creates synthetic users, receipts and orders on that stack. Set `BEETIP_TEST_APP_LOG` to scan the local app log for test codes.
- Physical Android and iOS camera acceptance is separate. On each device, use two participant sessions to exercise camera permission, rear-camera scanning, stopping the camera, and manual fallback after denial. Use synthetic orders and keep active codes out of captured evidence.

The independent local rehearsal at `dcaf77b14136ab6228c99aa2381e8e360dcf94e0` passed PostgreSQL 18.1 authorization, expiry, lockout, regeneration, and replay checks. Concurrent confirmations returned one `confirmed` and one `replayed`. Separate customer, provider and unrelated Supabase sessions passed the 390 px layout, accessibility, camera-denial fallback and software QR scan checks. Record physical Android Chrome and iOS Safari camera results and hosted acceptance under [issue #17](https://github.com/BeeTip/beetip/issues/17).

The acceptance rerun at `6ab3391631f3b8011f223b4cba3c751703dcac44` passed both harnesses above. Disposable PostgreSQL 18.1 covered authorization, the 60-second expiry, five-attempt lockout, regeneration, cross-order rejection, concurrent scans, replay, atomic rollback, and sanitized storage. The fresh local Supabase stack used PostgreSQL 17.6 and applied all 25 migrations through `20261119151037`. Three separate Supabase Auth sessions verified the 390 px layout and accessibility, role and origin checks, camera-denial fallback, manual confirmation, software QR scanning, and camera teardown after scanning. The harness found no test codes in the checked order and purchase projections, audit details, or local app log.
