/**
 * Playwright E2E config — per the e2e-testing skill (ECC):
 * - POM page objects in tests/e2e/pages/
 * - auto-wait locators only (NO arbitrary waitForTimeout)
 * - trace on first retry, screenshot on failure, video retained on failure
 * - webServer: the offline UI test server (dist/public + API stubs)
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { outputFolder: "playwright-report" }], ["list"]] : [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node scripts/ui-test-server.mjs",
    url: "http://localhost:4173/api/version",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
