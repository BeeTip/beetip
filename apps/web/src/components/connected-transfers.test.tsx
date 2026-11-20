// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConnectedTransfers } from "./connected-transfers";

const order = "e1ffe1de-153c-4e73-aa55-ce50daaafe35";
const transfer = "e8f25e61-6f60-4700-b440-77deae8e8512";
const member = "member";
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const detail = (state: string, actions: string[], version: number) => ok({
  memberId: member, orderId: order, data: {
    title: "Pesanan kampus", accountLabel: "Akun uji", accountBlocked: state === "ambiguous", blockingOrderId: null,
    options: [], history: [{ id: transfer, component: "refund", itemIndex: null, itemLabel: null, amount: 25000,
      independentReview: true, preparedBy: "initiator", state, version, allocationChanged: false, actions,
      facts: [{ state, actorId: "initiator", note: "Catatan uji", at: "2026-11-20T00:00:00Z", reference: null, accountRecord: null }],
    }],
  },
});

it("checks an unknown approval response after reload without posting a second command", async () => {
  let posted = false;
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (options.method === "POST") {
      posted = true;
      expect(JSON.parse(String(options.body))).toMatchObject({ orderId: order, action: "approve", payload: { transferId: transfer, version: 1 } });
      throw new Error("Koneksi terputus");
    }
    if (url.includes("operation=")) return ok({ memberId: member, data: { orderId: order, transferId: transfer } });
    return posted ? detail("approved", [], 2) : detail("prepared", ["approve", "abandon"], 1);
  });
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<ConnectedTransfers order={order} memberId={member} />));
  const approve = [...host.querySelectorAll("button")].find(button => button.textContent === "Setujui permintaan")!;
  const form = approve.closest("form")!;
  form.querySelector("textarea")!.value = "Alokasi sesuai";
  await act(async () => { approve.click(); approve.click(); });
  expect(host.textContent).toContain("Status penyimpanan belum diketahui");
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<ConnectedTransfers order={order} memberId={member} />));
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Periksa operasi")!.click());
  expect(host.textContent).toContain("Operasi tersimpan");
  expect(host.textContent).toContain("Disetujui");
  expect(fetch.mock.calls.filter(call => call[1].method === "POST")).toHaveLength(1);
});

it("requests account records when reconciling an ambiguous result", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => detail("ambiguous", ["resolve_completed", "resolve_not_sent"], 4)));
  await act(async () => root.render(<ConnectedTransfers order={order} memberId={member} />));
  expect(host.textContent).toContain("Akun masih memiliki transfer yang belum selesai");
  const completed = [...host.querySelectorAll("button")].find(button => button.textContent === "Konfirmasi terkirim dari mutasi")!;
  const form = completed.closest("form")!;
  expect(form.querySelector<HTMLInputElement>('[name="record"]')!.required).toBe(true);
  expect(form.querySelector<HTMLInputElement>('[name="reference"]')!.required).toBe(true);
  expect(host.textContent).not.toContain("Mulai simulasi transfer");
});
