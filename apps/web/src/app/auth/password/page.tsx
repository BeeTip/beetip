import { redirect } from "next/navigation";
import { AuthForm } from "../../../components/auth-form";
import { currentMember } from "../../../server/identity/client";

export default async function Page() {
  if (!await currentMember()) redirect("/login?form=recover");
  return <section className="stack"><h1>Atur kata sandi baru</h1><AuthForm action="password" /></section>;
}
