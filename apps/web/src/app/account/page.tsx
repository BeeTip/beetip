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
  return <section className="stack"><h1>Akun BeeTip</h1><div className="panel stack"><h2>{member.name}</h2><p>{member.status === "approved" ? "Keanggotaan terverifikasi." : member.status === "suspended" ? "Akses akun dibatasi. Hubungi pengelola BeeTip." : "Verifikasi keanggotaan belum selesai. Kamu sudah dapat menghubungi bantuan."}</p>{member.status !== "suspended" && <Link className="button button-primary" href="/support">Hubungi bantuan</Link>}<SignOut /></div></section>;
}
