import "server-only";
import { identityClient } from "./client";
import { mode } from "./config";
import { reply } from "./http";

export async function protectedClient() {
  if (mode() !== "connected") throw new Error("UNAVAILABLE");
  const client = await identityClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || !user.email_confirmed_at || user.is_anonymous) throw new Error("UNAUTHENTICATED");
  const { data: member, error: memberError } = await client.from("members").select("status").eq("id", user.id).single();
  if (memberError) throw new Error("PERMISSION");
  if (member.status === "suspended") throw new Error("PERMISSION");
  return { client, user };
}

export function commandFailure(error: { message: string }) {
  const code = ["PERMISSION", "VALIDATION", "CONFLICT"].find(value => error.message.startsWith(value));
  if (!code) throw new Error("UNAVAILABLE");
  return reply({ ok: false, code, message: code === "PERMISSION" ? "Akses tidak diizinkan. Periksa akun, peran, dan MFA." : code === "CONFLICT" ? "Data sudah berubah atau permintaan sudah digunakan. Muat ulang." : "Periksa data dan bukti yang dikirim." }, code === "PERMISSION" ? 403 : code === "CONFLICT" ? 409 : 400);
}
