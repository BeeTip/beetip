# Connected handover

The assigned provider can start delivery for a funded order after shopping is complete and at least one item was purchased. An all-unavailable purchase stays in its purchase outcome. The order detail and list show delivery status, while the purchase section preserves the receipt and item outcome.

The customer checks quantity and condition, then generates a 12-character hexadecimal backup code and an on-device QR. The assigned provider can scan the QR or enter the code using the labeled field. The camera needs a secure context and permission. Manual entry is available throughout.

Each code expires after 60 seconds according to PostgreSQL. A new code immediately replaces the old one and starts a fresh attempt budget. Five incorrect submissions for an active code require a replacement from the customer. Code issuance and confirmation serialize on the same order row. Confirmation updates the challenge, order state, and audit in one transaction. Shipment and receipt do not release funds or change simulated funding balances.

The issuance response is private and uncached. The interface holds the code and QR in memory. The mutation API hashes the submitted code before calling PostgreSQL. PostgreSQL stores a separate salted hash bound to the order and both participants. Audit records contain actor, order, event, and a fixed reason for authorized confirmation rejections. Requests from unauthorized callers receive a generic permission response. Keep handover bodies, RPC payloads, screenshots and traces out of operational logging and test artifacts.

## Verification

- Run `rtk proxy node scripts/test-btp15-handover.mjs` against disposable loopback PostgreSQL with `BEETIP_LOCAL_DATABASE_URL`. CI runs this SQL suite with platform stand-ins.
- Run `rtk proxy node scripts/test-btp15-handover-sessions.mjs` with `BEETIP_TEST_LOCAL_STACK` pointing to an isolated Supabase CLI work directory and `BEETIP_TEST_URL` pointing to the matching connected loopback app. Apply all migrations and configure the app with the local receipt storage secret before running. The test creates synthetic users, receipts and orders on that stack. Set `BEETIP_TEST_APP_LOG` to scan the local app log for test codes.
- Physical Android and iOS camera acceptance is separate. On each device, use two participant sessions to exercise camera permission, rear-camera scanning, stopping the camera, and manual fallback after denial. Use synthetic orders and keep active codes out of captured evidence.
