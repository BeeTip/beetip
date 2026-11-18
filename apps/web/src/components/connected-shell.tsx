import Link from "next/link";
import type { ReactNode } from "react";
import { Hexagon, Home, LifeBuoy, UserRound } from "lucide-react";
import { currentMember } from "../server/identity/client";
import { identityConfigured } from "../server/identity/config";

export async function ConnectedShell({ children }: { children: ReactNode }) {
  let member = null;
  if (identityConfigured()) {
    try { member = await currentMember(); } catch {}
  }
  const account = member ? "/account" : "/login";
  return <div className="app-shell connected-shell"><div className="app-body"><header className="mobile-header"><Link className="brand" href="/"><Hexagon fill="currentColor" size={23} />BEETIP<span className="brand-dot">.</span></Link><nav aria-label="Navigasi utama"><Link href="/">Jelajahi</Link><Link href={account}>{member ? "Dashboard" : "Masuk"}</Link>{!member && <Link className="button button-primary" href="/login?form=signup">Daftar</Link>}</nav></header><main id="main-content">{children}</main><nav className="public-bottom-nav" aria-label="Navigasi seluler"><Link href="/"><Home size={20} />Jelajahi</Link><Link href={account}><UserRound size={20} />{member ? "Dashboard" : "Masuk"}</Link><Link href="/support"><LifeBuoy size={20} />Bantuan</Link></nav></div></div>;
}
