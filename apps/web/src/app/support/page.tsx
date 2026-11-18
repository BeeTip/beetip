import { Support } from "../../components/support";
import { redirect } from "next/navigation";
import { ConnectedSupport } from "../../components/connected-support";
import { currentMember } from "../../server/identity/client";
import { identityConfigured, mode } from "../../server/identity/config";
import { supportReferenceSchema } from "@beetip/validation";

export default async function Page({ searchParams }: { searchParams: Promise<{ orderId?: string; case?: string }> }) {
  const params = await searchParams;
  if (mode() === "demo") return <Support orderId={params.orderId} />;
  if (!identityConfigured()) redirect("/account");
  const order = supportReferenceSchema.safeParse(params.orderId).data;
  const caseId = supportReferenceSchema.safeParse(params.case).data;
  const member = await currentMember();
  const next = caseId ? `/support?case=${caseId}` : order ? `/support?orderId=${order}` : "/support";
  if (!member) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (member.status === "suspended") redirect("/account");
  return <ConnectedSupport key={member.id} memberId={member.id} order={order} initialCase={caseId} />;
}
