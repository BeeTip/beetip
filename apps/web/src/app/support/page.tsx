import { Support } from "../../components/support";
import { redirect } from "next/navigation";
import { ConnectedSupport } from "../../components/connected-support";
import { currentMember } from "../../server/identity/client";
import { identityConfigured, mode } from "../../server/identity/config";

export default async function Page({ searchParams }: { searchParams: Promise<{ orderId?: string }> }) {
  if (mode() === "demo") { const { orderId } = await searchParams; return <Support orderId={orderId} />; }
  if (!identityConfigured()) redirect("/account");
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.status === "suspended") redirect("/account");
  return <ConnectedSupport />;
}
