import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AccountPage from "./page";
import LoginPage from "../login/page";
import OrderPage from "../orders/[id]/page";

const identity = vi.hoisted(() => ({ configured: vi.fn(), member: vi.fn() }));
vi.mock("../../server/identity/config", () => ({ mode: () => "connected", identityConfigured: identity.configured }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({}),
  redirect: (destination: string) => { throw new Error(destination); },
}));
vi.mock("../../server/identity/client", () => ({
  currentMember: identity.member,
  identityClient: () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    };
    return { from: () => query };
  },
}));

it("shows members the account actions they can use", async () => {
  identity.configured.mockReturnValue(true);
  identity.member.mockResolvedValue({ id: "member", name: "Nadia", status: "active" });

  const page = renderToStaticMarkup(await AccountPage());

  expect(page).toContain("Halo, Nadia");
  expect(page).toContain('href="/account/orders"');
  expect(page).toContain('href="/listings/new"');
  expect(page).not.toContain("persetujuan keanggotaan");
});

it("lets visitors browse when account services are unavailable", async () => {
  identity.configured.mockReturnValue(false);

  for (const screen of [await AccountPage(), await LoginPage({ searchParams: Promise.resolve({}) })]) {
    const page = renderToStaticMarkup(screen);

    expect(page).toContain("Layanan akun belum tersedia");
    expect(page).toContain('href="/"');
    expect(page).not.toContain("Konfigurasi layanan");
  }
});

it("keeps the linked order when a signed-out customer is asked to sign in", async () => {
  identity.configured.mockReturnValue(true);
  identity.member.mockResolvedValue(null);
  const id = "00000000-0000-4000-8000-000000000001";
  const order = `/orders/${id}`;
  const destination = encodeURIComponent(order);

  await expect(OrderPage({ params: Promise.resolve({ id }) })).rejects.toThrow(`/login?next=${destination}`);
  const login = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next: order }) }));
  expect(login).toContain(`href="/login?form=signup&amp;next=${destination}"`);
});
