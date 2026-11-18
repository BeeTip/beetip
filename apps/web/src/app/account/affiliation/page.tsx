import { redirect } from "next/navigation";
import { ConnectedAffiliation } from "../../../components/connected-affiliation";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page() {
  if (mode() === "demo") redirect("/profile");
  if (!identityConfigured()) return <section className="panel"><h1>Layanan afiliasi belum tersedia</h1></section>;
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.status === "suspended") redirect("/account");
  return <ConnectedAffiliation />;
}
