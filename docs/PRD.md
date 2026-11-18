# BEETIP Product Requirements Document

Version: 0.1, review draft  
Date: 5 October 2026  
Course: Venture Creation  
Launch community: BINUS Alam Sutera students, staff, and employees

## 1. Product definition

Owner access-policy update, 18 November 2026: public browsing and self-service email-confirmed accounts replace mandatory membership approval. Account actions require confirmed email, and staff privileges remain separately scoped. Campus affiliation may later be an optional badge. This decision supersedes mandatory verified-campus access assumptions below. The current scope is sample browsing and open onboarding; see [the access policy](public-onboarding.md).

BEETIP is a two-way community jastip marketplace centered on BINUS Alam Sutera. Members request purchases from nearby shops, restaurants, or malls, or offer to buy and deliver items while already visiting those places. One account can act as customer and provider.

Customers pay the agreed purchase budget and jastip fee before the provider purchases the goods. The provider uses their own money at the shop and receives reimbursement plus their earnings after confirmed delivery. The first real-customer pilot uses supervised manual payment operations, subject to verifying a suitable collection and payout arrangement.

The course deliverables are a business proposal, a prototype, working software, and documented feedback from real customers. The team has approximately five members and no initial development budget. The objective is the earliest credible pilot, rather than a fixed launch date unsupported by team availability.

Status: the core features and pilot business model reflect the founder's decisions. Numeric limits, policy timeframes, pricing experiments, and technical choices below are proposed defaults to review during implementation and testing.

## 2. Problem and value proposition

Customers may want food, drinks, or specific retail items from nearby places but lack time to visit. A member already visiting that location may be willing to deliver the items for a fee. BEETIP makes that existing trip discoverable and gives both parties a structured agreement.

Value proposition: get nearby items through a verified BINUS community member who is already near the shop, with transparent item costs, an agreed jastip fee, and a recorded handover.

USP hypotheses to validate:

1. Existing trips and combined orders can make jastip fees affordable.
2. Two-way listings allow customers to express demand and providers to advertise shopping trips.
3. Structured negotiation lets both parties agree to an acceptable fee.
4. Community verification and transaction evidence can improve confidence between members.
5. Detailed requests support personal items and shops beyond a conventional food menu.

Lower total cost, willingness to advance purchase funds, and improved trust are research hypotheses. Campus affiliation alone does not guarantee reliability. BEETIP does not claim official BINUS endorsement.

## 3. Users and launch boundary

| User | Primary need |
| --- | --- |
| Customer | Request a specific item or join an available shopping trip. |
| Provider | Earn a jastip fee from a trip they can realistically fulfill. |
| Pilot administrator | Verify members, reconcile payments, resolve disputes, and collect feedback. |

Membership is limited to verified BINUS students, staff, and employees. Requesting and fulfillment are available to every verified member. Administrative access is assigned separately.

Delivery covers campus meeting points and nearby apartments, boarding houses, and homes. The initial service area must be configured before the pilot. A proposed starting boundary is a 3 km radius around the campus, adjusted to actual access and travel conditions. Building lobby or entrance handover is the default for residential destinations.

Goods can include food, drinks, groceries, stationery, and everyday retail items. Exclude illegal goods, alcohol, tobacco and vaping products, prescription medicines, weapons, dangerous materials, live animals, cash transfers, and items requiring special handling the pilot cannot provide. Administrators can reject unsuitable listings. These are proposed product restrictions, rather than a complete statement of Indonesian law.

## 4. First-version scope

### Required for the pilot

- Mobile web application with Indonesian interface copy and IDR amounts.
- Community verification and a single account for both roles.
- Request listings and provider trip offers on one board with clear labels.
- Filters for listing type, shop, destination area, category, and delivery time.
- Fixed or negotiable jastip fees, bounds, and competing offers.
- Immediate and scheduled orders.
- Item descriptions, quantities, reference photos or links, and purchase budget.
- Private order chat and structured substitution or price-change approval.
- Multiple customer orders on one provider trip.
- Manual prepayment verification, receipt reconciliation, payout, and refund tracking.
- Separate QR or code confirmation for each order.
- Cancellation, disputes, transaction history, and post-order ratings.
- Administrator interface and pilot feedback collection.

