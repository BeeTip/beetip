import Link from "next/link";
import { AuthForm } from "../../components/auth-form";
import { AccountUnavailable } from "../../components/account-unavailable";
import { identityConfigured } from "../../server/identity/config";
import { accountRedirect } from "@beetip/validation";

export default async function Page({ searchParams }: { searchParams: Promise<{ form?: string; error?: string; next?: string }> }) {
  if (!identityConfigured()) return <AccountUnavailable />;
  const query = await searchParams;
  const action = query.form === "signup" ? "signup" : query.form === "recover" ? "recover" : "login";
  const next = accountRedirect(query.next);
  const destination = encodeURIComponent(next);
  return <section className="stack"><h1>{({ login: "Masuk ke BeeTip", signup: "Buat akun BeeTip", recover: "Pulihkan akun" })[action]}</h1><p>Jelajahi listing tanpa akun. Konfirmasikan email untuk masuk.</p>{query.error && <p role="alert">Tautan konfirmasi tidak berlaku. Minta tautan baru atau masuk kembali.</p>}<AuthForm action={action} next={next} /><nav aria-label="Pilihan akun"><Link href={`/login?next=${destination}`}>Masuk</Link> · <Link href={`/login?form=signup&next=${destination}`}>Buat akun</Link> · <Link href="/login?form=recover">Lupa kata sandi</Link></nav><Link href="/">Lanjut jelajahi BeeTip</Link></section>;
}
