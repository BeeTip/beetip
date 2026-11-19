export type ErrorCode = "VALIDATION" | "PERMISSION" | "CONFLICT" | "EXPIRED" | "INVALID_STATE";
export type Result<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };
export type Member = { id: string; name: string; verified: boolean; admin: boolean };
export type ShoppingItem = { name: string; specification: string; quantity: number; unitBudget: number };
export type Schedule = { start: number; end: number };
export type SupportThread = { id: string; memberId: string; orderId?: string; status: "open" | "resolved"; messages: { authorId: string; text: string; at: number }[] };
export type Listing = {
  id: string; ownerId: string; type: "request" | "trip"; title: string; shop: string;
  category: "Makanan" | "Minuman" | "Belanja"; area: string; window: string; cutoff: number;
  budget: number; fee: number; negotiable: boolean; bound: number; capacity: number;
  spendingCapacity: number; item: string; quantity: number; closed: boolean;
  items?: ShoppingItem[]; schedule?: Schedule; destination?: string; moderation?: "active" | "paused" | "closed" | "removed";
};
export type Offer = { id: string; listingId: string; authorId: string; fee: number; budget: number; item: string; quantity: number; destination: string; window: string; items?: ShoppingItem[]; status: "active" | "withdrawn" | "accepted" };
export type Fulfillment = "awaiting_payment" | "ready_to_purchase" | "purchasing" | "approval_required" | "purchased" | "delivering" | "delivery_confirmed" | "cancelled";
export type Funding = { id: string; amount: number; reference: string; status: "pending" | "verified"; verifiedBy?: string };
export type Transfer = { id: string; kind: "payout" | "refund"; amount: number; reference: string; status: "review" | "ready" | "ambiguous" | "completed"; createdBy: string; reviewedBy?: string };
export type Receipt = { key: string; reference: string; line: string; amount: number };
export type Amendment = { item: string; budget: number; reason: string; status: "pending" | "approved" | "rejected" };
type CancellationAmounts = { purchase: number; fee: number; refund: number };
type CancellationProposal = CancellationAmounts & { id: string; proposedBy: string; reason: string };
export type Order = {
  id: string; listingId: string; customerId: string; providerId: string;
  terms: Readonly<{ title: string; item: string; quantity: number; budget: number; fee: number; destination: string; window: string; items?: ShoppingItem[] }>;
  budget: number; approvedItem: string; state: Fulfillment; createdAt: number; reservationUntil: number;
  funding: Funding[]; receipts: Receipt[]; transfers: Transfer[]; amendment?: Amendment;
  dispute?: { reason: string; openedBy: string; resolvedBy?: string; resolution?: string };
  confirmation?: { code: string; expiresAt: number; attempts: number; used: boolean };
  retiredCodes?: string[];
  confirmedBy?: string; confirmedAt?: number; cancellationRequested?: string;
  cancellationProposal?: CancellationProposal;
  cancellationAllocation?: CancellationAmounts & { reviewedBy?: string; reason: string };
  ratings: { authorId: string; score: number; feedback: string }[];
};
export type Message = { id: string; orderId: string; authorId: string; text: string; at: number };
export type Audit = { operationId: string; actorId: string; type: string; targetId: string; resultId?: string; at: number; detail: string };
export type State = { version: 1 | 2; support?: SupportThread[]; members: Member[]; listings: Listing[]; offers: Offer[]; orders: Order[]; messages: Message[]; audit: Audit[]; operations: string[] };
export type Command =
  | { type: "createListing"; listing: Omit<Listing, "id" | "ownerId" | "closed"> }
  | { type: "offer"; listingId: string; fee: number; budget: number; item: string; quantity: number; destination: string; window: string; items?: ShoppingItem[] }
  | { type: "withdraw"; offerId: string }
  | { type: "accept"; offerId: string }
  | { type: "takeRequest"; listingId: string }
  | { type: "moderateListing"; listingId: string; status: "active" | "paused" | "closed" | "removed"; reason: string; schedule?: Schedule; cutoff?: number }
  | { type: "supportOpen"; orderId?: string; text: string }
  | { type: "supportReply"; threadId: string; text: string }
  | { type: "supportStatus"; threadId: string; status: "open" | "resolved" }
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
  | ({ type: "resolveCancellation"; orderId: string; reason: string } & CancellationAmounts)
  | { type: "approveCancellation"; orderId: string; proposalId: string; reason: string }
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
  querySupport(): SupportThread[];
  execute(command: Command, operationId: string): Result<string>;
  exportLedger(): Result<string>;
}

