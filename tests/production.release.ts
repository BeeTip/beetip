import { expect, test } from "@playwright/test";
import { createSeed } from "../packages/domain/src";

test("guest surfaces report missing identity configuration without falling back to demo data", async ({ page }) => {
  const savedDemo = JSON.stringify({ state: createSeed(), actorId: "admin1" });
  await page.addInitScript(value => {
    if (sessionStorage.getItem("release-demo-seeded")) return;
    localStorage.setItem("beetip-demo-v2", value);
    sessionStorage.setItem("release-demo-seeded", "true");
  }, savedDemo);

  for (const path of ["/", "/listings/11111111-1111-4111-8111-111111111111"]) {
    const [catalog, document] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/listings", { timeout: 10000 }),
      page.goto(path),
    ]);
    expect(document?.status(), path).toBe(200);
    expect(document?.headers()["cache-control"], path).toBe("private, no-store");
    expect(catalog.status()).toBe(503);
    expect(catalog.headers()["cache-control"]).toBe("private, no-store");
    expect(await catalog.json()).toEqual({ ok: false, code: "UNAVAILABLE", message: "Layanan belum tersedia. Coba lagi nanti." });
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Layanan belum tersedia");
    await expect(page.getByRole("link", { name: "Daftar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Administrasi" })).toHaveCount(0);
    await expect(page.getByText("Titip Chatime", { exact: true })).toHaveCount(0);
  }

  await page.goto("/listings/trip-aeon");
  await expect(page.getByRole("heading", { name: "Halaman tidak ditemukan" })).toBeVisible();

  for (const path of ["/login", "/login?form=signup", "/account", "/listings/new"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { name: "Layanan akun belum tersedia" })).toBeVisible();
    await expect(page.locator("main form")).toHaveCount(0);
    await expect(page.getByLabel("Akun aktif")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset data lokal" })).toHaveCount(0);
  }
  expect(await page.evaluate(() => localStorage.getItem("beetip-demo-v2"))).toBe(savedDemo);
});

test("demo routes and staff authority stay closed on the production server", async ({ request }) => {
  for (const path of ["/profile", "/admin", "/trips", "/trips/trip-aeon", "/orders"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(new URL(response.headers().location, response.url()).pathname, path).toBe("/account");
  }

  for (const [path, heading] of [["/orders/BTP-001", "Pesanan belum dapat dimuat"], ["/chat/BTP-001", "Pesan pesanan belum dapat dimuat"]]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["cache-control"], path).toBe("private, no-store");
    expect(await response.text(), path).toContain(heading);
  }

  const staff = await request.get("/api/identity/staff");
  const grant = await request.post("/api/identity/staff", {
    headers: { origin: new URL(staff.url()).origin },
    data: {
      operationId: "11111111-1111-4111-8111-111111111111",
      memberId: "22222222-2222-4222-8222-222222222222",
      role: "platform_admin",
      grant: true,
      reason: "owner_approved",
    },
  });
  for (const response of [staff, grant]) {
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  }
});
