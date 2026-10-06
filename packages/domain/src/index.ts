export type ErrorCode = "VALIDATION" | "PERMISSION" | "CONFLICT" | "EXPIRED" | "INVALID_STATE";
export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };
export type Member = { id: string; name: string; verified: boolean; admin: boolean };
export type Listing = {
  id: string; ownerId: string; type: "request" | "trip"; title: string; shop: string;
  category: "Makanan" | "Minuman" | "Belanja"; area: string; window: string; cutoff: number;
  budget: number; fee: number; negotiable: boolean; bound: number; capacity: number;
  spendingCapacity: number; item: string; quantity: number; closed: boolean;
};
export type Offer = { id: string; listingId: string; authorId: string; fee: number; budget: number; item: string; quantity: number; destination: string; window: string; status: "active" | "withdrawn" | "accepted" };
export type Fulfillment = "awaiting_payment" | "ready_to_purchase" | "purchasing" | "approval_required" | "purchased" | "delivering" | "delivery_confirmed" | "cancelled";
export type Funding = { id: string; amount: number; reference: string; status: "pending" | "verified"; verifiedBy?: string };
export type Transfer = { id: string; kind: "payout" | "refund"; amount: number; reference: string; status: "review" | "ready" | "ambiguous" | "completed"; createdBy: string; reviewedBy?: string };
export type Receipt = { key: string; reference: string; line: string; amount: number };
export type Amendment = { item: string; budget: number; reason: string; status: "pending" | "approved" | "rejected" };
export type Order = {
  id: string; listingId: string; customerId: string; providerId: string;
  terms: Readonly<{ title: string; item: string; quantity: number; budget: number; fee: number; destination: string; window: string }>;
  budget: number; approvedItem: string; state: Fulfillment; createdAt: number; reservationUntil: number;
  funding: Funding[]; receipts: Receipt[]; transfers: Transfer[]; amendment?: Amendment;
  dispute?: { reason: string; openedBy: string; resolvedBy?: string; resolution?: string };
  confirmation?: { code: string; expiresAt: number; attempts: number; used: boolean };
  retiredCodes?: string[];
  confirmedBy?: string; confirmedAt?: number; cancellationRequested?: string;
  ratings: { authorId: string; score: number; feedback: string }[];
};
export type Message = { id: string; orderId: string; authorId: string; text: string; at: number };
export type Audit = { operationId: string; actorId: string; type: string; targetId: string; resultId?: string; at: number; detail: string };
export type State = { version: 1; members: Member[]; listings: Listing[]; offers: Offer[]; orders: Order[]; messages: Message[]; audit: Audit[]; operations: string[] };
export type Command =
  | { type: "createListing"; listing: Omit<Listing, "id" | "ownerId" | "closed"> }
  | { type: "offer"; listingId: string; fee: number; budget: number; item: string; quantity: number; destination: string; window: string }
  | { type: "withdraw"; offerId: string }
  | { type: "accept"; offerId: string }
  | { type: "submitFunding"; orderId: string; amount: number; reference: string }
  | { type: "verifyFunding"; orderId: string; fundingId: string }
  | { type: "startPurchase"; orderId: string }
  | { type: "amend"; orderId: string; item: string; budget: number; reason: string }
  | { type: "answerAmendment"; orderId: string; approve: boolean }
  | { type: "purchase"; orderId: string; amount: number; reference: string; line: string }
  | { type: "deliver"; orderId: string }
  | { type: "generateCode"; orderId: string; checked: boolean }
  | { type: "confirm"; orderId: string; code: string }
  | { type: "dispute"; orderId: string; reason: string }
  | { type: "resolveDispute"; orderId: string; reason: string }
  | { type: "cancel"; orderId: string; reason: string }
  | { type: "resolveCancellation"; orderId: string; reason: string }
  | { type: "createTransfer"; orderId: string; kind: "payout" | "refund"; reference: string }
  | { type: "reviewTransfer"; orderId: string; transferId: string }
  | { type: "recordTransfer"; orderId: string; transferId: string; outcome: "completed" | "ambiguous" | "not_sent" }
  | { type: "message"; orderId: string; text: string }
  | { type: "rate"; orderId: string; score: number; feedback: string }
  | { type: "verifyMember"; memberId: string };

