# Listing moderation and order ratings

## Listing decisions

A platform administrator with an active confirmed account, a verified MFA factor, and an AAL2 session can find a listing by title or ID under **Akun → Moderasi listing**. Each decision requires a reason and records the actor, previous status, new status, listing revision, and time. The listing owner and authors of pending offers receive an in-app notification. The reason stays in the private audit record.

- **Aktif** reopens a listing with a future cutoff, an active owner, and enough unreserved customer and spending capacity for another order. A request that already has an order stays closed.
- **Dijeda** and **Ditutup** hide the listing from public browse and block new agreements. The owner can update the schedule while keeping the moderation status.
- **Dihapus** also blocks owner edits. An administrator can move the listing to a paused or closed state when the owner needs to correct the schedule before reopening.

Moderation, listing edits, offer writes, and acceptance serialize on the listing row. A decision increments the listing revision. Pending offer authors must confirm the current revision after reopening or can withdraw. Existing orders keep their terms, reservation, chat, evidence, fulfillment, and financial workflows.

## Ratings

After confirmed handover, each participant in a connected non-booth order can submit one rating from 1 to 5 and up to 500 characters of optional feedback. Participants can read their own submission on the order. Scores and feedback stay private to their authors through the application. Use the existing support channel to report a safety or service issue. Rating eligibility follows fulfillment, and financial reconciliation continues independently.

## Verification

- Run `node scripts/test-btp19-moderation.mjs` against disposable PostgreSQL with `BEETIP_LOCAL_DATABASE_URL` set to a loopback database. The script creates its own database, applies every migration, and exercises the public RPCs through PostgreSQL role and JWT-claim sessions.
- Run `node scripts/test-btp19-moderation-sessions.mjs` with `BEETIP_TEST_LOCAL_STACK` pointing to a disposable Supabase CLI stack whose project ID is `beetip_btp19_isolated`, and a connected web server at `BEETIP_TEST_URL` (default `http://127.0.0.1:3119`). The script uses independent local Auth sessions and a 390 px Chromium viewport. Its seeded delivery state isolates the browser rating flow. The PostgreSQL harness exercises the handover and synthetic transfer commands.

## Hosted rollout

Apply `20261121002100` on the target database before rehearsing the new screens. Listing reads on the newer app also support databases before this migration. Enable staff use on a candidate that supports the new listing statuses, then confirm public discovery, owner edits, existing orders, and separate staff and member sessions against that candidate.
