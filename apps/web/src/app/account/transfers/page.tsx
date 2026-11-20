import { redirect } from "next/navigation";
import { orderQuerySchema } from "@beetip/validation";
import { ConnectedTransfers, ConnectedTransferQueue } from "../../../components/connected-transfers";
import { currentMember } from "../../../server/identity/client";
import { mode } from "../../../server/identity/config";
import { syntheticTransfersEnabled } from "../../../server/identity/manual-transfers";

export default async function Page({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  if (mode() === "demo") redirect("/profile");
  if (!syntheticTransfersEnabled()) return <p>Pemeriksaan transfer sintetis belum tersedia.</p>;
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.status === "suspended") return <p>Akses akun dibatasi.</p>;
  const order = orderQuerySchema.safeParse({ id: (await searchParams).order });
  return order.success ? <ConnectedTransfers key={`${member.id}:${order.data.id}`} memberId={member.id} order={order.data.id} />
    : <ConnectedTransferQueue key={member.id} memberId={member.id} />;
}
