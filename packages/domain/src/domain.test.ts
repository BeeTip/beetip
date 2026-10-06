import { describe, expect, it } from "vitest";
import { createSeed, DemoService, totals, type Command } from "./index";

function setup() {
  let time = 1000000; let counter = 0;
  const state = createSeed(time);
  const service = (actor: string) => new DemoService(state, actor, () => time, () => "123456");
  const run = (actor: string, command: Command, id = `op-${++counter}`) => service(actor).execute(command, id);
  const must = (actor: string, command: Command) => { const result = run(actor, command); expect(result.ok, JSON.stringify(result)).toBe(true); if (!result.ok) throw new Error(result.message); return result.value; };
  return { state, service, run, must, advance: (ms: number) => { time += ms; } };
}

function requestJourney() {
  const h = setup();
  const offerId = h.must("provider", { type: "offer", listingId: "request-coffee", fee: 10000, budget: 30000, item: "Es kopi susu, tanpa gula", quantity: 1, destination: "Lobby demo", window: "14.30" });
  const orderId = h.must("customer", { type: "accept", offerId });
  return { ...h, orderId };
}

describe("marketplace acceptance", () => {
  it("requires verified members and keeps addresses and offers private", () => {
    const h = setup();
    expect(h.run("unverified", { type: "message", orderId: "BTP-001", text: "hello" })).toMatchObject({ ok: false, code: "PERMISSION" });
    expect(h.service("customer2").queryOrder("BTP-001")).toMatchObject({ ok: false, code: "PERMISSION" });
    expect(h.service("customer2").queryMessages("BTP-001")).toMatchObject({ ok: false, code: "PERMISSION" });
    const offerId = h.must("provider", { type: "offer", listingId: "request-coffee", fee: 10000, budget: 30000, item: "Es kopi susu, tanpa gula", quantity: 1, destination: "Lobby demo", window: "14.30" });
    expect(h.service("customer2").queryOffers("request-coffee")).toEqual({ ok: true, value: [] });
    expect(h.service("customer").queryOffers("request-coffee")).toMatchObject({ ok: true, value: [{ id: offerId }] });
  });
  it("enforces fixed fees and bounds", () => {
    const h = setup(); const base = { type: "offer" as const, budget: 30000, item: "Item demo", quantity: 1, destination: "Lobby", window: "14.30" };
    expect(h.run("customer", { ...base, listingId: "trip-kfc", fee: 8000 })).toMatchObject({ code: "VALIDATION" });
    expect(h.run("customer", { ...base, listingId: "trip-aeon", fee: 6000 })).toMatchObject({ code: "VALIDATION" });
    expect(h.run("provider", { ...base, listingId: "request-coffee", item: "Es kopi susu, tanpa gula", fee: 16000 })).toMatchObject({ code: "VALIDATION" });
  });
  it("updates one active offer and permits withdrawal", () => {
    const h = setup(); const c = { type: "offer" as const, listingId: "trip-kfc", fee: 7000, budget: 30000, item: "Ayam", quantity: 1, destination: "Lobby", window: "14.30" };
    const first = h.must("customer", c); expect(h.must("customer", { ...c, budget: 35000 })).toBe(first);
    expect(h.state.offers).toHaveLength(1); h.must("customer", { type: "withdraw", offerId: first }); expect(h.state.offers[0].status).toBe("withdrawn");
  });
  it("prevents two acceptances on one request and preserves snapshot", () => {
    const h = requestJourney(); const initial = structuredClone(h.state.orders.at(-1)!.terms);
    expect(h.run("customer", { type: "accept", offerId: h.state.offers[0].id })).toMatchObject({ code: "CONFLICT" });
    h.state.listings.find(l => l.id === "request-coffee")!.fee = 999;
    expect(h.state.orders.at(-1)!.terms).toEqual(initial);
  });
  it("rejects the last slot and releases an expired reservation", () => {
    const h = setup(); const c = { type: "offer" as const, listingId: "trip-aeon", fee: 10000, budget: 30000, item: "Teh", quantity: 1, destination: "Lobby", window: "14.30" };
    const id = h.must("customer", c); expect(h.run("provider", { type: "accept", offerId: id })).toMatchObject({ code: "CONFLICT" });
    h.advance(900001); h.must("provider", { type: "accept", offerId: id });
    expect(h.state.orders.find(o => o.id === "BTP-003")!.state).toBe("cancelled");
    expect(h.state.audit.filter(a => a.type === "reservationExpired")).toHaveLength(1);
  });
  it("checks trip spending capacity", () => {
    const h = setup(); h.state.listings.find(l => l.id === "trip-kfc")!.spendingCapacity = 20000;
    const id = h.must("customer", { type: "offer", listingId: "trip-kfc", fee: 7000, budget: 30000, item: "Ayam", quantity: 1, destination: "Lobby", window: "14.30" });
    expect(h.run("customer2", { type: "accept", offerId: id })).toMatchObject({ code: "CONFLICT" });
  });
  it("cancels expired pending payments and still reconciles later incoming evidence", () => {
    const h = setup();
    const funding = h.must("customer3", { type: "submitFunding", orderId: "BTP-003", amount: 70000, reference: "DELAYED-IN" });
    h.advance(900001); h.service("admin1").expireReservations();
    expect(h.state.orders[2].state).toBe("cancelled");
    h.must("admin1", { type: "verifyFunding", orderId: "BTP-003", fundingId: funding });
    expect(h.state.orders[2].state).toBe("cancelled");
    expect(totals(h.state.orders[2])).toMatchObject({ received: 70000, refundDue: 70000 });
  });
});

