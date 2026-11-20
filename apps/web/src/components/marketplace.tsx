"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect } from "react";
import { formatIDR, listingAvailability, type Listing, type Command, type Result } from "@beetip/domain";
import { ArrowLeft, ArrowUpRight, Plus, Search, ShieldCheck } from "lucide-react";
import { useDemo } from "./demo-provider";
import { Creation } from "./creation";
import { ListingResponse } from "./listing-response";
import { Badge, Button, Empty } from "./ui";

export function Heading({ title, subtitle, children, eyebrow }: { title: string; subtitle?: string; eyebrow?: string; children?: React.ReactNode }) { return <div className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{children}</div>; }
export function Back({ href = "/", children = "Kembali ke beranda" }: { href?: string; children?: React.ReactNode }) { return <Link className="back-link" href={href}><ArrowLeft size={16} />{children}</Link>; }
export function ListingCard({ listing }: { listing: Listing }) {
  const { state, actorId } = useDemo();
  const member = state.members.find(m => m.id === listing.ownerId);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const availability = listingAvailability(listing, state.orders, now);
  const available = availability === "Tersedia";
  return <article className="listing-card"><div className={`illustration ${listing.category}`}><Image src={listing.category === "Minuman" ? "/drink.svg" : listing.category === "Makanan" ? "/food.svg" : "/bag.svg"} width={58} height={64} alt="" /><span className="illustration-label">{listing.category}</span></div><div className="listing-content"><div className="member-line"><span className="avatar">{member?.name.charAt(0)}</span>{member?.name}</div><h3>{listing.title}</h3><div className="badge-row"><Badge>{listing.type === "trip" ? "Jasa titip tersedia" : "Minta dibelikan"}</Badge>{member?.verified && <Badge tone="success"><ShieldCheck size={12} />Terverifikasi</Badge>}</div><p>{listing.shop}<br />{listing.window} · {listing.area}</p><div className="listing-economics"><div><span>Ongkos jasa</span><strong>{formatIDR(listing.fee)}</strong></div><div><span>{listing.type === "request" ? "Maks. belanja" : "Kapasitas belanja"}</span><strong>{formatIDR(listing.type === "request" ? listing.budget : listing.spendingCapacity)}</strong></div></div><Badge tone={available ? "neutral" : "warning"}>{available ? "Ongkos tetap" : availability}</Badge><Button asChild><Link href={`/listings/${listing.id}`}>{listing.ownerId === actorId || !available ? "Lihat detail" : listing.type === "request" ? "Saya bisa belikan" : "Titip di sini"} <ArrowUpRight size={14} /></Link></Button></div></article>;
}
export function Board() {
  const { service } = useDemo();
  const [search, setSearch] = useState(""); const [category, setCategory] = useState("Semua"); const [type, setType] = useState("all"); const [area, setArea] = useState("all"); const [window, setWindow] = useState("all");
  const listings = service.queryListings().filter(listing => !listing.cancelled);
  const results = listings.filter(l => (category === "Semua" || l.category === category) && (type === "all" || l.type === type) && (area === "all" || l.area === area) && (window === "all" || l.window === window) && `${l.title} ${l.shop} ${l.item}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <section className="marketplace-hero">
      <div className="marketplace-hero-copy">
        <Heading eyebrow="KOMUNITAS BINUS ALAM SUTERA" title="Mau titip apa hari ini?" subtitle="Temukan permintaan dibelikan dan jasa titip yang tersedia.">
          <Button className="desktop-create" asChild><Link href="/listings/new"><Plus size={17} />Buat listing</Link></Button>
        </Heading>
      </div>
      <div className="marketplace-hero-note"><span className="hero-spark" aria-hidden="true" /><p>Dari teman,<br />untuk teman.</p><span>Jastip terasa lebih dekat.</span></div>
    </section>
    <div className="search-bar"><Search size={18} className="muted" /><input aria-label="Cari listing" placeholder="Cari makanan, kopi, atau tempat belanja..." value={search} onChange={e => setSearch(e.target.value)} /></div>
    <div className="filters" aria-label="Kategori">{["Semua", "Makanan", "Minuman", "Belanja"].map(c => <button className="chip" key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div>
    <div className="filter-extra"><select aria-label="Jenis listing" value={type} onChange={e => setType(e.target.value)}><option value="all">Semua jenis listing</option><option value="trip">Jasa titip tersedia</option><option value="request">Minta dibelikan</option></select><select aria-label="Area tujuan" value={area} onChange={e => setArea(e.target.value)}><option value="all">Semua area</option>{[...new Set(listings.map(l => l.area))].map(a => <option key={a}>{a}</option>)}</select><select aria-label="Waktu pengantaran" value={window} onChange={e => setWindow(e.target.value)}><option value="all">Semua waktu</option>{[...new Set(listings.map(l => l.window))].map(w => <option key={w}>{w}</option>)}</select></div>
    <div className="section-heading"><h2>Temukan titipan</h2><span>{results.length} listing</span></div>
    <div className="board">{results.map(l => <ListingCard key={l.id} listing={l} />)}{!results.length && <Empty title="Belum ada yang cocok">Coba kategori atau kata pencarian lainnya.</Empty>}</div>
    <div className="board-footer"><ShieldCheck size={20} /><span>Satu akun bisa meminta titipan dan membantu membelikan.</span></div>
  </>;
}

type ActionField = { name: string; label: string; value?: string | number; type?: "number" | "text" | "textarea"; min?: number; max?: number };
export function ActionForm({ title, fields, submit, onSubmit }: { title?: string; fields: ActionField[]; submit: string; onSubmit: (v: Record<string, string>) => Result<string> }) {
  const [error, setError] = useState("");
  return <form className="stack" onSubmit={e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>; const result = onSubmit(data); setError(result.ok ? "" : result.message); if (result.ok) e.currentTarget.reset(); }}>{title && <h3>{title}</h3>}{fields.map(f => <label className="field" key={f.name}>{f.label}{f.type === "textarea" ? <textarea name={f.name} defaultValue={f.value} maxLength={1000} required /> : <input name={f.name} type={f.type ?? "text"} defaultValue={f.value} required min={f.min ?? (f.type === "number" ? 0 : undefined)} max={f.max} maxLength={f.type === "number" ? undefined : 1000} />}</label>)}{error && <p role="alert" className="error-text">{error}</p>}<Button type="submit">{submit}</Button></form>;
}

export function ListingForm() { return <Creation />; }

export function ListingDetail({ id }: { id: string }) { return <ListingResponse key={id} id={id} />; }

export function Trips({ id }: { id?: string }) {
  const { state, actorId, service } = useDemo();
  const trips = state.listings.filter(l => l.type === "trip" && l.ownerId === actorId);
  if (id) {
    const trip = trips.find(t => t.id === id);
    if (!trip) return <Empty title="Jastip tidak tersedia">Halaman ini tersedia untuk pemilik jasa titip.</Empty>;
    const orders = service.queryOrders().filter(o => o.listingId === id);
    return <><Back href="/trips">Kembali ke jastip saya</Back><Heading title={trip.title} subtitle="Setiap pelanggan memiliki pesanan dan penyelesaian sendiri." /><div className="stack"><ListingCard listing={trip} />{orders.map(o => <Link key={o.id} href={`/orders/${o.id}`} className="order-card"><div className="section-heading"><h3>{o.id}</h3><Badge>{state.members.find(m => m.id === o.customerId)?.name}</Badge></div><p>{o.approvedItem} · batas {formatIDR(o.budget)}</p><p>{o.terms.destination}</p><p>{o.receipts.length ? `Alokasi struk: ${formatIDR(o.receipts.reduce((n, r) => n + r.amount, 0))}` : "Belum ada pembelian"}</p></Link>)}{!orders.length && <Empty title="Belum ada pelanggan">Terima penawaran melalui detail listing.</Empty>}</div></>;
  }
  return <><Heading title="Jastip saya" subtitle="Kelola jasa titip yang kamu buka dan permintaan yang kamu belikan."><Button asChild><Link href="/listings/new"><Plus size={16} />Buka jasa titip</Link></Button></Heading><div className="stack"><h2>Permintaan yang saya belikan</h2>{service.queryOrders().filter(o => o.providerId === actorId && state.listings.find(l => l.id === o.listingId)?.type === "request").map(o => <Link className="order-card" key={o.id} href={`/orders/${o.id}`}><h3>{o.terms.title}</h3><p>{o.approvedItem}</p><p>Perkiraan pengantaran: {o.terms.window}</p></Link>)}<h2>Jasa titip yang saya buka</h2>{trips.map(t => <div className="stack" key={t.id}><ListingCard listing={t} /><Button variant="secondary" asChild><Link href={`/trips/${t.id}`}>Kelola jasa titip</Link></Button></div>)}{!trips.length && <Empty title="Belum membuka jasa titip">Buka jasa titip atau bantu belikan permintaan di Beranda.</Empty>}</div></>;
}

export const executeFor = (run: (c: Command) => Result<string>, command: Command) => () => run(command);
