"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { PurchaseCommand, PurchaseView } from "@beetip/validation";
import { connectedOrderState } from "./connected-order-state";
import { ConnectedHandover } from "./connected-handover";
import { Button } from "./ui";

const endpoint = "/api/identity/purchases";
const money = (value: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Jakarta" }).format(new Date());
const evidenceUrl = (order: string, key: string) => `${endpoint}/evidence?${new URLSearchParams({ order, key })}`;
type Draft = Pick<Extract<PurchaseCommand, { action: "receipt" }>["payload"], "merchant" | "reference" | "date" | "discount" | "lines">;
type Submission = { command: PurchaseCommand; image?: File };

function ReceiptForm({ save, disabled }: { save: (draft: Draft, image: File) => void; disabled: boolean }) {
  const [rows, setRows] = useState([1]);
  const next = useRef(2);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const image = data.get("image");
    if (!(image instanceof File) || !image.size) return;
    save({ merchant: String(data.get("merchant")), reference: String(data.get("reference")), date: String(data.get("date")),
      discount: Number(data.get("discount")), lines: rows.map(id => ({ label: String(data.get(`line-${id}`)),
        quantity: Number(data.get(`quantity-${id}`)), gross: Number(data.get(`gross-${id}`)) })) }, image);
  }
  return <form className="stack" onSubmit={submit}>
    <fieldset className="stack" disabled={disabled}>
      <legend>Struk baru</legend>
      <label>Nama toko<input name="merchant" maxLength={100} required /></label>
      <label>Nomor struk<input name="reference" maxLength={80} required /></label>
      <label>Tanggal struk<input name="date" type="date" defaultValue={today()} max={today()} required /></label>
      <label>Foto struk (JPEG atau PNG, maks. 2 MB)<input name="image" type="file" accept="image/jpeg,image/png" required /></label>
      {rows.map((id, index) => <fieldset className="stack" key={id}>
        <legend>Baris struk {index + 1}</legend>
        <label>Nama barang di struk<input placeholder="Contoh: Nasi ayam" name={`line-${id}`} maxLength={100} required /></label>
        <div className="form-grid">
          <label>Jumlah di struk<input name={`quantity-${id}`} type="number" min={1} max={1000} defaultValue={1} required /></label>
          <label>Total baris sebelum diskon bersama (Rp)<input name={`gross-${id}`} type="number" min={1} max={100000000} required /></label>
        </div>
        {rows.length > 1 && <Button type="button" variant="secondary" onClick={() => setRows(rows.filter(row => row !== id))}>Hapus baris {index + 1}</Button>}
      </fieldset>)}
      {rows.length < 40 && <Button type="button" variant="secondary" onClick={() => setRows([...rows, next.current++])}>Tambah baris struk</Button>}
      <label>Diskon bersama pada struk (Rp)<input name="discount" type="number" min={0} max={4000000000} defaultValue={0} required /></label>
      <Button type="submit">Simpan struk</Button>
    </fieldset>
  </form>;
}

function AllocationForm({ items, receipt, save, disabled }: {
  items: PurchaseView["items"]; receipt: PurchaseView["receipts"][number];
  save: (payload: Extract<PurchaseCommand, { action: "allocate" }>["payload"]) => void; disabled: boolean;
}) {
  const [rows, setRows] = useState([1]);
  const next = useRef(2);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    save({ receipt: receipt.id, entries: rows.map(id => ({ line: Number(data.get(`line-${id}`)),
      item: Number(data.get(`item-${id}`)), quantity: Number(data.get(`quantity-${id}`)) })) });
  }
  return <form className="stack" onSubmit={submit}>
    <fieldset className="stack" disabled={disabled}>
      <legend>Alokasi untuk pesanan ini</legend>
      <p>Diskon bersama pada struk {money(receipt.discount)}.</p>
      {rows.map((id, index) => <fieldset className="stack" key={id}>
        <legend>Alokasi {index + 1}</legend>
        <label>Baris yang akan dialokasikan<select name={`line-${id}`} required defaultValue="">
          <option value="" disabled>Pilih baris struk</option>
          {receipt.lines.map(line => <option key={line.line} value={line.line}>{line.line}. {line.label}, sisa {line.remaining} ({money(line.gross)} total)</option>)}
        </select></label>
        <label>Barang pesanan<select name={`item-${id}`} required defaultValue="">
          <option value="" disabled>Pilih barang</option>
          {items.map(item => <option key={item.index} value={item.index}>{item.name}{item.specification && ` (${item.specification})`}, sisa {item.quantity - item.purchased}</option>)}
        </select></label>
        <label>Jumlah yang dibeli<input name={`quantity-${id}`} type="number" min={1} max={50} defaultValue={1} required /></label>
        {rows.length > 1 && <Button type="button" variant="secondary" onClick={() => setRows(rows.filter(row => row !== id))}>Hapus alokasi {index + 1}</Button>}
      </fieldset>)}
      {rows.length < 40 && <Button type="button" variant="secondary" onClick={() => setRows([...rows, next.current++])}>Tambah alokasi</Button>}
      <Button type="submit">Simpan alokasi</Button>
    </fieldset>
  </form>;
}

