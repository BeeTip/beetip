import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AccountPage from "./page";
import LoginPage from "../login/page";
import OrderPage from "../orders/[id]/page";
import ChatPage from "../chat/[orderId]/page";
import { ConnectedAffiliation } from "../../components/connected-affiliation";

const identity = vi.hoisted(() => ({ configured: vi.fn(), member: vi.fn(), roles: vi.fn() }));
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
      in: vi.fn().mockReturnThis(),
      is: identity.roles,
    };
    return { from: () => query };
  },
}));

it("shows members the account actions they can use", async () => {
  identity.configured.mockReturnValue(true);
  identity.member.mockResolvedValue({ id: "member", name: "Nadia", status: "active" });
  identity.roles.mockResolvedValue({ data: [] });

  const page = renderToStaticMarkup(await AccountPage());

  expect(page).toContain("Halo, Nadia");
  expect(page).toContain('href="/account/orders"');
  expect(page).toContain('href="/listings/new"');
  expect(page).not.toContain("persetujuan keanggotaan");
  expect(page).not.toContain('href="/account/listing-moderation"');
  identity.roles.mockResolvedValue({ data: [{ role: "finance_operation" }, { role: "platform_admin" }] });
  const staff = renderToStaticMarkup(await AccountPage());
  expect(staff).toContain('href="/account/listing-moderation"');
  expect(staff).toContain('href="/account/funding"');
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

it("offers a retry on the same order or chat when the service is unavailable", async () => {
  identity.configured.mockReturnValue(false);
  const id = "00000000-0000-4000-8000-000000000001";
  const order = renderToStaticMarkup(await OrderPage({ params: Promise.resolve({ id }) }));
  const chat = renderToStaticMarkup(await ChatPage({ params: Promise.resolve({ orderId: id }) }));

  expect(order).toContain("Pesanan belum dapat dimuat");
  expect(order).toContain(`href="/orders/${id}">Coba lagi</a>`);
  expect(chat).toContain("Pesan pesanan belum dapat dimuat");
  expect(chat).toContain(`href="/chat/${id}">Coba lagi</a>`);
  for (const page of [order, chat]) expect(page).toContain('href="/">Jelajahi titipan</a>');
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

it("introduces optional affiliation as a badge application", () => {
  const page = renderToStaticMarkup(<ConnectedAffiliation />);

  expect(page).toContain("Afiliasi opsional");
  expect(page).toContain("Ajukan lencana afiliasi untuk mengonfirmasi institusimu.");
});
