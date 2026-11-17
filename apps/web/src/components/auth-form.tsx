"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui";

type Action = "login" | "signup" | "recover" | "password";
function announceAccountChange() {
  try { localStorage.setItem("beetip-auth-change", crypto.randomUUID()); } catch {}
}
export function AuthForm({ action }: { action: Action }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/identity/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...fields }) });
      const result = await response.json();
      setMessage(result.message);
      if (result.ok && (action === "login" || action === "password")) { announceAccountChange(); router.push("/account"); router.refresh(); }
    } catch { setMessage("Koneksi terputus. Coba lagi."); }
    finally { setBusy(false); }
  }
  return <form className="panel stack" onSubmit={submit}>{action === "signup" && <label className="field">Nama tampilan<input name="name" autoComplete="name" maxLength={80} required /></label>}{action !== "password" && <label className="field">Email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>}{action !== "recover" && <label className="field">Kata sandi<input name="password" type="password" autoComplete={action === "login" ? "current-password" : "new-password"} minLength={action === "login" ? 1 : 12} maxLength={128} required /></label>}<Button disabled={busy} type="submit">{busy ? "Memproses..." : ({ login: "Masuk", signup: "Buat akun", recover: "Kirim tautan pemulihan", password: "Simpan kata sandi" })[action]}</Button><p role="status" aria-live="polite">{message}</p></form>;
}

export function SignOut() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return <><Button variant="secondary" disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/identity/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "signout" }) });
      if (!response.ok) throw new Error("Signout failed");
      announceAccountChange();
      router.push("/login"); router.refresh();
    } catch { setError("Belum berhasil keluar. Coba lagi."); }
    finally { setBusy(false); }
  }}>Keluar</Button><p role="status">{error}</p></>;
}
