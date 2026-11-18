import Link from "next/link";
import { redirect } from "next/navigation";
import { ordersPageSchema } from "@beetip/validation";
import { PrivateListings } from "../../../components/connected-listings";
import { connectedOrderState } from "../../../components/connected-order-state";
import { currentMember, identityClient } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (mode() === "demo") redirect("/orders");
  if (!identityConfigured()) return <p>Layanan belum tersedia.</p>;
  const member = await currentMember();
  if (!member) redirect("/login");
  if (member.status === "suspended") return <p>Akses akun dibatasi.</p>;
  const parsed = ordersPageSchema.safeParse(await searchParams);
  if (!parsed.success) return <p>Periksa alamat halaman.</p>;
  const client = await identityClient();
  const { data, error } = await client.rpc("browse_orders", { p_before: parsed.data.before, p_before_id: parsed.data.beforeId });
  if (error) return <p>Pesanan belum dapat dimuat. Coba muat ulang.</p>;
  const rows = data as unknown as { id: string; title: string; state: string; created_at: string }[];
  const last = rows.slice(0, 20).at(-1);
  return <PrivateListings key={member.id} memberId={member.id}><section className="stack"><h1>Pesanan saya</h1>{rows.length === 0 && <p>Belum ada pesanan.</p>}{rows.slice(0, 20).map(order => <article className="panel stack" key={order.id}><h2>{order.title}</h2><p>{connectedOrderState(order.state)}</p><Link href={`/orders/${order.id}`}>Lihat pesanan</Link></article>)}{rows.length > 20 && last && <Link href={`/account/orders?before=${encodeURIComponent(last.created_at)}&beforeId=${last.id}`}>Muat lebih banyak</Link>}</section></PrivateListings>;
}
