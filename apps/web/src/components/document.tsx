import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "../app/globals.css";

export const metadata: Metadata = { title: "BeeTip | Titip belanja, sekalian jalan", description: "Titip belanja dan antar pesanan bersama komunitas kampus." };

export function Document({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body className={GeistSans.className}><a className="skip-link" href="#main-content">Lewati ke konten</a>{children}</body></html>;
}
