import { ListingForm } from "../../../components/marketplace";
import { ConnectedListingForm, PrivateListings } from "../../../components/connected-listings";
import { AccountUnavailable } from "../../../components/account-unavailable";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  if (mode() === "demo") return <ListingForm />;
  if (!identityConfigured()) return <AccountUnavailable />;
  const member = await currentMember();
  if (!member) redirect("/login?form=signup&next=%2Flistings%2Fnew");
  if (member.status === "suspended") return <section className="panel"><h1>Akses akun dibatasi</h1><Link href="/support">Hubungi bantuan</Link></section>;
  const { edit } = await searchParams;
  return <PrivateListings key={member.id} memberId={member.id}><ConnectedListingForm key={edit ?? "new"} memberId={member.id} editId={edit} /></PrivateListings>;
}
