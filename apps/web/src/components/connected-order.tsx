"use client";

import { useEffect, useState } from "react";
import type { ConnectedOrder } from "@beetip/validation";
import { Button } from "./ui";

export function ConnectedOrderDetail({ id, memberId }: { id: string; memberId: string }) {
  const [order, setOrder] = useState<ConnectedOrder | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/identity/orders?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok || data.memberId !== memberId) throw new Error(data.message ?? "Sesi berubah. Muat ulang halaman.");
      if (!controller.signal.aborted) setOrder(data.order);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [id, memberId, attempt]);
  const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
  const time = (value: string) => new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
  if (error) return <div role="alert"><p>{error}</p><Button onClick={() => { setError(""); setAttempt(attempt + 1); }}>Coba lagi</Button></div>;
  if (!order) return <p role="status">Memuat pesanan...</p>;
  return <section className="panel stack"><h1>{order.terms.title}</h1><p>Pesanan {order.id}</p><p>{order.state === "awaiting_payment" ? "Menunggu pembayaran" : "Dibatalkan"}</p><h2>Rincian yang disepakati</h2>{order.terms.items.map((item, index) => <p key={index}>{item.name} x {item.quantity}: {item.specification} ({money(item.unitBudget)} per item)</p>)}<p>Batas belanja: {money(order.terms.budget)}. Ongkos: {money(order.terms.fee)}.</p><p>Tujuan: {order.terms.destination}</p><p>Pengantaran: {time(order.terms.start)} sampai {time(order.terms.end)}</p><p>Reservasi sampai {time(order.reservationUntil)}.</p><p>Pembayaran dan pengiriman pesan belum tersedia. Pesanan ini tidak membuktikan dana masuk.</p></section>;
}
