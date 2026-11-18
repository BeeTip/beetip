import { createHash } from "node:crypto";
import { acceptsMutation, affiliationIdSchema, evidenceType } from "@beetip/validation";
import { identityConfig } from "../../../../../../server/identity/config";
import { boundaryFailure } from "../../../../../../server/identity/http";
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
    if (!["image/png", "image/jpeg"].includes(request.headers.get("content-type") ?? "")) throw new Error("VALIDATION");
    const { client, user, row, path } = await evidence(context);
    if (row.member_id !== user.id || row.status !== "draft") throw new Error("PERMISSION");
    if (Number(request.headers.get("content-length") ?? 0) > 2097152) throw new Error("VALIDATION");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("VALIDATION");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2097152) { await reader.cancel(); throw new Error("VALIDATION"); }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    const contentType = evidenceType(bytes);
    if (!contentType || contentType !== request.headers.get("content-type")) throw new Error("VALIDATION");
    const { error } = await client.storage.from("affiliation-evidence").upload(path, bytes, { contentType, upsert: false });
    if (error?.statusCode === "409") {
      const { data: previous, error: readError } = await client.storage.from("affiliation-evidence").download(path);
      if (readError) throw new Error("UNAVAILABLE");
      if (createHash("sha256").update(Buffer.from(await previous.arrayBuffer())).digest("hex") !== createHash("sha256").update(bytes).digest("hex")) {
        return Response.json({ ok: false, message: "Bukti sudah tersimpan. Tarik pengajuan sebelum mengganti bukti." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
      }
    }
    if (error && error.statusCode !== "409") throw new Error("UNAVAILABLE");
    return Response.json({ ok: true, alreadyUploaded: Boolean(error) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return boundaryFailure(error); }
}
