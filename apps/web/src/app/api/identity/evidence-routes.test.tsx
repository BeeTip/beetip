import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as downloadCase, PUT as uploadCase } from "./order-cases/evidence/route";
import { GET as downloadPurchase, PUT as uploadPurchase } from "./purchases/evidence/route";
import { GET as downloadFunding, PUT as uploadFunding } from "./funding/[id]/evidence/route";

const origin = "http://127.0.0.1:3197";
const id = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const operation = "00000000-0000-4000-8000-000000000003";
const rpc = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("../../../server/identity/config", () => ({ identityConfig: () => ({ origin }) }));
vi.mock("../../../server/identity/protected", () => ({
  protectedClient: async () => ({ user: { id: member }, client: { rpc } }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => storage } }),
}));

const context = { params: Promise.resolve({ id }) };
const prefix = `${member}/${id}/${operation}`;
const routes = [
  { name: "funding", path: `funding/${id}/evidence`, upload: (request: Request) => uploadFunding(request, context),
    download: (request: Request) => downloadFunding(request, context), authorizedKey: id },
  { name: "purchase", path: `purchases/evidence?order=${id}&key=${operation}`, upload: uploadPurchase,
    download: downloadPurchase, authorizedKey: prefix },
  { name: "case", path: `order-cases/evidence?order=${id}&key=${operation}`, upload: uploadCase,
    download: downloadCase, authorizedKey: prefix },
];

function uploadRequest(path: string, bytes: Uint8Array<ArrayBuffer>, contentType: string) {
  return new Request(`${origin}/api/identity/${path}`, {
    method: "PUT", body: bytes,
    headers: { Origin: origin, "Content-Type": contentType, "X-Beetip-Member": member },
  });
}

describe.each(routes)("$name evidence", ({ name, path, upload, download, authorizedKey }) => {
  beforeEach(() => {
    vi.resetAllMocks();
    rpc.mockResolvedValue({ data: authorizedKey });
    for (const variable of ["BEETIP_FUNDING_STORAGE_SECRET", "BEETIP_RECEIPT_STORAGE_SECRET", "BEETIP_CASE_STORAGE_SECRET"]) {
      vi.stubEnv(variable, "sb_secret_test");
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it("tells the member how to fix an oversized upload before storage is called", async () => {
    const response = await upload(uploadRequest(path, new Uint8Array(2 * 1024 * 1024 + 1), "image/png"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION",
      message: "Ukuran gambar melebihi 2 MB. Perkecil gambar lalu unggah ulang.",
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("asks for a matching format when a JPEG is declared as PNG", async () => {
    const jpg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).jpeg().toBuffer();
    const response = await upload(uploadRequest(path, new Uint8Array(jpg), "image/png"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "VALIDATION",
      message: "Format file tidak sesuai. Simpan ulang sebagai JPG atau PNG, lalu unggah ulang.",
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("keeps transparent PNGs readable and derives immutable keys from authorized data", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "transparent" } })
      .withExif({ IFD0: { ImageDescription: "synthetic PNG" } }).png().toBuffer();
    storage.upload.mockResolvedValue({ error: null });

    const response = await upload(uploadRequest(path, new Uint8Array(png), "image/png"));
    expect(response.status).toBe(200);
    const [key, saved, options] = storage.upload.mock.calls[0];
    const hash = createHash("sha256").update(saved).digest("hex");
    expect(key).toBe(name === "funding" ? authorizedKey : `${authorizedKey}/${hash}`);
    expect(options).toEqual({ contentType: "image/png", upsert: false });
    const metadata = await sharp(saved).metadata();
    expect(metadata).toMatchObject({ format: "png", hasAlpha: true });
    expect(metadata.exif).toBeUndefined();
    expect(await response.json()).toEqual(name === "funding" ? { ok: true } : { imageHash: hash });
  });

  it("refuses an upload when the session is no longer authorized after validation", async () => {
    rpc.mockResolvedValueOnce({ data: authorizedKey }).mockResolvedValueOnce({ error: { code: "PERMISSION" } });
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "blue" } }).png().toBuffer();
    expect((await upload(uploadRequest(path, new Uint8Array(png), "image/png"))).status).toBe(403);
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("serves private attachments only after a fresh authorization check", async () => {
    const asset = new Blob(["synthetic fixture"], { type: "image/jpeg" });
    storage.download.mockResolvedValue({ data: asset });
    const request = new Request(`${origin}/api/identity/${path}`);

    const response = await download(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename=.*\.jpg$/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("synthetic fixture");

    rpc.mockResolvedValueOnce({ data: authorizedKey }).mockResolvedValueOnce({ error: { code: "PERMISSION" } });
    const revoked = await download(request);
    expect(revoked.status).toBe(403);
    expect(await revoked.text()).not.toContain("synthetic fixture");
  });

  it("denies an unrelated session before retrieving private bytes", async () => {
    rpc.mockResolvedValue({ error: { code: "PERMISSION" } });
    const response = await download(new Request(`${origin}/api/identity/${path}`));
    expect(response.status).toBe(403);
    expect(storage.download).not.toHaveBeenCalled();
  });
});
