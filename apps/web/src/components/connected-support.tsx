"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "./ui";

type Thread = { id: string; status: string; messages: { id: string; sequence: number; sender_id: string; body: string; created_at: string }[] };
export function ConnectedSupport() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [memberId, setMemberId] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const identity = useRef<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    const response = await fetch("/api/identity/support", { cache: "no-store" });
    const result = await response.json();
    if (current !== generation.current) return;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) { setThreads([]); setBody(""); attempt.current = null; }
      throw new Error(result.message ?? "Bantuan belum tersedia.");
    }
    if (identity.current && identity.current !== result.memberId) { setBody(""); attempt.current = null; }
    identity.current = result.memberId;
    setThreads(result.threads); setMemberId(result.memberId);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    fetch("/api/identity/support", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (current !== generation.current) return;
        if (!response.ok) throw new Error(result.message ?? "Bantuan belum tersedia.");
        identity.current = result.memberId;
        setThreads(result.threads); setMemberId(result.memberId);
      })
      .catch(error => { if (!controller.signal.aborted) setMessage(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    function revalidate() {
      if (document.visibilityState !== "visible") return;
      setThreads([]); setLoading(true);
      refresh().catch(error => setMessage(error.message)).finally(() => setLoading(false));
    }
    function accountChanged(event: StorageEvent) {
      if (event.key !== "beetip-auth-change") return;
      setThreads([]); setBody(""); attempt.current = null;
      revalidate();
    }
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    window.addEventListener("storage", accountChanged);
    const timer = setInterval(revalidate, 30000);
    return () => { window.removeEventListener("focus", revalidate); document.removeEventListener("visibilitychange", revalidate); window.removeEventListener("storage", accountChanged); clearInterval(timer); };
  }, [refresh]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const text = body.trim();
    if (!attempt.current || attempt.current.body !== text) attempt.current = { body: text, id: crypto.randomUUID() };
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/identity/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: attempt.current.id, body: text }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { setThreads([]); setBody(""); attempt.current = null; }
        throw new Error(result.message ?? "Pesan belum terkirim.");
      }
      setBody(""); attempt.current = null;
      setMessage("Pesan bantuan tersimpan.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Koneksi terputus. Coba lagi dengan pesan yang sama."); }
    finally { setBusy(false); }
  }
  return <section className="stack"><h1>Hubungi bantuan</h1><p>Pesan hanya dapat dibaca oleh akunmu dan petugas bantuan yang ditugaskan.</p><form className="panel stack" onSubmit={submit}><label className="field">Pesan bantuan<textarea name="body" value={body} onChange={event => setBody(event.target.value)} maxLength={1000} disabled={busy} required /></label><Button type="submit" disabled={busy || !body.trim()}>{busy ? "Menyimpan..." : "Kirim ke bantuan"}</Button></form><p role="status" aria-live="polite">{message}</p>{loading ? <p role="status">Memuat percakapan...</p> : <><Button variant="secondary" onClick={() => refresh().catch(error => setMessage(error.message))}>Muat ulang percakapan</Button>{!threads.length && <p>Belum ada percakapan bantuan.</p>}{threads.map(thread => <section className="panel stack" key={thread.id}><h2>{thread.status === "open" ? "Bantuan terbuka" : "Bantuan selesai"}</h2>{thread.messages.map(item => <article className="info-box" key={item.id}><strong>{item.sender_id === memberId ? "Kamu" : "Tim bantuan"}</strong><p>{item.body}</p><p className="small">{new Date(item.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p></article>)}</section>)}</>}</section>;
}