describe("funding, amendments and receipts", () => {
  it("blocks purchase until verification and additional funding", () => {
    const h = requestJourney(); const id = h.orderId;
    expect(h.run("provider", { type: "startPurchase", orderId: id })).toMatchObject({ code: "INVALID_STATE" });
    const fundingId = h.must("customer", { type: "submitFunding", orderId: id, amount: 40000, reference: "IN-1" });
    expect(h.run("provider", { type: "startPurchase", orderId: id })).toMatchObject({ code: "INVALID_STATE" });
    h.must("admin1", { type: "verifyFunding", orderId: id, fundingId }); h.must("provider", { type: "startPurchase", orderId: id });
    h.must("provider", { type: "amend", orderId: id, item: "Kopi besar", budget: 35000, reason: "Harga berubah" });
    expect(h.run("provider", { type: "purchase", orderId: id, amount: 35000, reference: "R", line: "1" })).toMatchObject({ code: "INVALID_STATE" });
    h.must("customer", { type: "answerAmendment", orderId: id, approve: true });
    expect(h.run("provider", { type: "startPurchase", orderId: id })).toMatchObject({ code: "INVALID_STATE" });
    const additional = h.must("customer", { type: "submitFunding", orderId: id, amount: 5000, reference: "IN-2" });
    h.must("admin1", { type: "verifyFunding", orderId: id, fundingId: additional }); h.must("provider", { type: "startPurchase", orderId: id });
    h.must("provider", { type: "purchase", orderId: id, amount: 35000, reference: "R", line: "1" });
    expect(h.state.orders.at(-1)!.terms.budget).toBe(30000);
  });
  it("rejects a substitution without changing agreed item", () => {
    const h = setup(); h.must("provider", { type: "startPurchase", orderId: "BTP-002" });
    h.must("provider", { type: "amend", orderId: "BTP-002", item: "Pengganti", budget: 60000, reason: "Habis" });
    h.must("customer2", { type: "answerAmendment", orderId: "BTP-002", approve: false });
    expect(h.state.orders[1].approvedItem).toBe(h.state.orders[1].terms.item);
  });
  it("prevents overspending and duplicate shared receipt allocations", () => {
    const h = setup(); h.must("provider", { type: "startPurchase", orderId: "BTP-002" });
    expect(h.run("provider", { type: "purchase", orderId: "BTP-002", amount: 60001, reference: "R", line: "1" })).toMatchObject({ code: "VALIDATION" });
    expect(h.run("provider", { type: "purchase", orderId: "BTP-002", amount: 55000, reference: "STRUK-DEMO", line: "BTP-001" })).toMatchObject({ code: "CONFLICT" });
    h.must("provider", { type: "purchase", orderId: "BTP-002", amount: 55000, reference: "STRUK-DEMO", line: "BTP-002" });
  });
});

