import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 2,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["json", { outputFile: "test-results.json" }]],
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  globalSetup: require.resolve("./tests/setup/global-setup"),
  use: {
    baseURL: process.env.TEST_BASE_URL || "https://ahmedelbaz.qzz.io",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15000,
    navigationTimeout: 20000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /.*\.spec\.ts$/,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
      testMatch: /.*\.spec\.ts$/,
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      testMatch: /.*\.spec\.ts$/,
    },
    {
      name: "API",
      testMatch: /.*-api\.spec\.ts$/,
      use: {
        baseURL: process.env.TEST_BASE_URL || "https://ahmedelbaz.qzz.io",
        extraHTTPHeaders: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    },
  ],
  webServer: {
    command: "npm run start -- --port 3000",
    url: process.env.TEST_BASE_URL || "https://ahmedelbaz.qzz.io",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  outputDir: "./test-results",
});
