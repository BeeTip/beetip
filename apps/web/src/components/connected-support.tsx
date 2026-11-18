"use client";

import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { supportCaseActions, supportCategories } from "@beetip/validation";
import { Badge, Button } from "./ui";
import { SupportFailure, SupportThread, type SupportCall } from "./connected-support-thread";

type Category = keyof typeof supportCategories;
type CaseSummary = { id: string; category: Category; status: string; updatedAt: string; assigned: boolean; requester: boolean; escalated: boolean };
type QueueCase = { id: string; category: Category; updatedAt: string; version: number; assigneeId?: string | null; escalated?: boolean; hasOrder?: boolean; orderAccess?: boolean; canClaim?: boolean };
type Operator = { id: string; name: string };
type Workspace = { cases: CaseSummary[]; queue: QueueCase[]; operators: Operator[]; operator: boolean; lead: boolean };
type LeadAction = "reassign" | "grant_order" | "revoke_order";

const date = (value: string) => new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";

export function ConnectedSupport({ memberId, order, initialCase }: { memberId: string; order?: string; initialCase?: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [selected, select] = useState(initialCase);
  const [refresh, setRefresh] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState("");
  const [paging, setPaging] = useState(false);
  const sessionValid = useRef(true);
  const revision = useRef(0);
  const invalidate = useCallback(() => setRefresh(++revision.current), []);
  const clear = useCallback(() => {
    sessionValid.current = false;
    revision.current++;
    setWorkspace(null);
    select(undefined);
    setBlocked(true);
  }, []);

  const call = useCallback<SupportCall>(async <T extends object>(query = "", command?: object, signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(15000);
    const response = await fetch("/api/identity/support" + query, {
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(command ? { method: "POST", headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId }, body: JSON.stringify(command) } : {}),
    }).catch(() => { throw new SupportFailure("Bantuan belum dapat dimuat. Periksa koneksi dan coba lagi.", 503); });
    const result: T & { memberId?: string; message?: string; code?: string } = await response.json();
    if (response.status === 401 || result.code === "SESSION_CHANGED" || (response.ok && result.memberId !== memberId)) clear();
    if (!sessionValid.current) throw new Error("Sesi berubah. Masuk kembali.");
    if (!response.ok) throw new SupportFailure(result.message ?? "Bantuan belum tersedia.", response.status);
    return result;
  }, [clear, memberId]);

  useEffect(() => {
    if (blocked) return;
    const client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const channel = client.channel(`member:${memberId}`, { config: { private: true } });
    channel.on("broadcast", { event: "refresh" }, invalidate).subscribe(status => {
      if (status === "SUBSCRIBED") invalidate();
    });
    const auth = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (session && session.user.id !== memberId)) clear();
      else if (event === "TOKEN_REFRESHED" || event === "MFA_CHALLENGE_VERIFIED") invalidate();
    });
    function visible() {
      if (document.visibilityState === "visible") invalidate();
    }
    function accountChanged(event: StorageEvent) {
      if (event.key === "beetip-auth-change") clear();
    }
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", accountChanged);
    const timer = setInterval(visible, 30000);
    return () => {
      clearInterval(timer);
      auth.data.subscription.unsubscribe();
      void client.removeChannel(channel);
      window.removeEventListener("focus", visible);
      window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", accountChanged);
    };
  }, [blocked, clear, invalidate, memberId]);

  useEffect(() => {
    if (blocked) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => call<{ workspace: Workspace }>("?view=cases", undefined, controller.signal)).then(result => {
      if (controller.signal.aborted) return;
      setWorkspace(result.workspace ?? null);
      setError("");
    }).catch(error => {
      if (controller.signal.aborted) return;
      setWorkspace(null);
      if (error instanceof SupportFailure && error.denied) clear();
      else setError(error.message);
    });
    return () => controller.abort();
  }, [blocked, call, clear, refresh]);

  async function moreQueue(row: QueueCase) {
    const currentRevision = revision.current;
    setPaging(true);
    try {
      const query = new URLSearchParams({ view: "cases", queueBefore: row.updatedAt, queueBeforeId: row.id });
      const { workspace: next } = await call<{ workspace: Workspace }>(`?${query}`);
      if (currentRevision !== revision.current) return;
      if (next) setWorkspace(current => {
        if (!current || current.lead !== next.lead || current.operator !== next.operator) return next;
        const existing = new Set(current.queue.map(item => item.id));
        return { ...next, queue: [...current.queue, ...next.queue.filter(item => !existing.has(item.id))] };
      });
      setError("");
    } catch (error) {
      if (currentRevision !== revision.current) return;
      if (error instanceof SupportFailure && error.denied) clear();
      else setError(error instanceof Error ? error.message : "Antrean belum dapat dimuat.");
    } finally { setPaging(false); }
  }

  if (blocked) return <section className="panel stack"><h1>Hubungi bantuan</h1><p role="alert">Sesi atau akses berubah. Masuk kembali untuk membuka bantuan.</p><Link href="/login?next=%2Fsupport">Masuk kembali</Link></section>;
  return <section className="stack">
    <h1>Hubungi bantuan</h1>
    <p>Pesan hanya dapat dibaca oleh akunmu dan petugas bantuan yang ditugaskan.</p>
    <Button variant="secondary" onClick={invalidate}>Muat ulang percakapan</Button>
    {error && <p role="alert">{error}</p>}
    {!workspace && !error && <p role="status">Memuat percakapan...</p>}
    {selected && <SupportThread key={selected} id={selected} memberId={memberId} refresh={refresh} call={call} onChange={invalidate} onBack={() => select(undefined)} />}
    <OpenSupport key={order} order={order} call={call} onOpen={id => { select(id); invalidate(); }} />
    {workspace && <>
      <section className="panel stack" aria-label="Percakapan bantuan">
        <h2>Percakapan bantuan</h2>
        {!workspace.cases.length && <p>Belum ada percakapan bantuan.</p>}
        {workspace.cases.map(row => <div className="info-box stack" key={row.id}>
          <strong>{supportCategories[row.category]}</strong>
          <p>{row.requester ? "Permintaanmu" : "Ditugaskan kepadamu"} · {date(row.updatedAt)}</p>
          <Badge tone={row.status === "resolved" ? "success" : "neutral"}>{row.status === "resolved" ? "Selesai" : row.escalated ? "Dieskalasi" : row.assigned ? "Ditangani" : "Menunggu petugas"}</Badge>
          <Button variant="secondary" disabled={selected === row.id} onClick={() => select(row.id)}>Buka percakapan</Button>
        </div>)}
      </section>
      {(workspace.operator || workspace.lead) && <section className="panel stack">
        <h2>{workspace.lead ? "Kelola kasus terbuka" : "Antrean bantuan"}</h2>
        {!workspace.queue.length && <p>Antrean kosong.</p>}
        {workspace.queue.map(row => <QueueCard key={row.id} row={row} operator={workspace.operator} lead={workspace.lead}
          operators={workspace.operators} memberId={memberId} call={call} onChange={invalidate} onClaim={select} />)}
        {workspace.queue.length > 0 && workspace.queue.length % 50 === 0 && <Button variant="secondary" disabled={paging}
          onClick={() => void moreQueue(workspace.queue[workspace.queue.length - 1])}>Muat kasus sebelumnya</Button>}
      </section>}
    </>}
  </section>;
}

