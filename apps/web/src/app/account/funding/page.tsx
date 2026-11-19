import { redirect } from "next/navigation";
import Link from "next/link";
import { fundingIdSchema } from "@beetip/validation";
import { ConnectedFundingQueue } from "../../../components/connected-funding";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  if (mode() === "demo") redirect("/profile");
  if (!identityConfigured()) return <p>Pemeriksaan dana belum tersedia.</p>;
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.status === "suspended") return <p>Akses akun dibatasi.</p>;
  const order = fundingIdSchema.safeParse((await searchParams).order);
  return <><Link href="/account/order-cases">Pemeriksaan kasus pesanan</Link>
    <ConnectedFundingQueue key={`${member.id}:${order.data ?? ""}`} memberId={member.id} order={order.data} /></>;
}
