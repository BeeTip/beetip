import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import AccountPage from "./page";
import OrdersPage from "./orders/page";
import LoginPage from "../login/page";
import OrderPage from "../orders/[id]/page";
import ChatPage from "../chat/[orderId]/page";
import { ConnectedAffiliation } from "../../components/connected-affiliation";

const identity = vi.hoisted(() => ({ configured: vi.fn(), member: vi.fn(), rpc: vi.fn() }));
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
    return { from: () => query, rpc: identity.rpc };
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

it("offers a retry and a link to browse when the order list is unavailable", async () => {
  identity.configured.mockReturnValue(false);
  const page = renderToStaticMarkup(await OrdersPage({ searchParams: Promise.resolve({}) }));

  expect(page).toContain("Pesanan belum dapat dimuat");
  expect(page).toContain('href="/account/orders">Coba lagi</a>');
  expect(page).toContain('href="/">Jelajahi titipan</a>');
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

it("keeps the order history page when retrying a failed load", async () => {
  identity.configured.mockReturnValue(true);
  identity.member.mockResolvedValue({ id: "member", status: "active" });
  identity.rpc.mockResolvedValue({ error: { message: "connection lost" } });
  const before = "2026-11-20T12:00:00+07:00";
  const beforeId = "00000000-0000-4000-8000-000000000001";
  const page = renderToStaticMarkup(await OrdersPage({ searchParams: Promise.resolve({ before, beforeId }) }));

  expect(page).toContain(`href="/account/orders?before=${encodeURIComponent(before)}&amp;beforeId=${beforeId}">Coba lagi</a>`);
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

it("returns signed-out visitors to their order history after authentication", async () => {
  identity.configured.mockReturnValue(true);
  identity.member.mockResolvedValue(null);
  const orders = "/account/orders";
  const destination = encodeURIComponent(orders);

  await expect(OrdersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(`/login?next=${destination}`);
  const login = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ next: orders }) }));
  expect(login).toContain(`href="/login?form=signup&amp;next=${destination}"`);
});

it("introduces optional affiliation as a badge application", () => {
  const page = renderToStaticMarkup(<ConnectedAffiliation />);

  expect(page).toContain("Afiliasi opsional");
  expect(page).toContain("Ajukan lencana afiliasi untuk mengonfirmasi institusimu.");
});
