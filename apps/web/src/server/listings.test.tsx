import type { Database } from "@beetip/database/types";
import { expect, it, vi } from "vitest";
import { ownListing } from "./listings";

vi.mock("server-only", () => ({}));

it("keeps legacy listings free of moderation holds", () => {
  const listing = { status: "active" } as Omit<Database["public"]["Tables"]["listings"]["Row"], "moderation_hold">;

  expect(ownListing(listing).moderated).toBe(false);
  expect(ownListing({ ...listing, moderation_hold: null }).moderated).toBe(false);
  expect(ownListing({ ...listing, moderation_hold: "00000000-0000-4000-8000-000000000001" }).moderated).toBe(true);
});
