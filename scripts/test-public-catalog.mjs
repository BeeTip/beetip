import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

const origin = process.env.BEETIP_TEST_URL ?? "http://127.0.0.1:3108";
const samples = process.argv.includes("--samples");
assert(origin === "https://beetip-campus.vercel.app" || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
const browser = await chromium.launch({ executablePath: process.env.BEETIP_BROWSER_EXECUTABLE });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await expect(page.getByRole("heading", { name: "Mau titip apa hari ini?" })).toBeVisible();
    if (samples) {
      await expect(page.locator(".listing-card")).toHaveCount(4);
      await expect(page.getByText("Jelajahi contoh titipan", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "Terapkan filter" })).toBeVisible();
      const response = await context.request.get(`${origin}/api/listings`);
      assert.equal(response.status(), 200);
      const data = await response.json();
      assert(data.ok && Array.isArray(data.listings));
      assert(data.listings.every(row => !("destination" in row) && !("owner_id" in row)));
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  if (samples) {
  await page.getByLabel("Cari listing").fill("kopi");
  await expect(page.locator(".listing-card")).toHaveCount(1);
  await page.getByLabel("Cari listing").fill("");
  await page.getByRole("button", { name: "Makanan", exact: true }).click();
  await expect(page.locator(".listing-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Semua", exact: true }).click();
  await page.getByRole("link", { name: "Lihat detail" }).first().click();
  await expect(page.getByRole("heading", { name: "Titip kopi untuk teman belajar" })).toBeVisible();
  await page.getByRole("link", { name: "Buat akun BeeTip", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Buat akun BeeTip" })).toBeVisible();
  } else {
    await page.getByLabel("Cari listing").fill("empty-search-" + crypto.randomUUID());
    await page.getByRole("button", { name: "Terapkan filter" }).click();
    await expect(page.getByRole("heading", { name: "Belum ada listing" })).toBeVisible();
  }
  await page.goto(`${origin}/listings/new`);
  await page.waitForURL("**/login?form=signup&next=%2Flistings%2Fnew");
  await expect(page.locator('input[name="next"]')).toHaveValue("/listings/new");
  assert.equal((await context.request.get(`${origin}/api/identity/support`)).status(), 401);
  assert.equal((await context.request.get(`${origin}/listings/unknown-sample`)).status(), 404);
  assert.equal((await context.request.get(`${origin}/drink.svg`)).status(), 200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin);
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/public-catalog-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "PASS", origin, catalog: samples ? "historical samples" : "connected listings", checks: ["public home", "search and empty states", "390/768/1440 widths", "signup only at account intent", "return destination preserved", "private API remains denied", "unknown IDs 404", "public images", "no client runtime errors"] }));
} finally { await browser.close(); }
