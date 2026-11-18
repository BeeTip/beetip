import { Chat } from "../../../components/orders";
import { ConnectedChat } from "../../../components/connected-chat";
import { PrivateListings } from "../../../components/connected-listings";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";
import { redirect } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (mode() === "demo") return <Chat id={orderId} />;
  if (!identityConfigured()) return <p>Layanan belum tersedia.</p>;
  const member = await currentMember();
  if (!member) redirect(`/login?next=${encodeURIComponent(`/chat/${orderId}`)}`);
  if (member.status === "suspended") return <p>Akses akun dibatasi.</p>;
  return <PrivateListings key={member.id} memberId={member.id}><ConnectedChat key={`${member.id}:${orderId}`} orderId={orderId} memberId={member.id} /></PrivateListings>;
}
