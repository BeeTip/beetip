import { boundaryFailure, mutationBody } from "../../../../server/identity/http";
import { syntheticTransfersEnabled } from "../../../../server/identity/manual-transfers";
import { commandFailure, protectedClient } from "../../../../server/identity/protected";
import { reconciliationClient, reconciliationExportInput } from "../../../../server/identity/reconciliation";

export async function POST(request: Request) {
  try {
    if (!syntheticTransfersEnabled()) throw new Error("UNAVAILABLE");
    const input = reconciliationExportInput(await mutationBody(request));
    const { client, user } = await protectedClient();
    if (request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
    const { data, error } = await reconciliationClient(client).rpc("export_reconciliation", input);
    if (error) return commandFailure(error);
    return new Response(data.csv, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="beetip-rekonsiliasi.csv"',
        "X-Content-Type-Options": "nosniff",
        "X-Beetip-Export": data.id,
      },
    });
  } catch (error) { return boundaryFailure(error); }
}
