import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function persona(page: Page, id: string) {
  await page.goto("/profile");
  await page.getByLabel("Persona demo").selectOption(id);
}

test("handover and second-admin refund reconcile the PRD example", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/orders/BTP-001");
  await page.getByLabel("Saya sudah memeriksa barang").check();
  await page.getByRole("button", { name: "Tampilkan kode serah terima" }).click();
  const code = await page.getByTestId("confirmation-code").textContent();
  await persona(page, "provider");
  await page.goto("/orders/BTP-001");
  await expect(page.getByTestId("confirmation-code")).toHaveCount(0);
  await page.getByLabel("Kode serah terima").fill(code!);
  await page.getByRole("button", { name: "Konfirmasi penerimaan" }).click();
  await expect(page.getByRole("heading", { name: "Penerimaan dikonfirmasi" })).toBeVisible();
  await persona(page, "admin1"); await page.goto("/orders/BTP-001");
  await page.getByRole("button", { name: "Siapkan payout simulasi" }).click();
  await page.getByRole("button", { name: "Hasil ambigu" }).click();
  await expect(page.getByText("Hasil ambigu, perlu rekonsiliasi", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Rekonsiliasi: terkirim" }).click();
  await page.getByRole("button", { name: "Ajukan refund simulasi" }).click();
  await page.getByRole("button", { name: "Tinjau dengan admin lain" }).click();
  await expect(page.getByRole("status")).toContainText("Administrator lain");
  await persona(page, "admin2"); await page.goto("/orders/BTP-001");
  await page.getByRole("button", { name: "Tinjau dengan admin lain" }).click();
  await page.getByRole("button", { name: "Catat transfer selesai" }).click();
  await expect(page.getByText("Dana direkonsiliasi · demo", { exact: true })).toBeVisible();
  await expect(page.locator(".amount-row").filter({ hasText: "Payout selesai" })).toContainText("65.000");
  await expect(page.locator(".amount-row").filter({ hasText: "Refund selesai" })).toContainText("5.000");
  await persona(page, "customer"); await page.goto("/orders/BTP-001");
  await page.getByLabel("Feedback pilot fiktif").fill("Titipan mudah dipantau (demo).");
  await page.getByRole("button", { name: "Kirim rating & feedback" }).click();
  await expect(page.getByRole("heading", { name: "Bagaimana pengalamanmu?" })).toHaveCount(0);
});

test("customer request completes from offer to settlement", async ({ page }) => {
  await persona(page, "provider"); await page.goto("/listings/request-coffee");
  await page.getByRole("button", { name: "Kirim / revisi penawaran" }).click();
  await persona(page, "customer"); await page.goto("/listings/request-coffee");
  await page.getByRole("button", { name: "Terima penawaran" }).click();
  await expect(page).toHaveURL(/\/orders\/demo-/);
  const url = page.url();
  await page.getByRole("button", { name: "Catat pembayaran simulasi" }).click();
  await persona(page, "admin1"); await page.goto(url);
  await page.getByRole("button", { name: "Verifikasi dana simulasi" }).click();
  await persona(page, "provider"); await page.goto(url);
  await page.getByRole("button", { name: "Mulai pembelian" }).click();
  await page.getByRole("button", { name: "Simpan alokasi struk" }).click();
  await page.getByRole("button", { name: "Mulai pengantaran" }).click();
  await persona(page, "customer"); await page.goto(url);
  await page.getByLabel("Saya sudah memeriksa barang").check();
  await page.getByRole("button", { name: "Tampilkan kode serah terima" }).click();
  const code = await page.getByTestId("confirmation-code").textContent();
  await persona(page, "provider"); await page.goto(url);
  await page.getByLabel("Kode serah terima").fill(code!);
  await page.getByRole("button", { name: "Konfirmasi penerimaan" }).click();
  await expect(page.getByRole("heading", { name: "Penerimaan dikonfirmasi" })).toBeVisible();
  await persona(page, "admin1"); await page.goto(url);
  await page.getByRole("button", { name: "Siapkan payout simulasi" }).click();
  await page.getByRole("button", { name: "Catat transfer selesai" }).click();
  await expect(page.getByText("Dana direkonsiliasi · demo", { exact: true })).toBeVisible();
});

test("provider trip accepts three customers independently", async ({ page }) => {
  await persona(page, "provider"); await page.goto("/listings/new");
  await page.getByRole("combobox", { name: "Jenis listing", exact: true }).selectOption("trip");
  await page.getByLabel("Judul listing").fill("Trip belanja sore demo");
  await page.getByLabel("Toko / lokasi belanja").fill("AEON demo");
  await page.getByLabel("Contoh item / kategori tersedia").fill("Teh susu");
  await page.getByLabel("Ongkos minimal (Rp)").fill("7000");
  await page.getByRole("button", { name: "Terbitkan listing demo" }).click();
  await expect(page).toHaveURL(/\/listings\/demo-/);
  const listingURL = page.url(); const orders: string[] = [];
  for (const customer of ["customer", "customer2", "customer3"]) {
    await persona(page, customer); await page.goto(listingURL);
    await page.getByRole("button", { name: "Kirim / revisi penawaran" }).click();
    await persona(page, "provider"); await page.goto(listingURL);
    await page.getByRole("button", { name: "Terima penawaran" }).click();
    await expect(page).toHaveURL(/\/orders\/demo-/); orders.push(page.url());
  }
  await page.goto("/trips");
  await page.getByRole("link", { name: "Buka dashboard trip" }).last().click();
  await expect(page.locator(".order-card")).toHaveCount(3);
  await persona(page, "customer2"); await page.goto(orders[1]);
  await page.getByText("Pembatalan dan masalah pesanan", { exact: true }).click();
  await page.getByLabel("Masalah / alasan sengketa").fill("Masalah pada pesanan kedua");
  await page.getByRole("button", { name: "Buka sengketa" }).click();
  await persona(page, "customer"); await page.goto(orders[0]);
  await expect(page.getByText("Sengketa aktif", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Catat pembayaran simulasi" }).click();
  await expect(page.getByText("Menunggu verifikasi", { exact: true })).toBeVisible();
});

test("private routes, unverified persona, chat persistence and reset", async ({ page }) => {
  await page.goto("/chat/BTP-001");
  await page.getByLabel("Pesan demo").fill("Pesan sintetis untuk tes");
  await page.getByRole("button", { name: "Kirim pesan demo" }).click();
  await page.reload(); await expect(page.locator(".chat-message").filter({ hasText: "Pesan sintetis untuk tes" })).toBeVisible();
  await persona(page, "customer2"); await page.goto("/orders/BTP-001");
  await expect(page.getByRole("heading", { name: "Pesanan tidak tersedia" })).toBeVisible();
  await persona(page, "unverified"); await page.goto("/listings/new");
  await expect(page.getByRole("heading", { name: "Verifikasi diperlukan" })).toBeVisible();
  await page.goto("/profile"); await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await page.getByRole("button", { name: "Ya, reset demo" }).click();
  await page.goto("/chat/BTP-001"); await expect(page.locator(".chat-message").filter({ hasText: "Pesan sintetis untuk tes" })).toHaveCount(0);
});

test("corrupt storage requires reset and disabled storage remains usable", async ({ page }) => {
  await page.goto("/"); await page.evaluate(() => localStorage.setItem("beetip-demo-v1", "broken")); await page.reload();
  await expect(page.locator(".storage-warning")).toContainText("rusak");
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(page.locator(".storage-warning")).toHaveCount(0);
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("Unavailable", "SecurityError"); }; });
  await page.reload(); await persona(page, "provider");
  await expect(page.locator(".storage-warning")).toContainText("Penyimpanan browser tidak tersedia");
  await expect(page.getByRole("heading", { name: "Rizky Pratama" })).toBeVisible();
});

for (const width of [360, 390, 768, 1440]) {
  test(`layout, keyboard and reduced motion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of ["/", "/orders/BTP-001", "/listings/new", "/profile"]) {
      await page.goto(route); await expect(page.locator("h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await persona(page, "admin1"); await page.goto("/admin");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto("/"); await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Lewati ke konten" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeInViewport();
    expect(await page.locator(".button").first().evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
  });
}

for (const width of [390, 1440]) {
  test(`accessible member and administration screens at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const route of ["/", "/orders/BTP-001", "/listings/new", "/profile"]) {
      await page.goto(route); await expect(page.locator("h1")).toBeVisible();
      const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(audit.violations).toEqual([]);
    }
    await persona(page, "admin1"); await page.goto("/admin");
    const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(audit.violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}
