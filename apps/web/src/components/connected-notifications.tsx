"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notificationRegistry, type InboxNotification, type NotificationPreference } from "@beetip/validation";
import { Button } from "./ui";

type Cursor = { before: string; beforeId: string };
export function ConnectedNotifications({ memberId }: { memberId: string }) {
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreference[]>([]);
  const [unread, setUnread] = useState(0);
  const [next, setNext] = useState<Cursor | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; controller.current?.abort(); }, []);
  const clear = useCallback(() => { invalidate(); setItems([]); setPreferences([]); setUnread(0); setNext(null); }, [invalidate]);
  const load = useCallback(async (cursor?: Cursor) => {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const current = ++generation.current;
    try {
      const response = await fetch(`/api/identity/notifications?${new URLSearchParams(cursor ?? {})}`, { cache: "no-store", signal: request.signal });
      const result = await response.json();
      if (request.signal.aborted || current !== generation.current) return;
      if (!response.ok || result.memberId !== memberId) { clear(); setError(result.message ?? "Sesi berubah. Muat ulang halaman."); return; }
      setItems(previous => cursor ? [...previous, ...result.items.filter((row: InboxNotification) => !previous.some(item => item.id === row.id))] : result.items);
      setPreferences(result.preferences); setUnread(result.unread); setNext(result.next); setError("");
    } catch (cause) { if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : "Gagal memuat notifikasi."); }
  }, [memberId, clear]);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    function refresh() { if (document.visibilityState === "visible") { clear(); void load(); } }
    function changed(event: StorageEvent) { if (event.key === "beetip-auth-change") { clear(); if (document.visibilityState === "visible") void load(); } }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("storage", changed);
    const timer = setInterval(refresh, 30000);
    return () => { clearTimeout(initial); clearInterval(timer); invalidate(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("storage", changed); };
  }, [load, clear, invalidate]);
  async function command(input: unknown) {
    setBusy(true);
    const current = generation.current;
    try {
      const response = await fetch("/api/identity/notifications", { method: "POST", headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId }, body: JSON.stringify(input) });
      if (current !== generation.current) return;
      if (!response.ok) { if (response.status === 401 || response.status === 403) clear(); throw new Error((await response.json()).message); }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Permintaan gagal."); }
    finally { setBusy(false); }
  }
  async function open(id: string) {
    const current = generation.current;
    try {
      const response = await fetch(`/api/identity/notifications/${id}/target`, { cache: "no-store" });
      const result = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) clear();
        throw new Error(result.message);
      }
      window.location.assign(result.target);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Tujuan tidak tersedia."); }
  }
  return <section className="stack">
    <h1>Notifikasi</h1>
    <p role="status">{unread} belum dibaca</p>
    {error && <p role="alert">{error}</p>}
    <Button variant="secondary" onClick={() => void load()}>Muat ulang</Button>
    {items.length === 0 && <p>Belum ada notifikasi yang tersedia.</p>}
    <ul className="stack">{items.map(item => <li className="panel stack" key={item.id}>
      <p>{notificationRegistry[item.event_type].title} {item.read_at ? "(Dibaca)" : "(Baru)"}</p>
      <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</time>
      <Button variant="secondary" onClick={() => void open(item.id)}>Buka</Button>
      {!item.read_at && <Button disabled={busy} onClick={() => void command({ action: "read", id: item.id })}>Tandai dibaca</Button>}
    </li>)}</ul>
    {next && <Button disabled={busy} onClick={() => void load(next)}>Muat lebih banyak</Button>}
    <h2>Preferensi email</h2>
    <p>Notifikasi di aplikasi tetap tersedia. Pengiriman email mengikuti kesiapan layanan.</p>
    {preferences.filter(preference => {
      const rule = notificationRegistry[preference.event_type];
      return rule.implemented && rule.email !== "in_app_only";
    }).map(preference => <label className="check-field" key={preference.event_type}>
      <input type="checkbox" checked={preference.email_enabled} disabled={busy} onChange={event => void command({ action: "preference", eventType: preference.event_type, email: event.target.checked })} />
      {notificationRegistry[preference.event_type].title}
    </label>)}
  </section>;
}
