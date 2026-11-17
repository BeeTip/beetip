import { authInputSchema } from "@beetip/validation";
import { identityClient } from "../../../../server/identity/client";
import { identityConfig } from "../../../../server/identity/config";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";

export async function POST(request: Request) {
  try {
    const parsed = authInputSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const input = parsed.data;
    const client = await identityClient();
    const { origin } = identityConfig();
    let error;
    if (input.action === "signup") {
      ({ error } = await client.auth.signUp({ email: input.email, password: input.password, options: { data: { display_name: input.name }, emailRedirectTo: `${origin}/auth/callback` } }));
    } else if (input.action === "login") {
      ({ error } = await client.auth.signInWithPassword({ email: input.email, password: input.password }));
    } else if (input.action === "recover") {
      ({ error } = await client.auth.resetPasswordForEmail(input.email, { redirectTo: `${origin}/auth/callback?next=/auth/password` }));
    } else if (input.action === "password") {
      const { data: { user }, error: sessionError } = await client.auth.getUser();
      if (sessionError || !user || !user.email_confirmed_at || user.is_anonymous) return reply({ ok: false, message: "Masuk kembali melalui tautan pemulihan." }, 401);
      ({ error } = await client.auth.updateUser({ password: input.password }));
    } else {
      ({ error } = await client.auth.signOut());
    }
    if (error) {
      if (error.status === 429) return reply({ ok: false, message: "Terlalu banyak percobaan. Tunggu sebelum mencoba lagi." }, 429);
      if (!error.status || error.status >= 500) return reply({ ok: false, message: "Layanan akun belum tersedia. Coba lagi nanti." }, 503);
      if (input.action !== "recover" && input.action !== "signup") return reply({ ok: false, message: "Permintaan gagal. Periksa akun atau coba lagi." }, 400);
    }
    return reply({ ok: true, message: input.action === "signup" || input.action === "recover" ? "Jika alamat dapat digunakan, tautan konfirmasi akan dikirim. Periksa kotak masuk email." : "Perubahan tersimpan." });
  } catch (error) { return boundaryFailure(error); }
}
