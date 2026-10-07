"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDemo } from "./demo-provider";
import { Heading, ActionForm } from "./marketplace";
import { Badge, Button, Empty } from "./ui";
import { listingAvailability, type Listing, type SupportThread } from "@beetip/domain";
import { fromWIBInput, toWIBInput } from "./creation";

function Conversation({ thread }: { thread: SupportThread }) {
  const { state, run } = useDemo();
  return <section className="panel stack"><div className="section-heading"><h3>{state.members.find(m => m.id === thread.memberId)?.name}</h3><Badge>{thread.status === "open" ? "Terbuka" : "Selesai"}</Badge></div>{thread.orderId && <Link href={`/orders/${thread.orderId}`}>Pesanan terkait: {thread.orderId}</Link>}{thread.messages.map((message, i) => <div className="info-box" key={i}><strong>{state.members.find(m => m.id === message.authorId)?.name}</strong><p>{message.text}</p><p className="small">{new Date(message.at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p></div>)}{thread.status === "open" && <ActionForm fields={[{ name: "text", label: "Balasan bantuan", type: "textarea" }]} submit="Kirim balasan" onSubmit={v => run({ type: "supportReply", threadId: thread.id, text: v.text })} />}</section>;
}

export function Support({ orderId }: { orderId?: string }) {
  const { service } = useDemo();
  if (orderId && !service.queryOrder(orderId).ok) return <Empty title="Pesanan tidak tersedia">Bantuan pesanan hanya dapat dibuka peserta terkait.</Empty>;
  const threads = service.querySupport().filter(t => !orderId || t.orderId === orderId);
  return <><Heading title="Hubungi bantuan" subtitle="Tanyakan cara memakai BeeTip atau laporkan masalah titipan." /><p className="small">Percakapan tersimpan pada perangkat ini. Pengiriman antarperangkat akan tersedia setelah layanan pesan terhubung.</p><SupportComposer orderId={orderId} /><div className="stack">{threads.map(thread => <Conversation key={thread.id} thread={thread} />)}{!threads.length && <Empty title="Belum ada percakapan bantuan">Ceritakan pertanyaan atau masalahmu melalui formulir di atas.</Empty>}</div></>;
}
function SupportComposer({ orderId }: { orderId?: string }) {
  const { run } = useDemo();
  return <section className="panel stack"><h2>{orderId ? `Bantuan untuk ${orderId}` : "Tulis pertanyaanmu"}</h2><ActionForm fields={[{ name: "text", label: "Pesan bantuan", type: "textarea" }]} submit="Kirim ke bantuan" onSubmit={v => run({ type: "supportOpen", orderId, text: v.text })} /></section>;
}
export function SupportInbox() {
  const { service, run } = useDemo(); const [filter, setFilter] = useState("open");
  return <section className="stack admin-section"><Heading title="Kotak masuk bantuan" subtitle="Baca pertanyaan anggota dan tindak lanjuti masalah pesanan." /><label className="field">Status bantuan<select value={filter} onChange={e => setFilter(e.target.value)}><option value="open">Terbuka</option><option value="resolved">Selesai</option><option value="all">Semua</option></select></label>{service.querySupport().filter(t => filter === "all" || t.status === filter).map(thread => <div className="stack" key={thread.id}><Conversation thread={thread} /><Button variant="secondary" onClick={() => run({ type: "supportStatus", threadId: thread.id, status: thread.status === "open" ? "resolved" : "open" })}>{thread.status === "open" ? "Tandai bantuan selesai" : "Buka kembali bantuan"}</Button></div>)}</section>;
}
function Moderate({ listing }: { listing: Listing }) {
  const { state, run } = useDemo(); const [status, setStatus] = useState<Listing["moderation"]>("paused"); const [reason, setReason] = useState(""); const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const [deadline, setDeadline] = useState(() => toWIBInput(Date.now() + 82800000)); const [start, setStart] = useState(() => toWIBInput(Date.now() + 86400000)); const [end, setEnd] = useState(() => toWIBInput(Date.now() + 88200000));
  const [reschedule, setReschedule] = useState(() => !listing.schedule || listing.cutoff <= Date.now());
  return <details className="panel"><summary>{listing.title} · {listingAvailability(listing, state.orders, now)}</summary><div className="stack"><Link href={`/listings/${listing.id}`}>Lihat rincian listing</Link><p>{listing.shop} · {listing.window}</p><p>{state.members.find(m => m.id === listing.ownerId)?.name} · {listing.type === "request" ? "Minta dibelikan" : "Jasa titip tersedia"}</p><form className="stack" onSubmit={e => { e.preventDefault(); const result = run({ type: "moderateListing", listingId: listing.id, status: status ?? "paused", reason, ...(status === "active" && reschedule ? { cutoff: fromWIBInput(deadline), schedule: { start: fromWIBInput(start), end: fromWIBInput(end) } } : {}) }); setError(result.ok ? "" : result.message); }}><label className="field">Tindakan listing<select value={status} onChange={e => setStatus(e.target.value as Listing["moderation"])}><option value="paused">Jeda</option><option value="closed">Tutup</option><option value="removed">Hapus dari beranda</option><option value="active">Aktifkan kembali</option></select></label>{status === "active" && <><label className="check-field"><input type="checkbox" checked={reschedule} onChange={e => setReschedule(e.target.checked)} />Perbarui jadwal</label>{reschedule && <><label className="field">Batas penerimaan baru (WIB)<input required type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} /></label><label className="field">Mulai pengantaran baru (WIB)<input required type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label><label className="field">Selesai pengantaran baru (WIB)<input required type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label></>}</>}<label className="field">Alasan tindakan<input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label><p className="small">Tindakan dicatat dalam audit. Pesanan yang sudah diterima tetap berjalan dan kesepakatannya tetap tersimpan.</p>{error && <p role="alert" className="error-text">{error}</p>}<Button type="submit">Simpan status listing</Button></form></div></details>;
}
export function ListingModeration() {
  const { service, state } = useDemo(); const [search, setSearch] = useState(""); const [filter, setFilter] = useState("all");
  const listings = service.queryListings().filter(l => `${l.title} ${l.shop}`.toLowerCase().includes(search.toLowerCase()) && (filter === "all" || (l.moderation ?? "active") === filter));
  return <section className="stack admin-section"><Heading title="Kelola listing" subtitle="Atur ketersediaan listing tanpa mengubah pesanan yang sudah disepakati." /><div className="form-grid"><label className="field">Cari listing untuk dikelola<input value={search} onChange={e => setSearch(e.target.value)} /></label><label className="field">Filter status listing<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Semua</option><option value="active">Aktif</option><option value="paused">Dijeda</option><option value="closed">Ditutup</option><option value="removed">Dihapus</option></select></label></div>{listings.map(listing => <Moderate key={listing.id} listing={listing} />)}{!listings.length && <Empty title="Tidak ada listing yang cocok">Ubah pencarian atau status.</Empty>}<p className="small">{state.listings.length} listing tercatat.</p></section>;
}
