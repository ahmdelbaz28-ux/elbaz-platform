/**
 * E2E — Cookie consent banner (prod audit tour 2026-11-15):
 * The tour found Escape was DEAD (the backdrop button's onKeyDown required
 * focus nothing had) — root-cured with a window-level keydown listener.
 * This spec guards every dismissal path permanently:
 *   1. banner appears for a fresh visitor
 *   2. Accept all → dismissed + consent stored (all true)
 *   3. Essential only → dismissed + consent stored (analytics false)
 *   4. backdrop click → dismissed
 *   5. Escape key → dismissed (THE root cure — works without focus)
 *   6. consent persists: no banner again on next navigation
 */
import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForSelector("#main-content");
  // Banner entrance is deliberately delayed 800ms for a smooth fade-in.
  await page.waitForTimeout(1100);
}

test("fresh visitor sees the banner; Accept all dismisses and stores full consent", async ({ page }) => {
  await gotoHome(page);
  const banner = page.getByTestId("cookie-consent-banner");
  await expect(banner).toBeVisible();
  await page.getByTestId("cookie-accept-all").click();
  await expect(banner).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem("elbaz_cookie_consent"));
  expect(stored && JSON.parse(stored)).toEqual({ necessary: true, analytics: true, marketing: true });
});

test("Essential only dismisses and stores minimal consent", async ({ page }) => {
  await gotoHome(page);
  const banner = page.getByTestId("cookie-consent-banner");
  await expect(banner).toBeVisible();
  await page.getByTestId("cookie-accept-essential").click();
  await expect(banner).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem("elbaz_cookie_consent"));
  expect(stored && JSON.parse(stored)).toEqual({ necessary: true, analytics: false, marketing: false });
});

test("clicking the backdrop dismisses the banner", async ({ page }) => {
  await gotoHome(page);
  const banner = page.getByTestId("cookie-consent-banner");
  await expect(banner).toBeVisible();
  await page.getByTestId("cookie-consent-backdrop").click({ position: { x: 40, y: 40 } });
  await expect(banner).toHaveCount(0);
});

test("ROOT CURE: Escape dismisses the banner without any element being focused", async ({ page }) => {
  await gotoHome(page);
  const banner = page.getByTestId("cookie-consent-banner");
  await expect(banner).toBeVisible();
  // No click, no focus — the exact scenario the tour caught in production.
  await page.keyboard.press("Escape");
  await expect(banner).toHaveCount(0);
});

test("consent persists: the banner never reappears on the next navigation", async ({ page }) => {
  await gotoHome(page);
  await page.getByTestId("cookie-accept-essential").click();
  await expect(page.getByTestId("cookie-consent-banner")).toHaveCount(0);
  await page.goto("/courses");
  await page.waitForSelector("#main-content");
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("cookie-consent-banner")).toHaveCount(0);
});
