import { mfaInputSchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { protectedClient } from "../../../../server/identity/protected";

export async function POST(request: Request) {
  try {
    const parsed = mfaInputSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client } = await protectedClient();
    if (parsed.data.action === "enroll") {
      const { data: factors, error: listError } = await client.auth.mfa.listFactors();
      if (listError) throw new Error("UNAVAILABLE");
      if (factors.totp.some(factor => factor.status === "verified")) throw new Error("PERMISSION");
      for (const factor of factors.all.filter(factor => factor.factor_type === "totp" && factor.status === "unverified")) {
        const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
        if (error) throw new Error("UNAVAILABLE");
      }
      const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "BeeTip staff", issuer: "BeeTip" });
      if (error) throw new Error("UNAVAILABLE");
      return reply({ ok: true, factorId: data.id, secret: data.totp.secret });
    }
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId: parsed.data.factorId, code: parsed.data.code });
    if (error) return reply({ ok: false, message: "Kode MFA tidak valid atau kedaluwarsa." }, 400);
    return reply({ ok: true });
  } catch (error) { return boundaryFailure(error); }
}
