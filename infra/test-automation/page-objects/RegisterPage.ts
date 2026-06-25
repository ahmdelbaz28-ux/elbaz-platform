import { Page, expect } from "@playwright/test";
import { acceptCookieConsent } from "../helpers/cookie-consent";

export interface RegisterData {
  username: string;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export class RegisterPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate() {
    await this.page.goto("/register");
    await this.page.waitForLoadState("networkidle");
    await acceptCookieConsent(this.page);
  }

  async register(data: Partial<RegisterData>) {
    await this.navigate();
    const usernameInput = this.page.locator('#register-username, input[name="username"]').first();
    const nameInput = this.page.locator('#register-name, input[name="name"]').first();
    const emailInput = this.page.locator('#register-email, input[name="email"], input[type="email"]').first();
    const passwordInput = this.page.locator('#register-password, input[name="password"], input[type="password"]').first();
    const confirmPasswordInput = this.page.locator('#register-confirm-password, input[name="confirmPassword"]').first();
    const submitButton = this.page.locator('button[type="submit"], button:has-text("Create"), button:has-text("Register"), button:has-text("Sign up"), button:has-text("إنشاء")').first();

    if (data.username) await usernameInput.fill(data.username);
    if (data.name) await nameInput.fill(data.name);
    if (data.email) await emailInput.fill(data.email);
    if (data.password) await passwordInput.fill(data.password);
    if (data.confirmPassword) await confirmPasswordInput.fill(data.confirmPassword);
    await submitButton.click();
    await this.page.waitForLoadState("networkidle");
  }

  async expectRedirectToLogin() {
    await expect(this.page).toHaveURL(/\/login/, { timeout: 15000 });
  }

  async getValidationErrors(): Promise<string[]> {
    const errors: string[] = [];
    const errorSelectors = [
      '[role="alert"]',
      '.error-message',
      '.field-error',
      '.text-red-500',
      '.text-red-600',
      '[data-testid="error"]',
      'p.text-sm.text-destructive',
      'span.text-destructive',
      '.invalid-feedback',
      '[class*="f43f5e"]',
    ];
    for (const selector of errorSelectors) {
      const elements = this.page.locator(selector);
      const count = await elements.count();
      for (let i = 0; i < count; i++) {
        const text = await elements.nth(i).textContent();
        if (text && text.trim()) {
          errors.push(text.trim());
        }
      }
    }
    return errors;
  }

  async isVisible(): Promise<boolean> {
    const usernameInput = this.page.locator('#register-username, input[name="username"]').first();
    const passwordInput = this.page.locator('#register-password, input[name="password"], input[type="password"]').first();
    return (await usernameInput.isVisible().catch(() => false)) && (await passwordInput.isVisible().catch(() => false));
  }

  /**
   * Check if confirm password has show/hide toggle
   */
  async hasConfirmPasswordToggle(): Promise<boolean> {
    const container = this.page.locator('#register-confirm-password').first();
    const parent = container.locator('..');
    const toggleBtn = parent.locator('button[type="button"]');
    return toggleBtn.count().then((c) => c > 0);
  }

  /**
   * Navigate to login page from register page
   */
  async goToLogin() {
    const loginLink = this.page.locator('a[href="/login"], a:has-text("Login"), a:has-text("Sign in"), a:has-text("تسجيل الدخول")').first();
    await loginLink.click({ force: true });
    await this.page.waitForLoadState("networkidle");
  }
}
