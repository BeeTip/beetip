"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { fundingCommandSchema, fundingReasons, type FundingCommand, type FundingQueueItem, type FundingView } from "@beetip/validation";
import { Button } from "./ui";

const endpoint = "/api/identity/funding";
const statuses = {
  unpaid: "Menunggu bukti dana", draft: "Draf bukti tersimpan", pending: "Menunggu pemeriksaan bank",
  rejected: "Bukti ditolak", verified: "Dana terverifikasi",
};
const money = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const wib = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

async function fundingRequest(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { cache: "no-store", ...init, signal: init.signal ?? AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Permintaan gagal. Coba lagi.");
  return body;
}

function useFundingMutation(memberId: string) {
  const operations = useRef(new Map<string, string>());
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function command(input: FundingCommand) {
    const key = JSON.stringify(input);
    const operationId = operations.current.get(key) ?? crypto.randomUUID();
    if (!fundingCommandSchema.safeParse({ ...input, operationId }).success) throw new Error("Periksa referensi sintetis dan nominal rupiah bulat.");
    operations.current.set(key, operationId);
    await fundingRequest(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId },
      body: JSON.stringify({ ...input, operationId }),
    });
    operations.current.delete(key);
  }
  async function run(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    try { await action(); }
    catch (failure) {
      setError(failure instanceof Error && failure.name === "Error" ? failure.message : "Koneksi terputus. Periksa status lalu coba lagi.");
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return { busy, error, command, run };
}

function evidenceUrl(id: string) { return `${endpoint}/${id}/evidence`; }

export function ConnectedFunding({ orderId, memberId, refreshKey }: { orderId: string; memberId: string; refreshKey: number }) {
  const [view, setView] = useState<FundingView | null>(null);
  const [available, setAvailable] = useState(false);
  const [readError, setReadError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const mutation = useFundingMutation(memberId);
  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    void fundingRequest(`${endpoint}?view=order&order=${encodeURIComponent(orderId)}`, { signal }).then(body => {
      if (controller.signal.aborted) return;
      if (body.memberId !== memberId) throw new Error("Sesi berubah. Muat ulang halaman.");
      setView(body.data);
      setAvailable(body.storageAvailable);
      setReadError("");
    }).catch(error => {
      if (!controller.signal.aborted) {
        setView(null);
        setReadError(error.name === "Error" ? error.message : "Status dana belum tersedia.");
      }
    });
    return () => controller.abort();
  }, [orderId, memberId, refresh, refreshKey]);

  function update() { setRefresh(value => value + 1); }
  function begin(event: FormEvent<HTMLFormElement>, amount: number) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void mutation.run(async () => {
      await mutation.command({ action: "begin", id: orderId, account: String(fields.get("account")), reference: String(fields.get("reference")), amount });
      update();
    });
  }
  function submit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get("evidence");
    void mutation.run(async () => {
      if (file instanceof File && file.size) {
        if (file.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(file.type)) throw new Error("Pilih gambar JPG atau PNG hingga 2 MB.");
        await fundingRequest(evidenceUrl(id), {
          method: "PUT", headers: { "Content-Type": file.type, "X-Beetip-Member": memberId }, body: file,
        });
      }
      await mutation.command({ action: "submit", id });
      update();
    });
  }

  return <section className="stack" aria-labelledby="funding-title">
    <h2 id="funding-title">Dana pesanan</h2>
    {readError && <div role="alert"><p>{readError}</p><Button onClick={update}>Coba lagi</Button></div>}
    {!view && !readError && <p role="status">Memuat status dana...</p>}
    {view && <>
      <p role="status">{statuses[view.state]}. {view.amendmentPending ? "Belanja menunggu keputusan perubahan." : view.purchaseReady ? "Syarat dana untuk belanja terpenuhi." : "Belanja menunggu dana yang terverifikasi."}</p>
      <p>Total dana yang diperlukan {money.format(view.requiredAmount)}.</p>
      {view.outstandingAmount > 0 && view.outstandingAmount < view.requiredAmount &&
        <p>Kekurangan dana terverifikasi {money.format(view.outstandingAmount)}.</p>}
      {view.customer && view.outstandingAmount > 0 && view.state !== "draft" && view.state !== "pending" &&
        (!view.payable || !available || view.accounts.length === 0) &&
        <p>Pengiriman dana belum tersedia untuk pesanan ini.</p>}
      {view.state === "pending" && !view.payable && <p>Reservasi berakhir. <Link href="/support">Hubungi bantuan</Link> jika bukti masih perlu ditangani.</p>}
      {view.submission?.reason && <p>{fundingReasons[view.submission.reason]}.</p>}
      {view.submission?.uploaded && available && <a href={evidenceUrl(view.submission.id)} download>Unduh bukti saya</a>}
      {view.customer && view.payable && available && view.accounts.length > 0 && view.outstandingAmount > 0 &&
        view.state !== "draft" && view.state !== "pending" &&
        <form className="stack" onSubmit={event => begin(event, view.outstandingAmount)}>
          <p>Simulasi. Gunakan bukti dan referensi contoh. Jangan transfer uang.</p>
          <p>Nominal bukti yang perlu dikirim {money.format(view.outstandingAmount)}.</p>
          <label>Akun penampung uji<select name="account" required defaultValue=""><option value="" disabled>Pilih akun</option>
            {view.accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select></label>
          <label>Referensi transfer uji<input name="reference" required maxLength={80} placeholder="TEST1234" /></label>
          <Button type="submit" disabled={mutation.busy}>{mutation.busy ? "Menyimpan..." : "Lanjut unggah bukti"}</Button>
        </form>}
      {view.state === "draft" && view.submission && (() => {
        const { id, accountId, reference, uploaded, amount } = view.submission;
        const stale = amount !== view.outstandingAmount;
        const canSubmit = !stale && view.payable && available && view.accounts.some(account => account.id === accountId);
        return <div className="stack" key={id}>
          <p>Referensi <span className="break-all">{reference}</span>. Nominal draf {money.format(amount)}.</p>
          {canSubmit && <form className="stack" onSubmit={event => submit(event, id)}>
            {uploaded ? <p>Gambar tersimpan dan siap dikirim.</p> :
              <label>Bukti transfer uji (JPG atau PNG, maks. 2 MB)<input name="evidence" type="file" accept="image/png,image/jpeg" required /></label>}
            <Button type="submit" disabled={mutation.busy}>{mutation.busy ? "Memproses..." : "Kirim untuk diperiksa"}</Button>
          </form>}
          {!canSubmit && <p>{stale ? "Nominal berubah. Buang draf ini untuk menggunakan nominal terbaru." : "Draf ini sudah tidak dapat dikirim."}</p>}
          <Button variant="secondary" disabled={mutation.busy} onClick={() => void mutation.run(async () => {
            await mutation.command({ action: "discard", id });
            update();
          })}>Buang draf</Button>
        </div>;
      })()}
      {mutation.error && <div role="alert"><p>{mutation.error}</p><Button variant="secondary" onClick={update}>Perbarui status dana</Button></div>}
    </>}
  </section>;
}

