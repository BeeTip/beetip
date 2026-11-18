// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectedAcceptance } from "./connected-acceptance";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
let root: Root;
let host: HTMLDivElement;
const props = { memberId: "member", listingId: "listing", listingVersion: 1, offerId: "offer", offerVersion: 2 };
async function click(selector: string) { await act(async () => { host.querySelector<HTMLElement>(selector)!.click(); }); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("connected acceptance retry", () => {
  it("retains the original operation and exact payload after a lost response, even if props change", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError("Network response lost")).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, orderId: "committed-order" }) });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<ConnectedAcceptance {...props} />));
    expect(host.querySelector("button")!.disabled).toBe(true);
    await click("input"); await click("button");
    expect(host.textContent).toContain("Hasil belum diketahui");
    expect(host.querySelector("input")!.disabled).toBe(true);
    await act(async () => root.render(<ConnectedAcceptance {...props} listingVersion={3} offerVersion={4} />));
    await click("button");
    const first = JSON.parse(fetch.mock.calls[0][1].body);
    expect(first.operationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.listingVersion).toBe(1);
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
    expect(host.querySelector("a")!.getAttribute("href")).toBe("/orders/committed-order");
  });
  it.each([503, 502])("keeps the operation after HTTP %s", async status => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status, json: async () => ({ message: "Unavailable" }) }).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, orderId: "order" }) });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<ConnectedAcceptance {...props} />));
    await click("input"); await click("button"); await click("button");
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  });
  it("releases a known business refusal and uses a new operation for a changed command", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: "Conflict" }) });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<ConnectedAcceptance {...props} />));
    await click("input"); await click("button");
    await act(async () => root.render(<ConnectedAcceptance {...props} listingVersion={2} />));
    expect(host.querySelector("button")!.disabled).toBe(true);
    await click("input"); await click("button");
    expect(JSON.parse(fetch.mock.calls[1][1].body).operationId).not.toBe(JSON.parse(fetch.mock.calls[0][1].body).operationId);
    expect(JSON.parse(fetch.mock.calls[1][1].body).listingVersion).toBe(2);
  });
});
