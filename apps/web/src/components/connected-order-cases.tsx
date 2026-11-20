"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OrderCaseCommand, OrderCaseQueue, OrderCaseView } from "@beetip/validation";
import { Button } from "./ui";

const endpoint = "/api/identity/order-cases";
const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const kinds = { cancellation: "Pembatalan", dispute: "Sengketa" };
const states = { open: "sedang ditinjau", resolved: "diselesaikan", dismissed: "ditutup tanpa perubahan alokasi" };
const proposals = { pending: "Menunggu petugas kedua", returned: "Dikembalikan untuk diperbaiki", stale: "Perlu usulan baru", approved: "Disetujui" };
const components = { purchase: "Biaya barang", fee: "Ongkos jastip", refund: "Pengembalian dana" } as const;
type Amounts = OrderCaseView["allocation"];
type Action = OrderCaseCommand["action"];

async function caseRequest(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000), ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Permintaan kasus gagal. Muat ulang dan coba lagi.");
  return body;
}

function evidenceUrl(order: string, key: string) {
  return `${endpoint}/evidence?${new URLSearchParams({ order, key })}`;
}

function AmountSummary({ title, value }: { title: string; value: Amounts }) {
  return <div><strong>{title}</strong><dl>
    {(Object.keys(components) as (keyof Amounts)[]).map(key => <div className="amount-row" key={key}>
      <dt>{components[key]}</dt><dd>{money.format(value[key])}</dd>
    </div>)}
  </dl></div>;
}

function Photo({ required = false }: { required?: boolean }) {
  return <label className="field">Foto bukti {required ? "(wajib)" : "(opsional)"}
    <input name="photo" type="file" accept="image/png,image/jpeg" required={required} />
    <small>JPG atau PNG, maksimal 2 MB. Hindari foto dengan data pribadi yang tidak diperlukan.</small>
  </label>;
}

function Reason({ label = "Alasan" }: { label?: string }) {
  return <label className="field">{label}<textarea name="reason" required maxLength={1000} rows={3} /></label>;
}

