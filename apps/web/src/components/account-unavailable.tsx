import Link from "next/link";

export function AccountUnavailable() {
  return <section className="panel stack">
    <h1>Layanan akun belum tersedia</h1>
    <p>Coba lagi nanti atau lanjut jelajahi titipan.</p>
    <Link className="button button-primary" href="/">Jelajahi titipan</Link>
  </section>;
}
