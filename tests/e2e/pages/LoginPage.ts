/**
 * Page Object Model — Login page (per the e2e-testing skill).
 * Locators are user-visible roles/ids, auto-waited by Playwright.
 */
import { type Page, type Locator, expect } from "@playwright/test";

export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly rememberMe: Locator;
  readonly totpInput: Locator;
  readonly videoBackground: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.locator("#login-username");
    this.passwordInput = page.locator("#login-password");
    this.submitButton = page.getByRole("button", { name: /login|دخول|تسجيل/i }).first();
    this.rememberMe = page.locator("#remember-me");
    this.totpInput = page.locator("#login-totp");
    this.videoBackground = page.locator("video");
  }

  async goto() {
    await this.page.goto("/login");
    // The login form is the page's contract — wait for it, not for a timer.
    await expect(this.usernameInput).toBeVisible();
  }

  async fillCredentials(username: string, password: string) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
  }
}
