import "server-only";
import sharp from "sharp";
import { boundaryFailure, reply } from "./http";

const maxBytes = 2 * 1024 * 1024;
const maxPixels = 13_000_000;
const resizeMessage = "Ukuran gambar melebihi 2 MB. Perkecil gambar lalu unggah ulang.";
const imageMessage = "Pilih gambar JPG atau PNG yang bisa dibuka, maksimal 2 MB.";
const formatMessage = "Format file tidak sesuai. Simpan ulang sebagai JPG atau PNG, lalu unggah ulang.";
const resolutionMessage = "Resolusi gambar melebihi 13 megapiksel. Turunkan resolusinya, lalu unggah ulang.";
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff]);

class EvidenceImageError extends Error {}

export function evidenceUploadFailure(error: unknown) {
  if (error instanceof EvidenceImageError) {
    return reply({ ok: false, code: "VALIDATION", message: error.message }, 400);
  }
  return boundaryFailure(error);
}

export async function validatedEvidenceImage(request: Request) {
  const contentType = request.headers.get("content-type");
  if (contentType !== "image/png" && contentType !== "image/jpeg") throw new EvidenceImageError(imageMessage);
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new EvidenceImageError(resizeMessage);
  const reader = request.body?.getReader();
  if (!reader) throw new EvidenceImageError(imageMessage);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new EvidenceImageError(resizeMessage);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes: await normalizeEvidenceImage(Buffer.concat(chunks), contentType), contentType };
}

export async function normalizeEvidenceImage(input: Buffer, contentType: string) {
  if (input.length > maxBytes) throw new EvidenceImageError(resizeMessage);
  const format = input.subarray(0, pngSignature.length).equals(pngSignature) ? "png"
    : input.subarray(0, jpegSignature.length).equals(jpegSignature) ? "jpeg" : null;
  if (!format) throw new EvidenceImageError(imageMessage);
  if (`image/${format}` !== contentType) throw new EvidenceImageError(formatMessage);

  try {
    const image = sharp(input, { limitInputPixels: maxPixels, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new EvidenceImageError(imageMessage);
    const bytes = await image.rotate().toFormat(format).toBuffer();
    if (bytes.length > maxBytes) throw new EvidenceImageError(resizeMessage);
    return bytes;
  } catch (error) {
    if (error instanceof EvidenceImageError) throw error;
    if (error instanceof Error && error.message === "Input image exceeds pixel limit") {
      throw new EvidenceImageError(resolutionMessage);
    }
    throw new EvidenceImageError(imageMessage);
  }
}