const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, code, message });
const success = <T>(value: T): Result<T> => ({ ok: true, value });
const money = (n: number) => Number.isSafeInteger(n) && n >= 0;
const text = (s: string) => typeof s === "string" && s.trim().length > 0 && s.length <= 1000;
export const itemBudget = (items: ShoppingItem[]) => items.reduce((sum, item) => sum + item.quantity * item.unitBudget, 0);
export const itemSummary = (items: ShoppingItem[]) => items.map(i => `${i.name}${i.specification ? ` (${i.specification})` : ""} x${i.quantity}`).join(", ");
const validItems = (items: ShoppingItem[]) => items.length > 0 && items.length <= 20 && items.every(i => text(i.name) && typeof i.specification === "string" && i.specification.length <= 500 && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 50 && money(i.unitBudget) && i.unitBudget >= 1000) && itemBudget(items) <= 150000;
export const scheduleLabel = (schedule: Schedule) => `${new Date(schedule.start).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" })}, ${new Date(schedule.start).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} - ${new Date(schedule.end).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" })} WIB`;
export function listingAvailability(listing: Listing, orders: Order[], now: number) {
  if (listing.moderation === "removed") return "Dihapus";
  if (listing.moderation === "paused") return "Dijeda administrator";
  if (listing.moderation === "closed") return "Ditutup administrator";
  if (listing.closed) return "Sudah diterima";
  if (listing.cutoff <= now) return "Waktu berakhir";
  const active = orders.filter(o => o.listingId === listing.id && o.state !== "cancelled");
  if (active.length >= (listing.type === "request" ? 1 : listing.capacity) || active.reduce((sum, o) => sum + (o.amendment?.status === "pending" ? o.amendment.budget : o.budget), 0) >= listing.spendingCapacity) return "Kapasitas penuh";
  return "Tersedia";
}
export function migrateState(state: State): State {
  return { ...structuredClone(state), version: 2, support: state.support ?? [] };
}
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
  const cancellation = order.cancellationAllocation;
  const entitlement = order.state === "cancelled" ? (cancellation ? cancellation.purchase + cancellation.fee : cost)
    : order.state === "delivery_confirmed" ? cost + order.terms.fee : 0;
  const refundDue = order.state === "cancelled" ? cancellation?.refund ?? Math.max(0, received - cost)
    : order.state === "delivery_confirmed" ? Math.max(0, received - cost - order.terms.fee) : 0;
  return { received, cost, paidOut, refunded, entitlement, refundDue, outstanding: received - paidOut - refunded, settled: ["cancelled", "delivery_confirmed"].includes(order.state) && !order.dispute && !order.funding.some(f => f.status === "pending") && received === paidOut + refunded };
}