describe("handover and settlement", () => {
  it("validates role, order, expiry, attempt limits and reuse", () => {
    const h = setup(); h.must("customer", { type: "generateCode", orderId: "BTP-001", checked: true });
    expect(h.service("provider").queryOrder("BTP-001")).toMatchObject({ value: { confirmation: { code: "" } } });
    expect(h.run("customer2", { type: "confirm", orderId: "BTP-001", code: "123456" })).toMatchObject({ code: "PERMISSION" });
    expect(h.run("provider", { type: "confirm", orderId: "BTP-002", code: "123456" })).toMatchObject({ code: "INVALID_STATE" });
    for (let i = 0; i < 5; i++) expect(h.run("provider", { type: "confirm", orderId: "BTP-001", code: "000000" })).toMatchObject({ code: "VALIDATION" });
    expect(h.run("provider", { type: "confirm", orderId: "BTP-001", code: "123456" })).toMatchObject({ code: "EXPIRED" });
    h.must("customer", { type: "generateCode", orderId: "BTP-001", checked: true }); h.advance(60001);
    expect(h.run("provider", { type: "confirm", orderId: "BTP-001", code: h.state.orders[0].confirmation!.code })).toMatchObject({ code: "EXPIRED" });
    h.must("customer", { type: "generateCode", orderId: "BTP-001", checked: true });
    const latest = h.state.orders[0].confirmation!.code;
    h.must("provider", { type: "confirm", orderId: "BTP-001", code: latest });
    expect(h.run("provider", { type: "confirm", orderId: "BTP-001", code: "123456" })).toMatchObject({ code: "INVALID_STATE" });
    expect(totals(h.state.orders[0]).paidOut).toBe(0);
  });
  it("invalidates the old code when it is regenerated", () => {
    const h = setup();
    h.must("customer", { type: "generateCode", orderId: "BTP-001", checked: true });
    const old = h.state.orders[0].confirmation!.code;
    h.must("customer", { type: "generateCode", orderId: "BTP-001", checked: true });
    expect(h.state.orders[0].confirmation!.code).not.toBe(old);
    h.must("customer", { type: "generateCode", orderId: "BTP-001", checked: true });
    expect(h.state.orders[0].confirmation!.code).not.toBe(old);
    expect(h.run("provider", { type: "confirm", orderId: "BTP-001", code: old })).toMatchObject({ code: "VALIDATION" });
    expect(h.state.audit.at(-1)?.type).toBe("confirmationRejected");
  });
  it("reconciles the PRD example and safely retries transfers", () => {
    const h = setup(); h.must("customer", { type: "generateCode", orderId: "BTP-001", checked: true }); h.must("provider", { type: "confirm", orderId: "BTP-001", code: "123456" });
    const payout = h.must("admin1", { type: "createTransfer", orderId: "BTP-001", kind: "payout", reference: "OUT" });
    h.must("admin1", { type: "recordTransfer", orderId: "BTP-001", transferId: payout, outcome: "ambiguous" });
    expect(h.run("admin1", { type: "createTransfer", orderId: "BTP-001", kind: "payout", reference: "OUT2" })).toMatchObject({ code: "CONFLICT" });
    const command: Command = { type: "recordTransfer", orderId: "BTP-001", transferId: payout, outcome: "completed" };
    expect(h.run("admin1", command, "same-op").ok).toBe(true); expect(h.run("admin1", command, "same-op").ok).toBe(true);
    expect(h.run("admin1", command)).toMatchObject({ code: "INVALID_STATE" });
    const refund = h.must("admin1", { type: "createTransfer", orderId: "BTP-001", kind: "refund", reference: "REF" });
    expect(h.run("admin1", { type: "reviewTransfer", orderId: "BTP-001", transferId: refund })).toMatchObject({ code: "PERMISSION" });
    h.must("admin2", { type: "reviewTransfer", orderId: "BTP-001", transferId: refund }); h.must("admin2", { type: "recordTransfer", orderId: "BTP-001", transferId: refund, outcome: "completed" });
    expect(totals(h.state.orders[0])).toMatchObject({ received: 70000, cost: 55000, paidOut: 65000, refunded: 5000, outstanding: 0, settled: true });
    expect(h.service("admin1").exportLedger()).toMatchObject({ ok: true });
  });
  it("isolates disputes and requires review of disputed payouts", () => {
    const h = setup(); h.must("customer", { type: "generateCode", orderId: "BTP-001", checked: true }); h.must("provider", { type: "confirm", orderId: "BTP-001", code: "123456" });
    h.must("customer", { type: "dispute", orderId: "BTP-001", reason: "Item salah" });
    expect(h.run("admin1", { type: "createTransfer", orderId: "BTP-001", kind: "payout", reference: "OUT" })).toMatchObject({ code: "INVALID_STATE" });
    h.must("provider", { type: "startPurchase", orderId: "BTP-002" });
    h.must("admin1", { type: "resolveDispute", orderId: "BTP-001", reason: "Kedua pihak menyetujui penyelesaian" });
    const transfer = h.must("admin1", { type: "createTransfer", orderId: "BTP-001", kind: "payout", reference: "OUT" });
    expect(h.state.orders[0].transfers.find(t => t.id === transfer)!.status).toBe("review");
  });
  it("cancels before purchase and reviews cancellation after purchase", () => {
    const h = setup(); h.must("customer2", { type: "cancel", orderId: "BTP-002", reason: "Tidak jadi" });
    expect(totals(h.state.orders[1])).toMatchObject({ refundDue: 70000, entitlement: 0 });
    h.must("customer", { type: "cancel", orderId: "BTP-001", reason: "Tidak bisa hadir" });
    expect(h.state.orders[0].state).toBe("delivering"); h.must("admin1", { type: "resolveCancellation", orderId: "BTP-001", reason: "Biaya item tetap disetujui, ongkos dikembalikan" });
    expect(totals(h.state.orders[0])).toMatchObject({ refundDue: 15000, entitlement: 55000 });
  });
});

