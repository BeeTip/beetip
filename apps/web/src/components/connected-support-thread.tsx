"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { supportCaseActions, supportCategories, type ChatMessage } from "@beetip/validation";
import { Badge, Button } from "./ui";

export type SupportCall = <T extends object>(query?: string, command?: object, signal?: AbortSignal) => Promise<T>;

export class SupportFailure extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
  get denied() { return this.status === 401 || this.status === 403; }
}

type Message = Pick<ChatMessage, "id" | "sequence" | "senderId" | "body" | "createdAt">;
type History = { messages: Message[]; older: number | null };
type Thread = History & {
  id: string; status: "open" | "resolved"; category: keyof typeof supportCategories; requester: boolean;
  assigned: boolean; escalated: boolean; version: number; orderAccess: boolean; hasOrder: boolean;
};
type Action = "resolve" | "reopen" | "escalate";

function combine(previous: Thread | null, latest: Thread): Thread {
  if (!previous?.messages.length || !latest.messages.length
    || latest.messages[0].sequence > previous.messages[previous.messages.length - 1].sequence + 1) return latest;
  const earlier = previous.messages.filter(item => item.sequence < latest.messages[0].sequence);
  return earlier.length ? { ...latest, messages: [...earlier, ...latest.messages], older: previous.older } : latest;
}

