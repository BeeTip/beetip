import { redirect } from "next/navigation";
import { ConnectedBoard, PrivateListings } from "../../../components/connected-listings";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page() {
  if (mode() === "demo") redirect("/");
  if (!identityConfigured()) return <p>Layanan belum tersedia.</p>;
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.status === "suspended") return <p>Akses akun dibatasi.</p>;
  return <PrivateListings key={member.id} memberId={member.id}><ConnectedBoard own /></PrivateListings>;
}