export class DemoService implements ApplicationService {
  constructor(public state: State, public actorId: string, private now = Date.now, private randomCode = () => {
    const values = new Uint32Array(1); crypto.getRandomValues(values); return String(100000 + values[0] % 900000);
  }) {}
  private get actor() { return this.state.members.find(m => m.id === this.actorId); }
  private allowed(order: Order) { return !!this.actor && (this.actor.admin || [order.customerId, order.providerId].includes(this.actorId)); }
  queryListings() { return this.state.listings.filter(l => l.moderation !== "removed" || l.ownerId === this.actorId || this.actor?.admin).map(l => { const copy = structuredClone(l); if (l.ownerId !== this.actorId && !this.actor?.admin) delete copy.destination; return copy; }); }
  querySupport() { return structuredClone((this.state.support ?? []).filter(t => t.memberId === this.actorId || this.actor?.admin)); }
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
    if (!this.actor || (!this.actor.verified && !this.actor.admin && !command.type.startsWith("support"))) return fail("PERMISSION", "Verifikasi anggota diperlukan sebelum transaksi.");
    if (this.state.operations.includes(operationId)) {
      const prior = this.state.audit.find(a => a.operationId === operationId);
      return prior?.actorId === this.actorId && prior.type === command.type && (!("orderId" in command) || !command.orderId || prior.targetId === command.orderId) && (!("listingId" in command) || prior.targetId === command.listingId) && (!("threadId" in command) || prior.targetId === command.threadId) ? success(prior.resultId ?? prior.targetId) : fail("CONFLICT", "Referensi operasi sudah digunakan.");
    }
    const backup = structuredClone(this.state);
    this.expireReservations();
    const result = this.apply(command, operationId);
    if (result.ok) {
      this.state.operations.push(operationId);
      this.state.audit.push({ operationId, actorId: this.actorId, type: command.type, targetId: "orderId" in command && command.orderId ? command.orderId : "listingId" in command ? command.listingId : "threadId" in command ? command.threadId : result.value, resultId: result.value, at: this.now(), detail: "reason" in command ? command.reason : command.type });
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
  private createOrder(l: Listing, offer: Offer, id: string): Result<string> {
    const order: Order = { id, listingId: l.id, customerId: l.type === "request" ? l.ownerId : offer.authorId, providerId: l.type === "request" ? offer.authorId : l.ownerId, terms: { title: l.title, item: offer.item, quantity: offer.quantity, budget: offer.budget, fee: offer.fee, destination: l.type === "request" ? l.destination ?? l.area : offer.destination, window: offer.window, items: structuredClone(l.type === "request" ? l.items : offer.items) }, budget: offer.budget, approvedItem: offer.item, state: "awaiting_payment", createdAt: this.now(), reservationUntil: this.now() + 900000, funding: [], receipts: [], transfers: [], ratings: [] };
    this.state.orders.push(order); offer.status = "accepted"; if (l.type === "request") l.closed = true; return success(id);
  }
  private apply(c: Command, id: string): Result<string> {
    if (c.type === "supportOpen") {
      if (!text(c.text)) return fail("VALIDATION", "Isi pesan bantuan.");
      if (c.orderId && !this.queryOrder(c.orderId).ok) return fail("PERMISSION", "Pesanan tidak tersedia.");
      this.state.support ??= [];
      const existing = this.state.support.find(t => t.memberId === this.actorId && t.orderId === c.orderId && t.status === "open");
      if (existing) { existing.messages.push({ authorId: this.actorId, text: c.text, at: this.now() }); return success(existing.id); }
      this.state.support.push({ id, memberId: this.actorId, orderId: c.orderId, status: "open", messages: [{ authorId: this.actorId, text: c.text, at: this.now() }] }); return success(id);
    }
    if (c.type === "supportReply" || c.type === "supportStatus") {
      const thread = this.state.support?.find(t => t.id === c.threadId);
      if (!thread || (!this.actor?.admin && thread.memberId !== this.actorId)) return fail("PERMISSION", "Percakapan bantuan tidak tersedia.");
      if (c.type === "supportStatus") { if (!this.actor?.admin || !["open", "resolved"].includes(c.status)) return fail("PERMISSION", "Administrator diperlukan."); thread.status = c.status; }
      else { if (!text(c.text) || thread.status !== "open") return fail("INVALID_STATE", "Percakapan ditutup atau pesan kosong."); thread.messages.push({ authorId: this.actorId, text: c.text, at: this.now() }); }
      return success(thread.id);
    }
    if (c.type === "moderateListing") {
      if (!this.actor?.admin) return fail("PERMISSION", "Administrator diperlukan.");
      const listing = this.state.listings.find(l => l.id === c.listingId);
      if (!listing || !text(c.reason) || !["active", "paused", "closed", "removed"].includes(c.status)) return fail("VALIDATION", "Listing dan alasan diperlukan.");
      if (c.status === "active") {
        if (c.schedule || c.cutoff !== undefined) {
          if (!c.schedule || c.cutoff === undefined || !Number.isFinite(c.cutoff) || !Number.isFinite(c.schedule.start) || !Number.isFinite(c.schedule.end) || c.cutoff <= this.now() || c.schedule.start <= c.cutoff || c.schedule.end <= c.schedule.start || c.schedule.end - c.schedule.start > 86400000) return fail("VALIDATION", "Perbaiki jadwal dan batas penerimaan.");
          listing.schedule = c.schedule; listing.cutoff = c.cutoff; listing.window = scheduleLabel(c.schedule);
        }
        if (listing.cutoff <= this.now() || !listing.schedule || !Number.isFinite(listing.schedule.start) || !Number.isFinite(listing.schedule.end) || listing.schedule.start <= listing.cutoff || listing.schedule.end <= listing.schedule.start) return fail("EXPIRED", "Jadwal baru diperlukan sebelum mengaktifkan listing.");
        const preview = { ...listing, moderation: "active" as const };
        if (listingAvailability(preview, this.state.orders, this.now()) !== "Tersedia") return fail("CONFLICT", "Listing sudah diterima atau kapasitas penuh.");
      }
      listing.moderation = c.status; return success(listing.id);
    }
    if (c.type === "takeRequest") {
      const listing = this.state.listings.find(l => l.id === c.listingId);
      if (!listing || listing.type !== "request" || listing.negotiable) return fail("INVALID_STATE", "Permintaan ini memerlukan penawaran dan persetujuan peminta.");
      if (listing.ownerId === this.actorId || !this.state.members.find(m => m.id === listing.ownerId)?.verified) return fail("PERMISSION", "Diperlukan dua anggota terverifikasi yang berbeda.");
      if (listingAvailability(listing, this.state.orders, this.now()) !== "Tersedia") return fail("CONFLICT", "Permintaan sudah tidak tersedia.");
      if (listing.budget > listing.spendingCapacity) return fail("CONFLICT", "Batas belanja tidak mencukupi.");
      const offer: Offer = { id: `${id}-offer`, listingId: listing.id, authorId: this.actorId, fee: listing.fee, budget: listing.budget, item: listing.item, quantity: listing.quantity, items: listing.items, destination: listing.destination ?? listing.area, window: listing.window, status: "accepted" };
      this.state.offers.push(offer); return this.createOrder(listing, offer, id);
    }
    if (c.type === "verifyMember") {
      if (!this.actor?.admin) return fail("PERMISSION", "Administrator diperlukan.");
      const member = this.state.members.find(m => m.id === c.memberId);
      if (!member) return fail("VALIDATION", "Anggota tidak ditemukan.");
      member.verified = true; return success(member.id);
    }
    if (c.type === "createListing") {
      const l = c.listing;
      if (![l.title, l.shop, l.area, l.window, l.item].every(text) || ![l.budget, l.fee, l.bound, l.spendingCapacity].every(money) || l.budget > 150000 || l.spendingCapacity < l.budget || l.spendingCapacity > 450000 || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 1000 || !Number.isInteger(l.capacity) || l.capacity < 1 || l.capacity > 3 || !Number.isFinite(l.cutoff) || l.cutoff <= this.now() || (l.type !== "trip" && l.type !== "request") || !["Makanan", "Minuman", "Belanja"].includes(l.category)) return fail("VALIDATION", "Periksa rincian, batas Rp150.000, waktu, dan kapasitas 1–3 pelanggan.");
      if (l.items && (!validItems(l.items) || itemBudget(l.items) !== l.budget || itemSummary(l.items) !== l.item || l.items.reduce((n, i) => n + i.quantity, 0) !== l.quantity)) return fail("VALIDATION", "Total rincian barang tidak sesuai.");
      if (l.schedule && (!Number.isFinite(l.schedule.start) || !Number.isFinite(l.schedule.end) || l.schedule.start <= l.cutoff || l.schedule.end <= l.schedule.start || l.schedule.end - l.schedule.start > 86400000)) return fail("VALIDATION", "Waktu penerimaan harus sebelum pengantaran.");
      if (l.destination !== undefined && !text(l.destination)) return fail("VALIDATION", "Isi petunjuk serah terima.");
      if (l.negotiable && (l.type === "request" ? l.bound < l.fee : l.bound > l.fee)) return fail("VALIDATION", "Batas negosiasi bertentangan dengan ongkos.");
      if (l.fee > 150000 || l.bound > 150000) return fail("VALIDATION", "Ongkos jasa maksimal Rp150.000.");
      this.state.listings.push({ ...structuredClone(l), id, ownerId: this.actorId, closed: false, moderation: "active" }); return success(id);
    }
    if (c.type === "offer") {
      const l = this.state.listings.find(l => l.id === c.listingId);
      if (!l || l.closed || l.cutoff <= this.now()) return fail("EXPIRED", "Listing sudah ditutup atau berakhir.");
      if (listingAvailability(l, this.state.orders, this.now()) !== "Tersedia") return fail("CONFLICT", "Listing dijeda, ditutup, atau kapasitas penuh.");
      if (l.ownerId === this.actorId) return fail("PERMISSION", "Tidak dapat menawarkan pada listing sendiri.");
      if (![c.fee, c.budget].every(money) || c.budget > 150000 || ![c.item, c.destination, c.window].every(text) || !Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > 1000 || c.window !== l.window || (l.type === "request" && (c.budget !== l.budget || c.item !== l.item || c.quantity !== l.quantity))) return fail("VALIDATION", "Item, tujuan, kuantitas, atau anggaran tidak valid.");
      if (c.items && (!validItems(c.items) || itemBudget(c.items) !== c.budget || itemSummary(c.items) !== c.item || c.items.reduce((n, i) => n + i.quantity, 0) !== c.quantity)) return fail("VALIDATION", "Total rincian barang tidak sesuai.");
      if (!l.negotiable ? c.fee !== l.fee : l.type === "request" ? c.fee > l.bound : c.fee < l.bound) return fail("VALIDATION", "Ongkos tidak sesuai harga tetap atau batas negosiasi.");
      if (c.fee > 150000 || c.budget < 1000) return fail("VALIDATION", "Periksa ongkos dan batas belanja.");
      const previous = this.state.offers.find(o => o.listingId === l.id && o.authorId === this.actorId && o.status === "active");
      if (previous) { Object.assign(previous, structuredClone(c), { items: l.type === "request" ? structuredClone(l.items) : structuredClone(c.items) }); return success(previous.id); }
      this.state.offers.push({ ...structuredClone(c), items: l.type === "request" ? structuredClone(l.items) : structuredClone(c.items), id, authorId: this.actorId, status: "active" }); return success(id);
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
      if (listingAvailability(l, this.state.orders, this.now()) !== "Tersedia") return fail("CONFLICT", "Listing dijeda, ditutup, atau kapasitas penuh.");
      if (!this.state.members.find(m => m.id === offer.authorId)?.verified) return fail("PERMISSION", "Peserta belum terverifikasi.");
      if (offer.window !== l.window) return fail("CONFLICT", "Jadwal berubah. Anggota perlu mengirim ulang penawaran pada jadwal baru.");
      const active = this.state.orders.filter(o => o.listingId === l.id && o.state !== "cancelled");
      if (active.length >= (l.type === "request" ? 1 : l.capacity) || active.reduce((n, o) => n + (o.amendment?.status === "pending" ? o.amendment.budget : o.budget), 0) + offer.budget > l.spendingCapacity) return fail("CONFLICT", "Kapasitas pelanggan atau dana trip tidak mencukupi.");
      return this.createOrder(l, offer, id);
    }
    const order = this.state.orders.find(o => "orderId" in c && o.id === c.orderId);
    if (!order || !this.allowed(order)) return fail("PERMISSION", "Pesanan hanya dapat diakses peserta dan administrator.");
    const customer = order.customerId === this.actorId;
    const provider = order.providerId === this.actorId;
    const admin = !!this.actor?.admin;
    const t = totals(order);
    const permission = () => fail("PERMISSION", "Peran ini tidak dapat melakukan tindakan tersebut.");
    const invalid = () => fail("INVALID_STATE", "Tindakan tidak tersedia pada status pesanan ini.");
    if (order.cancellationRequested && ["submitFunding", "startPurchase", "amend", "purchase", "deliver", "generateCode", "confirm"].includes(c.type)) return invalid();
    const validCancellation = ({ purchase, fee, refund }: CancellationAmounts) =>
      [purchase, fee, refund].every(money) && purchase <= t.cost && fee <= order.terms.fee
      && (order.receipts.length > 0 || fee === 0) && purchase + fee + refund === t.received;
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
        if (["cancelled", "delivery_confirmed"].includes(order.state) || order.cancellationRequested || order.dispute
          || order.funding.some(f => f.status === "pending") || !text(c.reason)) return invalid();
        if (["purchasing", "purchased", "delivering"].includes(order.state) || order.receipts.length) { order.cancellationRequested = c.reason; break; }
        order.cancellationAllocation = { purchase: 0, fee: 0, refund: t.received, reason: c.reason.trim() };
        order.state = "cancelled"; order.confirmation = undefined; break;
      case "resolveCancellation":
        if (!admin || customer || provider) return permission();
        if (!order.cancellationRequested || !text(c.reason)) return invalid();
        if (!validCancellation(c)) return fail("VALIDATION", "Alokasi harus sesuai struk, ongkos yang disepakati, dan dana terverifikasi.");
        order.cancellationProposal = { id, purchase: c.purchase, fee: c.fee, refund: c.refund, reason: c.reason.trim(), proposedBy: this.actorId };
        return success(id);
      case "approveCancellation": {
        if (!admin || customer || provider) return permission();
        const proposal = order.cancellationProposal;
        if (!order.cancellationRequested || !proposal || proposal.id !== c.proposalId || !text(c.reason)
          || order.funding.some(f => f.status === "pending") || !validCancellation(proposal)) return invalid();
        if (proposal.proposedBy === this.actorId) return fail("PERMISSION", "Administrator lain harus meninjau alokasi.");
        order.cancellationAllocation = { purchase: proposal.purchase, fee: proposal.fee, refund: proposal.refund,
          reviewedBy: this.actorId, reason: c.reason.trim() };
        order.state = "cancelled"; order.confirmation = undefined; order.cancellationRequested = undefined; break;
      }
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
  const schedule = { start: now + 90000000, end: now + 91800000 };
  const base = { area: "Kampus Alam Sutera", window: scheduleLabel(schedule), schedule, cutoff: now + 86400000, budget: 60000, fee: 10000, negotiable: true, bound: 7000, capacity: 3, spendingCapacity: 450000, item: "Brown Sugar Boba Milk Tea, Large", quantity: 1, closed: false };
  const listings: Listing[] = [
    { ...base, id: "trip-aeon", ownerId: "provider", type: "trip", title: "Titip Chatime", shop: "AEON Mall BSD", category: "Minuman" },
    { ...base, id: "trip-kfc", ownerId: "customer2", type: "trip", title: "Mampir KFC, siapa ikut?", shop: "Summarecon Mall Serpong", category: "Makanan", item: "Paket ayam dan nasi", fee: 7000, bound: 7000, negotiable: false },
    { ...base, id: "trip-indomaret", ownerId: "customer3", type: "trip", title: "Belanja kebutuhan harian", shop: "Indomaret & Miniso", category: "Belanja", item: "Buku catatan dan alat tulis" },
    { ...base, id: "request-coffee", ownerId: "customer", type: "request", title: "Titip kopi untuk kelas sore", shop: "Kopi Kenangan Alam Sutera", category: "Minuman", item: "Es kopi susu, tanpa gula", budget: 30000, bound: 15000, capacity: 1, spendingCapacity: 150000 },
    { ...base, id: "request-fixed", ownerId: "customer", type: "request", title: "Tolong belikan roti", shop: "Bakery Alam Sutera", category: "Makanan", item: "Roti cokelat", budget: 20000, negotiable: false, capacity: 1, spendingCapacity: 150000, destination: "Lobby kampus, meja resepsionis" },
  ];
  const order = (id: string, customerId: string, state: Fulfillment, funded: boolean): Order => ({ id, listingId: "trip-aeon", customerId, providerId: "provider", terms: { title: "Titip Chatime", item: base.item, quantity: 1, budget: 60000, fee: 10000, destination: "Lobby Gedung Kampus Alam Sutera (demo)", window: base.window }, budget: 60000, approvedItem: base.item, state, createdAt: now, reservationUntil: now + 900000, funding: funded ? [{ id: `fund-${id}`, amount: 70000, reference: `DEMO-IN-${id}`, status: "verified", verifiedBy: "admin1" }] : [], receipts: ["purchased", "delivering", "delivery_confirmed"].includes(state) ? [{ key: `STRUK-DEMO:${id}`, reference: "STRUK-DEMO", line: id, amount: 55000 }] : [], transfers: [], ratings: [] });
  return { version: 2, support: [], members, listings, offers: [], orders: [order("BTP-001", "customer", "delivering", true), order("BTP-002", "customer2", "ready_to_purchase", true), order("BTP-003", "customer3", "awaiting_payment", false)], messages: [{ id: "msg-1", orderId: "BTP-001", authorId: "provider", text: "Minumannya sudah dibeli. Kita ketemu di lobby ya!", at: now - 300000 }], audit: [], operations: [] };
}
