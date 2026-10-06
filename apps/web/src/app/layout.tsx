import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { DemoProvider } from "../components/demo-provider";
import { Shell } from "../components/shell";
import "./globals.css";

export const metadata: Metadata = { title: "BeeTip | Titip belanja, sekalian jalan", description: "Demo marketplace jastip komunitas kampus." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body className={GeistSans.className}><a className="skip-link" href="#main-content">Lewati ke konten</a><DemoProvider><Shell>{children}</Shell></DemoProvider></body></html>;
}
