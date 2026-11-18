import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results/playwright",
  fullyParallel: true,
  workers: 3,
  timeout: 60000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://127.0.0.1:3107", trace: "retain-on-failure", launchOptions: { executablePath: process.env.BEETIP_BROWSER_EXECUTABLE } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    env: { BEETIP_MODE: "demo" },
    command: "pnpm --filter @beetip/web build && pnpm --filter @beetip/web start",
    url: "http://127.0.0.1:3107",
    reuseExistingServer: false,
    timeout: 180000,
  },
});
