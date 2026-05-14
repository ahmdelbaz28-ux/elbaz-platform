import { Page, expect } from "@playwright/test";
import { acceptCookieConsent } from "../helpers/cookie-consent";

export class LoginPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate() {
    await this.page.goto("/login");
    await this.page.waitForLoadState("networkidle");
    await acceptCookieConsent(this.page);
  }

  async isVisible(): Promise<boolean> {
    await this.page.waitForLoadState("networkidle");
    // Login page uses username, not email
    const usernameInput = this.page.locator('#login-username, input[name="username"]').first();
    const passwordInput = this.page.locator('#login-password, input[name="password"], input[type="password"]').first();
    const submitButton = this.page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("تسجيل الدخول")').first();
    const usernameVisible = await usernameInput.isVisible().catch(() => false);
    const passwordVisible = await passwordInput.isVisible().catch(() => false);
    const submitVisible = await submitButton.isVisible().catch(() => false);
    return usernameVisible && passwordVisible && submitVisible;
  }

  async login(username: string, password: string) {
    await this.navigate();
    // Login uses username field, not email
    const usernameInput = this.page.locator('#login-username, input[name="username"]').first();
    const passwordInput = this.page.locator('#login-password, input[name="password"], input[type="password"]').first();
    const submitButton = this.page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("تسجيل الدخول")').first();

    await usernameInput.fill(username);
    await passwordInput.fill(password);
    await submitButton.click();
    await this.page.waitForURL("**/dashboard**", { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState("networkidle");
  }

  async loginWithInvalidCredentials() {
    await this.login("invaliduser", "wrongpassword123");
  }

  async getErrorMessage(): Promise<string> {
    const errorSelectors = [
      '[role="alert"]',
      '.alert-error',
      '.error-message',
      '.toast-error',
      '[data-testid="error-message"]',
      '.text-red-500',
      '.bg-red-100',
      '[class*="f43f5e"]',
    ];
    for (const selector of errorSelectors) {
      const element = this.page.locator(selector).first();
      if ((await element.isVisible().catch(() => false)) && (await element.textContent())) {
        return (await element.textContent())!.trim();
      }
    }
    const responseText = await this.page.locator("text=/invalid|incorrect|wrong|failed|error/i").first().textContent().catch(() => null);
    return responseText?.trim() ?? "";
  }

  async expectRedirectToDashboard() {
    await expect(this.page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  }

  /**
   * Navigate to register page from login page
   */
  async goToRegister() {
    const registerLink = this.page.locator('a[href="/register"], a:has-text("Register"), a:has-text("Sign up"), a:has-text("create"), a:has-text("إنشاء")').first();
    await registerLink.click({ force: true });
    await this.page.waitForLoadState("networkidle");
  }

  /**
   * Navigate to forgot password page from login page
   */
  async goToForgotPassword() {
    const forgotLink = this.page.locator('a[href="/forgot-password"], a:has-text("Forgot"), a:has-text("نسيت")').first();
    await forgotLink.click({ force: true });
    await this.page.waitForLoadState("networkidle");
  }
}