export function ConnectedPurchase({ orderId, memberId, refreshKey, orderState, closed, onChange }: {
  orderId: string; memberId: string; refreshKey: number; orderState: string; closed: boolean; onChange: () => void;
}) {
  const [view, setView] = useState<PurchaseView>();
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Submission>();
  const [panel, setPanel] = useState<"receipt" | "allocate" | "finish">();
  const [receiptId, setReceiptId] = useState("");
  const [attempt, setAttempt] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    void fetch(`${endpoint}?id=${encodeURIComponent(orderId)}`, { cache: "no-store", signal }).then(async response => {
      const data = await response.json();
      if (!response.ok || data.memberId !== memberId || data.orderId !== orderId || !data.purchase) throw new Error(data.message);
      if (!controller.signal.aborted) { setView(data.purchase); setLoadError(""); }
    }).catch(() => { if (!controller.signal.aborted) setLoadError("Progres belanja belum dapat dimuat."); });
    return () => controller.abort();
  }, [orderId, memberId, refreshKey, attempt]);

  async function send(submission: Submission) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setPending(submission);
    setError("");
    setNotice("");
    const headers = { "X-Beetip-Member": memberId };
    const { command, image } = submission;
    try {
      if (image && command.action === "receipt" && !command.payload.imageHash) {
        const response = await fetch(evidenceUrl(orderId, command.operationId), { method: "PUT", headers: { ...headers, "Content-Type": image.type }, body: image, signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (response.status < 500 && !response.ok) { setPending(undefined); setError(data.message ?? "Periksa foto struk."); return; }
        if (!response.ok || typeof data.imageHash !== "string") throw new Error();
        command.payload.imageHash = data.imageHash;
      }
      const response = await fetch(endpoint, { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(command), signal: AbortSignal.timeout(15000) });
      const data = await response.json();
      if (response.status < 500 && !response.ok) { setPending(undefined); setError(data.message ?? "Periksa data belanja."); return; }
      if (!response.ok || data.ok !== true || typeof data.resultId !== "string") throw new Error();
      setPending(undefined);
      setNotice({ receipt: "Struk tersimpan. Pilih struk ini untuk mengalokasikan barang.", allocate: "Alokasi tersimpan.", finish: "Progres akhir tersimpan." }[command.action]);
      if (command.action === "receipt") setReceiptId(data.resultId);
      setPanel(command.action === "receipt" ? "allocate" : undefined);
      onChange();
    } catch { setError("Hasil belum dapat dipastikan. Coba kirim ulang tindakan yang sama."); }
    finally { setBusy(false); inFlight.current = false; }
  }

  if (!view && loadError) return <section className="stack" aria-label="Progres belanja"><p role="alert">{loadError}</p>
    <Button variant="secondary" onClick={() => setAttempt(attempt + 1)}>Muat ulang progres</Button></section>;
  if (!view) return <section aria-label="Progres belanja"><p role="status">Memuat progres belanja...</p></section>;
  const complete = Boolean(view.state && view.state !== "purchasing");
  const remaining = view.items.filter(item => item.purchased < item.quantity);
  const receipt = view.receipts.find(row => row.id === receiptId);
  const locked = Boolean(pending || busy);
  const base = () => ({ orderId, version: view.version, operationId: crypto.randomUUID() });
  return <><section className="stack" aria-label="Progres belanja">
    <h2>Progres belanja</h2>
    {view.customerName && <p>Pesanan untuk {view.customerName}</p>}
    {loadError && <p role="alert">{loadError} <Button variant="secondary" onClick={() => setAttempt(attempt + 1)}>Muat ulang progres</Button></p>}
    <p>{view.state ? connectedOrderState(view.state) : closed ? "Belanja tidak dapat dilanjutkan." : view.ready ? "Siap dibelanjakan" : "Menunggu dana terverifikasi atau keputusan perubahan."}</p>
    <ul>{view.items.map(item => <li key={item.index}>{item.name}{item.specification && ` (${item.specification})`}. Dibeli {item.purchased}/{item.quantity}{item.unavailable > 0 && `, tidak tersedia ${item.unavailable}`}.</li>)}</ul>
    {view.note && <p>Alasan barang tidak tersedia: {view.note}</p>}
    <p>Belanja tercatat {money(view.spent)} dari batas {money(view.budget)}.</p>
    {view.allocations.length > 0 && <details>
      <summary>Rincian struk dan diskon</summary>
      <p>Diskon bersama dibagi menurut nilai baris struk. Untuk baris yang dibagi, bagian diskon mengikuti nilai yang dialokasikan. Selisih pembulatan rupiah dibawa ke bagian berikutnya.</p>
      <ul>{view.allocations.map(row => <li key={row.id} style={{ overflowWrap: "anywhere" }}>
        {row.merchant} ({row.reference}, {row.date}), baris {row.line} {row.label} × {row.quantity}. {money(row.gross)} dikurangi {money(row.discount)} = {money(row.net)}.
        {view.provider && <> <a href={evidenceUrl(orderId, row.receipt)}>Unduh foto struk</a></>}
      </li>)}</ul>
    </details>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {pending && <Button type="button" disabled={busy} onClick={() => void send(pending)}>{busy ? "Menyimpan..." : "Kirim ulang tindakan"}</Button>}
    {view.provider && view.ready && !complete && !closed && <>
      <div className="actions">
        {remaining.length > 0 && <>
          <Button type="button" variant="secondary" aria-expanded={panel === "receipt"} disabled={locked} onClick={() => setPanel(panel === "receipt" ? undefined : "receipt")}>Tambah struk</Button>
          {view.receipts.length > 0 && <Button type="button" variant="secondary" aria-expanded={panel === "allocate"} disabled={locked} onClick={() => setPanel(panel === "allocate" ? undefined : "allocate")}>Pilih struk tersimpan</Button>}
        </>}
        <Button type="button" variant="secondary" aria-expanded={panel === "finish"} disabled={locked} onClick={() => setPanel(panel === "finish" ? undefined : "finish")}>Selesaikan belanja</Button>
      </div>
      {panel === "receipt" && <ReceiptForm disabled={locked} save={(draft, image) => void send({ command: { ...base(), action: "receipt", payload: { ...draft, imageHash: "" } }, image })} />}
      {panel === "allocate" && <>
        <label>Struk untuk alokasi<select value={receipt?.id ?? ""} onChange={event => setReceiptId(event.target.value)} disabled={locked}>
          <option value="">Pilih struk</option>
          {view.receipts.map(row => <option key={row.id} value={row.id}>{row.merchant} ({row.reference}, {row.date})</option>)}
        </select></label>
        {receipt && <><a href={evidenceUrl(orderId, receipt.id)}>Unduh foto struk</a>
          <AllocationForm key={receipt.id} items={remaining} receipt={receipt} disabled={locked}
            save={payload => void send({ command: { ...base(), action: "allocate", payload } })} /></>}
      </>}
      {panel === "finish" && <form className="stack" onSubmit={event => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void send({ command: { ...base(), action: "finish", payload: { unavailable: data.getAll("missing").map(Number), note: String(data.get("note") ?? "") } } });
      }}>
        <fieldset className="stack" disabled={locked}>
          <legend>Konfirmasi hasil belanja</legend>
          {remaining.map(item => <label key={item.index}><input type="checkbox" name="missing" value={item.index} required /> {item.name}{item.specification && ` (${item.specification})`}, sisa {item.quantity - item.purchased} tidak tersedia</label>)}
          {remaining.length > 0 ? <label>Alasan barang tidak tersedia<textarea name="note" maxLength={400} required /></label> : <p>Semua jumlah yang disetujui sudah dialokasikan.</p>}
          <p>Setelah dikonfirmasi, hasil belanja terkunci.</p>
          <Button type="submit">Konfirmasi selesai</Button>
        </fieldset>
      </form>}
    </>}
    {view.tripOrders.length > 0 && <nav className="stack" aria-label="Pesanan lain dalam perjalanan ini">
      <h3>Pesanan lain dalam perjalanan ini</h3>
      <ul>{view.tripOrders.map(order => <li key={order.id}>
        <Link href={`/orders/${order.id}`}>{order.name} <span>({order.id.slice(0, 8)})</span></Link> · {connectedOrderState(order.state)}
      </li>)}</ul>
    </nav>}
  </section>
    {(["delivering", "delivery_confirmed"].includes(orderState) || view.provider && ["purchased", "purchase_partial"].includes(orderState)) &&
      <ConnectedHandover key={orderState === "delivery_confirmed" ? "confirmed" : "pending"}
        orderId={orderId} memberId={memberId} orderState={orderState} provider={view.provider} onChange={onChange} />}
  </>;
}
