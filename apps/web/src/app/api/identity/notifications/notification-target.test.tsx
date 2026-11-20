import { expect, it, vi } from "vitest";
import { GET } from "./[id]/target/route";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("../../../../server/identity/protected", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../server/identity/protected")>(),
  protectedClient: async () => ({ client: { rpc } }),
}));

const id = "00000000-0000-4000-8000-000000000001";
const request = new Request(`https://app.example/api/identity/notifications/${id}/target`);
const context = { params: Promise.resolve({ id }) };

it.each([
  `/account/funding?order=${id}`,
  `/account/transfers/?order=${id}`,
  `/account/reconciliation?order=${id}`,
  "/account/../account/funding",
  "/\\external.example/account",
])("does not expose an inaccessible destination %s", async target => {
  rpc.mockResolvedValueOnce({ data: target });
  const response = await GET(request, context);
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).not.toHaveProperty("target");
});

it.each([
  `/orders/${id}`,
  `/account/order-cases?order=${id}`,
  `/support?case=${id}`,
  `/account/offers?listing=${id}`,
  "/account/affiliation",
])("preserves the authorized destination %s", async target => {
  rpc.mockResolvedValueOnce({ data: target });
  const response = await GET(request, context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, target });
});