describe("three-customer provider journey", () => {
  it("accepts and settles each customer independently", () => {
    const h = setup();
    const trip = h.must("provider", { type: "createListing", listing: { ...h.state.listings[0], title: "Trip baru", cutoff: 99999999 } });
    for (const customer of ["customer", "customer2", "customer3"]) {
      const offer = h.must(customer, { type: "offer", listingId: trip, fee: 10000, budget: 60000, item: "Teh", quantity: 1, destination: "Lobby demo", window: "14.30" });
      const order = h.must("provider", { type: "accept", offerId: offer });
      const funding = h.must(customer, { type: "submitFunding", orderId: order, amount: 70000, reference: `IN-${customer}` });
      h.must("admin1", { type: "verifyFunding", orderId: order, fundingId: funding }); h.must("provider", { type: "startPurchase", orderId: order });
      h.must("provider", { type: "purchase", orderId: order, amount: 55000, reference: "SHARED", line: customer }); h.must("provider", { type: "deliver", orderId: order });
      h.must(customer, { type: "generateCode", orderId: order, checked: true }); h.must("provider", { type: "confirm", orderId: order, code: h.state.orders.find(o => o.id === order)!.confirmation!.code });
      if (customer === "customer2") h.must(customer, { type: "dispute", orderId: order, reason: "Belum lengkap" });
      else {
        const payout = h.must("admin1", { type: "createTransfer", orderId: order, kind: "payout", reference: `OUT-${customer}` }); h.must("admin1", { type: "recordTransfer", orderId: order, transferId: payout, outcome: "completed" });
        const refund = h.must("admin1", { type: "createTransfer", orderId: order, kind: "refund", reference: `REF-${customer}` }); h.must("admin2", { type: "reviewTransfer", orderId: order, transferId: refund }); h.must("admin2", { type: "recordTransfer", orderId: order, transferId: refund, outcome: "completed" });
        h.must(customer, { type: "rate", orderId: order, score: 5, feedback: "Mudah digunakan (demo)" });
      }
    }
    const orders = h.state.orders.filter(o => o.listingId === trip);
    expect(orders).toHaveLength(3); expect(orders.filter(o => totals(o).settled)).toHaveLength(2); expect(orders[1].dispute).toBeDefined();
  });
});
