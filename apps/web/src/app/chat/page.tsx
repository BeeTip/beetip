import { Chat } from "../../components/orders";
import { mode } from "../../server/identity/config";
import { redirect } from "next/navigation";
export default function Page() {
  if (mode() !== "demo") redirect("/account/orders");
  return <Chat />;
}
