import { ListingDetail } from "../../../components/marketplace";
import { ConnectedListingDetail } from "../../../components/connected-listings";
import { notFound } from "next/navigation";
import { mode } from "../../../server/identity/config";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (mode() === "demo") return <ListingDetail id={id} />;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <ConnectedListingDetail key={id} id={id} />;
}