export interface ApplicationService {
  queryListings(): Listing[];
  queryOffers(listingId: string): Result<Offer[]>;
  queryOrder(orderId: string): Result<Order>;
  queryOrders(): Order[];
  queryMessages(orderId: string): Result<Message[]>;
  execute(command: Command, operationId: string): Result<string>;
  exportLedger(): Result<string>;
}

const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, code, message });
const success = <T>(value: T): Result<T> => ({ ok: true, value });
const money = (n: number) => Number.isSafeInteger(n) && n >= 0;
const text = (s: string) => typeof s === "string" && s.trim().length > 0 && s.length <= 1000;
export const formatIDR = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
export const stateLabels: Record<Fulfillment, string> = {
  awaiting_payment: "Menunggu pembayaran", ready_to_purchase: "Siap dibeli", purchasing: "Sedang dibeli",
  approval_required: "Perlu persetujuan", purchased: "Sudah dibeli", delivering: "Dalam perjalanan", delivery_confirmed: "Diterima", cancelled: "Dibatalkan",
};
export function totals(order: Order) {
  const received = order.funding.filter(f => f.status === "verified").reduce((a, f) => a + f.amount, 0);
  const cost = order.receipts.reduce((a, r) => a + r.amount, 0);
  const paidOut = order.transfers.filter(t => t.kind === "payout" && t.status === "completed").reduce((a, t) => a + t.amount, 0);
  const refunded = order.transfers.filter(t => t.kind === "refund" && t.status === "completed").reduce((a, t) => a + t.amount, 0);
  const entitlement = order.state === "cancelled" ? cost : order.state === "delivery_confirmed" ? cost + order.terms.fee : 0;
  const refundDue = order.state === "cancelled" ? Math.max(0, received - cost) : order.state === "delivery_confirmed" ? Math.max(0, received - cost - order.terms.fee) : 0;
  return { received, cost, paidOut, refunded, entitlement, refundDue, outstanding: received - paidOut - refunded, settled: ["cancelled", "delivery_confirmed"].includes(order.state) && !order.dispute && !order.funding.some(f => f.status === "pending") && received === paidOut + refunded };
}

