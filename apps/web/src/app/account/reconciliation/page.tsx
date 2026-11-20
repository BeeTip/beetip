import Link from "next/link";
import { redirect } from "next/navigation";
import { fundingIdSchema } from "@beetip/validation";
import { connectedOrderState } from "../../../components/connected-order-state";
import { ReconciliationExport } from "../../../components/reconciliation-export";
import { Amount, Badge } from "../../../components/ui";
import { mode } from "../../../server/identity/config";
import { syntheticTransfersEnabled } from "../../../server/identity/manual-transfers";
import { protectedClient } from "../../../server/identity/protected";
import { amountLabels, reconciliationClient, type ReconciliationAmounts } from "../../../server/identity/reconciliation";

const page = "/account/reconciliation";
const currency = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const moneyStatus = {
  settled: "Selesai", outstanding: "Belum selesai", held: "Dana ditahan",
  ambiguous: "Hasil transfer belum pasti", mismatch: "Saldo tidak cocok",
};
const fulfillmentLabel = (state: string) => state === "awaiting_purchase" ? "Menunggu belanja" : connectedOrderState(state);

function Amounts({ amounts }: { amounts: ReconciliationAmounts }) {
  return <dl>
    {(Object.keys(amountLabels) as (keyof ReconciliationAmounts)[]).map(key => (
      <div className="amount-row" key={key}>
        <dt>{amountLabels[key]}</dt><dd><strong>{currency.format(BigInt(amounts[key]))}</strong></dd>
      </div>
    ))}
  </dl>;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (mode() === "demo") redirect("/profile");
  if (!syntheticTransfersEnabled()) return <p>Rekonsiliasi dana sintetis belum tersedia.</p>;
  const { order, trip, after } = await searchParams;
  const scope = order !== undefined ? "order" : trip !== undefined ? "trip" : "list";
  const input = order ?? trip ?? after;
  const id = input === undefined ? null : fundingIdSchema.safeParse(input);
  if ([order, trip, after].filter(value => value !== undefined).length > 1 || (id && !id.success)) {
    return <p>Periksa tautan rekonsiliasi.</p>;
  }

  const session = await protectedClient().catch((error: Error) => {
    if (error.message === "UNAUTHENTICATED") redirect("/login");
    if (error.message !== "PERMISSION") throw error;
    return null;
  });
  const result = session && await reconciliationClient(session.client).rpc("read_reconciliation", {
    p_scope: scope, p_id: id?.data ?? null,
  });
  if (!session || !result || result.error) return <section className="panel stack">
    <h1>Rekonsiliasi dana</h1>
    <p role="alert">{!result || result.error?.message.startsWith("PERMISSION")
      ? "Akses rekonsiliasi tidak diizinkan." : "Rekonsiliasi belum dapat dimuat."}</p>
    <Link href="/account/affiliation">Keamanan akun</Link>
  </section>;

  const report = result.data;
  const detail = scope === "order" ? report.orders[0] : null;
  return <div className="stack">
    <nav aria-label="Navigasi rekonsiliasi"><Link className="back-link" href={scope === "list" ? "/account/funding" : page}>
      {scope === "list" ? "Kembali ke pemeriksaan dana" : "Semua pesanan"}
    </Link></nav>
    <section className="panel stack">
      <h1>{scope === "list" ? "Rekonsiliasi dana" : scope === "trip" ? "Rekonsiliasi trip" : detail?.title}</h1>
      <p>{scope === "trip" ? "Dana sintetis dari pesanan trip yang dapat Anda akses." : "Dana dan transfer sintetis."}</p>
      {detail && <>
        <p>Status pesanan <strong>{fulfillmentLabel(detail.fulfillment)}</strong></p>
        <p>Status dana <Badge tone={detail.money_status === "settled" ? "success" : "warning"}>{moneyStatus[detail.money_status]}</Badge></p>
      </>}
      {scope !== "list" && id && <ReconciliationExport memberId={session.user.id} scope={scope} id={id.data} />}
      {detail?.trip_id && <Link href={`${page}?trip=${detail.trip_id}`}>Lihat rekonsiliasi trip</Link>}
      {detail && ["delivery_confirmed", "cancelled"].includes(detail.fulfillment) &&
        <Link href={`/account/transfers?order=${detail.order_id}`}>Lihat catatan transfer</Link>}
      {scope !== "list" && report.totals && <Amounts amounts={report.totals} />}
    </section>
    {scope !== "order" && <section className="panel stack">
      <h2>Pesanan</h2>
      {report.orders.length === 0 ? <p>Belum ada pesanan dengan dana terverifikasi.</p> : <ul className="stack">
        {report.orders.map(row => <li key={row.order_id}>
          <Link href={`${page}?order=${row.order_id}`}>{row.title}</Link>
          <p className="small">{row.order_id.slice(0, 8).toUpperCase()} · {fulfillmentLabel(row.fulfillment)} · {moneyStatus[row.money_status]}</p>
          <Amount label="Dana belum diselesaikan" value={currency.format(BigInt(row.amounts.outstanding))} />
        </li>)}
      </ul>}
      {after && <Link href={page}>Kembali ke awal</Link>}
      {report.next_cursor && <Link href={`${page}?after=${report.next_cursor}`}>Pesanan berikutnya</Link>}
    </section>}
  </div>;
}
