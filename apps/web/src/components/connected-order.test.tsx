// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectedOrderDetail } from "./connected-order";
import { connectedOrderState } from "./connected-order-state";

vi.mock("./connected-amendments", () => ({ ConnectedAmendments: () => null }));
vi.mock("./connected-purchase", () => ({ ConnectedPurchase: () => null }));

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
    return Promise.resolve(url.includes("/funding") || url.includes("/order-cases")
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

it("confirms demo payment with one action and recovers after an interrupted request", async () => {
  let paid = false;
  let attempts = 0;
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (options.method === "POST") {
      expect(url).toBe("/api/identity/orders/demo-payment");
      expect(options.headers).toMatchObject({ "X-Beetip-Member": "member" });
      expect(JSON.parse(String(options.body))).toEqual({ orderId: "order" });
      if (++attempts === 1) throw new Error("Connection lost");
      paid = true;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ memberId: "member", order: {
      ...order, boothDemo: true, canSimulatePayment: !paid, state: paid ? "booth_ready" : "booth_awaiting_payment",
    } }) };
  });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ConnectedOrderDetail id="order" memberId="member" />));
  const pay = () => [...host.querySelectorAll("button")].find(button => button.textContent === "Simulasikan pembayaran");
  expect(pay()).toBeDefined();
  await act(async () => pay()!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Coba lagi");
  await act(async () => pay()!.click());
  expect(host.textContent).toContain("Siap belanja demo");
  expect(pay()).toBeUndefined();
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

it("submits cancellation from the connected order and reloads the amount on hold", async () => {
  const allocation = { purchase: 0, fee: 5000, refund: 20000 };
  const empty = { purchase: 0, fee: 0, refund: 0 };
  let opened = false;
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (url.includes("/funding")) return { ok: true, json: async () => ({ memberId: "member", data: null }) };
    if (!url.includes("/order-cases")) return response("funding_verified");
    if (options.method === "POST") {
      expect(options.headers).toMatchObject({ "X-Beetip-Member": "member" });
      expect(JSON.parse(String(options.body))).toMatchObject({
        orderId: "order", action: "open", payload: { kind: "cancellation", reason: "Barang tidak diperlukan" },
      });
      opened = true;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ memberId: "member", orderId: "order", storageAvailable: true, data: {
      verified: 25000, held: opened ? allocation : empty, allocation, unheld: opened ? empty : allocation,
      access: "member", canCancel: !opened, canDispute: false, items: [],
      case: opened ? { id: "case", kind: "cancellation", state: "open", reason: "Barang tidak diperlukan", evidence: [], proposal: null } : null,
    } }) };
  });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ConnectedOrderDetail id="order" memberId="member" />));
  const button = [...host.querySelectorAll("button")].find(element => element.textContent === "Ajukan pembatalan");
  expect(button).toBeDefined();
  const form = button!.closest("form")!;
  form.querySelector("textarea")!.value = "Barang tidak diperlukan";
  await act(async () => form.requestSubmit());
  expect(host.textContent).toContain("Pembatalan sedang ditinjau");
  expect(host.textContent).toContain("Dana ditahan");
  expect(host.textContent).toContain("Rp");
  expect([...host.querySelectorAll("button")].some(element => element.textContent === "Ajukan pembatalan")).toBe(false);
});
