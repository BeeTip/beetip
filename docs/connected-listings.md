# Connected listing publishing and browsing

BTP-04 replaces public sample records with real, asynchronous listing projections. Anyone can browse `/` and active listing details without signing in. Email-confirmed, nonsuspended accounts can publish either a request or offered jastip at `/listings/new`, and manage their own records at `/account/listings`. Optional affiliation is not required. Offers, orders, capacity reservations and payments remain later issues.

## Data and authorization

`public.listings` stores structured item names, specifications, quantities and integer IDR unit budgets. The server calculates the total budget, limited to Rp150,000 per customer. Service fee and negotiation bound are separate. Requests have one provider; offered jastip supports up to three customers and a spending capacity up to Rp450,000. Fixed fees require an equal bound; negotiable request bounds are ceilings and offered-jastip bounds are floors.

Schedules have explicit time zones and are stored as timestamps. The UI interprets date/time input and date filters in Asia/Jakarta, independent of the browser's local timezone. Cutoff cannot follow delivery start, delivery end must follow start, cutoff must be in the future when saving, and delivery must be within 90 days. Editing an expired record requires renewing its schedule. Active listings disappear publicly at cutoff; paused, closed and suspended-owner listings are excluded. Owner history still includes those records.

Only an authenticated owner can select base-table rows through RLS. Clients cannot write the table directly. `save_listing` uses a public invoker wrapper and a private, restricted definer command deriving its actor from `auth.uid()`. It independently validates fields, totals, schedules and current identity, checks a live Auth session and suspension, locks updates, checks the expected version, and atomically writes the listing, payload-bound operation receipt and sanitized audit event. Exact concurrent retries return the same ID; changed payloads and stale versions conflict. Failed commands roll back their receipts and audit facts.

The anonymous `browse_listings` projection explicitly selects public fields. It excludes owner UUIDs, exact destinations and all profile/contact/evidence data. The private destination is returned only to the owner API. Public text is rendered as text, with input guidance against entering private addresses or contacts in public fields. No server service credential or whole-dataset export is added. The public projection follows the explicit whitelist approach described in [Supabase's function guidance](https://supabase.com/docs/guides/database/functions); base-row authorization uses [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

Public queries support kind, category, literal title/shop/area search and a WIB delivery-start date. Pages contain at most 20 rows, ordered by immutable creation timestamp and UUID descending; the 21st row determines whether a continuation exists. Both timestamp and UUID form the cursor so tied timestamps cannot skip records. Owner history has the same bounded cursor contract. Changing filters cancels stale requests and restarts pagination. Public read failures show retry; empty results have a separate state. Unknown or expired details show an unavailable state; malformed IDs return 404.

Private pages unmount on account-change storage events, including hidden tabs, and recheck identity on focus, visibility and a 30-second visible-tab timer. Listing writes also bind the expected account through `X-Beetip-Member`; it must match the authenticated actor. This header never grants authority. A lost mutation response retains its operation ID and payload for an exact retry. Users must reconcile through Listing saya before changing an uncertain request. Private responses are uncached.

Events are `listing_published` and `listing_updated`, with actor, operation, target and revision only. Notification delivery remains BTP-10/BTP-11. Changing listing terms does not create an offer, order, funding obligation or capacity reservation.

## Repeat verification

Apply migrations only to the dedicated development project `rgiptdfjlmwldngapojq`. `20261118015931_connected_listings.sql` was applied there and types were generated from that schema. No production database or Auth/mail configuration was changed. The CLI reported a local Docker catalog-cache warning after the successful push; hosted migration read-back verified the applied version.

Run the rollback-only `supabase/tests/connected_listings.sql` through that project's owner SQL connection. With a local connected server and its matching `APP_ORIGIN`, run:

```powershell
$env:BEETIP_TEST_PROJECT_REF = 'rgiptdfjlmwldngapojq'
$env:BEETIP_TEST_URL = 'http://127.0.0.1:3108'
node scripts/test-connected-listings.mjs
node scripts/test-public-catalog.mjs
```

The guarded connected harness creates only synthetic, temporary confirmed/unconfirmed accounts without sending mail. It tests actual Auth sessions, UI publishing/editing, public/private separation, direct API/RPC denial, retries and update races, tied-timestamp pagination, active/cutoff and WIB filters, suspension, provider-outage recovery, three viewport widths, long unbroken public text, and cross-tab logout. It removes only its own listing/user fixtures in `finally`, retaining private operation/audit facts. It does not prove fresh email delivery or real settlement. Captures live under ignored `test-results/btp04/`.

The public harness now defaults to the real board. Use `--samples` only to recheck the historical deployed sample UI. Likewise, staging smoke defaults to the connected projection; `BEETIP_STAGING_CATALOG=samples` explicitly selects the historical deployment contract. These modes prevent future acceptance checks from requiring obsolete sample listings.

Web deployment and owner operating/release decisions remain separate from this implementation. The previously accepted public deployment is not evidence that the new listing UI has been deployed.
