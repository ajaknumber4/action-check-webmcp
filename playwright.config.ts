import { defineConfig, devices } from "@playwright/test";

const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: remoteBaseUrl ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: remoteBaseUrl ? undefined : [
    {
      command: "npm --prefix workers/refund-staging-target run dev",
      port: 8787,
      reuseExistingServer: true,
    },
    {
      command: "npm run preview -- --host 127.0.0.1",
      port: 4173,
      reuseExistingServer: true,
    },
  ],
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1536, height: 1024 } },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
