import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, PUT } from "./route";

const origin = "http://127.0.0.1:3108";
const id = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const storage = vi.hoisted(() => ({ upload: vi.fn() }));
const sessionStorage = vi.hoisted(() => ({ download: vi.fn(), upload: vi.fn() }));
const createClient = vi.hoisted(() => vi.fn());
const claimUpload = vi.hoisted(() => vi.fn());
const maybeSingle = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("../../../../../../server/identity/config", () => ({ identityConfig: () => ({ origin, url: origin }) }));
vi.mock("../../../../../../server/identity/protected", () => ({
  protectedClient: async () => ({
    user: { id: member },
    client: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
      storage: { from: () => sessionStorage },
    },
  }),
}));

function upload(bytes: Buffer, contentType: string) {
  return PUT(new Request(`${origin}/api/identity/affiliation/${id}/evidence`, {
    method: "PUT", headers: { Origin: origin, "Content-Type": contentType }, body: new Uint8Array(bytes),
  }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BEETIP_AFFILIATION_STORAGE_SECRET", "sb_secret_affiliation_fixture");
  createClient.mockReturnValue({ rpc: claimUpload, storage: { from: () => storage } });
  claimUpload.mockResolvedValue({ data: "first", error: null });
  maybeSingle.mockResolvedValue({ data: { member_id: member, status: "draft" } });
  storage.upload.mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllEnvs());

it("serves a private attachment for a visible request and denies an unrelated request", async () => {
  const request = new Request(`${origin}/api/identity/affiliation/${id}/evidence`);
  const context = { params: Promise.resolve({ id }) };
  sessionStorage.download.mockResolvedValue({ data: new Blob(["synthetic fixture"]) });

  const response = await GET(request, context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-disposition")).toBe("attachment; filename=affiliation-evidence");
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(sessionStorage.download).toHaveBeenCalledWith(`${member}/${id}/evidence`);
  expect(createClient).not.toHaveBeenCalled();

  sessionStorage.download.mockClear();
  maybeSingle.mockResolvedValue({ data: null });
  expect((await GET(request, context)).status).toBe(403);
  expect(sessionStorage.download).not.toHaveBeenCalled();
});

it("refuses to upload to a visible affiliation draft owned by another member", async () => {
  maybeSingle.mockResolvedValue({ data: { member_id: id, status: "draft" } });
  const response = await upload(Buffer.alloc(0), "image/png");
  expect(response.status).toBe(403);
  expect(createClient).not.toHaveBeenCalled();
});

it("checks draft state again after normalizing the image", async () => {
  maybeSingle.mockResolvedValueOnce({ data: { member_id: member, status: "draft" } })
    .mockResolvedValueOnce({ data: { member_id: member, status: "withdrawn" } });
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();

  expect((await upload(image, "image/png")).status).toBe(403);
  expect(createClient).not.toHaveBeenCalled();
});

it("keeps validated uploads working before switching the Storage policy and credential", async () => {
  vi.stubEnv("BEETIP_AFFILIATION_STORAGE_SECRET", "");
  sessionStorage.upload.mockResolvedValue({ error: null });
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();

  expect((await upload(image, "image/png")).status).toBe(200);
  expect(sessionStorage.upload).toHaveBeenCalledWith(`${member}/${id}/evidence`, expect.any(Buffer), { contentType: "image/png", upsert: false });
  expect(createClient).not.toHaveBeenCalled();
});

it("cannot use session credentials once the old Storage policy has been removed", async () => {
  vi.stubEnv("BEETIP_AFFILIATION_STORAGE_SECRET", "");
  sessionStorage.upload.mockResolvedValue({ error: { statusCode: "400" } });
  sessionStorage.download.mockResolvedValue({ error: { statusCode: "404" } });
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();

  expect((await upload(image, "image/png")).status).toBe(503);
  expect(createClient).not.toHaveBeenCalled();
});

it("rejects a different image once another upload has claimed the draft", async () => {
  claimUpload.mockResolvedValue({ data: "conflict", error: null });
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();

  expect((await upload(image, "image/png")).status).toBe(409);
  expect(claimUpload).toHaveBeenCalledWith("claim_affiliation_upload", {
    p_request: id, p_member: member, p_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
  });
  expect(storage.upload).not.toHaveBeenCalled();
});

it("rejects an unreadable image before saving it as affiliation evidence", async () => {
  const truncated = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const response = await upload(truncated, "image/png");
  expect(response.status).toBe(400);
  expect((await response.json()).message).toBe("Pilih gambar JPG atau PNG yang bisa dibuka, maksimal 2 MB.");
  expect(storage.upload).not.toHaveBeenCalled();
});

it("stores an oriented 4032 by 3024 phone JPEG without its EXIF metadata", async () => {
  const original = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: "red" } })
    .withMetadata({ orientation: 6 }).withExifMerge({ IFD0: { ImageDescription: "synthetic phone photo" } })
    .jpeg({ progressive: true }).toBuffer();
  expect(original.length).toBeLessThan(2 * 1024 * 1024);
  expect((await sharp(original).metadata()).orientation).toBe(6);

  const response = await upload(original, "image/jpeg");
  expect(response.status).toBe(200);
  expect(createClient).toHaveBeenCalledWith(origin, "sb_secret_affiliation_fixture", expect.any(Object));
  const [path, saved, options] = storage.upload.mock.calls[0];
  expect(path).toBe(`${member}/${id}/evidence`);
  expect(options).toEqual({ contentType: "image/jpeg", upsert: false });
  const metadata = await sharp(saved).metadata();
  expect(metadata).toMatchObject({ width: 3024, height: 4032, format: "jpeg" });
  expect(metadata.exif).toBeUndefined();
  expect(metadata.icc).toBeUndefined();
});

it("asks the member to lower photo resolution when the JPEG exceeds the pixel limit", async () => {
  const original = await sharp({ create: { width: 4200, height: 3200, channels: 3, background: "red" } })
    .jpeg().toBuffer();
  expect(original.length).toBeLessThan(2 * 1024 * 1024);

  const response = await upload(original, "image/jpeg");
  expect(response.status).toBe(400);
  expect((await response.json()).message).toBe("Resolusi gambar melebihi 13 megapiksel. Turunkan resolusinya, lalu unggah ulang.");
  expect(storage.upload).not.toHaveBeenCalled();
});

it("strips metadata and keeps retries compatible with a draft uploaded before normalization", async () => {
  const original = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
    .withExif({ IFD0: { ImageDescription: "private fixture metadata" } }).png().toBuffer();
  expect((await sharp(original).metadata()).exif).toBeDefined();

  expect((await upload(original, "image/png")).status).toBe(200);
  const saved = storage.upload.mock.calls[0][1] as Buffer;
  expect((await sharp(saved).metadata()).exif).toBeUndefined();

  claimUpload.mockResolvedValue({ data: "existing", error: null });
  sessionStorage.download.mockResolvedValue({ data: new Blob([new Uint8Array(original)]), error: null });
  const replay = await upload(original, "image/png");
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({ ok: true, alreadyUploaded: true });

  const other = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
  expect((await upload(other, "image/png")).status).toBe(409);
});
