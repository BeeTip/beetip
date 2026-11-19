// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectedOrderDetail } from "./connected-order";
import { connectedOrderState } from "./connected-order-state";

vi.mock("./connected-amendments", () => ({ ConnectedAmendments: () => null }));

let root: Root;
let host: HTMLDivElement;
const order = { id: "order", state: "awaiting_payment", reservationUntil: "2000-01-01T00:00:00Z", terms: { title: "Pesanan uji", items: [], budget: 20000, fee: 5000, destination: "Kampus", start: "2026-11-19T00:00:00Z", end: "2026-11-19T01:00:00Z" } };
const response = (state: string) => ({ ok: true, json: async () => ({ memberId: "member", order: { ...order, state } }) });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("uses server state even with an old deadline and refreshes expiry without a browser decision", async () => {
  let orderReads = 0;
  const fetch = vi.fn((url: string, options: RequestInit) => {
    expect(options.cache).toBe("no-store");
    return Promise.resolve(url.includes("/funding")
      ? { ok: true, json: async () => ({ memberId: "member", data: null }) }
      : response(orderReads++ === 0 ? "awaiting_payment" : "expired"));
  });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ConnectedOrderDetail id="order" memberId="member" />));
  expect(host.textContent).toContain("Menunggu pembayaran");
  await act(async () => vi.advanceTimersByTimeAsync(30000));
  expect(host.textContent).toContain("Reservasi kedaluwarsa");
  expect(host.textContent).toContain("tidak lagi memakai kapasitas");
  expect(orderReads).toBe(2);
});
it("retries a failed status read without a mutation", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("Jaringan terputus")).mockResolvedValueOnce(response("expired"));
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ConnectedOrderDetail id="order" memberId="member" />));
  expect(host.querySelector('[role="alert"]')!.textContent).toContain("Jaringan terputus");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toContain("Reservasi kedaluwarsa");
  expect(fetch.mock.calls.every(call => call[1].method === undefined)).toBe(true);
});
it("times out a stalled read and cleans up its timers", async () => {
  const fetch = vi.fn().mockImplementation(() => new Promise(() => {})); vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ConnectedOrderDetail id="order" memberId="member" />));
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(host.textContent).toContain("Coba lagi");
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});
it("rejects a mismatched account response and labels unknown states honestly", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("expired")));
  await act(async () => root.render(<ConnectedOrderDetail id="order" memberId="other" />));
  expect(host.textContent).toContain("Sesi berubah"); expect(host.textContent).not.toContain("Pesanan uji");
  expect(connectedOrderState("future_state")).toBe("Status belum tersedia");
  expect(connectedOrderState("funding_verified")).toBe("Dana telah diverifikasi");
});
