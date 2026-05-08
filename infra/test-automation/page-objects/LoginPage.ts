import { Page, expect } from "@playwright/test";

export class LoginPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate() {
    await this.page.goto("/login");
    await this.page.waitForLoadState("networkidle");
  }

  async isVisible(): Promise<boolean> {
    await this.page.waitForLoadState("networkidle");
    const emailInput = this.page.locator('input[name="email"], input[type="email"]').first();
    const passwordInput = this.page.locator('input[name="password"], input[type="password"]').first();
    const submitButton = this.page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first();
    const emailVisible = await emailInput.isVisible().catch(() => false);
    const passwordVisible = await passwordInput.isVisible().catch(() => false);
    const submitVisible = await submitButton.isVisible().catch(() => false);
    return emailVisible && passwordVisible && submitVisible;
  }

  async login(email: string, password: string) {
    await this.navigate();
    const emailInput = this.page.locator('input[name="email"], input[type="email"]').first();
    const passwordInput = this.page.locator('input[name="password"], input[type="password"]').first();
    const submitButton = this.page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first();

    await emailInput.fill(email);
    await passwordInput.fill(password);
    await submitButton.click();
    await this.page.waitForURL("**/dashboard**", { timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState("networkidle");
  }

  async loginWithInvalidCredentials() {
    await this.login("invalid@test.com", "wrongpassword123");
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
}
