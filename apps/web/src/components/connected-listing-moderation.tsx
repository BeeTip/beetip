"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { moderationCommandSchema, moderationStatuses, type ModerationCommand, type ModerationListing } from "@beetip/validation";
import { Button } from "./ui";

const endpoint = "/api/identity/listing-moderation";
const statuses = { active: "Aktif", paused: "Dijeda", closed: "Ditutup", removed: "Dihapus" };

function Decision({ listing, memberId, reload }: { listing: ModerationListing; memberId: string; reload: (preserveDraft?: boolean) => Promise<void> }) {
  const [status, setStatus] = useState<ModerationListing["status"] | "">("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<ModerationCommand | null>(null);
  const availableStatuses = moderationStatuses.filter(value => value !== listing.status || (!listing.moderated && value !== "active"));
  const nextStatus = status && availableStatuses.includes(status) ? status : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const parsed = moderationCommandSchema.safeParse({
      operationId: pending.current?.operationId ?? crypto.randomUUID(),
      listingId: listing.id, version: listing.version, status: nextStatus, reason,
    });
    if (!parsed.success) { setError("Pilih status dan isi alasan moderasi dengan 3 sampai 500 karakter."); return; }
    pending.current = parsed.data;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (response.status >= 500 || (response.ok && data.memberId !== memberId)) throw new Error();
      pending.current = null;
      setUncertain(false);
      if (!response.ok) { setError(data.message); return; }
      await reload();
    } catch {
      setUncertain(true);
      setError("Status belum dapat dikonfirmasi. Coba simpan lagi atau muat ulang listing.");
    } finally { setBusy(false); }
  }

  function refresh() {
    pending.current = null;
    setUncertain(false);
    setError("");
    void reload(true);
  }

  return <article className="panel stack">
    <h2>{listing.title}</h2>
    <p>{statuses[listing.status]}{listing.moderated ? " oleh operator" : ""}</p>
    <p>Batas penawaran: {new Date(listing.cutoff).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p>
    <form className="stack" onSubmit={submit}>
      <label className="field">Status baru
        <select required value={nextStatus} disabled={busy || uncertain} onChange={event => setStatus(event.target.value as typeof status)}>
          <option value="">Pilih status</option>
          {availableStatuses.map(value => <option key={value} value={value}>{statuses[value]}</option>)}
        </select>
      </label>
      <label className="field">Alasan moderasi
        <textarea required minLength={3} maxLength={500} value={reason} disabled={busy || uncertain} onChange={event => setReason(event.target.value)} />
      </label>
      <Button type="submit" disabled={busy}>{busy ? "Menyimpan..." : "Simpan status"}</Button>
    </form>
    {error && <div className="info-box stack"><p role="alert">{error}</p>
      <Button variant="secondary" disabled={busy} onClick={refresh}>Muat ulang listing</Button>
    </div>}
  </article>;
}

export function ConnectedListingModeration({ memberId }: { memberId: string }) {
  const [search, setSearch] = useState("");
  const [listings, setListings] = useState<ModerationListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [generation, setGeneration] = useState(0);
  const submittedSearch = useRef("");
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (term: string, preserveDraft = false) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError(""); setDenied(false);
    try {
      const params = new URLSearchParams({ search: term.trim() });
      const response = await fetch(`${endpoint}?${params}`, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (response.status === 403) setDenied(true);
      if (!response.ok || data.memberId !== memberId) throw new Error(data.message ?? "Sesi berubah. Muat ulang halaman.");
      setListings(data.listings);
      if (!preserveDraft) setGeneration(value => value + 1);
    } catch (error) {
      if (!controller.signal.aborted) {
        setListings([]);
        setError(error instanceof Error && error.name === "Error" ? error.message : "Listing belum dapat dimuat. Coba lagi.");
      }
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [memberId]);
  useEffect(() => {
    const timer = setTimeout(() => void load(""), 0);
    return () => { clearTimeout(timer); request.current?.abort(); };
  }, [load]);

  return <section className="stack">
    <Link href="/account">Kembali ke akun</Link>
    <h1>Moderasi listing</h1>
    <form className="panel stack" onSubmit={event => {
      event.preventDefault();
      submittedSearch.current = search;
      void load(search);
    }}>
      <label className="field">Cari judul atau ID listing
        <input type="search" value={search} maxLength={100} onChange={event => setSearch(event.target.value)} />
      </label>
      <Button type="submit" disabled={loading}>Cari listing</Button>
    </form>
    {loading && <p role="status">Memuat listing...</p>}
    {error && <div className="info-box stack"><p role="alert">{error}</p>
      {denied && <Link href="/account/affiliation">Verifikasi MFA di pengaturan akun</Link>}
      <Button variant="secondary" onClick={() => void load(submittedSearch.current)}>Coba lagi</Button>
    </div>}
    {!loading && !error && listings.length === 0 && <p role="status">Listing tidak ditemukan.</p>}
    {listings.length > 0 && <div hidden={loading} className={loading ? undefined : "stack"}>
      {listings.map(listing => <Decision key={`${generation}:${listing.id}`} listing={listing}
        memberId={memberId} reload={preserveDraft => load(submittedSearch.current, preserveDraft)} />)}
    </div>}
  </section>;
}
