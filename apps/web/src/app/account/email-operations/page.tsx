import Link from "next/link";
import { EmailOperations, type EmailQueue } from "../../../components/email-operations";
import { protectedClient } from "../../../server/identity/protected";

async function loadQueue() {
  try {
    const { client, user } = await protectedClient();
    const { data, error } = await client.rpc("btp11_operator_queue");
    if (!error && data) return { queue: data as EmailQueue, memberId: user.id };
    return error?.message.startsWith("PERMISSION") ? "denied" : "unavailable";
  } catch (error) {
    return error instanceof Error && ["UNAUTHENTICATED", "PERMISSION"].includes(error.message)
      ? "denied" : "unavailable";
  }
}

export default async function Page() {
  const result = await loadQueue();
  if (result === "unavailable") return <p>Antrean email belum tersedia.</p>;
  if (result !== "denied") return <EmailOperations key={result.memberId} {...result} />;
  return <section className="panel stack"><h1>Operasi email</h1>
    <p>Masuk sebagai pengelola platform dengan MFA aktif.</p>
    <Link href="/account/affiliation">Afiliasi dan keamanan petugas</Link>
  </section>;
}
