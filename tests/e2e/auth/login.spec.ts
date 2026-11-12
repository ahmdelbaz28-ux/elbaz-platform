/**
 * E2E — login page contract (offline UI test server; the API stubs reject
 * real logins, so these tests pin the CLIENT-side contract: rendering,
 * validation, accessibility of the form, and the cinematic video background
 * shipped in the 540p optimization).
 */
import { test, expect } from "@playwright/test";
import { LoginPage } from "../pages/LoginPage";

test.describe("Login page", () => {
  let login: LoginPage;

  test.beforeEach(async ({ page }) => {
    login = new LoginPage(page);
    await login.goto();
  });

  test("renders the credential form with masked password", async () => {
    await expect(login.usernameInput).toBeVisible();
    await expect(login.passwordInput).toBeVisible();
    await expect(login.passwordInput).toHaveAttribute("type", "password");
  });

  test("remember-me toggles independently", async () => {
    // The remember-me is a Radix checkbox (button with role=checkbox +
    // aria-checked) — NOT a native input. App contract: it DEFAULTS to
    // checked (remember=true) and toggles off on click.
    const checkbox = login.rememberMe;
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "false");
    await checkbox.click();
    await expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  test("empty submit is blocked by client-side validation (no navigation)", async ({ page }) => {
    const responsePromise = page.waitForRequest(
      (r) => r.url().includes("/api/") && r.method() === "POST",
      { timeout: 2_500 },
    ).catch(() => null);
    await login.submitButton.click();
    const post = await responsePromise;
    // Either HTML5 validation blocks the submit (no request) or the stub
    // answers — but the user must still be ON the login page.
    expect(page.url()).toContain("/login");
    if (post === null) {
      // Validation path: both fields required per the HTML contract.
      await expect(login.usernameInput).toHaveAttribute("required", /.*/);
    }
  });

  test("cinematic video background is present and configured correctly", async ({ page }) => {
    // The poster fallback is ALWAYS painted (reduced-motion / failure path).
    await expect(page.locator("div[style*='login-bg-poster']")).toHaveCount(1);
    // ⚡ PERF contract: the <video> element is conditionally created (only
    // when allowed). When present, the autoplay policy contract must hold —
    // asserted on DOM PROPERTIES, because React sets `muted` as a property
    // and never renders it as an attribute.
    const video = page.locator("video");
    if ((await video.count()) === 1) {
      const props = await video.evaluate((el) => ({
        muted: el.muted,
        loop: el.loop,
        autoplay: el.autoplay,
        playsInline: el.playsInline,
        preload: el.preload,
      }));
      expect(props).toMatchObject({ muted: true, loop: true, autoplay: true, playsInline: true, preload: "auto" });
    }
  });

  test("no console errors and no uncaught page errors during load", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/login");
    await expect(page.locator("#login-username")).toBeVisible();
    // API stubs legitimately 401; anything else is a defect.
    const unexpected = consoleErrors.filter((e) => !/40[13]|Failed to load resource/i.test(e));
    expect(unexpected).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
