import { boundaryFailure, reply } from "../../../../server/identity/http";
import { protectedClient } from "../../../../server/identity/protected";

export async function GET() {
  try { const { user } = await protectedClient(); return reply({ ok: true, memberId: user.id }); }
  catch (error) { return boundaryFailure(error); }
}
