import { OrderDetail } from "../../../components/orders";
import { ConnectedOrderDetail } from "../../../components/connected-order";
import { PrivateListings } from "../../../components/connected-listings";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";
import { redirect } from "next/navigation";
import { accountRedirect } from "@beetip/validation";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (mode() === "demo") return <OrderDetail id={id} />;
  if (!identityConfigured()) return <p>Layanan belum tersedia.</p>;
  const member = await currentMember();
  if (!member) redirect(`/login?next=${encodeURIComponent(accountRedirect(`/orders/${id}`))}`);
  if (member.status === "suspended") return <p>Akses akun dibatasi.</p>;
  return <PrivateListings key={member.id} memberId={member.id}><ConnectedOrderDetail id={id} memberId={member.id} /></PrivateListings>;
}
