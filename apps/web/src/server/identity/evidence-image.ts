import "server-only";
import sharp from "sharp";

const maxBytes = 2 * 1024 * 1024;
const maxPixels = 12_000_000;

export async function validatedEvidenceImage(request: Request) {
  const contentType = request.headers.get("content-type");
  if (contentType !== "image/png" && contentType !== "image/jpeg") throw new Error("VALIDATION");
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new Error("VALIDATION");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("VALIDATION");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error("VALIDATION");
    }
    chunks.push(value);
  }
  return { bytes: await normalizeEvidenceImage(Buffer.concat(chunks), contentType), contentType };
}

export async function normalizeEvidenceImage(input: Buffer, contentType: string) {
  if (input.length > maxBytes) throw new Error("VALIDATION");
  try {
    const image = sharp(input, { limitInputPixels: maxPixels, failOn: "warning" });
    const metadata = await image.metadata();
    if (`image/${metadata.format}` !== contentType || (metadata.pages ?? 1) !== 1) throw new Error("VALIDATION");
    const bytes = await image.rotate().toFormat(metadata.format === "png" ? "png" : "jpeg").toBuffer();
    if (bytes.length > maxBytes) throw new Error("VALIDATION");
    return bytes;
  } catch {
    throw new Error("VALIDATION");
  }
}
