import { redirect } from "next/navigation";
import { orderQuerySchema } from "@beetip/validation";
import { ConnectedOrderCaseQueue } from "../../../components/connected-order-cases";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  if (mode() === "demo") redirect("/profile");
  if (!identityConfigured()) return <p>Pemeriksaan kasus belum tersedia.</p>;
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.status === "suspended") return <p>Akses akun dibatasi.</p>;
  const order = orderQuerySchema.safeParse({ id: (await searchParams).order });
  return <ConnectedOrderCaseQueue key={`${member.id}:${order.data?.id ?? ""}`} memberId={member.id} order={order.data?.id} />;
}