### Deferred

- Live payment gateway integration and automated settlement.
- In-app wallet or stored balance.
- Native mobile applications and continuous location tracking.
- Auctions with public bid rankings, automated dispatch, and route optimization.
- Premium subscriptions, paid promotion, merchant subscriptions, and loyalty points.
- Multi-campus expansion and unrestricted public registration.

## 5. Listing and negotiation requirements

### Customer request

Required fields: item name, quantity, shop or acceptable shop area, purchase estimate, maximum approved item budget, offered jastip fee, delivery area, handover location, requested delivery window, negotiation toggle, and expiry. Optional fields: product photo, reference link, variants, and substitution preferences.

For a negotiable request, the customer specifies the maximum acceptable jastip fee. Providers submit an offered fee and delivery window. For a fixed request, providers accept the posted fee and delivery conditions without changing the price.

### Provider offer

Required fields: shop or shopping location, available item categories, shopping cutoff, delivery window, supported destination areas, jastip fee, negotiation toggle, maximum customer orders, and trip purchase budget capacity. Item prices are estimates until supported by a purchase receipt.

For a negotiable offer, the provider specifies the minimum acceptable jastip fee. Customers submit an item request and proposed fee. For a fixed offer, customers request a slot at the stated fee, and the provider confirms availability before payment.

### Shared rules

- Negotiation changes the jastip fee. Changes to item specifications or purchase budget require explicit agreement.
- Bounds cannot contradict the advertised fee: a customer maximum must be at least the offered fee, and a provider minimum must be no greater than the advertised fee.
- Offer values are visible to their author and listing owner. Other bidders do not see competitors' prices.
- Each user has one active offer per listing, which can be revised or withdrawn before acceptance.
- Acceptance creates an order with a snapshot of price, items, destination, and timing.
- A customer request closes when an offer is accepted. A provider trip remains open until its cutoff or capacity is reached.
- Capacity reservation and acceptance must be atomic, so simultaneous users cannot claim the same final slot.
- Accepted terms cannot be silently edited. A change requires an order amendment accepted by both parties.
- An unpaid reservation expires after a proposed 15 minutes. Administrators can extend it with a recorded reason.

## 6. Customer-request journey

1. The customer verifies membership and publishes a request.
2. Providers review the request and accept fixed terms or submit competing offers.
3. The customer selects a provider and reviews the purchase budget, fee, and delivery window.
4. The order reserves capacity and displays payment instructions.
5. The customer prepays. An administrator verifies the actual incoming payment before authorizing purchase.
6. The provider pays the shop using their own funds and uploads the receipt.
7. Any replacement or higher purchase cost requires customer approval before purchase. An increased budget also requires verified additional payment.
8. The provider delivers the items. The customer checks them and presents the order's confirmation QR or backup code.
9. Successful confirmation makes the order eligible for payout, unless an unresolved dispute blocks it.
10. The administrator reimburses the actual approved item cost and pays the provider's earnings, recording the transfer reference.
11. Any unused purchase budget is refunded to the customer. Both parties can rate the transaction and provide feedback.

## 7. Provider-offer and combined-order journey

1. A provider publishes a shopping trip with cutoff, delivery window, destinations, capacity, and fees.
2. Customers submit item requests at the fixed fee or negotiate within the provider's minimum.
3. The provider accepts each feasible request, creating a separate customer order.
4. Customers prepay separately, and administrators verify each payment.
5. The provider buys only the funded, accepted orders and advances their combined purchase cost.
6. A trip dashboard lists each customer's items, spending limit, receipt allocation, and handover destination.
7. The provider delivers orders individually. Every order has its own confirmation and settlement status.

A proposed initial limit is three customers per trip and Rp150,000 of approved item budget per customer. These are configurable risk limits, not validated demand assumptions. Providers can set a lower trip spending capacity. Accepted orders must fit both customer capacity and the provider's total spending capacity.

