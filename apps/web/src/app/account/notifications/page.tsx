import { redirect } from "next/navigation";
import { ConnectedNotifications } from "../../../components/connected-notifications";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page() {
  if (mode() === "demo" || !identityConfigured()) return <p>Layanan belum tersedia.</p>;
  const member = await currentMember();
  if (!member) redirect("/login?next=%2Faccount%2Fnotifications");
  if (member.status === "suspended") return <p>Akses akun dibatasi.</p>;
  return <ConnectedNotifications key={member.id} memberId={member.id} />;
}