export class DemoService implements ApplicationService {
  constructor(public state: State, public actorId: string, private now = Date.now, private randomCode = () => {
    const values = new Uint32Array(1); crypto.getRandomValues(values); return String(100000 + values[0] % 900000);
  }) {}
  private get actor() { return this.state.members.find(m => m.id === this.actorId); }
  private allowed(order: Order) { return !!this.actor && (this.actor.admin || [order.customerId, order.providerId].includes(this.actorId)); }
  queryListings() { return this.state.listings.map(l => ({ ...l })); }
  queryOffers(listingId: string): Result<Offer[]> {
    const listing = this.state.listings.find(l => l.id === listingId);
    if (!listing) return fail("VALIDATION", "Listing tidak ditemukan.");
    return success(structuredClone(this.state.offers.filter(o => o.listingId === listingId && (listing.ownerId === this.actorId || o.authorId === this.actorId || this.actor?.admin))));
  }
  queryOrder(id: string): Result<Order> {
    const order = this.state.orders.find(o => o.id === id);
    if (!order || !this.allowed(order)) return fail("PERMISSION", "Pesanan hanya dapat diakses peserta dan administrator.");
    const copy = structuredClone(order);
    if (copy.confirmation && this.actorId !== order.customerId) copy.confirmation.code = "";
    copy.retiredCodes = undefined;
    return success(copy);
  }
  queryOrders() { return this.state.orders.filter(o => this.allowed(o)).map(o => { const result = this.queryOrder(o.id); if (!result.ok) throw new Error(result.message); return result.value; }); }
  queryMessages(orderId: string): Result<Message[]> { const order = this.queryOrder(orderId); return order.ok ? success(structuredClone(this.state.messages.filter(m => m.orderId === orderId))) : order; }
  execute(command: Command, operationId: string): Result<string> {
    if (!text(operationId)) return fail("VALIDATION", "Referensi operasi diperlukan.");
    if (!this.actor || (!this.actor.verified && !this.actor.admin)) return fail("PERMISSION", "Verifikasi anggota diperlukan sebelum transaksi.");
    if (this.state.operations.includes(operationId)) {
      const prior = this.state.audit.find(a => a.operationId === operationId);
      return prior?.actorId === this.actorId && prior.type === command.type && (!("orderId" in command) || prior.targetId === command.orderId) ? success(prior.resultId ?? prior.targetId) : fail("CONFLICT", "Referensi operasi sudah digunakan.");
    }
    const backup = structuredClone(this.state);
    this.expireReservations();
    const result = this.apply(command, operationId);
    if (result.ok) {
      this.state.operations.push(operationId);
      this.state.audit.push({ operationId, actorId: this.actorId, type: command.type, targetId: "orderId" in command ? command.orderId : result.value, resultId: result.value, at: this.now(), detail: "reason" in command ? command.reason : command.type });
    } else if (command.type !== "confirm") {
      Object.assign(this.state, backup);
      this.expireReservations();
    } else {
      this.state.audit.push({ operationId: `${operationId}-failed`, actorId: this.actorId, type: "confirmationRejected", targetId: command.orderId, at: this.now(), detail: result.code });
    }
    return result;
  }
  expireReservations() {
    for (const order of this.state.orders) if (order.state === "awaiting_payment" && order.reservationUntil <= this.now() && !order.funding.some(f => f.status === "verified")) {
      order.state = "cancelled";
      this.state.audit.push({ operationId: `expiry-${order.id}`, actorId: "system", type: "reservationExpired", targetId: order.id, at: this.now(), detail: "Reservasi tanpa pembayaran berakhir." });
      const listing = this.state.listings.find(l => l.id === order.listingId);
      if (listing?.type === "request" && listing.cutoff > this.now()) listing.closed = false;
    }
  }
  private apply(c: Command, id: string): Result<string> {
    if (c.type === "verifyMember") {
      if (!this.actor?.admin) return fail("PERMISSION", "Administrator diperlukan.");
      const member = this.state.members.find(m => m.id === c.memberId);
      if (!member) return fail("VALIDATION", "Anggota tidak ditemukan.");
      member.verified = true; return success(member.id);
    }
    if (c.type === "createListing") {
      const l = c.listing;
      if (![l.title, l.shop, l.area, l.window, l.item].every(text) || ![l.budget, l.fee, l.bound, l.spendingCapacity].every(money) || l.budget > 150000 || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 50 || !Number.isInteger(l.capacity) || l.capacity < 1 || l.capacity > 3 || !Number.isFinite(l.cutoff) || l.cutoff <= this.now() || (l.type !== "trip" && l.type !== "request") || !["Makanan", "Minuman", "Belanja"].includes(l.category)) return fail("VALIDATION", "Periksa rincian, batas Rp150.000, waktu, dan kapasitas 1–3 pelanggan.");
      if (l.negotiable && (l.type === "request" ? l.bound < l.fee : l.bound > l.fee)) return fail("VALIDATION", "Batas negosiasi bertentangan dengan ongkos.");
      this.state.listings.push({ ...l, id, ownerId: this.actorId, closed: false }); return success(id);
    }
    if (c.type === "offer") {
      const l = this.state.listings.find(l => l.id === c.listingId);
      if (!l || l.closed || l.cutoff <= this.now()) return fail("EXPIRED", "Listing sudah ditutup atau berakhir.");
      if (l.ownerId === this.actorId) return fail("PERMISSION", "Tidak dapat menawarkan pada listing sendiri.");
      if (![c.fee, c.budget].every(money) || c.budget > 150000 || ![c.item, c.destination, c.window].every(text) || !Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > 50 || (l.type === "request" && (c.budget !== l.budget || c.item !== l.item || c.quantity !== l.quantity))) return fail("VALIDATION", "Item, tujuan, kuantitas, atau anggaran tidak valid.");
      if (!l.negotiable ? c.fee !== l.fee : l.type === "request" ? c.fee > l.bound : c.fee < l.bound) return fail("VALIDATION", "Ongkos tidak sesuai harga tetap atau batas negosiasi.");
      const previous = this.state.offers.find(o => o.listingId === l.id && o.authorId === this.actorId && o.status === "active");
      if (previous) { Object.assign(previous, c); return success(previous.id); }
      this.state.offers.push({ ...c, id, authorId: this.actorId, status: "active" }); return success(id);
    }
    if (c.type === "withdraw" || c.type === "accept") {
      const offer = this.state.offers.find(o => o.id === c.offerId);
      if (!offer || offer.status !== "active") return fail("CONFLICT", "Penawaran tidak aktif.");
      const l = this.state.listings.find(l => l.id === offer.listingId)!;
      if (c.type === "withdraw") {
        if (offer.authorId !== this.actorId) return fail("PERMISSION", "Hanya pembuat dapat menarik penawaran.");
        offer.status = "withdrawn"; return success(offer.id);
      }
      if (l.ownerId !== this.actorId) return fail("PERMISSION", "Hanya pemilik listing dapat menerima.");
      if (l.closed || l.cutoff <= this.now()) return fail("EXPIRED", "Listing tidak tersedia.");
      if (!this.state.members.find(m => m.id === offer.authorId)?.verified) return fail("PERMISSION", "Peserta belum terverifikasi.");
      const active = this.state.orders.filter(o => o.listingId === l.id && o.state !== "cancelled");
      if (active.length >= (l.type === "request" ? 1 : l.capacity) || active.reduce((n, o) => n + (o.amendment?.status === "pending" ? o.amendment.budget : o.budget), 0) + offer.budget > l.spendingCapacity) return fail("CONFLICT", "Kapasitas pelanggan atau dana trip tidak mencukupi.");
      const order: Order = { id, listingId: l.id, customerId: l.type === "request" ? l.ownerId : offer.authorId, providerId: l.type === "request" ? offer.authorId : l.ownerId, terms: { title: l.title, item: offer.item, quantity: offer.quantity, budget: offer.budget, fee: offer.fee, destination: l.type === "request" ? l.area + " · Lobby kampus (demo)" : offer.destination, window: offer.window }, budget: offer.budget, approvedItem: offer.item, state: "awaiting_payment", createdAt: this.now(), reservationUntil: this.now() + 900000, funding: [], receipts: [], transfers: [], ratings: [] };
      this.state.orders.push(order); offer.status = "accepted"; if (l.type === "request") l.closed = true; return success(id);
    }
    const order = this.state.orders.find(o => "orderId" in c && o.id === c.orderId);
    if (!order || !this.allowed(order)) return fail("PERMISSION", "Pesanan hanya dapat diakses peserta dan administrator.");
    const customer = order.customerId === this.actorId;
    const provider = order.providerId === this.actorId;
    const admin = !!this.actor?.admin;
    const t = totals(order);
    const permission = () => fail("PERMISSION", "Peran ini tidak dapat melakukan tindakan tersebut.");
    const invalid = () => fail("INVALID_STATE", "Tindakan tidak tersedia pada status pesanan ini.");
    if (order.cancellationRequested && ["startPurchase", "amend", "purchase", "deliver", "generateCode", "confirm"].includes(c.type)) return invalid();
    const receiptStates = ["purchasing", "ready_to_purchase", "approval_required"];
    switch (c.type) {
      case "submitFunding":
        if (!customer) return permission();
        if (!["awaiting_payment", "ready_to_purchase", "purchasing", "approval_required"].includes(order.state)) return invalid();
        if (!money(c.amount) || c.amount <= 0 || !text(c.reference) || this.state.orders.some(o => o.funding.some(f => f.reference === c.reference)) || order.funding.reduce((n, f) => n + f.amount, 0) + c.amount > order.budget + order.terms.fee) return fail("VALIDATION", "Jumlah atau referensi pembayaran tidak valid / sudah digunakan.");
        order.funding.push({ id, amount: c.amount, reference: c.reference, status: "pending" }); break;
      case "verifyFunding": {
        if (!admin) return permission();
        const funding = order.funding.find(f => f.id === c.fundingId);
        if (!funding || funding.status !== "pending") return invalid();
        funding.status = "verified"; funding.verifiedBy = this.actorId;
        if (order.state !== "cancelled" && totals(order).received >= order.budget + order.terms.fee && order.amendment?.status !== "pending") order.state = "ready_to_purchase";
        break;
      }
      case "startPurchase":
        if (!provider) return permission();
        if (order.state !== "ready_to_purchase" || t.received < order.budget + order.terms.fee || order.dispute) return invalid();
        order.state = "purchasing"; break;
      case "amend": {
        if (!provider) return permission();
        if (!receiptStates.includes(order.state) || order.receipts.length || order.amendment?.status === "pending" || order.dispute) return invalid();
        if (!text(c.item) || !text(c.reason) || !money(c.budget) || c.budget < order.budget || c.budget > 150000) return fail("VALIDATION", "Item, alasan, atau anggaran tambahan tidak valid.");
        const listing = this.state.listings.find(l => l.id === order.listingId)!;
        const reserved = this.state.orders.filter(o => o.listingId === order.listingId && o.state !== "cancelled").reduce((n, o) => n + (o.amendment?.status === "pending" ? o.amendment.budget : o.budget), 0);
        if (reserved - order.budget + c.budget > listing.spendingCapacity) return fail("CONFLICT", "Anggaran tambahan melebihi kapasitas trip.");
        order.amendment = { item: c.item, budget: c.budget, reason: c.reason, status: "pending" }; order.state = "approval_required"; break;
      }
      case "answerAmendment":
        if (!customer) return permission();
        if (order.amendment?.status !== "pending") return invalid();
        order.amendment.status = c.approve ? "approved" : "rejected";
        if (c.approve) { order.budget = order.amendment.budget; order.approvedItem = order.amendment.item; }
        order.state = t.received >= order.budget + order.terms.fee ? "ready_to_purchase" : "approval_required"; break;
      case "purchase": {
        if (!provider) return permission();
        if (order.state !== "purchasing" || t.received < order.budget + order.terms.fee || order.dispute || order.amendment?.status === "pending") return invalid();
        if (!money(c.amount) || c.amount <= 0 || c.amount + t.cost > order.budget || !text(c.reference) || !text(c.line)) return fail("VALIDATION", "Biaya harus sesuai anggaran dan didukung alokasi struk.");
        const key = `${c.reference.trim()}:${c.line.trim()}`;
        if (this.state.orders.some(o => o.receipts.some(r => r.key === key))) return fail("CONFLICT", "Baris struk sudah dialokasikan ke pesanan.");
        order.receipts.push({ key, reference: c.reference, line: c.line, amount: c.amount }); order.state = "purchased"; break;
      }
      case "deliver":
        if (!provider) return permission();
        if (order.state !== "purchased" || order.dispute) return invalid();
        order.state = "delivering"; break;
      case "generateCode": {
        if (!customer) return permission();
        if (order.state !== "delivering" || order.dispute || !c.checked) return invalid();
        let code = this.randomCode();
        const existing = new Set(this.state.orders.flatMap(o => [...(o.retiredCodes ?? []), ...(o.confirmation ? [o.confirmation.code] : [])]));
        while (existing.has(code)) code = String(100000 + (Number(code) - 100000 + 1) % 900000);
        if (order.confirmation) order.retiredCodes = [...(order.retiredCodes ?? []), order.confirmation.code];
        order.confirmation = { code, expiresAt: this.now() + 60000, attempts: 0, used: false }; break;
      }
      case "confirm": {
        if (!provider) return permission();
        const token = order.confirmation;
        if (order.state !== "delivering" || order.dispute || !token || token.used) return invalid();
        if (token.expiresAt <= this.now() || token.attempts >= 5) return fail("EXPIRED", "Kode berakhir. Pelanggan perlu membuat kode baru.");
        token.attempts++;
        if (c.code !== token.code) return fail("VALIDATION", "Kode tidak sesuai pesanan.");
        token.used = true; order.state = "delivery_confirmed"; order.confirmedBy = this.actorId; order.confirmedAt = this.now(); break;
      }
      case "dispute":
        if (!customer && !provider) return permission();
        if (!text(c.reason) || order.dispute || t.settled || order.state === "cancelled") return invalid();
        order.dispute = { reason: c.reason, openedBy: this.actorId }; break;
      case "resolveDispute":
        if (!admin) return permission();
        if (!order.dispute || !text(c.reason)) return invalid();
        this.state.audit.push({ operationId: `${id}-resolution`, actorId: this.actorId, type: "disputeResolution", targetId: order.id, at: this.now(), detail: c.reason });
        order.dispute = undefined; break;
      case "cancel":
        if (!customer && !provider) return permission();
        if (["cancelled", "delivery_confirmed"].includes(order.state) || !text(c.reason)) return invalid();
        if (["purchasing", "purchased", "delivering"].includes(order.state) || order.receipts.length) { order.cancellationRequested = c.reason; break; }
        order.state = "cancelled"; order.confirmation = undefined; break;
      case "resolveCancellation":
        if (!admin) return permission();
        if (!order.cancellationRequested || !text(c.reason)) return invalid();
        order.state = "cancelled"; order.confirmation = undefined; order.cancellationRequested = undefined; break;
      case "createTransfer": {
        if (!admin) return permission();
        if (order.dispute || order.funding.some(f => f.status === "pending") || !["delivery_confirmed", "cancelled"].includes(order.state)) return invalid();
        if (order.transfers.some(tr => tr.kind === c.kind && tr.status !== "completed")) return fail("CONFLICT", "Transfer masih diproses. Rekonsiliasi sebelum mengulang.");
        if (!text(c.reference) || this.state.orders.some(o => o.transfers.some(tr => tr.reference === c.reference))) return fail("VALIDATION", "Referensi transfer diperlukan dan harus unik.");
        const amount = c.kind === "payout" ? t.entitlement - t.paidOut : t.refundDue - t.refunded;
        if (amount <= 0 || amount > t.outstanding) return invalid();
        const needsReview = c.kind === "refund" || order.state === "cancelled" || this.state.audit.some(a => a.targetId === order.id && a.type === "disputeResolution");
        order.transfers.push({ id, kind: c.kind, amount, reference: c.reference, status: needsReview ? "review" : "ready", createdBy: this.actorId }); break;
      }
      case "reviewTransfer": {
        if (!admin) return permission();
        const transfer = order.transfers.find(t => t.id === c.transferId);
        if (!transfer || transfer.status !== "review") return invalid();
        if (transfer.createdBy === this.actorId) return fail("PERMISSION", "Administrator lain harus meninjau transfer.");
        transfer.reviewedBy = this.actorId; transfer.status = "ready"; break;
      }
      case "recordTransfer": {
        if (!admin) return permission();
        const transfer = order.transfers.find(t => t.id === c.transferId);
        if (!transfer || !["ready", "ambiguous"].includes(transfer.status) || order.dispute) return invalid();
        if (c.outcome === "not_sent" && transfer.status !== "ambiguous") return invalid();
        transfer.status = c.outcome === "not_sent" ? "ready" : c.outcome; break;
      }
      case "message":
        if (!text(c.text)) return fail("VALIDATION", "Pesan maksimal 1.000 karakter.");
        this.state.messages.push({ id, orderId: order.id, authorId: this.actorId, text: c.text.trim(), at: this.now() }); break;
      case "rate":
        if (!customer && !provider) return permission();
        if (order.state !== "delivery_confirmed" || !t.settled || !Number.isInteger(c.score) || c.score < 1 || c.score > 5 || !text(c.feedback) || order.ratings.some(r => r.authorId === this.actorId)) return invalid();
        order.ratings.push({ authorId: this.actorId, score: c.score, feedback: c.feedback }); break;
      default: return invalid();
    }
    return success(c.type === "submitFunding" || c.type === "createTransfer" ? id : order.id);
  }
  exportLedger(): Result<string> {
    if (!this.actor?.admin) return fail("PERMISSION", "Administrator diperlukan untuk ekspor ledger.");
    const rows = [["order", "received", "item_cost", "fee", "platform_fee", "payment_charges", "payout", "refund", "outstanding", "state", "incoming_references", "payout_references", "refund_references"]];
    for (const o of this.state.orders) { const t = totals(o); rows.push([o.id, String(t.received), String(t.cost), String(o.terms.fee), "0", "0", String(t.paidOut), String(t.refunded), String(t.outstanding), o.state, o.funding.filter(f => f.status === "verified").map(f => f.reference).join(" | "), o.transfers.filter(t => t.kind === "payout" && t.status === "completed").map(t => t.reference).join(" | "), o.transfers.filter(t => t.kind === "refund" && t.status === "completed").map(t => t.reference).join(" | ")]); }
    return success(rows.map(r => r.map(v => `"${v.replaceAll('"', '""')}"`).join(",")).join("\r\n"));
  }
}

