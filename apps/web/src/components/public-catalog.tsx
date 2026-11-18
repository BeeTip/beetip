"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowUpRight, Plus, Search } from "lucide-react";
import type { SampleListing } from "../server/catalog";
import { Badge, Button, Empty } from "./ui";

const money = (amount: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
const kind = (listing: SampleListing) => listing.type === "trip" ? "Jasa titip" : "Minta dibelikan";

function SampleCard({ listing }: { listing: SampleListing }) {
  return <article className="listing-card"><div className={`illustration ${listing.category}`}><Image src={listing.category === "Minuman" ? "/drink.svg" : listing.category === "Makanan" ? "/food.svg" : "/bag.svg"} width={58} height={64} alt="" /><span className="illustration-label">{listing.category}</span></div><div className="listing-content"><div className="badge-row"><Badge>Contoh listing</Badge><Badge>{kind(listing)}</Badge></div><h3>{listing.title}</h3><p>{listing.shop}<br />{listing.area}</p><div className="listing-economics"><div><span>Contoh ongkos jasa</span><strong>{money(listing.fee)}</strong></div></div><Button asChild><Link href={`/listings/${listing.id}`}>Lihat detail <ArrowUpRight size={14} /></Link></Button></div></article>;
}

export function PublicCatalog({ listings }: { listings: readonly SampleListing[] }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Semua");
  const [type, setType] = useState("all");
  const results = listings.filter(listing => (category === "Semua" || listing.category === category) && (type === "all" || listing.type === type) && `${listing.title} ${listing.shop} ${listing.area}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <><section className="marketplace-hero"><div className="marketplace-hero-copy"><div className="page-heading"><div><span className="eyebrow">TITIP BELANJA, SEKALIAN JALAN</span><h1>Mau titip apa hari ini?</h1><p>Jelajahi titipan tanpa membuat akun. Masuk saat kamu ingin mulai.</p></div><Button className="desktop-create" asChild><Link href="/listings/new"><Plus size={17} />Buat listing</Link></Button></div></div><div className="marketplace-hero-note"><span className="hero-spark" aria-hidden="true" /><p>Dari teman,<br />untuk teman.</p><span>Jastip terasa lebih dekat.</span></div></section><div className="info-box"><strong>Jelajahi contoh titipan</strong><p className="small">Listing berikut adalah contoh untuk mengenal BeeTip. Pemesanan dan pembayaran belum tersedia.</p></div><div className="search-bar" style={{ marginTop: 24 }}><Search size={18} className="muted" /><input aria-label="Cari listing" placeholder="Cari makanan, kopi, atau tempat belanja..." value={search} onChange={event => setSearch(event.target.value)} /></div><div className="filters" aria-label="Kategori">{["Semua", "Makanan", "Minuman", "Belanja"].map(value => <button className="chip" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div><div className="filter-extra"><select aria-label="Jenis listing" value={type} onChange={event => setType(event.target.value)}><option value="all">Semua jenis listing</option><option value="trip">Jasa titip</option><option value="request">Minta dibelikan</option></select></div><div className="section-heading"><h2>Temukan titipan</h2><span role="status" aria-live="polite">{results.length} contoh listing</span></div><div className="board">{results.map(listing => <SampleCard key={listing.id} listing={listing} />)}{!results.length && <Empty title="Belum ada yang cocok">Coba kategori atau kata pencarian lainnya.</Empty>}</div></>;
}

export function PublicListingDetail({ listing, signedIn }: { listing: SampleListing; signedIn: boolean }) {
  return <div className="stack"><Link className="back-link" href="/"><ArrowLeft size={16} />Kembali ke beranda</Link><div className="page-heading"><div><span className="eyebrow">CONTOH LISTING</span><h1>{listing.title}</h1><p>{listing.shop} · {listing.area}</p></div></div><div className="detail-grid"><section className="panel stack"><div className="badge-row"><Badge>{kind(listing)}</Badge><Badge>{listing.category}</Badge></div><h2>Tentang titipan ini</h2><p>{listing.description}</p><div className="amount-row"><span>Contoh ongkos jasa</span><strong>{money(listing.fee)}</strong></div><p className="small">Ongkos jasa terpisah dari harga barang. Rincian dan harga di halaman ini hanya contoh, bukan penawaran yang dapat dipesan.</p></section><section className="panel stack"><h2>{signedIn ? "Kamu sudah siap menjelajah" : "Mulai dengan akun BeeTip"}</h2><p>{signedIn ? "Akunmu sudah dapat digunakan untuk mengakses dashboard dan bantuan. Pemesanan contoh listing ini belum tersedia." : "Kamu bebas melihat semua contoh tanpa akun. Buat akun dan konfirmasi email untuk mengakses dashboard. Pemesanan contoh listing ini belum tersedia."}</p>{signedIn ? <Button asChild><Link href="/account">Buka dashboard</Link></Button> : <><Button asChild><Link href="/login?form=signup">Buat akun BeeTip</Link></Button><Button variant="secondary" asChild><Link href="/login">Sudah punya akun? Masuk</Link></Button></>}<Link className="back-link" href="/">Jelajahi contoh lainnya</Link></section></div></div>;
}
