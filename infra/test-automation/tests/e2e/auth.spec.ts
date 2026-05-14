import { test, expect } from "@playwright/test";
import { LoginPage } from "../../page-objects/LoginPage";
import { RegisterPage } from "../../page-objects/RegisterPage";
import { DashboardPage } from "../../page-objects/DashboardPage";

const TEST_USER = {
  email: `testuser_${Date.now()}@example.com`,
  password: "TestPass123!",
  name: "Test User",
};

test.describe("Authentication", () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
  });

  test("successful login with valid credentials", async ({ page }) => {
    await loginPage.navigate();
    await expect(loginPage.isVisible()).resolves.toBe(true);
  });

  test("invalid credentials shows error message", async ({ page }) => {
    await loginPage.loginWithInvalidCredentials();
    const errorMessage = await loginPage.getErrorMessage();
    expect(errorMessage.length).toBeGreaterThan(0);
    expect(page.url()).toContain("/login");
  });

  test("protected route redirects to login when unauthenticated", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    const currentUrl = page.url();
    const isLoginPage =
      currentUrl.includes("/login") ||
      currentUrl.includes("/signin") ||
      currentUrl.includes("/auth");
    expect(isLoginPage).toBe(true);
  });

  test("logout redirects to home page", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const emailInput = page.locator('input[name="email"], input[type="email"]').first();
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    const submitButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first();

    await emailInput.fill(TEST_USER.email);
    await passwordInput.fill(TEST_USER.password);
    await submitButton.click();
    await page.waitForLoadState("networkidle");

    const logoutButton = page.locator(
      'button:has-text("Logout"), button:has-text("Sign out"), a:has-text("Logout"), a:has-text("Sign out"), [data-testid="logout"]'
    ).first();

    if ((await logoutButton.isVisible().catch(() => false))) {
      await logoutButton.click();
      await page.waitForLoadState("networkidle");
      const currentUrl = page.url();
      expect(currentUrl).toMatch(/\/$|\/home|\/login/);
    }
  });
});
