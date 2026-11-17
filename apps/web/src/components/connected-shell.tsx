import Link from "next/link";
import type { ReactNode } from "react";

export function ConnectedShell({ children }: { children: ReactNode }) {
  return <div className="app-shell connected-shell"><div className="app-body"><header className="mobile-header"><Link className="brand" href="/account">BEETIP</Link><nav aria-label="Navigasi akun"><Link href="/account">Akun</Link> <Link href="/support">Bantuan</Link></nav></header><main id="main-content">{children}</main></div></div>;
}
