import { acceptsMutation, fundingIdSchema } from "@beetip/validation";
import { identityConfig } from "../../../../../../server/identity/config";
import { fundingBucket, fundingImageHash, validatedFundingImage } from "../../../../../../server/identity/funding-evidence";
import { boundaryFailure, reply } from "../../../../../../server/identity/http";
import { protectedClient } from "../../../../../../server/identity/protected";

type Context = { params: Promise<{ id: string }> };

async function evidence(context: Context, upload: boolean, memberId?: string | null) {
  const { id } = await context.params;
  if (!fundingIdSchema.safeParse(id).success) throw new Error("VALIDATION");
  const { client, user } = await protectedClient();
  if (upload && memberId !== user.id) throw new Error("PERMISSION");
  const { data, error } = await client.rpc("funding_evidence", { p_id: id, p_upload: upload });
  if (error || data !== id) throw new Error("PERMISSION");
  return id;
}

export async function GET(_request: Request, context: Context) {
  try {
    const id = await evidence(context, false);
    const { data, error } = await fundingBucket().download(id);
    if (error) throw new Error("PERMISSION");
    await evidence(context, false);
    const extension = data.type === "image/jpeg" ? "jpg" : "png";
    return new Response(data, { headers: {
      "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename=bukti-dana.${extension}`, "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return boundaryFailure(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    if (!acceptsMutation(request.headers.get("origin"), identityConfig().origin, "application/json")) throw new Error("PERMISSION");
    const member = request.headers.get("X-Beetip-Member");
    const id = await evidence(context, true, member);
    const { bytes, contentType } = await validatedFundingImage(request);
    await evidence(context, true, member);
    const bucket = fundingBucket();
    const { error } = await bucket.upload(id, bytes, { contentType, upsert: false });
    if (!error) {
      await evidence(context, true, member);
      return reply({ ok: true });
    }
    // Storage versions return either 400 or 409 for immutable object collisions.
    if (error.statusCode === "400" || error.statusCode === "409") {
      const { data, error: readError } = await bucket.download(id);
      if (data && !readError) {
        if (fundingImageHash(Buffer.from(await data.arrayBuffer())) === fundingImageHash(bytes)) return reply({ ok: true });
        return reply({ ok: false, code: "CONFLICT", message: "Bukti sudah tersimpan. Buang draf untuk mengganti gambar." }, 409);
      }
    }
    throw new Error("UNAVAILABLE");
  } catch (error) { return boundaryFailure(error); }
}
