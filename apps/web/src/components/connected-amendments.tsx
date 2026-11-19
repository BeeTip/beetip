"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { amendmentCommandSchema, type AmendmentItem, type AmendmentView } from "@beetip/validation";
import { Button } from "./ui";

const endpoint = "/api/identity/amendments";
const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const labels = { pending: "Menunggu persetujuan", approved: "Disetujui", rejected: "Ditolak" };

function Terms({ items, budget }: { items: AmendmentItem[]; budget: number }) {
  return <>
    <ul className="list-disc break-words pl-5">{items.map((item, index) =>
      <li key={index}>{item.name} × {item.quantity} ({money.format(item.unitBudget)} per barang){item.specification && <span> · {item.specification}</span>}</li>
    )}</ul>
    <p>Batas belanja {money.format(budget)}.</p>
  </>;
}

function Proposal({ items, disabled, propose }: { items: AmendmentItem[]; disabled: boolean; propose: (items: AmendmentItem[], reason: string) => void }) {
  const nextKey = useRef(items.length);
  const [rows, setRows] = useState(() => items.map((item, key) => ({ ...item, key })));
  const budget = rows.reduce((total, item) => total + item.quantity * item.unitBudget, 0);

  function edit(key: number, update: Partial<AmendmentItem>) {
    setRows(current => current.map(item => item.key === key ? { ...item, ...update } : item));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    propose(rows.map(item => ({ name: item.name, specification: item.specification, quantity: item.quantity, unitBudget: item.unitBudget })), reason);
  }

  return <form onSubmit={submit}><fieldset className="stack min-w-0" disabled={disabled}>
    {rows.map((item, index) => <fieldset key={item.key} className="stack min-w-0">
      <legend>Barang {index + 1}</legend>
      <label>Nama barang<input value={item.name} required maxLength={100} onChange={event => edit(item.key, { name: event.target.value })} /></label>
      <label>Spesifikasi<input value={item.specification} maxLength={200} onChange={event => edit(item.key, { specification: event.target.value })} /></label>
      <label>Jumlah<input type="number" inputMode="numeric" value={item.quantity || ""} required min={1} max={50} onChange={event => edit(item.key, { quantity: Number(event.target.value) })} /></label>
      <label>Batas harga per barang (Rp)<input type="number" inputMode="numeric" value={item.unitBudget || ""} required min={1000} max={150000} onChange={event => edit(item.key, { unitBudget: Number(event.target.value) })} /></label>
      {rows.length > 1 && <Button type="button" variant="secondary" onClick={() => setRows(current => current.filter(row => row.key !== item.key))}>Hapus barang {index + 1}</Button>}
    </fieldset>)}
    {rows.length < 20 && <Button type="button" variant="secondary" onClick={() => {
      const key = nextKey.current++;
      setRows(current => [...current, { key, name: "", specification: "", quantity: 1, unitBudget: 1000 }]);
    }}>Tambah barang</Button>}
    <label>Alasan perubahan<textarea name="reason" required maxLength={400} /></label>
    <p>Batas belanja yang diusulkan {money.format(budget)}.</p>
    {budget > 150000 && <p role="alert">Batas belanja maksimal Rp150.000.</p>}
    <Button type="submit" disabled={budget > 150000}>Kirim usulan</Button>
  </fieldset></form>;
}

