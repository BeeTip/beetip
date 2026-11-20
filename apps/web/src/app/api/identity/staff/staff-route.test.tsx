import { expect, it, vi } from "vitest";
import { POST } from "./route";

const rpc = vi.hoisted(() => vi.fn());
const origin = "http://127.0.0.1:3197";
vi.mock("server-only", () => ({}));
vi.mock("../../../../server/identity/config", () => ({ mode: () => "connected", identityConfig: () => ({ origin }) }));
vi.mock("../../../../server/identity/protected", () => ({
  protectedClient: async () => ({ client: { rpc } }),
}));

const memberId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";
function request(role: string) {
  return new Request(`${origin}/api/identity/staff`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ memberId, operationId, role, grant: true, reason: "owner_approved" }),
  });
}

it("rejects grants for retired transfer approval roles", async () => {
  rpc.mockResolvedValue({ data: memberId });
  expect((await POST(request("finance_review"))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

it("preserves access administration for demo case reviewers", async () => {
  rpc.mockResolvedValueOnce({ data: memberId });
  const response = await POST(request("finance_operation"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, memberId });
});
