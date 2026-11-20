"use client";

import Link from "next/link";
import { ArrowLeft, CalendarClock, MapPin, Package, Plus, Store, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { connectedListingSchema, wibInput, wibTimestamp, type ConnectedListingInput, type OwnListing, type PublicListing } from "@beetip/validation";
import { Badge, Button, Empty, Modal } from "./ui";

const money = (amount: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
const time = (value: string) => new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) + " WIB";
type Cursor = { before: string; beforeId: string };

export function PrivateListings({ memberId, children }: { memberId: string; children: ReactNode }) {
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    let disposed = false;
    let generation = 0;
    async function check() {
      if (document.visibilityState !== "visible") return;
      const current = ++generation;
      try {
        const data = await read("/api/identity/member");
        if (!disposed && current === generation && data.memberId !== memberId) setAllowed(false);
      } catch { if (!disposed && current === generation) setAllowed(false); }
    }
    function changed(event: StorageEvent) { if (event.key === "beetip-auth-change") { generation++; setAllowed(false); } }
    window.addEventListener("storage", changed);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 30000);
    return () => { disposed = true; generation++; clearInterval(timer); window.removeEventListener("storage", changed); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [memberId]);
  return allowed ? children : <section className="panel stack"><h1>Sesi akun berubah</h1><p>Muat ulang untuk melanjutkan dengan akun saat ini.</p><Button onClick={() => window.location.reload()}>Muat ulang</Button></section>;
}

async function read(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.message ?? "Listing belum dapat dimuat. Coba lagi.");
  return data;
}

function ListingCard({ listing, own }: { listing: PublicListing; own: boolean }) {
  return <article className="panel stack"><div className="badge-row"><Badge>{listing.type === "request" ? "Minta dibelikan" : "Jasa titip"}</Badge><Badge>{listing.category}</Badge>{own && <Badge>{listing.status}</Badge>}</div><h2>{listing.title}</h2><p>{listing.shop} · {listing.area}</p><p>{time(listing.start)}</p><p>Ongkos jasa <strong>{money(listing.fee)}</strong></p><Link className="button button-primary" href={own ? `/listings/new?edit=${listing.id}` : `/listings/${listing.id}`}>{own ? "Ubah listing" : "Lihat detail"}</Link>{own && <Link className="button button-secondary" href={`/account/offers?listing=${listing.id}`}>Tinjau penawaran</Link>}</article>;
}

export function ConnectedBoard({ own = false }: { own?: boolean }) {
  const [filters, setFilters] = useState({ search: "", type: "all", category: "Semua", date: "" });
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PublicListing[]>([]);
  const [next, setNext] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const load = useCallback(async (cursor?: Cursor) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true); setError("");
    if (!cursor) { setRows([]); setNext(null); }
    try {
      const params = new URLSearchParams(query);
      if (cursor) { params.set("before", cursor.before); params.set("beforeId", cursor.beforeId); }
      const data = await read(`${own ? "/api/identity/listings" : "/api/listings"}?${params}`, controller.signal);
      if (controller.signal.aborted) return;
      setRows(previous => cursor ? [...previous, ...data.listings.filter((row: PublicListing) => !previous.some(item => item.id === row.id))] : data.listings);
      setNext(data.next);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Gagal memuat listing."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [own, query]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); active.current?.abort(); }; }, [load]);
  function filter(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ""));
    if (params.toString() === query) void load(); else setQuery(params.toString());
  }
  return <section className="stack"><div className="page-heading"><div><span className="eyebrow">TITIP BELANJA, SEKALIAN JALAN</span><h1>{own ? "Listing saya" : "Mau titip apa hari ini?"}</h1><p>{own ? "Ubah jadwal atau batalkan listing." : "Jelajahi titipan tanpa membuat akun. Masuk untuk mengirim penawaran."}</p></div><Link className="button button-primary" href="/listings/new">Buat listing</Link></div>{!own && <form className="panel stack" onSubmit={filter}><div className="form-grid"><label className="field">Cari listing<input value={filters.search} maxLength={100} onChange={event => setFilters({ ...filters, search: event.target.value })} /></label><label className="field">Jenis listing<select value={filters.type} onChange={event => setFilters({ ...filters, type: event.target.value })}><option value="all">Semua jenis</option><option value="request">Minta dibelikan</option><option value="trip">Jasa titip</option></select></label><label className="field">Kategori<select value={filters.category} onChange={event => setFilters({ ...filters, category: event.target.value })}>{["Semua", "Makanan", "Minuman", "Belanja"].map(value => <option key={value}>{value}</option>)}</select></label><label className="field">Tanggal pengantaran (WIB)<input type="date" value={filters.date} onChange={event => setFilters({ ...filters, date: event.target.value })} /></label></div><Button type="submit">Terapkan filter</Button></form>}{loading && <p role="status">Memuat listing...</p>}{error && <div role="alert" className="info-box"><p>{error}</p><Button onClick={() => void load(rows.length && next ? next : undefined)}>Coba lagi</Button></div>}{!loading && !error && rows.length === 0 && <Empty title="Belum ada listing">Coba kategori atau tanggal lain, atau buat titipan pertama.</Empty>}<div className="listing-grid">{rows.map(listing => <ListingCard key={listing.id} listing={listing} own={own} />)}</div>{next && !loading && !error && <Button variant="secondary" onClick={() => void load(next)}>Muat lebih banyak</Button>}</section>;
}

