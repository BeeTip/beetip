import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Bell, ChevronRight, Compass, Handshake, LayoutList, LifeBuoy, Package, Plus, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";
import { SignOut } from "../../components/auth-form";
import { AccountUnavailable } from "../../components/account-unavailable";
import { currentMember, identityClient } from "../../server/identity/client";
import { identityConfigured, mode } from "../../server/identity/config";

const activity = [
  { href: "/account/listings", label: "Listing saya", icon: LayoutList, tone: "honey" },
  { href: "/account/offers", label: "Penawaran saya", icon: Handshake, tone: "sage" },
  { href: "/account/orders", label: "Pesanan saya", icon: Package, tone: "peach" },
  { href: "/account/notifications", label: "Notifikasi", icon: Bell, tone: "honey" },
];

function DashboardLink({ href, label, icon: Icon, tone = "sage" }: { href: string; label: string; icon: LucideIcon; tone?: string }) {
  return <Link className="dashboard-link" href={href}>
    <span className={`dashboard-icon dashboard-icon-${tone}`}><Icon size={20} aria-hidden="true" /></span>
    <span>{label}</span><ChevronRight size={18} aria-hidden="true" />
  </Link>;
}

export default async function Page() {
  if (mode() === "demo") redirect("/profile");
  if (!identityConfigured()) return <AccountUnavailable />;
  const member = await currentMember();
  if (!member) redirect("/login");
  const finance = member.status === "suspended" ? null : await (await identityClient())
    .from("staff_roles").select("role").eq("member_id", member.id).eq("role", "finance_operation").is("revoked_at", null).maybeSingle();
  return <section className="account-dashboard" aria-label="Dashboard BeeTip">
    <header className="dashboard-hero">
      <span className="dashboard-monogram" aria-hidden="true">{Array.from(member.name.trim())[0]?.toLocaleUpperCase("id-ID")}</span>
      <h1>Halo, {member.name}</h1>
      {member.status === "suspended" && <p>Akses akun dibatasi. Hubungi pengelola BeeTip.</p>}
      <div className="dashboard-actions">
        {member.status !== "suspended" && <Link className="button button-primary" href="/listings/new"><Plus size={19} aria-hidden="true" />Buat listing</Link>}
        <Link className="button button-secondary" href="/"><Compass size={19} aria-hidden="true" />Jelajahi listing<ArrowRight size={16} aria-hidden="true" /></Link>
      </div>
    </header>
    {member.status !== "suspended" && <section className="dashboard-section" aria-labelledby="dashboard-activity">
      <h2 id="dashboard-activity">Aktivitas saya</h2>
      <div className="dashboard-activity">{activity.map(item => <DashboardLink key={item.href} {...item} />)}</div>
    </section>}
    <section className="dashboard-section" aria-labelledby="dashboard-account">
      <h2 id="dashboard-account">Akun dan bantuan</h2>
      <div className="dashboard-settings">
        <DashboardLink href="/support" label="Hubungi bantuan" icon={LifeBuoy} />
        {member.status !== "suspended" && <DashboardLink href="/account/affiliation" label="Afiliasi dan keamanan akun" icon={ShieldCheck} />}
        {finance?.data && <DashboardLink href="/account/funding" label="Pemeriksaan dana" icon={Wallet} />}
      </div>
      <SignOut />
    </section>
  </section>;
}