export function createSeed(now = Date.now()): State {
  const members: Member[] = [
    { id: "customer", name: "Nadia Putri", verified: true, admin: false },
    { id: "provider", name: "Rizky Pratama", verified: true, admin: false },
    { id: "customer2", name: "Salma Aulia", verified: true, admin: false },
    { id: "customer3", name: "Dimas Wijaya", verified: true, admin: false },
    { id: "unverified", name: "Anggota Baru", verified: false, admin: false },
    { id: "admin1", name: "Admin Maya", verified: true, admin: true },
    { id: "admin2", name: "Admin Arif", verified: true, admin: true },
  ];
  const base = { area: "Kampus Alam Sutera", window: "14.30–15.00 WIB", cutoff: now + 86400000, budget: 60000, fee: 10000, negotiable: true, bound: 7000, capacity: 3, spendingCapacity: 450000, item: "Brown Sugar Boba Milk Tea, Large", quantity: 1, closed: false };
  const listings: Listing[] = [
    { ...base, id: "trip-aeon", ownerId: "provider", type: "trip", title: "Titip Chatime", shop: "AEON Mall BSD", category: "Minuman" },
    { ...base, id: "trip-kfc", ownerId: "customer2", type: "trip", title: "Mampir KFC, siapa ikut?", shop: "Summarecon Mall Serpong", category: "Makanan", item: "Paket ayam dan nasi", fee: 7000, bound: 7000, negotiable: false },
    { ...base, id: "trip-indomaret", ownerId: "customer3", type: "trip", title: "Belanja kebutuhan harian", shop: "Indomaret & Miniso", category: "Belanja", item: "Buku catatan dan alat tulis" },
    { ...base, id: "request-coffee", ownerId: "customer", type: "request", title: "Titip kopi untuk kelas sore", shop: "Kopi Kenangan Alam Sutera", category: "Minuman", item: "Es kopi susu, tanpa gula", budget: 30000, bound: 15000, capacity: 1, spendingCapacity: 150000 },
  ];
  const order = (id: string, customerId: string, state: Fulfillment, funded: boolean): Order => ({ id, listingId: "trip-aeon", customerId, providerId: "provider", terms: { title: "Titip Chatime", item: base.item, quantity: 1, budget: 60000, fee: 10000, destination: "Lobby Gedung Kampus Alam Sutera (demo)", window: base.window }, budget: 60000, approvedItem: base.item, state, createdAt: now, reservationUntil: now + 900000, funding: funded ? [{ id: `fund-${id}`, amount: 70000, reference: `DEMO-IN-${id}`, status: "verified", verifiedBy: "admin1" }] : [], receipts: ["purchased", "delivering", "delivery_confirmed"].includes(state) ? [{ key: `STRUK-DEMO:${id}`, reference: "STRUK-DEMO", line: id, amount: 55000 }] : [], transfers: [], ratings: [] });
  return { version: 1, members, listings, offers: [], orders: [order("BTP-001", "customer", "delivering", true), order("BTP-002", "customer2", "ready_to_purchase", true), order("BTP-003", "customer3", "awaiting_payment", false)], messages: [{ id: "msg-1", orderId: "BTP-001", authorId: "provider", text: "Minumannya sudah dibeli. Kita ketemu di lobby ya!", at: now - 300000 }], audit: [], operations: [] };
}
