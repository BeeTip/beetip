import sharp from "sharp";
import { beforeEach, expect, it, vi } from "vitest";
import { PUT } from "./route";

const origin = "http://127.0.0.1:3108";
const id = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const storage = vi.hoisted(() => ({ upload: vi.fn(), download: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../server/identity/config", () => ({ identityConfig: () => ({ origin }) }));
vi.mock("../../../../../../server/identity/protected", () => ({
  protectedClient: async () => ({
    user: { id: member },
    client: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { member_id: member, status: "draft" } }) }) }) }),
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
  storage.upload.mockResolvedValue({ error: null });
});

it("rejects an unreadable image before saving it as affiliation evidence", async () => {
  const truncated = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const response = await upload(truncated, "image/png");
  expect(response.status).toBe(400);
  expect((await response.json()).message).toBe("Pilih gambar JPG atau PNG yang bisa dibuka, maksimal 2 MB.");
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
