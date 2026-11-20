import { ConnectedShell } from "../components/connected-shell";
import { Document } from "../components/document";

export { metadata } from "../components/document";
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Document><ConnectedShell>{children}</ConnectedShell></Document>;
}
