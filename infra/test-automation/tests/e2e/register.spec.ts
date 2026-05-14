import { test, expect } from "@playwright/test";
import { RegisterPage } from "../../page-objects/RegisterPage";
import type { RegisterData } from "../../page-objects/RegisterPage";

test.describe("Registration", () => {
  let registerPage: RegisterPage;

  test.beforeEach(async ({ page }) => {
    registerPage = new RegisterPage(page);
  });

  test("form validation shows errors for empty fields", async ({ page }) => {
    await registerPage.navigate();
    const submitButton = page.locator('button[type="submit"], button:has-text("Register"), button:has-text("Sign up")').first();
    await submitButton.click();
    await page.waitForLoadState("networkidle");

    const errors = await registerPage.getValidationErrors();
    expect(errors.length).toBeGreaterThan(0);
  });

  test("form validation shows error for weak password", async ({ page }) => {
    const weakData: RegisterData = {
      name: "Test User",
      email: `weakpass_${Date.now()}@example.com`,
      password: "123",
      confirmPassword: "123",
    };
    await registerPage.register(weakData);

    const errors = await registerPage.getValidationErrors();
    const hasPasswordError = errors.some(
      (e) => e.toLowerCase().includes("password") || e.toLowerCase().includes("short") || e.toLowerCase().includes("weak")
    );
    const isStillOnRegister = page.url().includes("/register");
    expect(hasPasswordError || isStillOnRegister).toBe(true);
  });

  test("form validation shows error for invalid email format", async ({ page }) => {
    const invalidEmailData: RegisterData = {
      name: "Test User",
      email: "notanemail",
      password: "ValidPass123!",
      confirmPassword: "ValidPass123!",
    };
    await registerPage.register(invalidEmailData);

    const errors = await registerPage.getValidationErrors();
    const hasEmailError = errors.some(
      (e) => e.toLowerCase().includes("email") || e.toLowerCase().includes("valid") || e.toLowerCase().includes("format")
    );
    const isStillOnRegister = page.url().includes("/register");
    expect(hasEmailError || isStillOnRegister).toBe(true);
  });

  test("form validation shows error for password confirmation mismatch", async ({ page }) => {
    const mismatchData: RegisterData = {
      name: "Test User",
      email: `mismatch_${Date.now()}@example.com`,
      password: "ValidPass123!",
      confirmPassword: "DifferentPass456!",
    };
    await registerPage.register(mismatchData);

    const errors = await registerPage.getValidationErrors();
    const hasMismatchError = errors.some(
      (e) => e.toLowerCase().includes("match") || e.toLowerCase().includes("confirm") || e.toLowerCase().includes("same")
    );
    const isStillOnRegister = page.url().includes("/register");
    expect(hasMismatchError || isStillOnRegister).toBe(true);
  });

  test("successful registration with valid data", async ({ page }) => {
    const validData: RegisterData = {
      name: "Valid Test User",
      email: `valid_${Date.now()}@example.com`,
      password: "StrongPass123!",
      confirmPassword: "StrongPass123!",
    };
    await registerPage.register(validData);

    const redirectedToLogin = page.url().includes("/login") || page.url().includes("/dashboard");
    expect(redirectedToLogin).toBe(true);
  });

  test("duplicate email detection shows error", async ({ page }) => {
    const duplicateEmail = `duplicate_${Date.now()}@example.com`;
    const firstData: RegisterData = {
      name: "First User",
      email: duplicateEmail,
      password: "StrongPass123!",
      confirmPassword: "StrongPass123!",
    };
    await registerPage.register(firstData);

    registerPage = new RegisterPage(page);
    const secondData: RegisterData = {
      name: "Second User",
      email: duplicateEmail,
      password: "StrongPass456!",
      confirmPassword: "StrongPass456!",
    };
    await registerPage.register(secondData);

    const errors = await registerPage.getValidationErrors();
    const hasDuplicateError = errors.some(
      (e) =>
        e.toLowerCase().includes("exists") ||
        e.toLowerCase().includes("already") ||
        e.toLowerCase().includes("taken") ||
        e.toLowerCase().includes("registered")
    );
    const isStillOnRegister = page.url().includes("/register");
    expect(hasDuplicateError || isStillOnRegister).toBe(true);
  });
});
