"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ManualTransferCommand, ManualTransferQueue, ManualTransferView } from "@beetip/validation";
import { Button } from "./ui";

const endpoint = "/api/identity/manual-transfers";
const page = "/account/transfers";
const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });
const states = {
  prepared: "Disiapkan", approved: "Disetujui", started: "Simulasi dimulai", ambiguous: "Hasil belum pasti",
  completed: "Tercatat terkirim", not_sent: "Tidak dikirim",
};
const components = { purchase: "Biaya barang", fee: "Ongkos jastip", refund: "Pengembalian dana" };
const labels = {
  approve: "Setujui permintaan", start: "Mulai simulasi transfer", abandon: "Tutup permintaan",
  completed: "Catat terkirim", not_sent: "Catat tidak dikirim", ambiguous: "Catat hasil belum pasti",
  resolve_completed: "Konfirmasi terkirim dari mutasi", resolve_not_sent: "Konfirmasi tidak dikirim dari mutasi",
};
type Action = ManualTransferCommand["action"];
type Transfer = ManualTransferView["history"][number];

async function request(query: string, memberId: string, init: RequestInit = {}) {
  const response = await fetch(query ? `${endpoint}?${query}` : endpoint, {
    cache: "no-store", signal: AbortSignal.timeout(15000), ...init,
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message ?? "Pemeriksaan transfer gagal.");
    throw Object.assign(error, { definitive: [400, 401, 403, 409].includes(response.status) });
  }
  if (body.memberId !== memberId) throw new Error("Sesi berubah. Muat ulang halaman.");
  return body;
}

function message(error: unknown) {
  return error instanceof Error && error.name === "Error" ? error.message : "Koneksi terputus. Coba lagi.";
}

export function ConnectedTransferQueue({ memberId }: { memberId: string }) {
  const [rows, setRows] = useState<ManualTransferQueue | null>(null);
  const [after, setAfter] = useState<string>();
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ view: "queue", ...(after ? { after } : {}) });
    void request(query.toString(), memberId, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(({ data }) => { if (!controller.signal.aborted) { setRows(data); setError(""); } })
      .catch(error => { if (!controller.signal.aborted) { setRows(null); setError(message(error)); } });
    return () => controller.abort();
  }, [after, memberId, refresh]);
  return <section className="panel stack">
    <h1>Transfer dan pengembalian dana</h1>
    <p>Simulasi dengan dana dan akun uji. Pemeriksaan memerlukan MFA petugas keuangan.</p>
    {error ? <><p role="alert">{error}</p><p><Link href="/account/affiliation">Keamanan akun</Link></p>
      <Button onClick={() => setRefresh(value => value + 1)}>Coba lagi</Button></> : rows === null ? <p role="status">Memuat pesanan…</p>
      : rows.length === 0 ? <p>Belum ada pesanan untuk diperiksa.</p> : <ul className="stack">
        {rows.map(row => <li key={row.orderId}><Link href={`${page}?order=${row.orderId}`}>{row.title}</Link>
          <p className="small">{row.accountLabel} · {row.latestState ? states[row.latestState] : "Siap diperiksa"}</p></li>)}
      </ul>}
    {after && <Button variant="secondary" onClick={() => { setRows(null); setAfter(undefined); }}>Kembali ke awal</Button>}
    {rows?.length === 30 && <Button variant="secondary" onClick={() => {
      setAfter(rows.at(-1)?.orderId); setRows(null);
    }}>Pesanan berikutnya</Button>}
  </section>;
}

function TransferAction({ action, busy, onSend }: {
  action: Transfer["actions"][number]; busy: boolean; onSend: (fields: FormData) => void;
}) {
  return <form className="stack" onSubmit={event => { event.preventDefault(); onSend(new FormData(event.currentTarget)); }}>
    {action.startsWith("resolve_") && <label className="field">Catatan mutasi akun uji
      <input name="record" required maxLength={160} />
    </label>}
    {(action === "completed" || action === "resolve_completed") && <label className="field">Referensi transaksi sintetis
      <input name="reference" required maxLength={64} aria-describedby={`transfer-reference-${action}`} />
      <small id={`transfer-reference-${action}`}>Awali dengan TEST, lalu isi kode transaksi uji.</small>
    </label>}
    <label className="field">Catatan petugas
      <textarea name="note" rows={2} required maxLength={1000} />
    </label>
    <Button type="submit" disabled={busy}>{labels[action]}</Button>
  </form>;
}

