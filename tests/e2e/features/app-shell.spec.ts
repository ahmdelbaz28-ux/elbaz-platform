/**
 * E2E — SPA shell contract (offline UI test server): the app boots, the
 * router renders, and the critical security headers shipped by index.html
 * (CSP nonce policy is server-side; here we pin the client boot contract).
 */
import { test, expect } from "@playwright/test";

test.describe("App shell", () => {
  test("boots on / and renders the routed page", async ({ page }) => {
    await page.goto("/");
    // The SPA must mount *something* routed — never a blank document.
    await expect(page.locator("body")).not.toHaveText("");
    await expect(page).toHaveTitle(/.+/);
  });

  test("SPA fallback serves the app for deep routes (no 404 document)", async ({ page }) => {
    // A deep route must return the SPA document (client router owns the path).
    const response = await page.goto("/courses/some-slug/deep/route");
    expect(response?.status()).toBe(200);
    await expect(page.locator("body")).not.toHaveText("");
  });

  test("stubbed /api/version answers (UI server contract)", async ({ request }) => {
    const res = await request.get("/api/version");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toBeDefined();
  });
});