Shared receipts must allocate purchased items to their respective orders without reimbursing the same item twice. Shared discounts must be allocated consistently and disclosed. One disputed order must not block settlement of unrelated confirmed orders on the same trip.

## 8. Pricing and business model

The jastip fee includes the provider's shopping effort and delivery. There is no separate mandatory professional-driver payment. Providers are compensated, even while BEETIP's platform fees are waived.

| Component | Definition |
| --- | --- |
| Purchase budget | Customer-approved maximum available for goods. |
| Actual item cost | Approved receipt-supported amount paid at the shop. |
| Jastip fee | Agreed payment for shopping and delivery. |
| Customer platform fee | Future BEETIP fee added to the customer's payment. |
| Provider platform fee | Future BEETIP fee deducted from provider earnings. |
| Payment charges | Actual payment and payout costs, disclosed separately if applicable. |

Pilot customer prepayment = purchase budget + jastip fee. Pilot provider payout = actual approved item cost + jastip fee. Customer refund = unused purchase budget. Any applicable transfer charges must be disclosed before commitment and cannot be silently deducted from item reimbursement.

Future customer payment = purchase budget + jastip fee + customer platform fee + disclosed payment charges. Future provider payout = actual approved item cost + jastip fee - provider platform fee. Future BEETIP gross transaction revenue = customer platform fee + provider platform fee; item reimbursement is not platform revenue.

Both sides will eventually pay a fee. The initial pricing experiment is a percentage of the jastip fee, rather than the item value, to avoid disproportionately charging for expensive goods. Rates remain unapproved. An illustration using 5% on each side would charge the customer Rp500 and deduct Rp500 from provider earnings on a Rp10,000 jastip fee, generating Rp1,000 gross platform revenue before costs. This is an example, not a launch commitment or evidence of profitability.

Example pilot: a customer prepays Rp60,000 for goods and Rp10,000 for jastip. The receipt totals Rp55,000. The provider receives Rp65,000 and the customer receives a Rp5,000 refund.

Premium is a later hypothesis: repeat-order templates, saved shopping lists, advanced trip management, and useful provider analytics. Verification, dispute access, and basic delivery evidence remain available to all members.

Contribution per order must account for payment collection, payout and refund charges, support effort, fraud losses, and infrastructure. Fee-free platform usage does not make transfers or operations costless. BEETIP will not subsidize orders from a nonexistent budget.

## 9. Payment approach and evidence boundary

As checked on 5 October 2026, Midtrans offers integration without setup or subscription fees but charges for successful transactions. Its published QRIS rate is 0.7%, and bank-account payouts are listed at Rp5,000 per transaction, with applicable tax conditions. Xendit's pricing also includes processing and payment-method or payout charges. Neither checked option provides a generally zero-cost live collection-and-payout flow. [Midtrans pricing](https://midtrans.com/pricing), [Xendit pricing](https://www.xendit.co/id/biaya/).

Decision: use a manually supervised pilot for real transactions. Integrated sandbox payments may support demonstrations but are not evidence of real-money settlement. Use the provider's documented test methods for sandbox testing. [Midtrans sandbox documentation](https://docs.midtrans.com/docs/testing-payment-on-sandbox).

Manual payment requirements:

- Identify the receiving account, authorized operator, reconciliation method, refund process, and payout account arrangements before accepting real funds.
- Verify the arrangement's suitability for third-party collections and conditional onward payments. Manual supervision does not by itself establish that the arrangement is permitted.
- Use an order-specific reference and verify actual account records. A customer screenshot alone cannot mark an order paid.
- Track funded amount, receipt cost, refund amount, provider entitlement, and transfer references per order.
- Delivery confirmation changes payout eligibility. Only an actual outgoing transfer can mark payout completed.
- Confirm outgoing transfers against account records; do not repeat an ambiguous payout without checking whether it succeeded.
- Require a second administrator to review refunds, disputed payouts, and exceptional adjustments.
- Do not describe the manual pilot as licensed escrow or offer an in-app balance.

