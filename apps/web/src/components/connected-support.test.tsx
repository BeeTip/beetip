// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ConnectedSupport } from "./connected-support";

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: () => {
    const channel = { on: () => channel, subscribe: () => channel };
    return {
      channel: () => channel,
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }) },
      removeChannel: vi.fn(),
    };
  },
}));

it.each([
  ["access", "Permintaan salinan data pribadi."],
  ["deletion", "Permintaan penghapusan data pribadi."],
])("files a data %s request as a private account support case", async (kind, body) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const memberId = "member";
  const fetchSupport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => Response.json(init?.method === "POST"
    ? { memberId, conversationId: "case" }
    : { memberId, workspace: { cases: [], queue: [], operators: [], operator: false, lead: false } }));
  vi.stubGlobal("fetch", fetchSupport);

  try {
    await act(async () => root.render(<ConnectedSupport memberId={memberId} privacy />));
    expect(host.querySelector("form h2")?.textContent).toBe("Permintaan data pribadi");
    const requestType = host.querySelector<HTMLSelectElement>("select[name=requestType]")!;
    await act(async () => {
      requestType.value = kind;
      requestType.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>("form button[type=submit]")!.click());

    const mutation = fetchSupport.mock.calls.find(([, init]) => init?.method === "POST");
    expect(mutation?.[0]).toBe("/api/identity/support");
    expect(JSON.parse(String(mutation?.[1]?.body))).toEqual({
      action: "open", operationId: expect.any(String), category: "account", body,
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
