import { acceptsMutation, purchaseEvidenceQuery } from "@beetip/validation";
import { identityConfig } from "../../../../../server/identity/config";
import { fundingImageHash, privateEvidenceBucket, validatedFundingImage } from "../../../../../server/identity/funding-evidence";
import { boundaryFailure, reply } from "../../../../../server/identity/http";
import { protectedClient } from "../../../../../server/identity/protected";

const bucket = () => privateEvidenceBucket("purchase-receipts", process.env.BEETIP_RECEIPT_STORAGE_SECRET);

async function authorizedPath(request: Request, upload: boolean) {
  const parsed = purchaseEvidenceQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) throw new Error("VALIDATION");
  const { client, user } = await protectedClient();
  if (upload && request.headers.get("X-Beetip-Member") !== user.id) throw new Error("PERMISSION");
  const { data, error } = await client.rpc("purchase_evidence_path", {
    p_order: parsed.data.order, p_key: parsed.data.key, p_upload: upload,
  });
  if (error || !data) throw new Error("PERMISSION");
  return data;
}

export async function PUT(request: Request) {
  try {
    if (!acceptsMutation(request.headers.get("origin"), identityConfig().origin, "application/json")) throw new Error("PERMISSION");
    const prefix = await authorizedPath(request, true);
    const { bytes, contentType } = await validatedFundingImage(request);
    if (await authorizedPath(request, true) !== prefix) throw new Error("PERMISSION");
    const imageHash = fundingImageHash(bytes);
    const path = `${prefix}/${imageHash}`;
    const storage = bucket();
    const { error } = await storage.upload(path, bytes, { contentType, upsert: false });
    if (error) {
      if (error.statusCode !== "400" && error.statusCode !== "409") throw new Error("UNAVAILABLE");
      const { data } = await storage.download(path);
      if (!data || fundingImageHash(Buffer.from(await data.arrayBuffer())) !== imageHash) throw new Error("UNAVAILABLE");
    }
    return reply({ imageHash });
  } catch (error) { return boundaryFailure(error); }
}

export async function GET(request: Request) {
  try {
    const path = await authorizedPath(request, false);
    const { data, error } = await bucket().download(path);
    if (error) throw new Error("UNAVAILABLE");
    if (await authorizedPath(request, false) !== path) throw new Error("PERMISSION");
    const extension = data.type === "image/jpeg" ? "jpg" : "png";
    return new Response(data, { headers: {
      "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename=struk.${extension}`, "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return boundaryFailure(error); }
}