Bank Indonesia identifies payment activities subject to its licensing framework. The specific BEETIP operating arrangement still needs verification; this PRD does not determine its legal classification. [Bank Indonesia payment licensing](https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/perizinan/default.aspx).

If a suitable manual arrangement is unavailable, continue prototype and usability testing with simulated payments. Real-money testing remains blocked until that arrangement is resolved. Gateway collection support must not be assumed to include conditional marketplace payouts or escrow.

## 10. Verification, delivery evidence, and privacy

Verify access to an approved institutional email domain where available. Confirm eligible domains with real pilot participants, including staff. Where email verification is insufficient, an administrator reviews evidence of current affiliation. Institutional email access is an affiliation check, not a guarantee of legal identity or account-holder reliability.

Do not publish student or employee identifiers. Retain only necessary verification evidence with restricted access and a defined deletion period. Membership verification decisions must be auditable.

Public listings show destination areas, not complete home addresses. Reveal exact handover details only to the accepted counterparty. Restrict receipts, chat, contact details, payment evidence, and delivery codes to relevant participants and authorized administrators.

Confirmation requirements:

- Generate a random, order-specific, short-lived token only when the order is ready for handover.
- Show it to the signed-in customer after they choose to confirm receipt; the provider scans it while signed in.
- Validate the token, assigned provider, customer, order state, and expiry on the server.
- Permit a backup code with attempt limits; expire and invalidate tokens after use or regeneration.
- Make retries safe: repeat scans cannot create another confirmation or payout.
- Record who confirmed delivery and when. A QR scan is evidence of handover acknowledgment, not proof of item quality.
- Missing phones or scanner failure require administrator review of both parties' acknowledgment, with a recorded exception.

Customers are prompted to check quantity and condition before confirmation. Administrators can suspend accounts and remove listings. Ratings are limited to completed orders, with one rating per participant and reporting for abuse.

## 11. Order, payment, and trip states

Track fulfillment and money movement separately.

Fulfillment: awaiting payment, ready to purchase, purchasing, approval required, purchased, delivering, delivery confirmed, cancelled.

Payment: unpaid, verification pending, funded, additional funding required, payout eligible, payout in progress, paid out, refund pending, refunded, partially refunded, disputed.

Trip: open, closed to new orders, shopping, delivering, completed, cancelled.

Disputes can arise across relevant order stages and must freeze only the unsettled disputed amount. Every transition records actor and timestamp. Reject invalid or repeated transitions. Do not mark an order fully settled until all required payouts and refunds are reconciled.

## 12. Cancellation and dispute policy

| Situation | Proposed pilot handling |
| --- | --- |
| Unpaid order expires | Cancel and release reserved capacity. |
| Funded order cancelled before purchase | Refund the unspent purchase budget and jastip fee. Disclose any unavoidable external charges. |
| Provider cannot buy the item | Offer an approved substitution or cancel the affected items and refund their unused budget. |
| Customer cancels after approved purchase | Review return options. Receipt-supported, nonreturnable authorized purchases are not automatically refundable; resolve the jastip fee according to work completed and recorded terms. |
| Provider buys an unapproved replacement or exceeds the budget | Customer is not automatically liable for unauthorized spending. Administrator reviews evidence. |
| Wrong, missing, or damaged items | Open a dispute before confirmation where possible, preserve evidence, and pause the affected unsettled payout. |
| Customer does not attend handover | Provider documents contact attempts and waits a proposed 15 minutes at the agreed location. Administrator reviews next steps; no automatic delivery confirmation. |
| Provider misses the delivery window | Notify the customer, request acceptance of revised timing, or escalate cancellation and refund handling. |

Proposed support targets: acknowledge disputes within 24 hours and aim to resolve within 72 hours when evidence is available. Publish staffed operating hours. Display actual support availability rather than claiming continuous coverage.

