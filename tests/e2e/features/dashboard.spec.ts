/**
 * E2E — Student dashboard contract (offline UI test server).
 *
 * The student /dashboard page used to have ZERO test coverage. These tests
 * pin, against deterministic stubs shaped like the real tRPC procedures:
 *   • the 4 stat cards render the server numbers (courses / watch time /
 *     certificates / total spent)
 *   • "Total Spent" only counts COMPLETED payments (the failed row must not
 *     inflate the number — pre-launch-audit fix, kept locked by the stub)
 *   • My Courses grid: progress badges + the completed-course certificate CTA
 *   • Certificates panel + payments panel render their server rows
 *   • the empty dataset mode shows the honest empty states
 *   • routing guards: guest → /login, plain user on /admin → bounced home
 */
import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const AUTH_FLAG = { name: "elbaz_auth_flag", value: "1", url: "http://localhost:4173" };

async function acceptCookies(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "elbaz_cookie_consent",
        JSON.stringify({ necessary: true, analytics: false, marketing: false }),
      );
    } catch { /* storage unavailable — the banner is dismissible anyway */ }
  });
}

test.beforeEach(async ({ request }) => {
  await request.get("/api/__e2e/reset");
});

test("student: stat cards render the server numbers", async ({ page }) => {
  await acceptCookies(page);
  await page.context().addCookies([AUTH_FLAG]);
  await page.goto("/dashboard");

  // Enrolled courses (stub: 2) — rendered as the plain number on the card.
  await expect(page.getByText("Enrolled Courses")).toBeVisible();
  await expect(page.getByText("Total Watch Time")).toBeVisible();
  await expect(page.getByText("5h 22m")).toBeVisible(); // myWatchTime.formatted
  await expect(page.getByText("Total Spent")).toBeVisible();
  // completed 1500 EGP only — had the failed payment counted, the card
  // would read 2,000 EGP (substring-safe negative assertion).
  await expect(page.getByText("1,500 EGP")).toBeVisible();
  await expect(page.getByText("2,000 EGP")).toHaveCount(0);
});

test("student: My Courses grid shows progress + certificate CTA", async ({ page }) => {
  await acceptCookies(page);
  await page.context().addCookies([AUTH_FLAG]);
  await page.goto("/dashboard");

  // Both enrolled course titles render (English is the default UI language).
  await expect(page.getByText("ETAP Basics")).toBeVisible();
  await expect(page.getByText("Power Systems Analysis")).toBeVisible();
  // In-progress badge on the 45% course.
  await expect(page.getByText("45%")).toBeVisible();
  // The 100% course shows the "Get Certificate" action.
  await expect(page.getByText("Get Certificate")).toBeVisible();
});

test("student: certificates panel renders the server certificate", async ({ page }) => {
  await acceptCookies(page);
  await page.context().addCookies([AUTH_FLAG]);
  await page.goto("/dashboard");

  await expect(page.getByText("CERT-E2E-2026-001")).toBeVisible();
  await expect(page.getByText("Distinction")).toBeVisible();
});

test("student: payments panel lists purchases with method + amount", async ({ page }) => {
  await acceptCookies(page);
  await page.context().addCookies([AUTH_FLAG]);
  await page.goto("/dashboard");

  await expect(page.getByText("Recent Payments")).toBeVisible();
  await expect(page.getByText("Course Purchase")).toHaveCount(2);
  await expect(page.getByText("paymob_card")).toBeVisible();
  await expect(page.getByText("vodafone_cash")).toBeVisible();
});

test("student: empty dataset shows honest empty states", async ({ page, request }) => {
  await request.get("/api/__e2e/dashboard-mode?mode=empty");
  await acceptCookies(page);
  await page.context().addCookies([AUTH_FLAG]);
  await page.goto("/dashboard");

  // The empty-state CTA (the quick-links card at the bottom also says
  // "Explore Courses" — target the exact empty-state link).
  await expect(page.getByRole("link", { name: "Explore Courses", exact: true })).toBeVisible();
  await expect(page.getByText("ETAP Basics")).toHaveCount(0);
  await expect(page.getByText("No payments yet")).toBeVisible();
});

test("guest: /dashboard redirects to /login", async ({ page }) => {
  await acceptCookies(page);
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  expect(page.url()).toContain("/login");
});

test("plain user: /admin bounces home (client admin guard)", async ({ page }) => {
  await acceptCookies(page);
  // elbaz_auth_flag only — the stub answers role "user" by default.
  await page.context().addCookies([AUTH_FLAG]);
  await page.goto("/admin");
  await page.waitForURL((u) => !u.pathname.startsWith("/admin"), { timeout: 10_000 });
  expect(new URL(page.url()).pathname).toBe("/");
});
