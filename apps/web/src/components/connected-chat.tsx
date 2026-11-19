"use client";

import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useRef, useState } from "react";
import { mergeChat, type ChatMessage, type ChatPage } from "@beetip/validation";
import { Button } from "./ui";

type Attempt = { id: string; body: string; status: "sending" | "failed"; error?: string };
type Runtime = { refresh: () => void; older: () => void; send: (attempt: Attempt) => void; read: () => void };

export function ConnectedChat({ orderId, memberId }: { orderId: string; memberId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState<ChatPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const runtime = useRef<Runtime | null>(null);
  useEffect(() => {
    let disposed = false;
    let blocked = false;
    let busy = false;
    let dirty = false;
    let after: number | null = null;
    let older: number | null = null;
    let displayed = 0;
    const sending = new Set<string>();
    const unconfirmed = new Map<string, string>();
    const controllers = new Set<AbortController>();
    const client = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const channel = client.channel(`member:${memberId}`, { config: { private: true } });
    function clear() {
      if (disposed || blocked) return;
      blocked = true;
      controllers.forEach(controller => controller.abort());
      void client.removeChannel(channel);
      setMessages([]); setAttempts([]); setDraft(""); setPage(null); setError(""); setDenied(true);
    }
    async function request(params?: string, body?: object) {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(`/api/identity/chat${body ? "" : `?order=${orderId}${params ?? ""}`}`, {
          cache: "no-store", signal: controller.signal,
          ...(body ? { method: "POST", headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId }, body: JSON.stringify({ ...body, order: orderId }) } : {}),
        });
        const data = await response.json();
        if (disposed || blocked) throw new Error("Sesi berubah.");
        if (response.status === 401 || response.status === 403 || (data.ok && data.memberId !== memberId)) { clear(); throw new Error("Akses percakapan berakhir."); }
        if (!response.ok || !data.ok) throw new Error(data.message ?? "Permintaan gagal. Coba lagi.");
        return data;
      } finally { clearTimeout(timeout); controllers.delete(controller); }
    }
    function merge(rows: ChatMessage[]) {
      displayed = Math.max(displayed, ...rows.map(row => row.sequence));
      setMessages(previous => mergeChat(previous, rows));
      setAttempts(previous => previous.filter(attempt => !rows.some(row => row.senderId === memberId && row.clientId === attempt.id)));
      for (const row of rows) {
        if (row.senderId !== memberId || unconfirmed.get(row.clientId) !== row.body) continue;
        unconfirmed.delete(row.clientId);
        setDraft(previous => previous.trim() === row.body ? "" : previous);
      }
    }
    async function refresh() {
      if (disposed || blocked || document.visibilityState !== "visible") return;
      dirty = true;
      if (busy) return;
      busy = true;
      setLoading(true);
      try {
        do {
          dirty = false;
          const initial = after === null;
          const data = await request(initial ? "" : `&after=${after}`);
          if (disposed || blocked) return;
          const result = data.page as ChatPage;
          if (!Array.isArray(result.messages) || !Number.isSafeInteger(result.highWater) || !Number.isSafeInteger(result.after)) throw new Error("Balasan belum dapat dipastikan. Coba lagi.");
          merge(result.messages);
          after = initial ? result.highWater : result.after;
          if (initial) older = result.older;
          setPage({ ...result, older }); setError("");
          if (result.hasMore) dirty = true;
        } while (dirty && !disposed && !blocked);
      } catch (cause) { if (!disposed && !blocked) setError(cause instanceof Error ? cause.message : "Gagal memuat pesan."); }
      finally { busy = false; if (!disposed && !blocked) setLoading(false); }
    }
    async function loadOlder() {
      if (older === null || busy || blocked || disposed) return;
      busy = true; setLoading(true);
      try {
        const data = await request(`&before=${older}`);
        if (disposed || blocked) return;
        const result = data.page as ChatPage;
        merge(result.messages); older = result.older; setPage(previous => previous && { ...previous, older }); setError("");
      } catch { if (!disposed && !blocked) setError("Pesan lama gagal dimuat. Coba lagi."); }
      finally { busy = false; if (!disposed && !blocked) { setLoading(false); if (dirty) void refresh(); } }
    }
    async function send(attempt: Attempt) {
      if (disposed || blocked || sending.has(attempt.id)) return;
      sending.add(attempt.id);
      unconfirmed.set(attempt.id, attempt.body);
      setAttempts(previous => [...previous.filter(row => row.id !== attempt.id), { ...attempt, status: "sending" }]);
      try {
        const data = await request(undefined, { action: "send", clientId: attempt.id, body: attempt.body });
        if (disposed || blocked) return;
        const row = data.message as ChatMessage;
        if (!row?.id || row.clientId !== attempt.id || row.senderId !== memberId || row.body !== attempt.body || !Number.isSafeInteger(row.sequence)) throw new Error("Hasil belum dapat dipastikan. Coba lagi dengan pesan yang sama.");
        merge([row]);
        void refresh();
      } catch (cause) {
        if (!disposed && !blocked) setAttempts(previous => previous.map(row => row.id === attempt.id ? { ...row, status: "failed", error: cause instanceof Error ? cause.message : "Hasil belum diketahui. Coba lagi." } : row));
      } finally { sending.delete(attempt.id); }
    }
    async function read() {
      if (disposed || blocked || document.visibilityState !== "visible" || !displayed) return;
      try { await request(undefined, { action: "read", sequence: displayed }); void refresh(); }
      catch { if (!disposed && !blocked) setError("Penanda baca belum tersimpan. Coba lagi."); }
    }
    runtime.current = { refresh: () => void refresh(), older: () => void loadOlder(), send: attempt => void send(attempt), read: () => void read() };
    const auth = client.auth.onAuthStateChange((_event, session) => { if (session?.user.id !== memberId) clear(); });
    void client.realtime.setAuth().then(() => {
      if (disposed || blocked) return;
      channel.on("broadcast", { event: "refresh" }, () => void refresh()).subscribe(status => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") void refresh();
      });
    }).catch(() => void refresh());
    const fallback = setTimeout(() => void refresh(), 4000);
    const poll = setInterval(() => void refresh(), 30000);
    function changed(event: StorageEvent) { if (event.key === "beetip-auth-change") clear(); }
    function visible() { void refresh(); }
    window.addEventListener("storage", changed); window.addEventListener("online", visible);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true; runtime.current = null; controllers.forEach(controller => controller.abort());
      clearTimeout(fallback); clearInterval(poll); auth.data.subscription.unsubscribe(); void client.removeChannel(channel);
      window.removeEventListener("storage", changed); window.removeEventListener("online", visible); document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [orderId, memberId]);
  if (denied) return <section className="panel stack"><h1>Percakapan tidak tersedia</h1><p>Sesi atau akses akun berubah. Isi percakapan telah dibersihkan.</p><Link href="/account">Kembali ke akun</Link></section>;
  return <section className="panel stack"><Link href={`/orders/${orderId}`}>Kembali ke pesanan</Link><h1>Pesan pesanan</h1><p>Percakapan pribadi untuk mengatur titipanmu.</p>{loading && !page && <p role="status">Memuat pesan...</p>}{error && <div role="alert"><p>{error}</p><Button onClick={() => runtime.current?.refresh()}>Coba muat lagi</Button></div>}{page && <p>{page.unread} pesan belum ditandai dibaca</p>}{page?.older && <Button variant="secondary" disabled={loading} onClick={() => runtime.current?.older()}>Muat pesan sebelumnya</Button>}{page && !loading && messages.length === 0 && <p>Belum ada pesan. Mulai percakapan untuk mengatur titipanmu.</p>}<ol className="stack" aria-label="Pesan tersimpan">{messages.map(row => <li key={row.id} className="info-box" style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}><strong>{row.senderId === memberId ? "Anda" : "Lawan bicara"}</strong><p>{row.body}</p><small>{new Date(row.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB"} | Tersimpan</small></li>)}</ol>{messages.length > 0 && <Button variant="secondary" onClick={() => runtime.current?.read()}>Tandai pesan yang tampil dibaca</Button>}{attempts.map(attempt => <div key={attempt.id} className="info-box" style={{ overflowWrap: "anywhere" }}><p>{attempt.body}</p><p role="status">{attempt.status === "sending" ? "Mengirim..." : "Belum terkonfirmasi. Pesan dapat sudah tersimpan."}</p>{attempt.error && <p role="alert">{attempt.error}</p>}{attempt.status === "failed" && <Button onClick={() => runtime.current?.send(attempt)}>Coba kirim pesan ini lagi</Button>}</div>)}{page?.closed ? <p>Percakapan ditutup. Riwayat tetap dapat dibaca.</p> : <form className="stack" onSubmit={event => {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const existing = attempts.find(row => row.body === body);
    if (existing?.status === "sending") return;
    runtime.current?.send(existing ?? { id: crypto.randomUUID(), body, status: "sending" });
  }}><label className="field">Pesan<textarea value={draft} maxLength={1000} rows={4} onChange={event => setDraft(event.target.value)} /></label><p>Draf hanya disimpan selama halaman ini terbuka. Pesan tidak mengubah kesepakatan atau pembayaran.</p><Button type="submit" disabled={!page || !draft.trim() || attempts.some(row => row.status === "sending" && row.body === draft.trim())}>Kirim pesan</Button></form>}{page && <Link className="button button-secondary" href={`/support?orderId=${orderId}`}>Minta bantuan untuk pesanan ini</Link>}</section>;
}
