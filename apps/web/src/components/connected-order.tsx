"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ConnectedOrder } from "@beetip/validation";
import { Button } from "./ui";
import { connectedOrderState } from "./connected-order-state";
import { ConnectedFunding } from "./connected-funding";
import { ConnectedAmendments } from "./connected-amendments";
import { ConnectedPurchase } from "./connected-purchase";

export function ConnectedOrderDetail({ id, memberId }: { id: string; memberId: string }) {
  return <ConnectedOrderContent key={`${memberId}:${id}`} id={id} memberId={memberId} />;
}

function ConnectedOrderContent({ id, memberId }: { id: string; memberId: string }) {
  const [order, setOrder] = useState<ConnectedOrder | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let refresh: ReturnType<typeof setTimeout>;
    const timeout = setTimeout(() => { controller.abort(); setError("Status belum dapat diperbarui. Coba lagi."); }, 15000);
    void fetch(`/api/identity/orders?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok || data.memberId !== memberId || data.order?.id !== id) throw new Error(data.message ?? "Sesi berubah. Muat ulang halaman.");
      if (!controller.signal.aborted) {
        setOrder(data.order);
        setError("");
        refresh = setTimeout(() => setAttempt(value => value + 1), 30000);
      }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); clearTimeout(refresh); };
  }, [id, memberId, attempt]);
  const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
  const time = (value: string) => new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
  if (error) return <div role="alert"><p>{error}</p><Button onClick={() => { setError(""); setAttempt(attempt + 1); }}>Coba lagi</Button></div>;
  if (!order) return <p role="status">Memuat pesanan...</p>;
  const completed = ["purchased", "purchase_partial", "purchase_unavailable", "delivering", "delivery_confirmed"].includes(order.state);
  const refresh = () => setAttempt(value => value + 1);
  const actions = <>
    <ConnectedPurchase orderId={id} memberId={memberId} refreshKey={attempt} orderState={order.state} closed={["expired", "cancelled"].includes(order.state)} onChange={refresh} />
    <ConnectedAmendments orderId={id} memberId={memberId} refreshKey={attempt} completed={completed} onChange={refresh} />
    <ConnectedFunding orderId={id} memberId={memberId} refreshKey={attempt} />
    <Link className="button button-secondary" href={`/chat/${id}`}>Pesan pesanan</Link><Link href="/account/orders">Kembali ke daftar pesanan</Link>
  </>;
  return <section className="panel stack"><h1>{order.terms.title}</h1><p>Pesanan {order.id}</p><p role="status">{connectedOrderState(order.state)}</p>{order.state === "expired" && <p>Reservasi tidak lagi memakai kapasitas. Pesanan ini tidak dapat dilanjutkan. Buka daftar untuk membuat kesepakatan baru.</p>}<Button onClick={() => setAttempt(value => value + 1)}>Perbarui status</Button><h2>Kesepakatan awal</h2>{order.terms.items.map((item, index) => <p key={index}>{item.name} x {item.quantity}: {item.specification} ({money(item.unitBudget)} per item)</p>)}<p>Batas belanja: {money(order.terms.budget)}. Ongkos: {money(order.terms.fee)}.</p><p>Tujuan: {order.terms.destination}</p><p>Pengantaran: {time(order.terms.start)} sampai {time(order.terms.end)}</p>{order.state === "awaiting_payment" && <p>Reservasi sampai {time(order.reservationUntil)}.</p>}{actions}</section>;
}
