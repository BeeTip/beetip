"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Hexagon, Home, MapPin, ClipboardList, MessageCircle, UserRound, ShieldCheck } from "lucide-react";
import { useDemo } from "./demo-provider";
import { Button } from "./ui";
import type { ReactNode } from "react";

const navigation = [{ href: "/", label: "Beranda", icon: Home }, { href: "/trips", label: "Trip", icon: MapPin }, { href: "/orders", label: "Pesanan", icon: ClipboardList }, { href: "/chat", label: "Chat", icon: MessageCircle }, { href: "/profile", label: "Profil", icon: UserRound }];
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const demo = useDemo();
  const member = demo.state.members.find(m => m.id === demo.actorId);
  return <div className="app-shell"><aside className="sidebar"><Link href="/" className="brand"><Hexagon fill="currentColor" size={27} /><span>BEETIP<span className="brand-dot">.</span></span></Link><p className="sidebar-caption">Titip belanja, sekalian jalan.</p><nav aria-label="Navigasi utama" className="navigation">{navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={(href === "/" ? path === href : path.startsWith(href)) ? "page" : undefined}><Icon size={21} /><span>{label}</span></Link>)}</nav><Link className="admin-link" href="/admin"><ShieldCheck size={18} /> Administrasi</Link><div className="sidebar-note"><span className="eyebrow">KOMUNITAS KAMPUS</span><strong>Dari teman,<br />untuk teman.</strong><p>Jastip untuk komunitas BINUS Alam Sutera.</p></div></aside><div className="app-body"><header className="mobile-header"><Link className="brand" href="/"><Hexagon fill="currentColor" size={23} /> BEETIP<span className="brand-dot">.</span></Link><Link href="/profile" className="avatar" aria-label="Buka profil">{member?.name.charAt(0)}</Link></header>{demo.storageIssue && <div className="storage-warning" role="alert">{demo.storageIssue}{demo.corrupt && <Button onClick={demo.reset}>Reset data lokal</Button>}</div>}<main id="main-content">{demo.ready ? children : <div className="loading" role="status">Memuat BeeTip...</div>}</main><div className="notice" role="status" aria-live="polite">{demo.notice}</div></div><nav className="bottom-nav" aria-label="Navigasi seluler">{navigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={(href === "/" ? path === href : path.startsWith(href)) ? "page" : undefined}><Icon size={20} /><span>{label}</span></Link>)}</nav></div>;
}
