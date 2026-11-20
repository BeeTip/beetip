// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectedHandover } from "./connected-handover";

vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,iVBORw0KGgo=" } }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["2026-11-19T00:05:00Z", "2026-11-18T23:55:00Z"])(
  "shows and clears the issued code with a browser wall clock of %s",
  async browserTime => {
    vi.setSystemTime(new Date(browserTime));
    vi.stubGlobal("fetch", vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return { ok: true, json: async () => ({ ok: true, code: "012345ABCDEF", expiresAt: "2026-11-19T00:01:00Z" }) };
    }));
    await act(async () => root.render(<ConnectedHandover orderId="order" memberId="customer" orderState="delivering"
      provider={false} onChange={vi.fn()} />));
    await act(async () => {
      host.querySelector<HTMLInputElement>("[name=checked]")!.checked = true;
      host.querySelector<HTMLButtonElement>("button")!.click();
      await vi.advanceTimersByTimeAsync(2000);
      await vi.dynamicImportSettled();
    });
    expect(host.querySelector(".qr-panel strong")?.textContent).toBe("012345ABCDEF");
    expect(host.querySelector(".qr-panel img")).toBeTruthy();

    await act(async () => vi.advanceTimersByTimeAsync(57000));
    expect(host.querySelectorAll(".qr-panel")).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(host.querySelectorAll(".qr-panel")).toHaveLength(0);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Buat kode baru");
  },
);
