// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ConnectedListingDetail } from "./connected-listings";

it("gives shoppers the next step from a connected listing", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      listings: [{
        id: "listing", title: "Titip makan siang", type: "trip", category: "Makanan",
        shop: "Kantin", area: "Kampus", items: [], budget: 20000, fee: 5000,
        negotiable: false, start: "2026-11-19T03:00:00Z", end: "2026-11-19T04:00:00Z",
        cutoff: "2026-11-19T02:00:00Z", capacity: 2, spendingCapacity: 100000,
      }],
    }),
  }));

  try {
    await act(async () => root.render(<ConnectedListingDetail id="listing" />));

    const offerLink = Array.from(host.querySelectorAll("a")).find(link => link.textContent === "Lanjut ke penawaran");
    expect(offerLink?.getAttribute("href")).toBe("/account/offers?listing=listing");
    expect(host.textContent).toContain("Periksa rincian dan ongkos sebelum menyetujui pesanan.");
    expect(host.textContent).toContain("Alamat tepat hanya dibagikan kepada peserta pesanan.");
    expect(host.textContent).not.toContain("Pembayaran belum tersedia");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    host.remove();
  }
});
