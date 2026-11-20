import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function persona(page: Page, id: string) { await page.goto("/profile"); await page.getByLabel("Akun aktif").selectOption(id); }
test("version one storage migrates without replacing agreed terms or funding", async ({ page }) => {
  await persona(page, "customer");
  const legacy = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem("beetip-demo-v2")!);
    data.state.version = 1; delete data.state.support;
    data.state.orders[0].terms.window = "14.30 - 15.00 WIB";
    delete data.state.listings[0].schedule;
    localStorage.setItem("beetip-demo-v1", JSON.stringify(data)); localStorage.removeItem("beetip-demo-v2");
    return data.state.orders[0];
  });
  await page.goto("/orders/BTP-001"); await page.reload();
  await expect(page.getByText("14.30 - 15.00 WIB", { exact: true })).toBeVisible();
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("beetip-demo-v2")!));
  expect(migrated.state.version).toBe(2); expect(migrated.state.orders[0]).toEqual(legacy);
});
test("multi-item creation, fixed acceptance, role dashboard and persisted support", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/");
  await page.locator(".create-fab").click(); await page.getByRole("button", { name: "Minta dibelikan", exact: false }).click();
  await page.getByLabel("Judul listing").fill("Kopi dan roti untuk kelas"); await page.getByLabel("Toko / lokasi belanja").fill("Kafe kampus");
  await expect(page.getByLabel("Nama barang 1")).toHaveAttribute("placeholder", "Contoh: Nasi ayam");
  await page.getByLabel("Nama barang 1").fill("Kopi"); await page.getByLabel("Jumlah barang 1").fill("2"); await page.getByLabel("Maksimal harga per barang 1").fill("20000");
  await page.getByRole("button", { name: "Tambah barang" }).click(); await page.getByLabel("Nama barang 2").fill("Roti");
  await expect(page.getByText("Maksimal total belanja:", { exact: false })).toContainText("50.000");
  await page.reload(); await page.getByRole("button", { name: "Minta dibelikan", exact: false }).click(); await expect(page.getByLabel("Nama barang 2")).toHaveValue("Roti");
  await page.getByRole("button", { name: "Lanjut", exact: true }).click(); await page.getByLabel("Alamat tujuan").fill("Meja resepsionis gedung A");
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(); expect(audit.violations).toEqual([]);
  await page.getByRole("button", { name: "Lanjut", exact: true }).click(); await expect(page.getByRole("checkbox", { name: /nego/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Terbitkan listing" }).click(); await expect(page).toHaveURL(/\/listings\/demo-/); const listing = page.url();
  await persona(page, "provider"); await page.goto(listing); await expect(page.getByText("Meja resepsionis gedung A", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Saya bisa belikan", exact: true }).click(); await page.getByRole("button", { name: "Setujui dan ambil titipan", exact: true }).click();
  await expect(page).toHaveURL(/\/orders\/demo-/); const order = page.url(); await expect(page.getByText("Meja resepsionis gedung A", { exact: true })).toBeVisible();
  await page.goto("/trips"); await expect(page.locator(".order-card").filter({ hasText: "Kopi dan roti untuk kelas" })).toBeVisible();
  await page.goto(order); await page.getByRole("link", { name: "Hubungi bantuan" }).click();
  await expect(page.getByText("Percakapan demo tersimpan di perangkat ini.", { exact: true })).toBeVisible();
  await page.getByLabel("Pesan bantuan").fill("Tolong periksa lokasi serah terima"); await page.getByRole("button", { name: "Kirim ke bantuan" }).click();
  await page.reload(); await expect(page.getByText("Tolong periksa lokasi serah terima", { exact: true })).toBeVisible();
  await persona(page, "customer2"); await page.goto("/support"); await expect(page.getByText("Tolong periksa lokasi serah terima", { exact: true })).toHaveCount(0);
  await persona(page, "admin1"); await page.goto("/admin"); await page.getByLabel("Balasan bantuan").fill("Lokasi telah diperiksa"); await page.getByRole("button", { name: "Kirim balasan" }).click();
  await persona(page, "provider"); await page.goto("/support"); await expect(page.getByText("Lokasi telah diperiksa", { exact: true })).toBeVisible();
});
test("administrator pauses and restores a listing without changing existing orders", async ({ page }) => {
  await persona(page, "admin1"); await page.goto("/admin"); await page.getByLabel("Cari listing untuk dikelola").fill("roti");
  await page.getByText("Tolong belikan roti · Tersedia", { exact: true }).click(); await page.getByLabel("Alasan tindakan").fill("Periksa toko"); await page.getByRole("button", { name: "Simpan status listing" }).click();
  await persona(page, "provider"); await page.goto("/listings/request-fixed"); await expect(page.getByRole("button", { name: "Saya bisa belikan", exact: true })).toBeDisabled();
  await page.goto("/orders/BTP-002"); await expect(page.getByRole("button", { name: "Mulai pembelian" })).toBeEnabled();
  await persona(page, "admin1"); await page.goto("/admin"); await page.getByLabel("Cari listing untuk dikelola").fill("roti"); await page.getByText("Tolong belikan roti · Dijeda administrator", { exact: true }).click();
  await page.getByLabel("Tindakan listing").selectOption("active"); await page.getByLabel("Alasan tindakan").fill("Toko tersedia"); await page.getByRole("button", { name: "Simpan status listing" }).click();
  await persona(page, "provider"); await page.goto("/listings/request-fixed"); await expect(page.getByRole("button", { name: "Saya bisa belikan", exact: true })).toBeEnabled();
});
