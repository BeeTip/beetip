import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { DemoProvider } from "../components/demo-provider";
import { Shell } from "../components/shell";
import "./globals.css";
import { ConnectedShell } from "../components/connected-shell";
import { mode } from "../server/identity/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "BeeTip | Titip belanja, sekalian jalan", description: "Titip belanja dan antar pesanan bersama komunitas kampus." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body className={GeistSans.className}><a className="skip-link" href="#main-content">Lewati ke konten</a>{mode() === "demo" ? <DemoProvider><Shell>{children}</Shell></DemoProvider> : <ConnectedShell>{children}</ConnectedShell>}</body></html>;
}