export function SupportThread({ id, memberId, refresh, call, onChange, onBack }: {
  id: string; memberId: string; refresh: number; call: SupportCall; onChange: () => void; onBack: () => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [paging, setPaging] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [failed, setFailed] = useState(false);
  const [orderHistory, setOrderHistory] = useState<{ data: History; refresh: number } | null>(null);
  const [orderError, setOrderError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const attempt = useRef<{ body: string; id: string } | null>(null);

  function forget() {
    setThread(null);
    setDraft("");
    setReason("");
    setOrderHistory(null);
    setOrderError("");
    attempt.current = null;
  }

  useEffect(() => { heading.current?.focus(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    void call<{ thread: Thread }>(`?case=${id}`, undefined, controller.signal).then(({ thread: latest }) => {
      if (controller.signal.aborted) return;
      setThread(previous => combine(previous, latest));
      setOrderHistory(previous => previous && latest.orderAccess ? { ...previous, refresh } : null);
      setOrderError("");
      setLoadError("");
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof SupportFailure && error.denied) forget();
      else { setThread(null); setOrderHistory(null); }
      setLoadError(error.message);
    });
    return () => controller.abort();
  }, [call, id, refresh]);

  async function page(before: number | null, order: boolean) {
    if (paging) return;
    setPaging(true);
    if (order) setOrderError("");
    else setError("");
    try {
      const query = new URLSearchParams({ case: id });
      if (before !== null) query.set("before", String(before));
      if (order) query.set("history", "order");
      const { thread: result } = await call<{ thread: Thread }>(`?${query}`);
      if (order) {
        setOrderHistory(previous => ({
          data: { messages: [...result.messages, ...(before !== null && previous?.refresh === refresh ? previous.data.messages : [])], older: result.older },
          refresh,
        }));
      } else {
        setThread(previous => previous ? {
          ...previous, messages: [...result.messages.filter(item => item.sequence < previous.messages[0].sequence), ...previous.messages],
          older: result.older,
        } : null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Riwayat belum dapat dimuat.";
      if (order) {
        setOrderHistory(null);
        setOrderError(message);
      } else if (error instanceof SupportFailure && error.denied) {
        forget();
        setLoadError(message);
      } else setError(message);
    } finally { setPaging(false); }
  }

  async function run(command: object, success: string) {
    if (busy) return false;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await call("", command);
      setNotice(success);
      onChange();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Perubahan belum tersimpan.";
      if (error instanceof SupportFailure && error.denied) { forget(); setLoadError(message); }
      else {
        setError(message);
        if (error instanceof SupportFailure && error.status === 409) onChange();
      }
      return false;
    } finally { setBusy(false); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    const body = draft.trim();
    if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() };
    const sent = await run({ action: "send", caseId: id, clientId: attempt.current.id, body }, "Balasan tersimpan.");
    setFailed(!sent);
    if (sent) { attempt.current = null; setDraft(""); }
  }

  async function act(action: Action) {
    if (!thread) return;
    const done = await run({ action, caseId: id, version: thread.version, ...(action === "escalate" && { reason: reason.trim() }) },
      action === "resolve" ? "Kasus ditandai selesai." : action === "reopen" ? "Kasus dibuka kembali." : "Kasus dieskalasi ke pengelola.");
    if (done) setReason("");
  }

  const order = orderHistory?.refresh === refresh && thread?.orderAccess ? orderHistory.data : null;
  const lastMessage = thread?.messages.at(-1);
  return <section className="panel stack" aria-labelledby="support-thread-title">
    <h2 id="support-thread-title" ref={heading} tabIndex={-1}>{thread ? supportCategories[thread.category] : "Percakapan bantuan"}</h2>
    <Button variant="secondary" onClick={onBack}>Tutup percakapan</Button>
    {loadError && <p role="alert">{loadError}</p>}
    {!thread && !loadError && <p role="status">Memuat pesan...</p>}
    {thread && <>
      <Badge tone={thread.status === "resolved" ? "success" : thread.escalated ? "warning" : "neutral"}>
        {thread.status === "resolved" ? "Selesai" : thread.escalated ? "Dieskalasi" : thread.assigned ? "Ditangani" : "Menunggu petugas"}
      </Badge>
      {thread.requester && thread.hasOrder && <p>Pesanan tertaut secara privat ke kasus ini.</p>}
      {thread.older !== null && <Button variant="secondary" onClick={() => void page(thread.older, false)} disabled={paging}>Muat pesan sebelumnya</Button>}
      <HistoryMessages rows={thread.messages} memberId={memberId} requester={thread.requester} />
      {lastMessage && <Button variant="secondary" disabled={busy}
        onClick={() => void run({ action: "read", caseId: id, sequence: lastMessage.sequence }, "Pesan ditandai dibaca.")}>
        Tandai pesan yang tampil dibaca
      </Button>}
      {thread.status === "resolved" ? <>
        <p>Buka kembali kasus untuk mengirim balasan baru.</p>
        <Button disabled={busy} onClick={() => void act("reopen")}>Buka kembali</Button>
      </> : <>
        <form className="stack" onSubmit={send}>
          <label className="field">Balasan<textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={1000} required disabled={busy} /></label>
          <Button type="submit" disabled={busy || !draft.trim()}>{busy ? "Menyimpan..." : failed ? "Coba kirim lagi" : "Kirim balasan"}</Button>
        </form>
        {!thread.requester && <>
          <Button variant="secondary" disabled={busy} onClick={() => void act("resolve")}>Tandai selesai</Button>
          {!thread.escalated && <form className="stack" onSubmit={event => { event.preventDefault(); void act("escalate"); }}>
            <label className="field">Alasan eskalasi<input value={reason} onChange={event => setReason(event.target.value)} maxLength={200} required disabled={busy} /></label>
            <Button variant="secondary" type="submit" disabled={busy || !reason.trim()}>{supportCaseActions.escalate}</Button>
          </form>}
          {thread.escalated && thread.hasOrder && !thread.orderAccess && <p>Pengelola dapat memberi izin baca chat pesanan untuk kasus ini.</p>}
        </>}
      </>}
      {thread.orderAccess && <section className="info-box stack" aria-label="Chat pesanan terkait" aria-busy={paging}>
        <h3>Chat pesanan terkait</h3>
        <p>Akses baca untuk kasus ini dicatat.</p>
        {order ? <>
          <Button variant="secondary" onClick={() => setOrderHistory(null)}>Sembunyikan chat pesanan</Button>
          {order.older !== null && <Button variant="secondary" disabled={paging} onClick={() => void page(order.older, true)}>Muat pesan pesanan sebelumnya</Button>}
          <HistoryMessages rows={order.messages} memberId={memberId} requester={false} order />
        </> : <Button variant="secondary" disabled={paging} onClick={() => void page(null, true)}>Baca chat pesanan</Button>}
        {orderError && <p role="alert">{orderError}</p>}
      </section>}
    </>}
    {error && <p role="alert">{error}</p>}
    <p role="status">{notice}</p>
  </section>;
}

function HistoryMessages({ rows, memberId, requester, order }: { rows: Message[]; memberId: string; requester: boolean; order?: boolean }) {
  if (!rows.length) return <p>Belum ada pesan.</p>;
  return <div className="stack" aria-label={order ? "Riwayat pesanan" : "Riwayat bantuan"}>
    {rows.map(item => <article className="info-box" key={item.id}>
      <strong>{item.senderId === memberId ? "Kamu" : order ? "Peserta pesanan" : requester ? "Tim bantuan" : "Peserta bantuan"}</strong>
      <p style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{item.body}</p>
      <time className="small" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</time>
    </article>)}
  </div>;
}
