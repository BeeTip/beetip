"use client";

import { useState } from "react";
import { Button } from "./ui";

export function ReconciliationExport({ memberId, scope, id }: { memberId: string; scope: "order" | "trip"; id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/identity/reconciliation", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Beetip-Member": memberId },
        body: JSON.stringify({ scope, id }), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.message ?? "CSV belum dapat diunduh.");
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "beetip-rekonsiliasi.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("CSV belum dapat diunduh. Periksa koneksi dan coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="stack">
    <Button variant="secondary" onClick={download} disabled={busy}>{busy ? "Menyiapkan CSV…" : "Unduh CSV"}</Button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
