import { DemoProvider } from "../components/demo-provider";
import { Document } from "../components/document";
import { Shell } from "../components/shell";

export { metadata } from "../components/document";
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Document><DemoProvider><Shell>{children}</Shell></DemoProvider></Document>;
}