export function ConnectedListingDetail({ id }: { id: string }) {
  const [listing, setListing] = useState<PublicListing | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void read(`/api/listings?id=${encodeURIComponent(id)}`, controller.signal).then(data => { if (!controller.signal.aborted) setListing(data.listings[0] ?? null); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, attempt]);
  if (loading) return <p role="status">Memuat detail...</p>;
  if (error) return <div className="panel stack" role="alert"><p>{error}</p><Button onClick={() => { setLoading(true); setError(""); setAttempt(attempt + 1); }}>Coba lagi</Button></div>;
  if (!listing) return <Empty title="Listing tidak tersedia">Listing sudah ditutup, melewati batas waktu, atau tidak ditemukan. <Link href="/">Kembali jelajahi</Link></Empty>;
  return <section className="stack"><Link href="/">Kembali jelajahi</Link><div className="panel stack"><div className="badge-row"><Badge>{listing.type === "request" ? "Minta dibelikan" : "Jasa titip"}</Badge><Badge>{listing.category}</Badge></div><h1>{listing.title}</h1><p>{listing.shop} · {listing.area}</p><h2>Rincian belanja</h2>{listing.items.map((item, index) => <div key={index}><strong>{item.name} × {item.quantity}</strong><p>{item.specification}</p><p>Maksimal {money(item.unitBudget)} per item</p></div>)}<p>Batas belanja <strong>{money(listing.budget)}</strong></p><p>Ongkos jasa <strong>{money(listing.fee)}</strong></p><p>Pengantaran: {time(listing.start)} sampai {time(listing.end)}</p><p>Tutup: {time(listing.cutoff)}</p><p>Kapasitas: {listing.capacity} orang · Batas belanja perjalanan {money(listing.spendingCapacity)}</p><div className="info-box">Periksa rincian dan ongkos sebelum menyetujui pesanan. Alamat tepat hanya dibagikan kepada peserta pesanan.</div><Link className="button button-primary" href={`/account/offers?listing=${listing.id}`}>Lanjut ke penawaran</Link></div></section>;
}

function initialListing(): ConnectedListingInput {
  const start = new Date(Date.now() + 86400000).toISOString();
  return { type: "request", title: "", shop: "", category: "Makanan", area: "Alam Sutera", destination: "", items: [{ name: "", specification: "", quantity: 0, unitBudget: 0 }], fee: 5000, bound: 5000, negotiable: false, capacity: 1, spendingCapacity: 150000, start, end: new Date(Date.now() + 90000000).toISOString(), cutoff: new Date(Date.now() + 82800000).toISOString(), status: "active" };
}

