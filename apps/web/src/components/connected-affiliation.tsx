"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { staffRoles } from "@beetip/validation";
import { Button } from "./ui";

type Affiliation = { id: string; member_id: string; institution: string; status: string; decision_code: string | null };
type Staff = { memberId: string; aal: string; grants: { member_id: string; role: string; revoked_at: string | null }[]; factors: { id: string }[] };
const labels: Record<string, string> = { draft: "Draf: unggah bukti lalu kirim", pending: "Menunggu pemeriksaan", approved: "Afiliasi terverifikasi", rejected: "Bukti perlu diperbaiki", withdrawn: "Ditarik", matched: "Bukti sesuai", unreadable: "Bukti tidak terbaca", not_matched: "Bukti belum sesuai" };
async function call(path: string, body?: unknown) {
  const response = await fetch(`/api/identity/${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Layanan belum tersedia.");
  return result;
}

export function ConnectedAffiliation() {
  const [rows, setRows] = useState<Affiliation[]>([]);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [secret, setSecret] = useState("");
  const [factorId, setFactorId] = useState("");
  const generation = useRef(0);
  const accountGeneration = useRef(0);
  const identity = useRef<string | null>(null);
  const attempt = useRef<{ key: string; operationId: string } | null>(null);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setRows([]); setStaff(null); setLoading(true);
    try {
      const [affiliation, access] = await Promise.all([call("affiliation"), call("staff")]);
      if (current !== generation.current) return;
      if (affiliation.memberId !== access.memberId) throw new Error("Akun berubah. Muat ulang afiliasi.");
      if (identity.current && identity.current !== access.memberId) {
        ++accountGeneration.current; setBusy(false); setSecret(""); setFactorId(""); attempt.current = null;
      }
      identity.current = access.memberId;
      setRows(affiliation.requests); setStaff(access);
    } finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    function revalidate() { if (document.visibilityState === "visible") refresh().catch(error => setMessage(error.message)); }
    function changed(event: StorageEvent) {
      if (event.key !== "beetip-auth-change") return;
      ++generation.current; ++accountGeneration.current;
      setRows([]); setStaff(null); setLoading(true); setBusy(false); setMessage("");
      identity.current = null;
      setSecret(""); setFactorId(""); attempt.current = null; revalidate();
    }
    revalidate();
    window.addEventListener("focus", revalidate);
    window.addEventListener("storage", changed);
    document.addEventListener("visibilitychange", revalidate);
    const timer = setInterval(revalidate, 30000);
    return () => { clearInterval(timer); window.removeEventListener("focus", revalidate); window.removeEventListener("storage", changed); document.removeEventListener("visibilitychange", revalidate); };
  }, [refresh]);
  async function run(action: (isCurrent: () => boolean) => Promise<unknown>) {
    if (busy) return;
    const currentAccount = accountGeneration.current;
    const isCurrent = () => currentAccount === accountGeneration.current;
    setBusy(true); setMessage("");
    try { await action(isCurrent); if (isCurrent()) { setMessage("Perubahan tersimpan."); await refresh(); } }
    catch (error) { if (isCurrent()) { setRows([]); setStaff(null); setMessage(error instanceof Error ? error.message : "Koneksi terputus. Muat ulang dan coba lagi."); } }
    finally { if (isCurrent()) setBusy(false); }
  }
  async function command(path: string, payload: Record<string, unknown>) {
    const currentAccount = accountGeneration.current;
    const key = JSON.stringify({ path, ...payload });
    if (attempt.current?.key !== key) attempt.current = { key, operationId: crypto.randomUUID() };
    const result = await call(path, { ...payload, operationId: attempt.current.operationId });
    if (currentAccount === accountGeneration.current) attempt.current = null;
    return result;
  }
  const own = rows.filter(row => row.member_id === staff?.memberId);
  const active = own.find(row => ["draft", "pending", "approved"].includes(row.status));
  const roles = staff?.grants.filter(grant => grant.member_id === staff.memberId && !grant.revoked_at).map(grant => grant.role) ?? [];
  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("institution"));
    const previous = attempt.current?.key ? JSON.parse(attempt.current.key) : null;
    const requestId = previous?.path === "affiliation" && previous.action === "begin" && previous.value === value ? previous.requestId : crypto.randomUUID();
    await run(() => command("affiliation", { action: "begin", requestId, value }));
  }
  return <section className="stack"><h1>Afiliasi opsional</h1><p>Verifikasi afiliasi hanya untuk lencana. Akun terkonfirmasi tetap dapat digunakan tanpa pengajuan atau persetujuan afiliasi.</p><p>Bukti hanya tersedia untuk akunmu dan pemeriksa afiliasi dengan MFA. Unggah kartu atau surat yang menunjukkan nama dan institusi; tutup nomor identitas, alamat, dan informasi lain yang tidak diperlukan. PNG atau JPEG, maksimal 2 MB. Bukti tidak ditampilkan pada profil publik.</p><p>Menarik pengajuan menonaktifkan lencana, tetapi bukti dan riwayat tetap tersedia untuk akunmu dan pemeriksa yang berwenang.</p><p role="status" aria-live="polite">{message}</p><Button variant="secondary" disabled={busy} onClick={() => refresh().catch(error => setMessage(error.message))}>Muat ulang afiliasi</Button>{loading ? <p>Memuat afiliasi...</p> : staff && <>
    {!active && <form className="panel stack" onSubmit={begin}><label className="field">Institusi<input name="institution" minLength={2} maxLength={100} required disabled={busy} /></label><Button type="submit" disabled={busy}>Mulai pengajuan opsional</Button></form>}
    {!own.length && <p>Belum ada pengajuan afiliasi.</p>}
    {own.map(row => <article className="panel stack" key={row.id}><h2>{row.institution}</h2><p>{labels[row.status]}</p>{row.decision_code && <p>{labels[row.decision_code]}</p>}{row.status === "draft" && <form className="stack" onSubmit={event => {
      event.preventDefault();
      const file = new FormData(event.currentTarget).get("evidence");
      if (!(file instanceof File) || !file.size || file.size > 2097152) { setMessage("Pilih gambar PNG atau JPEG maksimal 2 MB."); return; }
      void run(async () => {
        const response = await fetch(`/api/identity/affiliation/${row.id}/evidence`, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!response.ok) throw new Error((await response.json()).message);
        await command("affiliation", { action: "submit", requestId: row.id, value: "" });
      });
    }}><label className="field">Bukti afiliasi<input name="evidence" type="file" accept="image/png,image/jpeg" required disabled={busy} /></label><Button type="submit" disabled={busy}>Unggah dan kirim bukti</Button><Button variant="secondary" disabled={busy} onClick={() => run(() => command("affiliation", { action: "submit", requestId: row.id, value: "" }))}>Kirim bukti yang sudah diunggah</Button></form>}{row.status !== "draft" && <a href={`/api/identity/affiliation/${row.id}/evidence`}>Unduh bukti pribadi</a>}{row.status !== "withdrawn" && <Button variant="secondary" disabled={busy} onClick={() => run(() => command("affiliation", { action: "withdraw", requestId: row.id, value: "" }))}>Tarik pengajuan</Button>}</article>)}
    <section className="panel stack"><h2>Keamanan petugas</h2><p>Peran petugas diberikan terpisah oleh pengelola. MFA tidak memberi peran secara otomatis.</p>{staff.aal === "aal2" ? <p>MFA aktif pada sesi ini.</p> : <>{!staff.factors.length && <Button disabled={busy} onClick={() => run(async isCurrent => { const result = await call("mfa", { action: "enroll" }); if (isCurrent()) { setSecret(result.secret); setFactorId(result.factorId); } })}>Siapkan autentikator</Button>}{secret && <label className="field">Kunci autentikator<input readOnly value={secret} autoComplete="off" /></label>}<form className="stack" onSubmit={event => {
      event.preventDefault();
      const code = String(new FormData(event.currentTarget).get("code"));
      void run(async () => { await call("mfa", { action: "verify", factorId: factorId || staff.factors[0]?.id, code }); setSecret(""); setFactorId(""); });
    }}><label className="field">Kode autentikator<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required disabled={busy} /></label><Button type="submit" disabled={busy || (!factorId && !staff.factors.length)}>Verifikasi MFA</Button></form></>}</section>
    {staff.aal === "aal2" && roles.includes("membership_review") && <section className="stack"><h2>Antrean pemeriksaan afiliasi</h2>{!rows.some(row => row.member_id !== staff.memberId && row.status === "pending") && <p>Tidak ada pengajuan menunggu pemeriksaan.</p>}{rows.filter(row => row.member_id !== staff.memberId && row.status === "pending").map(row => <article className="panel stack" key={row.id}><h3>{row.institution}</h3><p className="small">Pemohon: {row.member_id}</p><a href={`/api/identity/affiliation/${row.id}/evidence`}>Unduh bukti untuk diperiksa</a><Button disabled={busy} onClick={() => run(() => command("affiliation", { action: "approve", requestId: row.id, value: "matched" }))}>Setujui lencana</Button><Button variant="secondary" disabled={busy} onClick={() => run(() => command("affiliation", { action: "reject", requestId: row.id, value: "unreadable" }))}>Tolak: bukti tidak terbaca</Button><Button variant="secondary" disabled={busy} onClick={() => run(() => command("affiliation", { action: "reject", requestId: row.id, value: "not_matched" }))}>Tolak: bukti belum sesuai</Button></article>)}</section>}
    {staff.aal === "aal2" && roles.includes("platform_admin") && <section className="stack"><h2>Peran petugas</h2><a href="/account/email-operations">Operasi email</a><form className="panel stack" onSubmit={event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      void run(() => command("staff", { memberId: fields.get("memberId"), role: fields.get("role"), grant: fields.get("grant") === "true", reason: fields.get("reason") }));
    }}><label className="field">ID akun petugas<input name="memberId" required disabled={busy} /></label><label className="field">Peran<select name="role" disabled={busy}>{staffRoles.map(role => <option key={role}>{role}</option>)}</select></label><label className="field">Tindakan<select name="grant" disabled={busy}><option value="false">Cabut akses</option><option value="true">Berikan akses</option></select></label><label className="field">Alasan<select name="reason" disabled={busy}><option value="access_removed">Akses dicabut</option><option value="owner_approved">Disetujui pemilik</option><option value="duty_changed">Perubahan tugas</option></select></label><Button type="submit" disabled={busy}>Simpan peran petugas</Button></form>{staff.grants.map(grant => <p className="small" key={`${grant.member_id}-${grant.role}`}>{grant.member_id}: {grant.role} ({grant.revoked_at ? "dicabut" : "aktif"})</p>)}</section>}
  </>}</section>;
}
