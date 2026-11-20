import sharp from "sharp";
import { beforeEach, expect, it, vi } from "vitest";
import { GET, PUT } from "./route";

const origin = "http://127.0.0.1:3108";
const id = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const storage = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn() }));
const maybeSingle = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../server/identity/config", () => ({ identityConfig: () => ({ origin }) }));
vi.mock("../../../../../../server/identity/protected", () => ({
  protectedClient: async () => ({
    user: { id: member },
    client: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
      storage: { from: () => storage },
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
  maybeSingle.mockResolvedValue({ data: { member_id: member, status: "draft" } });
  storage.upload.mockResolvedValue({ error: null });
});

it("serves a private attachment for a visible request and denies an unrelated request", async () => {
  const request = new Request(`${origin}/api/identity/affiliation/${id}/evidence`);
  const context = { params: Promise.resolve({ id }) };
  storage.download.mockResolvedValue({ data: new Blob(["synthetic fixture"]) });

  const response = await GET(request, context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-disposition")).toBe("attachment; filename=affiliation-evidence");
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(storage.download).toHaveBeenCalledWith(`${member}/${id}/evidence`);

  storage.download.mockClear();
  maybeSingle.mockResolvedValue({ data: null });
  expect((await GET(request, context)).status).toBe(403);
  expect(storage.download).not.toHaveBeenCalled();
});

it("refuses to upload to a visible affiliation draft owned by another member", async () => {
  maybeSingle.mockResolvedValue({ data: { member_id: id, status: "draft" } });
  const response = await upload(Buffer.alloc(0), "image/png");
  expect(response.status).toBe(403);
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

  storage.upload.mockResolvedValue({ error: { statusCode: "409" } });
  storage.download.mockResolvedValue({ data: new Blob([new Uint8Array(original)]), error: null });
  const replay = await upload(original, "image/png");
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({ ok: true, alreadyUploaded: true });

  const other = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
  expect((await upload(other, "image/png")).status).toBe(409);
});
