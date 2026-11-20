"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { AcceptanceCommand } from "@beetip/validation";
import { Button } from "./ui";

export function ConnectedAcceptance({ memberId, listingId, listingVersion, offerId, offerVersion }: Omit<AcceptanceCommand, "operationId"> & { memberId: string }) {
  const pending = useRef<AcceptanceCommand | null>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
  const consentKey = `${listingId}:${listingVersion}:${offerId ?? "fixed"}:${offerVersion ?? 0}`;
  const [consented, setConsented] = useState<string | null>(null);
  const consent = consented === consentKey;
  async function accept() {
    if (submitting.current || orderId || (!consent && !pending.current)) return;
    pending.current ??= { operationId: crypto.randomUUID(), listingId, listingVersion, ...(offerId ? { offerId, offerVersion } : {}) };
    submitting.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/identity/orders", { method: "POST", headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId }, body: JSON.stringify(pending.current), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (!response.ok || !data.ok || typeof data.orderId !== "string") {
        if ([400, 401, 403, 409].includes(response.status)) { pending.current = null; setUnknown(false); setConsented(null); }
        else setUnknown(true);
        throw new Error(data.message ?? "Hasil belum diketahui. Coba lagi dengan permintaan yang sama.");
      }
      pending.current = null; setUnknown(false); setOrderId(data.orderId);
    } catch (error) {
      if (pending.current) setUnknown(true);
      setError(error instanceof Error ? error.message : "Hasil belum diketahui. Coba lagi.");
    } finally { submitting.current = false; setBusy(false); }
  }
  if (orderId) return <div role="status"><p>Pesanan tersimpan.</p><Link className="button button-primary" href={`/orders/${orderId}`}>Lihat pesanan</Link></div>;
  return <div className="stack"><label className="check-field"><input type="checkbox" checked={consent} disabled={busy || unknown} onChange={event => setConsented(event.target.checked ? consentKey : null)} />{unknown ? "Penerimaan memakai rincian, ongkos, dan jadwal yang disetujui pada permintaan semula." : `Saya menyetujui rincian, ongkos, dan jadwal revisi ${listingVersion} untuk membuat pesanan.`}</label>{error && <p role="alert">{error}</p>}{unknown && <p role="status">Hasil belum diketahui. Coba lagi memakai ID operasi dan rincian semula.</p>}<Button disabled={busy || (!consent && !unknown)} onClick={() => void accept()}>{busy ? "Menyimpan pesanan..." : unknown ? "Coba lagi penerimaan" : offerId ? "Terima penawaran" : "Ambil permintaan harga tetap"}</Button></div>;
}