export function ConnectedAmendments({ orderId, memberId, refreshKey, onChange }: {
  orderId: string; memberId: string; refreshKey: number; onChange: () => void;
}) {
  const [view, setView] = useState<AmendmentView | null>(null);
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(false);
  const attempt = useRef<{ body: string; action: string } | null>(null);
  const active = useRef(false);
  const pending = view?.history.find(entry => entry.state === "pending");

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${endpoint}?id=${encodeURIComponent(orderId)}`, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    }).then(async response => {
      const body = await response.json();
      if (!response.ok || body.memberId !== memberId || !body.amendment) throw new Error(body.message ?? "Status perubahan belum tersedia.");
      if (!controller.signal.aborted) {
        setView(body.amendment);
        setReadError("");
      }
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setView(null);
        setReadError(failure.name === "Error" ? failure.message : "Status perubahan belum tersedia.");
      }
    });
    return () => controller.abort();
  }, [orderId, memberId, refreshKey]);

  async function send() {
    if (!attempt.current || active.current) return;
    const { body, action } = attempt.current;
    active.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
        headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId }, body,
      });
      const result = await response.json();
      if (response.ok && result.ok === true && typeof result.amendmentId === "string") {
        attempt.current = null;
        setView(null);
        setNotice(action === "propose" ? "Usulan dikirim." : action === "approve" ? "Perubahan disetujui." : "Usulan ditolak.");
        onChange();
      } else if ([400, 401, 403, 409].includes(response.status) && result.ok === false) {
        attempt.current = null;
        if (response.status === 409) setView(null);
        setError(result.message ?? "Periksa status perubahan terbaru.");
        onChange();
      } else {
        throw new Error();
      }
    } catch {
      setError("Hasil belum diketahui. Coba lagi untuk mengirim permintaan yang sama.");
    } finally {
      setRetry(attempt.current !== null);
      active.current = false;
      setBusy(false);
    }
  }

  function command(input: object) {
    if (!view || attempt.current) return;
    const parsed = amendmentCommandSchema.safeParse({ ...input, orderId, version: view.version, operationId: crypto.randomUUID() });
    if (!parsed.success) {
      setError("Periksa rincian barang, batas belanja, dan alasan perubahan.");
      return;
    }
    attempt.current = { body: JSON.stringify(parsed.data), action: parsed.data.action };
    void send();
  }

  return <section className="stack" aria-labelledby="amendments-title">
    <h2 id="amendments-title">Perubahan pesanan</h2>
    {readError && <div role="alert"><p>{readError}</p><Button type="button" onClick={onChange}>Coba lagi</Button></div>}
    {!view && !readError && <p role="status">Memuat perubahan pesanan...</p>}
    {view && <>
      {view.version > 1 && <div className="stack">
        <h3>Rincian yang berlaku · Versi {view.version}</h3>
        <Terms items={view.items} budget={view.budget} />
      </div>}
      {pending && <div className="stack">
        <h3>Usulan {pending.revision} · {labels.pending}</h3>
        <p className="break-words">{pending.reason}</p>
        <Terms items={pending.items} budget={pending.budget} />
        <p>Total jika disetujui {money.format(pending.budget + view.fee)}, termasuk ongkos. Belanja menunggu keputusan dan dana terverifikasi yang cukup.</p>
        {view.editable && !view.provider && <>
          <Button type="button" disabled={busy || retry} onClick={() => command({ action: "approve", amendmentId: pending.id })}>Setujui perubahan</Button>
          <Button type="button" variant="secondary" disabled={busy || retry} onClick={() => command({ action: "reject", amendmentId: pending.id })}>Tolak perubahan</Button>
        </>}
      </div>}
      {view.editable && view.provider && !pending &&
        <details key={view.version} className="stack">
          <summary>Usulkan perubahan barang atau biaya</summary>
          <Proposal items={view.items} disabled={busy || retry} propose={(items, reason) => command({ action: "propose", items, reason })} />
        </details>}
      {view.history.filter(entry => entry.state !== "pending").map(entry => <details key={entry.id}>
        <summary>Usulan {entry.revision} · {labels[entry.state]}</summary>
        <p className="break-words">{entry.reason}</p>
        <Terms items={entry.items} budget={entry.budget} />
      </details>)}
    </>}
    {busy && <p role="status">Menyimpan keputusan...</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {retry && <Button type="button" disabled={busy} onClick={() => void send()}>Ulangi permintaan terakhir</Button>}
  </section>;
}
