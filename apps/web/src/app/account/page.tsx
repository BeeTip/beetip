import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOut } from "../../components/auth-form";
import { currentMember } from "../../server/identity/client";
import { identityConfigured, mode } from "../../server/identity/config";

export default async function Page() {
  if (mode() === "demo") redirect("/profile");
  if (!identityConfigured()) return <section className="panel"><h1>Layanan akun belum tersedia</h1><p>Konfigurasi layanan belum selesai. Coba kembali nanti.</p></section>;
  const member = await currentMember();
  if (!member) redirect("/login");
  return <section className="stack"><h1>Dashboard BeeTip</h1><div className="panel stack"><h2>Halo, {member.name}</h2><p>{member.status === "suspended" ? "Akses akun dibatasi. Hubungi pengelola BeeTip." : "Email terkonfirmasi. Akunmu siap digunakan tanpa persetujuan keanggotaan."}</p><Link className="button button-primary" href="/">Jelajahi listing</Link>{member.status !== "suspended" && <><Link className="button button-secondary" href="/account/listings">Listing saya</Link><Link className="button button-secondary" href="/account/offers">Penawaran saya</Link><Link className="button button-secondary" href="/account/orders">Pesanan saya</Link><Link className="button button-secondary" href="/account/notifications">Notifikasi</Link><Link className="button button-secondary" href="/support">Hubungi bantuan</Link><Link className="button button-secondary" href="/account/affiliation">Afiliasi opsional dan keamanan petugas</Link></>}<SignOut /></div></section>;
}
