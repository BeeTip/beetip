import { ListingForm } from "../../../components/marketplace";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page() {
  if (mode() === "demo") return <ListingForm />;
  if (!identityConfigured()) return <section className="panel stack"><h1>Layanan akun belum tersedia</h1><p>Coba kembali nanti. Kamu tetap dapat menjelajahi contoh listing.</p><Link className="button button-primary" href="/">Jelajahi titipan</Link></section>;
  const member = await currentMember();
  if (!member) redirect("/login?form=signup&next=%2Flistings%2Fnew");
  return <section className="panel stack"><h1>Buat listing</h1><p>{member.status === "suspended" ? "Akses akun dibatasi. Hubungi bantuan untuk informasi lebih lanjut." : "Penerbitan listing belum tersedia. Kamu dapat menjelajahi contoh titipan dan mengakses dashboard tanpa menunggu verifikasi keanggotaan."}</p><Link className="button button-primary" href="/">Jelajahi contoh titipan</Link><Link className="button button-secondary" href="/account">Buka dashboard</Link></section>;
}
