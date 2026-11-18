import { redirect } from "next/navigation";
import { ConnectedOffers } from "../../../components/connected-offers";
import { PrivateListings } from "../../../components/connected-listings";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page({ searchParams }: { searchParams: Promise<{ listing?: string }> }) {
  if (mode() === "demo") redirect("/");
  if (!identityConfigured()) return <p>Layanan belum tersedia.</p>;
  const { listing } = await searchParams;
  const member = await currentMember();
  if (!member) redirect(`/login?next=${encodeURIComponent(`/account/offers${listing ? `?listing=${listing}` : ""}`)}`);
  if (member.status === "suspended") return <p>Akses akun dibatasi.</p>;
  return <PrivateListings key={member.id} memberId={member.id}><ConnectedOffers key={listing ?? "all"} listingId={listing} memberId={member.id} /></PrivateListings>;
}