Customer confirmation normally makes payout eligible. Allow post-confirmation issue reporting within a proposed 24 hours, but explain that already-paid funds may require recovery and are not guaranteed refundable. Do not promise unconditional refunds or insurance. Record outcomes, reasoning, and any partial allocations; participants can request one review by another administrator.

## 13. Working software requirements

Use a responsive web application to minimize installation friction. The framework and hosting provider are implementation decisions. Free-tier eligibility, capacity, storage, email delivery, and expiry conditions must be verified before selecting services; zero-cost hosting is not assumed indefinitely.

Minimum entities: member, verification, listing, item request, offer, trip, order, accepted terms, message, approval, receipt allocation, payment record, delivery confirmation, dispute, rating, and audit event.

Enforce permissions on the server. Keep secrets out of client code. Validate uploads, private file access, IDR amounts, offer bounds, and all state changes. Store money as integer rupiah amounts. Record administrator changes and export the transaction ledger for reconciliation. Log failures without exposing addresses, payment credentials, or confirmation tokens.

Provide loading, empty, failed, and unavailable states. Preserve submitted order data after recoverable failures. Support keyboard access, clear form errors, readable mobile layouts, and code entry when QR scanning is unavailable.

## 14. Acceptance criteria

1. An unverified account cannot transact; a verified member can use both roles.
2. Both listing types can be created, discovered, accepted, and completed.
3. Fixed-price listings reject price changes; negotiated offers obey their bounds.
4. Simultaneous acceptance cannot assign two providers to one request or exceed trip capacity.
5. An order cannot enter purchasing until its customer payment is verified.
6. A price increase or substitution cannot become an approved purchase without explicit consent and sufficient verified funding.
7. The order shows separate item budget, actual item cost, jastip fee, platform fees, refund, and provider payout.
8. A three-customer trip supports separate receipts or allocations, confirmations, disputes, payouts, and refunds.
9. Wrong-user, expired, reused, and wrong-order confirmation codes fail safely.
10. Delivery confirmation cannot itself claim that a real transfer has completed.
11. A dispute blocks the affected unsettled payout while unrelated trip orders can settle.
12. Private addresses and transaction evidence are inaccessible to unrelated accounts.
13. Cancellation and payment retries cannot cause duplicate refunds or payouts.
14. A ledger export reconciles customer payments with provider transfers, refunds, outstanding funds, and disclosed charges.

Validation must cover one complete request journey, one provider-offer journey with several customers, a price-change rejection, unavailable items, cancellations before and after purchase, a dispute, failed handover, and ambiguous transfer recovery. Real payment validation follows the payment readiness gate.

## 15. Pilot and business validation

Proposed pilot recruitment: 15 customers and 5 providers from the verified campus community, with overlapping roles allowed. Target at least 20 completed real orders over two weeks after readiness checks. These are research targets, not traction claims.

Launch with a few known shopping locations and published service hours. Recruit providers who already plan to visit them. Start with capped orders, record support effort, and expand only after reliable settlement and delivery.

Measure:

- Requests receiving an acceptable offer and time to acceptance.
- Accepted orders that become funded and completed.
- On-time delivery, cancellation, dispute, and refund rates.
- Actual item cost, jastip fee, external charges, and total customer cost.
- Provider willingness to advance purchase money, time spent, and earnings per trip.
- Batch size and whether existing trips actually reduce delivery effort.
- Repeat usage, support minutes per order, and payment reconciliation accuracy.
- Willingness to pay customer and provider platform fees.

For cost comparisons, use the same item, shop, destination, and approximate time where a comparable service exists. Record promotions and differences. Where no comparable option exists, report availability separately rather than inventing savings.

Proposed continuation criteria: at least 80% of funded orders completed, at least 80% of completed orders delivered within the agreed window, no unexplained outstanding funds, and enough qualitative evidence that customers value the service and providers accept its economics. The small pilot cannot establish statistically reliable demand or profitability.

## 16. Team responsibilities and delivery sequence