export function ConnectedTransfers({ memberId, order }: { memberId: string; order: string }) {
  const storageKey = `beetip-transfer:${memberId}:${order}`;
  const [view, setView] = useState<ManualTransferView | null>(null);
  const [pending, setPending] = useState("");
  const [retryAllowed, setRetryAllowed] = useState(false);
  const [selection, setSelection] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [before, setBefore] = useState<string>();
  const active = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ order, ...(before ? { before } : {}) });
    void request(query.toString(), memberId, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(body => {
        if (controller.signal.aborted) return;
        if (body.orderId !== order) throw new Error("Sesi berubah. Muat ulang halaman.");
        setPending(sessionStorage.getItem(storageKey) ?? "");
        setView(body.data);
      }).catch(failure => {
        if (!controller.signal.aborted) { setView(null); setError(message(failure)); }
      });
    return () => controller.abort();
  }, [before, memberId, order, refresh, storageKey]);

  function reload() { setView(null); setBefore(undefined); setSelection(""); setRefresh(value => value + 1); }

  async function send(action: Action, payload: Record<string, unknown>) {
    if (active.current || (pending && !retryAllowed)) return;
    active.current = true;
    setBusy(true); setError(""); setNotice("");
    const operationId = pending || crypto.randomUUID();
    try {
      sessionStorage.setItem(storageKey, operationId);
      setPending(operationId); setRetryAllowed(false);
      const body = await request("", memberId, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId },
        body: JSON.stringify({ orderId: order, operationId, action, payload }),
      });
      if (body.orderId !== order || typeof body.transferId !== "string") throw new Error("Respons belum terkonfirmasi.");
      sessionStorage.removeItem(storageKey);
      setPending(""); setNotice("Perubahan tersimpan."); reload();
    } catch (failure) {
      if (failure instanceof Error && "definitive" in failure && failure.definitive) {
        sessionStorage.removeItem(storageKey);
        setPending(""); setError(failure.message); reload();
      } else {
        setError("Status penyimpanan belum diketahui. Periksa operasi sebelum mengirim ulang.");
      }
    } finally { active.current = false; setBusy(false); }
  }

  async function lookup() {
    if (active.current || !pending) return;
    active.current = true;
    setBusy(true); setError(""); setNotice(""); setRetryAllowed(false);
    try {
      const { data } = await request(new URLSearchParams({ operation: pending }).toString(), memberId);
      if (data === null) {
        setNotice("Operasi belum ditemukan. Muat ulang data dan, jika perlu, kirim ulang isian yang sama.");
        setRetryAllowed(true); reload(); return;
      }
      if (data.orderId !== order) throw new Error("Operasi ini berasal dari pesanan lain.");
      sessionStorage.removeItem(storageKey);
      setPending(""); setNotice("Operasi tersimpan. Status transfer diperbarui."); reload();
    } catch (failure) { setError(message(failure)); }
    finally { active.current = false; setBusy(false); }
  }

  const selected = selection ? view?.options[Number(selection)] : undefined;
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const fields = new FormData(event.currentTarget);
    void send("prepare", {
      component: selected.component, ...(selected.itemIndex === null ? {} : { itemIndex: selected.itemIndex }),
      amount: Number(fields.get("amount")), note: fields.get("note"),
    });
  }

  const locked = busy || Boolean(pending && !retryAllowed);
  return <section className="panel stack" aria-busy={busy}>
    <Link href={page}>Semua pemeriksaan transfer</Link>
    <h1>{view?.title ?? "Pemeriksaan transfer"}</h1>
    <p>Simulasi dana uji. Langkah di halaman ini hanya mencatat hasil latihan.</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {pending && <div className="info-box stack"><p>Periksa apakah operasi terakhir tersimpan.</p>
      <Button variant="secondary" disabled={busy} onClick={() => void lookup()}>Periksa operasi</Button></div>}
    <Button variant="secondary" disabled={busy} onClick={() => { setError(""); reload(); }}>Muat ulang data</Button>
    {!view && !error && <p role="status">Memuat status transfer…</p>}
    {view && <>
      <p><strong>Akun uji</strong> {view.accountLabel}</p>
      {view.accountBlocked && <div className="info-box stack">
        <p>Akun masih memiliki transfer yang belum selesai. Periksa hasilnya sebelum memulai transfer lain.</p>
        {view.blockingOrderId && <Link href={`${page}?order=${view.blockingOrderId}`}>Buka transfer yang belum selesai</Link>}
      </div>}
      {!before && view.options.length > 0 && <form className="stack" onSubmit={prepare}>
        <h2>Siapkan permintaan</h2>
        <label className="field">Alokasi tersedia
          <select value={selection} required onChange={event => setSelection(event.target.value)}>
            <option value="">Pilih alokasi</option>
            {view.options.map((option, index) => <option key={`${option.component}:${option.itemIndex}`} value={index}>
              {components[option.component]} {option.label} · {currency.format(option.amount)}
            </option>)}
          </select>
        </label>
        <label className="field">Nominal (Rp)<input name="amount" type="number" inputMode="numeric" min={1} max={selected?.amount} step={1} required /></label>
        <label className="field">Catatan permintaan<textarea name="note" rows={2} required maxLength={1000} /></label>
        <Button type="submit" disabled={locked || !selected}>Simpan permintaan</Button>
      </form>}
      <h2>Riwayat transfer</h2>
      {view.history.length === 0 && <p>Belum ada catatan transfer.</p>}
      {view.history.map(transfer => <article key={transfer.id} className="info-box stack">
        <h3>{components[transfer.component]} {transfer.itemLabel} · {currency.format(transfer.amount)}</h3>
        <p><strong>{states[transfer.state]}</strong>{transfer.independentReview && transfer.state === "prepared" && " · Memerlukan persetujuan petugas kedua"}</p>
        {transfer.allocationChanged && <p>Alokasi berubah. Tutup permintaan ini untuk menyiapkan permintaan baru.</p>}
        <details><summary>Catatan dan hasil</summary><ol className="stack">
          {transfer.facts.map((fact, index) => <li key={index}><strong>{states[fact.state]}</strong>
            <p className="small">{date.format(new Date(fact.at))} WIB · {fact.actorId === memberId ? "Anda" : "Petugas lain"}</p>
            <p>{fact.note}</p>
            {fact.reference && <p>Referensi {fact.reference}</p>}
            {fact.accountRecord && <p>Catatan mutasi {fact.accountRecord}</p>}
          </li>)}
        </ol></details>
        {!before && transfer.actions.map(action => <TransferAction key={`${transfer.version}:${action}`} action={action} busy={locked}
          onSend={fields => void send(action, { transferId: transfer.id, version: transfer.version, ...Object.fromEntries(fields) })} />)}
      </article>)}
      {before && <Button variant="secondary" onClick={reload}>Kembali ke catatan terbaru</Button>}
      {view.history.length === 30 && <Button variant="secondary" onClick={() => {
        setBefore(view.history.at(-1)?.id); setView(null);
      }}>Catatan sebelumnya</Button>}
    </>}
  </section>;
}
