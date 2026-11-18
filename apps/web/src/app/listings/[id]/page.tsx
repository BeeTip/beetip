import { ListingDetail } from "../../../components/marketplace";
import { PublicListingDetail } from "../../../components/public-catalog";
import { notFound } from "next/navigation";
import { sampleListing } from "../../../server/catalog";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (mode() === "demo") return <ListingDetail id={id} />;
  const listing = sampleListing(id);
  if (!listing) notFound();
  const member = identityConfigured() ? await currentMember() : null;
  return <PublicListingDetail listing={listing} signedIn={Boolean(member && member.status !== "suspended")} />;
}
