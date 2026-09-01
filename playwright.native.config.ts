import { defineConfig, devices } from "@playwright/test";

const remoteBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, "");

export default defineConfig({
  testDir: "./tests/native",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: remoteBaseUrl ?? "http://127.0.0.1:4173",
    channel: "chrome",
    launchOptions: {
      args: ["--enable-features=WebMCP"],
    },
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
      name: "native-webmcp-chrome",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1536, height: 1024 },
      },
    },
  ],
});
