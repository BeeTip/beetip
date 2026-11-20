"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ConnectedOffer, OfferCommand, OfferListing } from "@beetip/validation";
import { Badge, Button, Empty } from "./ui";
import { ConnectedAcceptance } from "./connected-acceptance";

type Cursor = { before: string; beforeId: string };
const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const time = (value: string) => new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

export function ConnectedOffers({ listingId, memberId }: { listingId?: string; memberId: string }) {
  const [listing, setListing] = useState<OfferListing | null>(null);
  const [offers, setOffers] = useState<ConnectedOffer[]>([]);
  const [next, setNext] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [consent, setConsent] = useState(false);
  const [loadedAt, setLoadedAt] = useState(0);
  const pending = useRef<OfferCommand | null>(null);
  const controller = useRef<AbortController | null>(null);
  const active = offers.find(offer => offer.own && offer.status === "active");
  const load = useCallback(async (cursor?: Cursor) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true); setError("");
    if (!cursor) setReady(false);
    try {
      const params = new URLSearchParams(listingId ? { listingId } : {});
      if (cursor) { params.set("before", cursor.before); params.set("beforeId", cursor.beforeId); }
      const response = await fetch(`/api/identity/offers?${params}`, { cache: "no-store", signal: request.signal });
      const data = await response.json();
      if (!response.ok || data.memberId !== memberId) throw new Error(data.message ?? "Sesi berubah. Muat ulang halaman.");
      if (request.signal.aborted) return;
      setListing(data.listing); setLoadedAt(Date.now());
      setOffers(previous => cursor ? [...previous, ...data.offers.filter((row: ConnectedOffer) => !previous.some(offer => offer.id === row.id))] : data.offers);
      setNext(data.next); setReady(true);
      if (!cursor) setConsent(false);
    } catch (error) { if (!request.signal.aborted) setError(error instanceof Error ? error.message : "Gagal memuat penawaran."); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }, [listingId, memberId]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); controller.current?.abort(); }; }, [load]);
  async function send(action: "save" | "withdraw") {
    if (!listing || busy || !ready) return;
    if (action === "save" && !consent) { setError("Setujui rincian dan jadwal terbaru dahulu."); return; }
    const command: OfferCommand = { operationId: pending.current?.operationId ?? crypto.randomUUID(), offerId: active?.id ?? pending.current?.offerId ?? crypto.randomUUID(), listingId: listing.id, version: active?.version ?? 0, listingVersion: action === "withdraw" ? active!.listing_version : listing.version, fee: action === "withdraw" ? active!.fee : listing.fee, action };
    if (pending.current && JSON.stringify(pending.current) !== JSON.stringify(command)) { setError("Hasil sebelumnya belum diketahui. Coba lagi dengan data yang sama atau muat ulang penawaran."); return; }
    pending.current = command; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/identity/offers", { method: "POST", headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId }, body: JSON.stringify(command) });
      const data = await response.json();
      if (!response.ok) { if (response.status !== 503) pending.current = null; throw new Error(data.message); }
      pending.current = null;
      setNotice(action === "withdraw" ? "Penawaran ditarik." : "Penawaran tersimpan. Belum ada pesanan atau dana yang dipesan.");
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : "Gagal menyimpan. Coba lagi."); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send("save"); }
  const open = listing?.status === "active" && Date.parse(listing.cutoff) > loadedAt;
  return <section className="stack"><Link href="/account/listings">Listing saya</Link><h1>{listing?.isOwner ? "Tinjau penawaran" : "Penawaran saya"}</h1>{listing && <div className="panel stack"><h2>{listing.title}</h2><p>Pengantaran: {time(listing.start)} sampai {time(listing.end)}</p><p>Tutup: {time(listing.cutoff)}</p><p>Ongkos jasa tetap: {money(listing.fee)}.</p><p>Revisi listing {listing.version}.</p>{open && <Link href={`/listings/${listing.id}`}>Lihat rincian barang</Link>}{listing.status === "removed" && <p>Listing dihapus oleh operator.</p>}{ready && open && !listing.isOwner && listing.type === "request" && !listing.negotiable && <ConnectedAcceptance memberId={memberId} listingId={listing.id} listingVersion={listing.version} />}</div>}{loading && <p role="status">Memuat penawaran...</p>}{notice && <p role="status">{notice}</p>}{error && <div className="info-box" role="alert"><p>{error}</p><Button disabled={busy} onClick={() => { pending.current = null; void load(); }}>Muat ulang penawaran</Button></div>}{ready && listing && !listing.isOwner && <form className="panel stack" onSubmit={submit}><fieldset className="stack listing-fields" disabled={busy || loading}>{open ? <><label className="check-field"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} />Saya menyetujui rincian barang dan jadwal revisi {listing.version} dengan ongkos {money(listing.fee)}.</label><Button type="submit">{busy ? "Menyimpan..." : active ? "Perbarui dan setujui penawaran" : "Kirim penawaran"}</Button></> : <p>Listing ditutup atau batas waktu sudah lewat.</p>}{active && <Button type="button" variant="secondary" onClick={() => void send("withdraw")}>Tarik penawaran</Button>}</fieldset></form>}{ready && offers.length === 0 && <Empty title="Belum ada penawaran">Penawaran hanya terlihat oleh penulis dan pemilik listing.</Empty>}{ready && offers.map(offer => <article className="panel stack" key={offer.id}><div className="badge-row"><Badge>{offer.status === "active" ? "Aktif" : offer.status === "accepted" ? "Diterima" : "Ditarik"}</Badge><Badge>Revisi {offer.version}</Badge></div><h2>{offer.listing_title}</h2><p>Dikirim {time(offer.created_at)}</p><strong>{money(offer.fee)}</strong>{listing && open && offer.status === "active" && offer.listing_version !== listing.version && <p role="status">Jadwal atau rincian berubah. Penulis perlu menyetujui revisi terbaru sebelum penawaran dapat dipilih.</p>}{listing?.isOwner && open && offer.status === "active" && offer.listing_version === listing.version && <ConnectedAcceptance memberId={memberId} listingId={listing.id} listingVersion={listing.version} offerId={offer.id} offerVersion={offer.version} />}{!listing && <Link href={`/account/offers?listing=${offer.listing_id}`}>Kelola penawaran</Link>}</article>)}{next && !loading && <Button disabled={busy} variant="secondary" onClick={() => void load(next)}>Muat lebih banyak</Button>}</section>;
}
