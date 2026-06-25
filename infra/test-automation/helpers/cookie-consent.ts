import { Page } from "@playwright/test";

/**
 * Dismisses the cookie consent banner if it is visible.
 * Uses data-testid attributes for reliable targeting.
 * Must be called in beforeEach hooks to prevent the banner
 * from intercepting clicks on other elements.
 */
export async function acceptCookieConsent(page: Page) {
  try {
    // First, try setting localStorage directly to skip the banner entirely
    await page.evaluate(() => {
      localStorage.setItem(
        "elbaz_cookie_consent",
        JSON.stringify({
          necessary: true,
          analytics: true,
          marketing: true,
        })
      );
    });
    // Reload to apply the consent
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
  } catch {
    // Fallback: click the accept button if localStorage approach fails
    const acceptBtn = page.locator('[data-testid="cookie-accept-all"]');
    if (await acceptBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await acceptBtn.click();
      await page.waitForTimeout(500);
    }
  }
}

/**
 * Checks if the cookie consent banner is currently visible.
 */
export async function isCookieBannerVisible(page: Page): Promise<boolean> {
  return page
    .locator('[data-testid="cookie-consent-banner"]')
    .isVisible({ timeout: 2000 })
    .catch(() => false);
}
