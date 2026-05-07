import { Page, expect } from "@playwright/test";

export interface RegisterData {
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
  }

  async register(data: RegisterData) {
    await this.navigate();
    const nameInput = this.page.locator('input[name="name"], input[name="fullName"], input[placeholder*="name" i]').first();
    const emailInput = this.page.locator('input[name="email"], input[type="email"]').first();
    const passwordInput = this.page.locator('input[name="password"], input[type="password"]').first();
    const confirmPasswordInput = this.page.locator('input[name="confirmPassword"], input[name="password_confirmation"], input[placeholder*="confirm" i]').first();
    const submitButton = this.page.locator('button[type="submit"], button:has-text("Register"), button:has-text("Sign up"), button:has-text("Create")').first();

    await nameInput.fill(data.name);
    await emailInput.fill(data.email);
    await passwordInput.fill(data.password);
    await confirmPasswordInput.fill(data.confirmPassword);
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
    const nameInput = this.page.locator('input[name="name"], input[name="fullName"]').first();
    const emailInput = this.page.locator('input[name="email"], input[type="email"]').first();
    return (await nameInput.isVisible().catch(() => false)) && (await emailInput.isVisible().catch(() => false));
  }
}