export function ConnectedListingForm({ editId, memberId }: { editId?: string; memberId: string }) {
  const [value, setValue] = useState<ConnectedListingInput>(initialListing);
  const [published, setPublished] = useState<ConnectedListingInput | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(Boolean(editId));
  const [ready, setReady] = useState(!editId);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ operationId: string; listingId: string; version: number; listing: ConnectedListingInput } | null>(null);
  const [saved, setSaved] = useState<{ id: string; closed: boolean } | null>(null);
  useEffect(() => {
    if (!editId) return;
    const controller = new AbortController();
    void read(`/api/identity/listings?id=${encodeURIComponent(editId)}`, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      const row: OwnListing | undefined = data.listings[0];
      if (!row) throw new Error("Listing tidak ditemukan atau bukan milikmu.");
      const parsed = connectedListingSchema.parse(Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "version", "created_at", "budget"].includes(key))));
      setPublished(parsed);
      setLoadedAt(Date.now());
      setValue(parsed); setVersion(row.version); setReady(true);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [editId, attempt]);
  function update<Key extends keyof ConnectedListingInput>(key: Key, next: ConnectedListingInput[Key]) { setValue(previous => ({ ...previous, [key]: next })); }
  async function save(listing: ConnectedListingInput, cancelled = false) {
    if (busy) return;
    const parsed = connectedListingSchema.safeParse(listing);
    if (!parsed.success) { setError(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join(" ")); return; }
    if (pending.current && JSON.stringify(pending.current.listing) !== JSON.stringify(parsed.data)) { setError("Hasil penyimpanan sebelumnya belum diketahui. Muat ulang listing saya sebelum mengirim perubahan baru."); return; }
    pending.current ??= { operationId: crypto.randomUUID(), listingId: editId ?? crypto.randomUUID(), version, listing: parsed.data };
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/identity/listings", { method: "POST", headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId }, body: JSON.stringify(pending.current) });
      const data = await response.json();
      if (!response.ok) { if (response.status !== 503) pending.current = null; throw new Error(data.message); }
      setSaved({ id: data.listingId, closed: cancelled });
    } catch (error) { setError(error instanceof Error ? error.message : "Gagal menyimpan. Coba lagi dengan data yang sama."); }
    finally { setBusy(false); }
  }
  if (loading) return <p role="status">Memuat listing...</p>;
  if (saved) return <section className="panel stack">
    <h1>{saved.closed ? "Listing dibatalkan" : "Listing tersimpan"}</h1>
    <p>{saved.closed ? "Listing sudah ditutup untuk titipan baru." : "Jadwal ditampilkan dalam WIB. Listing aktif tampil selama batas waktu belum lewat."}</p>
    {!saved.closed && <Link className="button button-primary" href={`/listings/${saved.id}`}>Lihat listing</Link>}
    <Link className="button button-secondary" href="/account/listings">Listing saya</Link>
  </section>;
  const canCancel = editId && published && published.status !== "closed" && Date.parse(published.cutoff) > loadedAt;
  return <section className="stack listing-editor">
    <header>
      <Link className="back-link" href={editId ? "/account/listings" : "/"}><ArrowLeft size={16} aria-hidden="true" />{editId ? "Listing saya" : "Jelajahi listing"}</Link>
      <h1>{editId ? "Ubah listing" : "Buat listing"}</h1>
    </header>
    {error && <div role="alert" className="info-box"><p>{error}</p>{editId && <Button onClick={() => { pending.current = null; setLoading(true); setReady(false); setError(""); setAttempt(attempt + 1); }}>Muat ulang listing</Button>}</div>}
    {ready && <form className="stack" onSubmit={event => { event.preventDefault(); void save({ ...value, negotiable: false, bound: value.fee }); }}>
      <fieldset disabled={busy} className="stack listing-fields">
        <section className="panel listing-section">
          <h2><Store size={21} aria-hidden="true" />Tentang listing</h2>
          <div className="form-grid">
            <label className="field">Jenis listing<select value={value.type} onChange={event => { update("type", event.target.value as ConnectedListingInput["type"]); update("capacity", 1); }}><option value="request">Minta dibelikan</option><option value="trip">Buka jasa titip</option></select></label>
            <label className="field">Kategori<select value={value.category} onChange={event => update("category", event.target.value as ConnectedListingInput["category"])}>{["Makanan", "Minuman", "Belanja"].map(category => <option key={category}>{category}</option>)}</select></label>
            <label className="field">Judul<input required minLength={4} maxLength={100} placeholder="Contoh: Titip makan siang" value={value.title} onChange={event => update("title", event.target.value)} /></label>
            <label className="field">Tempat belanja<input required minLength={2} maxLength={100} placeholder="Contoh: AEON Mall Alam Sutera" value={value.shop} onChange={event => update("shop", event.target.value)} /></label>
          </div>
        </section>
        <section className="panel listing-section">
          <h2><Package size={21} aria-hidden="true" />Rincian barang</h2>
          {value.items.map((item, index) => <fieldset className="item-row" key={index}>
            <legend>Barang {index + 1}</legend>
            <div className="form-grid">
              {([
                ["name", "Nama barang", "text", "Contoh: Nasi ayam"],
                ["specification", "Spesifikasi (opsional)", "text", "Contoh: Sambal dipisah"],
                ["quantity", "Jumlah", "number", "Contoh: 2"],
                ["unitBudget", "Batas harga satuan (Rp)", "number", "Contoh: 25000"],
              ] as const).map(([key, label, type, placeholder]) => <label className="field" key={key}>{label} {index + 1}
                <input type={type} placeholder={placeholder} required={key !== "specification"} min={key === "quantity" ? 1 : key === "unitBudget" ? 1000 : undefined} max={key === "quantity" ? 50 : key === "unitBudget" ? 150000 : undefined} maxLength={key === "specification" ? 200 : 100} step={type === "number" ? 1 : undefined} value={type === "number" && item[key] === 0 ? "" : item[key]} onChange={event => update("items", value.items.map((row, position) => position === index ? { ...row, [key]: type === "number" ? Number(event.target.value) : event.target.value } : row))} />
              </label>)}
            </div>
            {value.items.length > 1 && <Button type="button" variant="ghost" onClick={() => update("items", value.items.filter((_, position) => position !== index))}>Hapus barang {index + 1}</Button>}
          </fieldset>)}
          {value.items.length < 20 && <Button type="button" variant="secondary" onClick={() => update("items", [...value.items, { name: "", specification: "", quantity: 0, unitBudget: 0 }])}><Plus size={17} aria-hidden="true" />Tambah barang</Button>}
          <p>Total batas belanja <strong>{money(value.items.reduce((sum, item) => sum + item.quantity * item.unitBudget, 0))}</strong> (maksimal Rp150.000)</p>
        </section>
        <section className="panel listing-section">
          <h2><MapPin size={21} aria-hidden="true" />Tujuan pengantaran</h2>
          <label className="field">Alamat tujuan<input required minLength={2} maxLength={200} autoComplete="street-address" placeholder="Contoh: Lobi Gedung A, Kampus Alam Sutera" value={value.destination} onChange={event => update("destination", event.target.value)} aria-describedby="listing-address-help" /></label>
          <p id="listing-address-help" className="small">Alamat lengkap dibagikan kepada peserta setelah pesanan diterima.</p>
        </section>
        <section className="panel listing-section">
          <h2><CalendarClock size={21} aria-hidden="true" />Jadwal pengantaran</h2>
          <div className="form-grid">{([["cutoff", "Terima titipan sampai (WIB)"], ["start", "Awal pengantaran (WIB)"], ["end", "Akhir pengantaran (WIB)"]] as const).map(([key, label]) => <label className="field" key={key}>{label}<input type="datetime-local" required value={wibInput(value[key])} onChange={event => { if (event.target.value) update(key, wibTimestamp(event.target.value)); }} /></label>)}</div>
        </section>
        <section className="panel listing-section">
          <h2><Wallet size={21} aria-hidden="true" />Biaya dan kapasitas</h2>
          <div className="form-grid">
            <label className="field">Ongkos jasa tetap (Rp)<input type="number" required min={0} max={150000} step={1} value={Number.isNaN(value.fee) ? "" : value.fee} onChange={event => update("fee", event.target.valueAsNumber)} /></label>
            {value.type === "trip" && <label className="field">Kapasitas pelanggan<input type="number" required min={1} max={3} value={Number.isNaN(value.capacity) ? "" : value.capacity} onChange={event => update("capacity", event.target.valueAsNumber)} /></label>}
            <label className="field">Kapasitas belanja (Rp)<input type="number" required min={1000} max={450000} step={1} value={Number.isNaN(value.spendingCapacity) ? "" : value.spendingCapacity} onChange={event => update("spendingCapacity", event.target.valueAsNumber)} /></label>
          </div>
        </section>
        <Button type="submit">{busy ? "Menyimpan..." : editId ? "Simpan perubahan" : "Terbitkan listing"}</Button>
      </fieldset>
    </form>}
    {ready && canCancel && <Modal title="Batalkan listing?" description="Listing akan ditutup untuk titipan baru. Pesanan yang sudah diterima tetap berjalan." trigger={<Button type="button" variant="danger" disabled={busy}>Batalkan listing</Button>}>
      <div className="actions"><Button type="button" variant="danger" disabled={busy} onClick={() => { if (published) void save({ ...published, status: "closed" }, true); }}>{busy ? "Menyimpan..." : "Ya, batalkan listing"}</Button></div>
      {error && <p role="alert">{error}</p>}
    </Modal>}
  </section>;
}
