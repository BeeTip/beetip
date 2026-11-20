import { acceptsMutation, affiliationIdSchema } from "@beetip/validation";
import { identityConfig } from "../../../../../../server/identity/config";
import { normalizeEvidenceImage, validatedEvidenceImage } from "../../../../../../server/identity/evidence-image";
import { boundaryFailure, reply } from "../../../../../../server/identity/http";
import { protectedClient } from "../../../../../../server/identity/protected";

type Context = { params: Promise<{ id: string }> };
async function evidence(context: Context) {
  const { id } = await context.params;
  if (!affiliationIdSchema.safeParse(id).success) throw new Error("VALIDATION");
  const { client, user } = await protectedClient();
  const { data, error } = await client.from("affiliation_requests").select("member_id,status").eq("id", id).maybeSingle();
  if (error) throw new Error("UNAVAILABLE");
  if (!data) throw new Error("PERMISSION");
  return { client, user, row: data, path: `${data.member_id}/${id}/evidence` };
}

export async function GET(_request: Request, context: Context) {
  try {
    const { client, path } = await evidence(context);
    const { data, error } = await client.storage.from("affiliation-evidence").download(path);
    if (error) throw new Error("PERMISSION");
    return new Response(data, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment; filename=affiliation-evidence", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return boundaryFailure(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    if (!acceptsMutation(request.headers.get("origin"), identityConfig().origin, "application/json")) throw new Error("PERMISSION");
    const { client, user, row, path } = await evidence(context);
    if (row.member_id !== user.id || row.status !== "draft") throw new Error("PERMISSION");
    const image = await validatedEvidenceImage(request).catch((error: unknown) => {
      if (error instanceof Error && error.message === "VALIDATION") return null;
      throw error;
    });
    if (!image) return reply({ ok: false, code: "VALIDATION", message: "Pilih gambar JPG atau PNG yang bisa dibuka, maksimal 2 MB." }, 400);
    const { bytes, contentType } = image;
    const { error } = await client.storage.from("affiliation-evidence").upload(path, bytes, { contentType, upsert: false });
    if (error?.statusCode === "409") {
      const { data: previous, error: readError } = await client.storage.from("affiliation-evidence").download(path);
      if (readError) throw new Error("UNAVAILABLE");
      const existing = Buffer.from(await previous.arrayBuffer());
      const normalized = existing.equals(bytes) ? existing : await normalizeEvidenceImage(existing, contentType).catch(() => null);
      if (!normalized?.equals(bytes)) {
        return Response.json({ ok: false, message: "Bukti sudah tersimpan. Tarik pengajuan sebelum mengganti bukti." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
      }
    }
    if (error && error.statusCode !== "409") throw new Error("UNAVAILABLE");
    return Response.json({ ok: true, alreadyUploaded: Boolean(error) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return boundaryFailure(error); }
}