export function ConnectedOrderCases({ orderId, memberId, boothDemo, refreshKey = 0, onChange }: {
  orderId: string; memberId: string; boothDemo?: boolean; refreshKey?: number; onChange?: () => void;
}) {
  const [view, setView] = useState<OrderCaseView | null>(null);
  const [storage, setStorage] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const operation = useRef<{ signature: string; id: string; imageHash?: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void caseRequest(`${endpoint}?order=${encodeURIComponent(orderId)}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
    }).then(body => {
      if (controller.signal.aborted) return;
      if (body.memberId !== memberId || body.orderId !== orderId) throw new Error("Sesi berubah. Muat ulang halaman.");
      setView(body.data); setStorage(body.storageAvailable === true);
    }).catch(failure => {
      if (controller.signal.aborted) return;
      setView(null); setError(failure.name === "Error" ? failure.message : "Status kasus belum tersedia. Coba lagi.");
    });
    return () => controller.abort();
  }, [orderId, memberId, refreshKey, refresh]);

  function reload() { setError(""); setRefresh(value => value + 1); }

  async function submit(form: HTMLFormElement, action: Action, payload: Record<string, unknown>, photo?: File) {
    if (active.current) return;
    active.current = true;
    setBusy(true); setError(""); setNotice("");
    try {
      if (!payload.reason) throw new Error("Isi alasan sebelum mengirim.");
      const image = photo?.size ? photo : undefined;
      if (image && (!storage || image.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(image.type))) {
        throw new Error("Pilih foto JPG atau PNG berukuran maksimal 2 MB.");
      }
      const signature = JSON.stringify([orderId, action, payload, image ? [image.name, image.size, image.type, image.lastModified] : null]);
      const pending = operation.current?.signature === signature ? operation.current : { signature, id: crypto.randomUUID() };
      operation.current = pending;
      if (image && !pending.imageHash) {
        const result = await caseRequest(evidenceUrl(orderId, pending.id), {
          method: "PUT", headers: { "Content-Type": image.type, "X-Beetip-Member": memberId }, body: image,
        });
        pending.imageHash = result.imageHash;
      }
      await caseRequest(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId },
        body: JSON.stringify({ orderId, action, operationId: pending.id, payload: { ...payload, imageHash: pending.imageHash } }),
      });
      operation.current = null;
      form.reset();
      setNotice("Pembaruan kasus tersimpan.");
      if (onChange) onChange(); else reload();
    } catch (failure) {
      setError(failure instanceof Error && failure.name === "Error" ? failure.message : "Koneksi terputus. Muat ulang status atau coba kirim lagi.");
    } finally { active.current = false; setBusy(false); }
  }

  function send(event: FormEvent<HTMLFormElement>, action: Action, payload: (fields: FormData) => Record<string, unknown>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const photo = fields.get("photo");
    void submit(form, action, { ...payload(fields), reason: String(fields.get("reason")).trim() }, photo instanceof File ? photo : undefined);
  }

  const orderCase = view?.case;
  const proposal = orderCase?.proposal;
  const demo = view?.boothDemo ?? boothDemo ?? false;
  const open = orderCase?.state === "open";
  const support = `/support?orderId=${encodeURIComponent(orderId)}`;
  return <section className="panel stack" aria-label="Pembatalan dan sengketa" aria-busy={busy}>
    <h2>Pembatalan dan sengketa</h2>
    {error && <div role="alert"><p>{error}</p><Button type="button" variant="secondary" onClick={reload}>Muat ulang kasus</Button>
      <p className="small">Petugas dapat memeriksa MFA di <Link href="/account/affiliation">keamanan akun</Link>.</p></div>}
    {(view || boothDemo === false) && !demo && <Link href={support}>Minta bantuan untuk pesanan ini</Link>}
    {notice && <p role="status">{notice}</p>}
    {!view && !error && <p role="status">Memuat kasus pesanan...</p>}
    {view && <>
      {orderCase && <>
        <h3>{kinds[orderCase.kind]} {demo && orderCase.state === "dismissed" ? "ditutup" : states[orderCase.state]}</h3>
        <p>{orderCase.reason}</p>
        {orderCase.itemIndex != null && <p>Barang yang disengketakan {view.items.find(item => item.index === orderCase.itemIndex)?.name}</p>}
        {!demo && <p>Dana terverifikasi {money.format(view.verified)}.</p>}
        {open && <>
          {!demo && <>
            <AmountSummary title="Dana ditahan" value={view.held} />
            <AmountSummary title="Dana di luar penahanan yang belum dialokasikan ke transfer" value={view.unheld} />
          </>}
          {demo && orderCase.kind === "cancellation" && <p>Belanja dan serah terima dijeda selama peninjauan pembatalan.</p>}
        </>}
        {orderCase.evidence.length > 0 && <ul aria-label="Bukti kasus">
          {orderCase.evidence.map(evidence => <li key={evidence.id}><a href={evidenceUrl(orderId, evidence.id)}>Unduh foto bukti</a><p>{evidence.note}</p></li>)}
        </ul>}
        {proposal && <div className="info-box stack">
          <strong>{proposals[proposal.status]}</strong>
          {demo ? <p>{proposal.outcome === "dismiss" ? "Usulan menutup kasus." : "Usulan menyelesaikan kasus."}</p> : <>
            <p>{proposal.outcome === "dismiss" ? "Usulan menutup kasus tanpa perubahan alokasi." : "Usulan menyelesaikan kasus dengan alokasi berikut."}</p>
            <AmountSummary title="Alokasi usulan" value={proposal.allocation} />
          </>}
          <p>{proposal.reason}</p>
          {proposal.reviewReason && <p>Catatan tinjauan {proposal.reviewReason}</p>}
        </div>}
        {!demo && !open && <AmountSummary title="Alokasi terkini" value={view.allocation} />}
        {demo && open && view.access === "member" && storage && orderCase.evidence.length < 8 &&
          <form className="stack" onSubmit={event => send(event, "evidence", () => ({ caseId: orderCase.id }))}>
            <Reason label="Keterangan bukti tambahan" /><Photo required />
            <Button disabled={busy} type="submit" variant="secondary">Kirim bukti tambahan</Button>
          </form>}
        {demo && open && view.access === "reviewer" && <details>
          <summary>Ajukan atau perbarui keputusan</summary>
          <form key={proposal?.id ?? orderCase.id} className="stack" onSubmit={event => send(event, "propose", fields => ({
            caseId: orderCase.id, outcome: fields.get("outcome"), purchase: 0, fee: 0, refund: 0,
          }))}>
            <label className="field">Hasil usulan<select name="outcome" required>
              <option value="resolve">Selesaikan kasus</option>
              <option value="dismiss">Tutup kasus</option>
            </select></label>
            <Reason label="Alasan usulan" />
            <Button disabled={busy} type="submit">Kirim usulan</Button>
          </form>
        </details>}
        {demo && open && proposal?.canReview && <form key={proposal.id} className="stack" onSubmit={event => send(event, "review", fields => ({
          caseId: orderCase.id, proposalId: proposal.id, decision: fields.get("decision"),
        }))}>
          <label className="field">Keputusan tinjauan<select name="decision" required defaultValue="">
            <option value="" disabled>Pilih keputusan</option><option value="approve">Setujui usulan</option><option value="return">Kembalikan untuk diperbaiki</option>
          </select></label>
          <Reason label="Alasan keputusan petugas kedua" />
          <Button disabled={busy} type="submit">Simpan keputusan</Button>
        </form>}
      </>}
      {demo && !open && view.canCancel && <details>
        <summary>Ajukan pembatalan pesanan</summary>
        <form className="stack" onSubmit={event => send(event, "open", () => ({ kind: "cancellation" }))}>
          <p>Belanja dan serah terima dijeda sampai petugas meninjau pembatalan.</p>
          <Reason label="Alasan pembatalan" />{storage && <Photo />}
          <Button disabled={busy} type="submit">Ajukan pembatalan</Button>
        </form>
      </details>}
      {demo && !open && view.canDispute && storage && <details>
        <summary>Ajukan sengketa pesanan</summary>
        <form className="stack" onSubmit={event => send(event, "open", () => ({ kind: "dispute" }))}>
          <Reason label="Alasan sengketa" /><Photo required />
          <Button disabled={busy} type="submit">Ajukan sengketa</Button>
        </form>
      </details>}
      {demo && view.canDispute && !storage && <p>Unggahan bukti belum tersedia. <Link href={support}>Hubungi bantuan</Link> untuk melaporkan masalah pesanan.</p>}
      {!orderCase && (!demo || (!view.canCancel && !view.canDispute)) && <p>Belum ada kasus untuk pesanan ini.</p>}
    </>}
  </section>;
}

export function ConnectedOrderCaseQueue({ memberId, order }: { memberId: string; order?: string }) {
  const [items, setItems] = useState<OrderCaseQueue | null>(null);
  const [error, setError] = useState("");
  const [after, setAfter] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (order) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ view: "queue", ...(after ? { after } : {}) });
    void caseRequest(`${endpoint}?${query}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(body => {
        if (controller.signal.aborted) return;
        if (body.memberId !== memberId) throw new Error("Sesi berubah. Muat ulang halaman.");
        setItems(body.data);
      }).catch(failure => { if (!controller.signal.aborted) setError(failure.message ?? "Antrean belum tersedia."); });
    return () => controller.abort();
  }, [order, memberId, after, retry]);
  return <section className="stack">
    <h1>Pemeriksaan kasus pesanan</h1>
    {order ? <><Link href="/account/order-cases">Kembali ke antrean</Link>
      <ConnectedOrderCases key={`${memberId}:${order}`} orderId={order} memberId={memberId} /></> : <>
      {error && <div role="alert"><p>{error}</p><Link href="/account/affiliation">Periksa MFA petugas</Link>
        <Button type="button" onClick={() => { setError(""); setItems(null); setRetry(value => value + 1); }}>Muat ulang antrean</Button></div>}
      {!error && !items && <p role="status">Memuat antrean...</p>}
      {items?.length === 0 && <p>Tidak ada kasus dalam bagian antrean ini.</p>}
      {items && items.length > 0 && <ul>
        {items.map(item => <li key={item.id}><Link href={`/account/order-cases?order=${item.orderId}`}>{kinds[item.kind]} · {item.title}</Link></li>)}
      </ul>}
      {after && <Button type="button" variant="secondary" onClick={() => { setItems(null); setAfter(undefined); }}>Awal antrean</Button>}
      {items?.length === 30 && <Button type="button" onClick={() => { setAfter(items.at(-1)!.id); setItems(null); }}>Berikutnya</Button>}
    </>}
  </section>;
}
