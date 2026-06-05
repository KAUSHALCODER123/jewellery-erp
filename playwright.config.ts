import { defineConfig, devices } from "@playwright/test";
process.env.NODE_ENV = "test";

export default defineConfig({
  globalSetup: "./tests/global-setup.ts",
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // run sequentially to avoid SQLite locks
  reporter: "line",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npx tsx src/server.ts",
      port: 4000,
      env: {
        NODE_ENV: "test",
        PLAYWRIGHT: "true",
      },
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npx vite --host 127.0.0.1 --port 5173",
      port: 5173,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
