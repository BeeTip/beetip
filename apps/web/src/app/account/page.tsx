import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOut } from "../../components/auth-form";
import { AccountUnavailable } from "../../components/account-unavailable";
import { currentMember, identityClient } from "../../server/identity/client";
import { identityConfigured, mode } from "../../server/identity/config";

export default async function Page() {
  if (mode() === "demo") redirect("/profile");
  if (!identityConfigured()) return <AccountUnavailable />;
  const member = await currentMember();
  if (!member) redirect("/login");
  const finance = member.status === "suspended" ? null : await (await identityClient())
    .from("staff_roles").select("role").eq("member_id", member.id).eq("role", "finance_operation").is("revoked_at", null).maybeSingle();
  return <section className="stack"><h1>Dashboard BeeTip</h1><div className="panel stack"><h2>Halo, {member.name}</h2>{member.status === "suspended" && <p>Akses akun dibatasi. Hubungi pengelola BeeTip.</p>}<Link className="button button-primary" href="/">Jelajahi listing</Link>{member.status !== "suspended" && <><Link className="button button-secondary" href="/listings/new">Buat listing</Link><Link className="button button-secondary" href="/account/listings">Listing saya</Link><Link className="button button-secondary" href="/account/offers">Penawaran saya</Link><Link className="button button-secondary" href="/account/orders">Pesanan saya</Link><Link className="button button-secondary" href="/account/notifications">Notifikasi</Link><Link className="button button-secondary" href="/support">Hubungi bantuan</Link><Link className="button button-secondary" href="/account/affiliation">Afiliasi opsional dan keamanan petugas</Link>{finance?.data && <Link className="button button-secondary" href="/account/funding">Pemeriksaan dana</Link>}</>}<SignOut /></div></section>;
}