export function ConnectedFundingQueue({ memberId, order }: { memberId: string; order?: string }) {
  const [rows, setRows] = useState<FundingQueueItem[] | null>(null);
  const [cursor, setCursor] = useState<FundingQueueItem | null>(null);
  const [readError, setReadError] = useState("");
  const [available, setAvailable] = useState(false);
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ view: "queue" });
    if (order) params.set("order", order);
    if (cursor) { params.set("after", cursor.submittedAt); params.set("afterId", cursor.id); }
    void fundingRequest(`${endpoint}?${params}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(body => {
      if (controller.signal.aborted) return;
      if (body.memberId !== memberId) throw new Error("Sesi berubah. Muat ulang halaman.");
      setRows(body.data);
      setAvailable(body.storageAvailable);
      setReadError("");
    }).catch(error => {
      if (!controller.signal.aborted) {
        setRows(null);
        setReadError(error.name === "Error" ? error.message : "Antrean belum tersedia.");
      }
    });
    return () => controller.abort();
  }, [memberId, order, cursor, refresh]);

  return <section className="panel stack">
    <h1>Pemeriksaan dana</h1>
    <p>Antrean simulasi. Cocokkan bukti dengan catatan uji pada akun penampung yang ditugaskan.</p>
    <Link href="/account">Kembali ke dashboard</Link>
    {order && <Link href="/account/funding">Lihat seluruh antrean</Link>}
    <Button variant="secondary" onClick={() => setRefresh(value => value + 1)}>Perbarui antrean</Button>
    {notice && <p role="status">{notice}</p>}
    {readError && <p role="alert">{readError}</p>}
    {!rows && !readError && <p role="status">Memuat antrean...</p>}
    {rows?.length === 0 && <p role="status">Tidak ada pengajuan yang perlu diperiksa.</p>}
    {rows && !available && rows.length > 0 && <p role="alert">Penyimpanan bukti sedang tidak tersedia.</p>}
    {rows?.map(row => <FundingReview key={row.id} row={row} memberId={memberId} available={available} onDecision={message => {
      setNotice(message);
      setRows(previous => previous?.filter(item => item.id !== row.id) ?? null);
      setRefresh(value => value + 1);
    }} />)}
    {cursor && <Button variant="secondary" onClick={() => setCursor(null)}>Kembali ke awal antrean</Button>}
    {rows?.length === 30 && <Button variant="secondary" onClick={() => setCursor(rows[29])}>Lihat pengajuan berikutnya</Button>}
  </section>;
}

function FundingReview({ row, memberId, available, onDecision }: {
  row: FundingQueueItem; memberId: string; available: boolean; onDecision: (message: string) => void;
}) {
  const mutation = useFundingMutation(memberId);
  function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void mutation.run(async () => {
      await mutation.command({ action: "verify", id: row.id, account: String(fields.get("account")),
        reference: String(fields.get("bankReference")), amount: Number(fields.get("bankAmount")) });
      onDecision("Pemeriksaan selesai. Dana terverifikasi.");
    });
  }
  function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get("reason") as keyof typeof fundingReasons;
    void mutation.run(async () => {
      await mutation.command({ action: "reject", id: row.id, reason });
      onDecision("Pemeriksaan selesai. Bukti ditolak.");
    });
  }
  return <article className="panel stack">
    <h2>{row.accountLabel}</h2>
    <p>Pengajuan <span className="break-all">{row.reference}</span> sebesar {money.format(row.amount)}.</p>
    {row.expiresAt && <p>Batas pemeriksaan {wib.format(new Date(row.expiresAt))} WIB.</p>}
    {available && <>
      <a href={evidenceUrl(row.id)} download>Unduh bukti transfer</a>
      <form className="stack" onSubmit={verify}>
        <label>Akun pada catatan bank<select name="account" required defaultValue=""><option value="" disabled>Pilih akun</option>
          <option value={row.accountId}>{row.accountLabel}</option>
        </select></label>
        <label>Referensi pada catatan bank<input name="bankReference" required maxLength={80} /></label>
        <label>Nominal pada catatan bank (rupiah)<input name="bankAmount" type="number" inputMode="numeric" min={1} step={1} required /></label>
        <label><input name="checked" type="checkbox" required /> Saya sudah memeriksa catatan bank uji.</label>
        <Button type="submit" disabled={mutation.busy}>{mutation.busy ? "Memproses..." : "Verifikasi dana"}</Button>
      </form>
      <form className="stack" onSubmit={reject}>
        <label>Alasan penolakan<select name="reason" defaultValue="" required><option value="" disabled>Pilih alasan</option>
          {Object.entries(fundingReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <Button type="submit" variant="secondary" disabled={mutation.busy}>Tolak bukti</Button>
      </form>
    </>}
    {mutation.error && <p role="alert">{mutation.error}</p>}
  </article>;
}
