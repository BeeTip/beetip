import Link from "next/link";

export function AccountUnavailable({ title = "Layanan akun belum tersedia", retryHref }: { title?: string; retryHref?: string } = {}) {
  return <section className="panel stack">
    <h1>{title}</h1>
    <p>Coba lagi nanti atau lanjut jelajahi titipan.</p>
    {retryHref && <a className="button button-primary" href={retryHref}>Coba lagi</a>}
    <Link className={retryHref ? "button button-secondary" : "button button-primary"} href="/">Jelajahi titipan</Link>
  </section>;
}