function OpenSupport({ order, call, onOpen }: { order?: string; call: SupportCall; onOpen: (id: string) => void }) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState<Category>(order ? "order" : "general");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !body.trim()) return;
    const text = body.trim();
    const reference = category === "order" ? order : undefined;
    const key = JSON.stringify([text, category, reference]);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await call<{ conversationId: string }>("", { action: "open", operationId: attempt.current.id, body: text, category, order: reference });
      if (!result.conversationId) throw new Error("Permintaan belum dapat dikonfirmasi. Coba dengan pesan yang sama.");
      setBody("");
      attempt.current = null;
      setMessage("Pesan bantuan tersimpan.");
      onOpen(result.conversationId);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Pesan belum terkirim.");
    } finally { setBusy(false); }
  }
  return <form className="panel stack" onSubmit={submit}>
    <h2>Permintaan baru</h2>
    <label className="field">Kategori
      <select value={category} onChange={event => setCategory(event.target.value as Category)} disabled={busy}>
        {Object.entries(supportCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {order && category === "order" && <p>Pesanan dari tautan ini akan dilampirkan secara privat.</p>}
    <label className="field">Pesan bantuan<textarea name="body" value={body} onChange={event => setBody(event.target.value)} maxLength={1000} disabled={busy} required /></label>
    <Button type="submit" disabled={busy || !body.trim()}>{busy ? "Menyimpan..." : failed ? "Coba kirim lagi" : "Kirim ke bantuan"}</Button>
    <p role="status">{message}</p>
  </form>;
}

function QueueCard({ row, operator, lead, operators, memberId, call, onChange, onClaim }: {
  row: QueueCase; operator: boolean; lead: boolean; operators: Operator[]; memberId: string;
  call: SupportCall; onChange: () => void; onClaim: (id: string) => void;
}) {
  const [action, choose] = useState<LeadAction | "">("");
  const [assignee, setAssignee] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const choices = operators.filter(item => item.id !== row.assigneeId);
  const leadActions: LeadAction[] = [];
  if (lead && row.assigneeId) {
    if (choices.length) leadActions.push("reassign");
    if (row.orderAccess) leadActions.push("revoke_order");
    else if (row.escalated && row.hasOrder) leadActions.push("grant_order");
  }

  async function run(next: "claim" | LeadAction) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await call("", { action: next, caseId: row.id, version: row.version,
        ...(next !== "claim" && { reason: reason.trim() }), ...(next === "reassign" && { assignee }) });
      if (next === "claim") onClaim(row.id);
      choose("");
      setReason("");
      setAssignee("");
      setMessage("Status kasus diperbarui.");
      onChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Perubahan belum tersimpan.");
      if (error instanceof SupportFailure && (error.denied || error.status === 409)) onChange();
    } finally { setBusy(false); }
  }
  return <article className="info-box stack">
    <strong>{supportCategories[row.category]}</strong>
    <p>{date(row.updatedAt)}</p>
    <Badge tone={row.escalated ? "warning" : "neutral"}>{row.escalated ? "Perlu tindak lanjut" : row.assigneeId ? "Ditugaskan" : "Belum ditugaskan"}</Badge>
    {row.assigneeId && <p>Petugas {operators.find(item => item.id === row.assigneeId)?.name ?? (row.assigneeId === memberId ? "saat ini adalah kamu" : "saat ini tidak aktif")}</p>}
    {!row.assigneeId && operator && row.canClaim !== false && <Button disabled={busy} onClick={() => void run("claim")}>Ambil kasus</Button>}
    {leadActions.length > 0 && <form className="stack" onSubmit={event => { event.preventDefault(); if (action) void run(action); }}>
      <label className="field">Tindakan pengelola
        <select value={leadActions.includes(action as LeadAction) ? action : ""} onChange={event => choose(event.target.value as LeadAction | "")} disabled={busy}>
          <option value="">Pilih tindakan</option>
          {leadActions.map(value => <option key={value} value={value}>{supportCaseActions[value]}</option>)}
        </select>
      </label>
      {action === "reassign" && <label className="field">Petugas baru
        <select value={assignee} onChange={event => setAssignee(event.target.value)} required disabled={busy}>
          <option value="">Pilih petugas</option>
          {choices.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id.slice(-8)}</option>)}
        </select>
      </label>}
      {action && leadActions.includes(action) && <>
        <label className="field">Alasan tindakan<input value={reason} onChange={event => setReason(event.target.value)} maxLength={200} required disabled={busy} /></label>
        <Button type="submit" disabled={busy || !reason.trim() || (action === "reassign" && !assignee)}>{supportCaseActions[action]}</Button>
      </>}
    </form>}
    <p role="status">{message}</p>
  </article>;
}
