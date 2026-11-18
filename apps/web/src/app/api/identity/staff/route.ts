import { staffInputSchema } from "@beetip/validation";
import { boundaryFailure, mutationBody, reply } from "../../../../server/identity/http";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";

export async function GET() {
  try {
    const { client, user } = await protectedClient();
    const fields = "member_id,role,revoked_at";
    const [own, recent] = await Promise.all([
      client.from("staff_roles").select(fields).eq("member_id", user.id),
      client.from("staff_roles").select(fields).neq("member_id", user.id).order("granted_at", { ascending: false }).limit(100),
    ]);
    const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    const { data: factors, error: factorError } = await client.auth.mfa.listFactors();
    if (own.error || recent.error || assuranceError || factorError) throw new Error("UNAVAILABLE");
    return reply({ ok: true, memberId: user.id, grants: [...own.data, ...recent.data], aal: assurance.currentLevel, factors: factors.totp.filter(factor => factor.status === "verified").map(factor => ({ id: factor.id })) });
  } catch (error) { return boundaryFailure(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = staffInputSchema.safeParse(await mutationBody(request));
    if (!parsed.success) throw new Error("VALIDATION");
    const { client } = await protectedClient();
    const input = parsed.data;
    const { data, error } = await client.rpc("set_staff_role", { p_operation_id: input.operationId, p_member_id: input.memberId, p_role: input.role, p_grant: input.grant, p_reason: input.reason });
    if (error) return commandFailure(error);
    return reply({ ok: true, memberId: data });
  } catch (error) { return boundaryFailure(error); }
}
