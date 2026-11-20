import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3108";

export default defineConfig({
  testDir: "./tests",
  testMatch: "production.release.ts",
  outputDir: "./test-results/production",
  use: { baseURL, trace: "retain-on-failure", launchOptions: { executablePath: process.env.BEETIP_BROWSER_EXECUTABLE } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @beetip/web exec next start --hostname 127.0.0.1 --port 3108",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      BEETIP_MODE: "connected",
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      APP_ORIGIN: "",
    },
  },
});
