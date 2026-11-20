import { acceptsMutation, affiliationIdSchema } from "@beetip/validation";
import { identityConfig } from "../../../../../../server/identity/config";
import { evidenceUploadFailure, normalizeEvidenceImage, validatedEvidenceImage } from "../../../../../../server/identity/evidence-image";
import { fundingImageHash, privateEvidenceClient } from "../../../../../../server/identity/funding-evidence";
import { boundaryFailure, reply } from "../../../../../../server/identity/http";
import { protectedClient } from "../../../../../../server/identity/protected";

type Context = { params: Promise<{ id: string }> };
const bucket = "affiliation-evidence";

async function evidence(context: Context) {
  const { id } = await context.params;
  if (!affiliationIdSchema.safeParse(id).success) throw new Error("VALIDATION");
  const { client, user } = await protectedClient();
  const { data, error } = await client.from("affiliation_requests").select("member_id,status").eq("id", id).maybeSingle();
  if (error) throw new Error("UNAVAILABLE");
  if (!data) throw new Error("PERMISSION");
  return { client, user, row: data, id, path: `${data.member_id}/${id}/evidence` };
}

async function ownedDraft(context: Context) {
  const { client, user, row, id, path } = await evidence(context);
  if (row.member_id !== user.id || row.status !== "draft") throw new Error("PERMISSION");
  return { client, user, id, path };
}

export async function GET(_request: Request, context: Context) {
  try {
    const { client, path } = await evidence(context);
    const { data, error } = await client.storage.from(bucket).download(path);
    if (error) throw new Error("PERMISSION");
    return new Response(data, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename=affiliation-evidence", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return boundaryFailure(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    if (!acceptsMutation(request.headers.get("origin"), identityConfig().origin, "application/json")) throw new Error("PERMISSION");
    await ownedDraft(context);
    const { bytes, contentType } = await validatedEvidenceImage(request);
    const { client, user, id, path } = await ownedDraft(context);
    const key = process.env.BEETIP_AFFILIATION_STORAGE_SECRET;
    const writer = key ? privateEvidenceClient(key) : null;
    let claim: string | null = "first";
    if (writer) {
      const { data, error } = await writer.rpc("claim_affiliation_upload", {
        p_request: id, p_member: user.id, p_digest: fundingImageHash(bytes),
      });
      if (error) throw new Error("UNAVAILABLE");
      claim = data;
    }
    if (claim === "denied") throw new Error("PERMISSION");
    const conflict = () => reply({ ok: false, message: "Gunakan gambar yang sama atau tarik pengajuan untuk mengganti bukti." }, 409);
    if (claim === "conflict") return conflict();

    if (claim === "first" || claim === "retry") {
      const { error } = await (writer ?? client).storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
      if (!error) return reply({ ok: true, alreadyUploaded: claim === "retry" });
      if (error.statusCode !== "409" && error.statusCode !== "400") throw new Error("UNAVAILABLE");
    } else if (claim !== "existing") {
      throw new Error("UNAVAILABLE");
    }

    const { data: previous, error: readError } = await client.storage.from(bucket).download(path);
    if (readError) throw new Error("UNAVAILABLE");
    const existing = Buffer.from(await previous.arrayBuffer());
    const normalized = existing.equals(bytes) ? existing : await normalizeEvidenceImage(existing, contentType).catch(() => null);
    return normalized?.equals(bytes) ? reply({ ok: true, alreadyUploaded: true }) : conflict();
  } catch (error) { return evidenceUploadFailure(error); }
}