| Responsibility | Suggested owner |
| --- | --- |
| Product, business proposal, and customer interviews | Member 1 |
| Prototype, interface design, and usability | Member 2 |
| Customer and provider web experience | Member 3 |
| Backend, verification, and transaction workflow | Member 4 |
| Administration, QA, reconciliation, and pilot operations | Member 5 |

Roles are flexible. Refund and dispute oversight must have a second reviewer even if administration has one primary owner.

Delivery sequence:

1. Confirm service area, verification method, fund operations, and prohibited-item policy; prepare a clickable prototype and business proposal.
2. Build verification, both boards, negotiation, acceptance, and order chat.
3. Add combined orders, receipt allocation, manual payment records, delivery codes, disputes, and administration.
4. Validate complete journeys with test data and resolve payment readiness blockers.
5. Run the supervised real-customer pilot and document feedback, behavior, costs, and resulting changes.

Do not commit a calendar deadline until team availability and implementation effort are known. Payment readiness and reliable reconciliation are launch dependencies.

## 17. Open decisions and blockers

- Exact service area and accessible campus or residential handover points.
- Approved institutional verification methods for students, staff, and employees.
- Suitable collection and conditional payout arrangement, named account operator, applicable external charges, and refund handling.
- Actual support operating hours and escalation contacts.
- Free-tier infrastructure suitability and capacity.
- Validation of proposed order limits, negotiation defaults, and policy timeframes.
- Future customer and provider fee rates and evidence of willingness to pay.

These do not block prototype development. The payment arrangement blocks acceptance of real customer funds. No software implementation, deployment, user testing, or real transaction has been completed as part of this PRD.

## 18. UX decisions from member testing, 7 October 2026

This section supersedes earlier UI wording and fixed-request selection behavior. Preserve detailed order information and expected arrival. Use Beranda for discovery, Jastip saya for services offered and requests fulfilled, and Pesanan with Saya titip/Saya belikan filters for transaction progress. One verified member account can do both jobs; administrators have additional operational permissions.

Creation starts with Minta dibelikan or Buka jasa titip and progresses through Rincian, Lokasi dan waktu, and Biaya dan tinjauan. Requests have editable item rows, optional specifications, quantities, per-unit maximum prices, and a computed maximum shopping total capped at Rp150,000. Offered jastip collects shop, category, public area, delivery window, fee, and up to three customers; customers provide their item lists. Combined active shopping capacity defaults to Rp450,000 and is separate from the service fee or personal funding.

Delivery uses date/time selectors in WIB with a future acceptance deadline before delivery starts and an end after the start. Exact handover instructions are private. Fixed fees have no editable negotiation fields and cannot be countered through any service command. Negotiation changes only the service fee: customer requests define a maximum and offered jastip defines a minimum. Item/budget amendments remain separate explicit approvals.

The first verified member confirming a fixed-fee customer request receives the order immediately. Negotiable requests require requester approval. Offered jastip requires the service owner to approve the customer's offer. Acceptance checks availability and capacity and must be atomic in the future server implementation. Retry identifiers must not create duplicate orders.

Administrators can pause, close, remove, and reactivate listings with reasons and audit history. These actions stop new offers/acceptances but preserve existing fulfillment and settlement. Reopening requires future valid scheduling and available capacity. Listing status is separate from payment and order status.

Members can contact support from Profile or an order. Support has private persisted conversations, an administrator inbox, replies, and open/resolved status. The current implementation is browser-local and does not deliver across devices. No staffed-hours or response-time promises are implied.

Realtime chat is subsequent backend work: durable messages, authenticated membership, reconnect catch-up, deduplication, unread indicators, recoverable drafts, and delivery failure states. Live maps are also deferred: opt-in active-delivery location sharing, participant-only visibility, stale-location indicators, and location retention limited to 24 hours after delivery/cancellation. Arrival estimates must disclose their basis rather than imply live tracking.

Retest with members without coaching: distinguish the two listing types, explain shopping budgets versus service fees, create a multi-item request, and take a fixed request. Passing automated checks does not replace this user test or establish pilot readiness.
