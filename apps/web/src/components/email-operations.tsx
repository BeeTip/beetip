"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui";

type Delivery = {
  id: string;
  dispatch_id: string;
  status: "uncertain" | "dead_letter" | "accepted";
  last_error: string | null;
  attempts: number;
  updated_at: string;
  replay_ready: boolean;
};

export type EmailQueue = {
  missedScheduler: boolean;
  overdue: boolean;
  needsAttention: boolean;
  lastSuccessAt: string | null;
  items: Delivery[];
};

type Action = "replay" | "reconciled_replay" | "close";
const time = new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jakarta" });
const statuses: Record<Delivery["status"], string> = {
  uncertain: "Status pengiriman belum pasti",
  dead_letter: "Pengiriman gagal",
  accepted: "Belum ada status akhir dari penyedia",
};
const errors: Record<string, string> = {
  submission_lease_expired: "Worker berhenti saat mengirim",
  transport_uncertain: "Konfirmasi penyedia belum diterima",
  duplicate_key: "Penyedia sudah menerima kunci pengiriman",
  rate_limited: "Batas permintaan penyedia",
  rejected: "Permintaan ditolak penyedia",
  hard_bounce: "Alamat ditolak permanen",
  soft_bounce: "Pengiriman tertunda atau ditolak sementara",
  blocked: "Diblokir penyedia",
  invalid: "Alamat tidak valid",
  spam: "Dilaporkan sebagai spam",
  unsubscribed: "Penerima berhenti berlangganan",
};

export function EmailOperations({ queue, memberId }: { queue: EmailQueue; memberId: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<{ id: string; dispatch: string; action: Action }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/identity/email-operations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId },
        body: JSON.stringify(selected),
      });
      const result = await response.json();
      setMessage(response.ok ? (selected.action === "close" ? "Pemeriksaan ditutup." : "Email dijadwalkan ulang.") :
        response.status === 409 ? "Status berubah atau penerima tidak lagi memenuhi syarat." :
          result.message ?? "Operasi belum tersedia.");
      if (response.ok || response.status === 409) setSelected(undefined);
      router.refresh();
    } catch {
      setMessage("Operasi belum tersedia. Muat ulang untuk memeriksa status terbaru.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="stack">
    <h1>Operasi email</h1>
    {queue.missedScheduler && <p role="alert">Worker belum melapor selama lebih dari lima menit.</p>}
    {queue.overdue && <p role="alert">Ada email yang melewati jadwal pengiriman lebih dari lima menit.</p>}
    <p>Worker terakhir aktif {queue.lastSuccessAt ? <time dateTime={queue.lastSuccessAt}>{time.format(new Date(queue.lastSuccessAt))} WIB</time> : "belum tercatat"}.</p>
    <Button variant="secondary" disabled={busy} onClick={() => router.refresh()}>Muat ulang antrean</Button>
    {message && <p role="status">{message}</p>}
    {!queue.items.length && <p>Tidak ada pengiriman yang perlu diperiksa.</p>}
    {queue.items.map(item => <article className="panel stack" key={item.id}>
      <h2>{statuses[item.status]}</h2>
      <p>{item.last_error && <>{errors[item.last_error] ?? "Status perlu diperiksa"}. </>}Percobaan: {item.attempts}.</p>
      <p>Kode pemeriksaan penyedia <code className="break-all">{item.dispatch_id}</code></p>
      <time dateTime={item.updated_at}>{time.format(new Date(item.updated_at))} WIB</time>
      {item.status === "uncertain" && <p>Periksa log Brevo dengan kode pengiriman. Jadwalkan ulang hanya jika log memastikan email belum diterima penyedia. Tunggu 30 menit sebelum menjadwalkan ulang.</p>}
      {item.status === "accepted" && <p>Brevo sudah menerima email ini. Periksa hasil akhirnya menggunakan kode pengiriman sebelum menutup pemeriksaan.</p>}
      {selected?.id === item.id && selected.dispatch === item.dispatch_id ? <>
        <p>{selected.action === "reconciled_replay" ? "Saya telah memeriksa log Brevo dan memastikan pengiriman sebelumnya tidak diterima penyedia." :
          selected.action === "close" ? "Tutup pemeriksaan ini tanpa menjadwalkan email." : "Jadwalkan pengiriman ulang setelah masalah diperbaiki."}</p>
        <Button disabled={busy} onClick={() => void submit()}>Konfirmasi</Button>
        <Button variant="secondary" disabled={busy} onClick={() => setSelected(undefined)}>Batal</Button>
      </> : <>
        {item.replay_ready && <Button disabled={busy} onClick={() => setSelected({
          id: item.id, dispatch: item.dispatch_id, action: item.status === "uncertain" ? "reconciled_replay" : "replay",
        })}>{item.status === "uncertain" ? "Jadwalkan ulang setelah pemeriksaan" : "Jadwalkan ulang"}</Button>}
        <Button variant="secondary" disabled={busy} onClick={() => setSelected({
          id: item.id, dispatch: item.dispatch_id, action: "close",
        })}>Tutup pemeriksaan</Button>
      </>}
    </article>)}
  </section>;
}
