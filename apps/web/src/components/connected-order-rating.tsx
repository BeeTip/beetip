"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { orderRatingCommandSchema, type OrderRating, type OrderRatingCommand } from "@beetip/validation";
import { Button } from "./ui";

const endpoint = "/api/identity/order-ratings";

export function ConnectedOrderRating({ orderId, memberId }: { orderId: string; memberId: string }) {
  const heading = useId();
  const [rating, setRating] = useState<OrderRating | null>(null);
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<OrderRatingCommand | null>(null);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch(`${endpoint}?orderId=${encodeURIComponent(orderId)}`, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || data.memberId !== memberId) throw new Error(data.message ?? "Sesi berubah. Muat ulang halaman.");
      setRating(data.rating);
      setNeedsReload(false);
    } catch (error) {
      if (!controller.signal.aborted) {
        setNeedsReload(true);
        setError(error instanceof Error && error.name === "Error" ? error.message : "Penilaian belum dapat dimuat. Coba lagi.");
      }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [memberId, orderId]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || needsReload) return;
    const parsed = orderRatingCommandSchema.safeParse({
      operationId: pending.current?.operationId ?? crypto.randomUUID(), orderId, score: Number(score), feedback,
    });
    if (!parsed.success) { setError("Pilih nilai 1 sampai 5 dan isi maksimal 500 karakter."); return; }
    pending.current = parsed.data;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (response.status >= 500 || (response.ok && data.memberId !== memberId)) throw new Error();
      pending.current = null;
      setUncertain(false);
      if (!response.ok) {
        setNeedsReload(data.code === "ALREADY_RATED");
        setError(data.message);
        return;
      }
      setRating(data.rating);
    } catch {
      setUncertain(true);
      setError("Penilaian belum dapat dikonfirmasi. Coba lagi.");
    } finally { setBusy(false); }
  }

  return <section className="panel stack" aria-labelledby={heading}>
    <h2 id={heading}>Penilaian pesanan</h2>
    {loading && <p role="status">Memuat penilaian...</p>}
    {error && <p className="info-box" role="alert">{error}</p>}
    {needsReload && <Button variant="secondary" disabled={loading} onClick={() => void load()}>Muat ulang penilaian</Button>}
    {!loading && !needsReload && (rating ? <>
      <p role="status">Penilaian terkirim: {rating.score} dari 5.</p>
      {rating.feedback && <p>{rating.feedback}</p>}
    </> : <form className="stack" onSubmit={submit}>
      <p>Nilai dan masukan hanya terlihat oleh akunmu.</p>
      <label className="field">Nilai layanan
        <select required value={score} disabled={busy || uncertain} onChange={event => setScore(event.target.value)}>
          <option value="">Pilih nilai</option>
          <option value="1">1 · Sangat buruk</option>
          <option value="2">2 · Buruk</option>
          <option value="3">3 · Cukup</option>
          <option value="4">4 · Baik</option>
          <option value="5">5 · Sangat baik</option>
        </select>
      </label>
      <label className="field">Masukan pribadi (opsional)
        <textarea maxLength={500} value={feedback} disabled={busy || uncertain} onChange={event => setFeedback(event.target.value)} />
      </label>
      <Button type="submit" disabled={busy}>{busy ? "Mengirim..." : "Kirim penilaian"}</Button>
    </form>)}
  </section>;
}
