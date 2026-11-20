import { redirect } from "next/navigation";
import { AccountUnavailable } from "../../../components/account-unavailable";
import { ConnectedListingModeration } from "../../../components/connected-listing-moderation";
import { PrivateListings } from "../../../components/connected-listings";
import { currentMember } from "../../../server/identity/client";
import { identityConfigured, mode } from "../../../server/identity/config";

export default async function Page() {
  if (mode() === "demo") redirect("/account");
  if (!identityConfigured()) return <AccountUnavailable />;
  const member = await currentMember();
  if (!member) redirect("/login");
  return <PrivateListings key={member.id} memberId={member.id}>
    <ConnectedListingModeration memberId={member.id} />
  </PrivateListings>;
}
