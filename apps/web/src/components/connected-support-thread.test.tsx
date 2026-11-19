// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SupportFailure, SupportThread, type SupportCall } from "./connected-support-thread";

it("clears audited order history on grant revocation and closes cached support history on reassignment", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const supportMessage = { id: "support-message", sequence: 1, senderId: "requester", body: "Isi bantuan privat",
    createdAt: "2026-11-19T00:00:00Z" };
  const orderMessage = { ...supportMessage, id: "order-message", body: "Isi chat pesanan privat" };
  const thread = { id: "case", category: "order", status: "open", requester: false, assigned: true,
    escalated: true, version: 2, orderAccess: true, hasOrder: true, messages: [supportMessage], older: null };
  const call = vi.fn()
    .mockResolvedValueOnce({ thread })
    .mockResolvedValueOnce({ thread: { ...thread, messages: [orderMessage] } })
    .mockResolvedValueOnce({ thread })
    .mockResolvedValueOnce({ thread: { ...thread, version: 4 } })
    .mockResolvedValueOnce({ thread: { ...thread, version: 4, messages: [orderMessage] } })
    .mockResolvedValueOnce({ thread: { ...thread, orderAccess: false, version: 5 } })
    .mockRejectedValueOnce(new SupportFailure("Akses kasus tidak diizinkan.", 403));
  const onChange = vi.fn();
  const onBack = vi.fn();
  const render = (refresh: number) => act(async () => {
    root.render(<SupportThread id="case" memberId="operator" refresh={refresh}
      call={call as SupportCall} onChange={onChange} onBack={onBack} />);
  });
  try {
    await render(0);
    expect(host.textContent).toContain(supportMessage.body);
    expect(host.textContent).not.toContain(orderMessage.body);
    const openOrder = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Baca chat pesanan");
    expect(openOrder).toBeDefined();
    await act(async () => { openOrder?.click(); });
    expect(host.textContent).toContain(orderMessage.body);
    expect(call.mock.calls[1][0]).toBe("?case=case&history=order");

    await render(1);
    expect(host.textContent).toContain(orderMessage.body);
    await render(2);
    expect(host.textContent).not.toContain(orderMessage.body);
    const reopenOrder = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Baca chat pesanan");
    expect(reopenOrder).toBeDefined();
    await act(async () => { reopenOrder?.click(); });
    expect(host.textContent).toContain(orderMessage.body);

    await render(3);
    expect(host.textContent).not.toContain(orderMessage.body);
    expect(host.textContent).toContain(supportMessage.body);
    await render(4);
    expect(host.textContent).not.toContain(supportMessage.body);
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Akses kasus tidak diizinkan.");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps audited order history hidden when an earlier page arrives after dismissal", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const current = { id: "order-current", sequence: 2, senderId: "requester", body: "Pesan pesanan terbaru",
    createdAt: "2026-11-19T00:00:00Z" };
  const earlier = { ...current, id: "order-earlier", sequence: 1, body: "Pesan pesanan sebelumnya" };
  const thread = { id: "case", category: "order", status: "open", requester: false, assigned: true,
    escalated: true, version: 2, orderAccess: true, hasOrder: true, messages: [], older: null };
  let resolvePage!: (result: { thread: object }) => void;
  const pending = new Promise<{ thread: object }>(resolve => { resolvePage = resolve; });
  const call = vi.fn()
    .mockResolvedValueOnce({ thread })
    .mockResolvedValueOnce({ thread: { ...thread, messages: [current], older: 2 } })
    .mockReturnValueOnce(pending);
  const click = (label: string) => act(async () => {
    const button = Array.from(host.querySelectorAll("button")).find(item => item.textContent === label);
    expect(button).toBeDefined();
    button?.click();
  });
  try {
    await act(async () => root.render(<SupportThread id="case" memberId="operator" refresh={0}
      call={call as SupportCall} onChange={vi.fn()} onBack={vi.fn()} />));
    await click("Baca chat pesanan");
    expect(host.querySelector('[aria-label="Riwayat pesanan"]')?.textContent).toContain(current.body);
    await click("Muat pesan pesanan sebelumnya");
    await click("Sembunyikan chat pesanan");
    await act(async () => resolvePage({ thread: { ...thread, messages: [earlier] } }));
    expect(host.querySelector('[aria-label="Riwayat pesanan"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
