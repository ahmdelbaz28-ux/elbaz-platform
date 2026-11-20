/**
 * E2E — Admin dashboard contract (offline UI test server).
 *
 * /admin had ZERO test coverage. These tests pin, against deterministic
 * stubs shaped like the real tRPC procedures:
 *   • the guard chain: guest → /login, and only the admin identity passes
 *     ProtectedRoute(requireAdmin)
 *   • the Overview tab renders the server stat numbers + sidebar navigation
 *   • the Users tab renders the paginated users list
 *   • the Notifications composer — THE ROOT FIX: the type the admin picks
 *     ("System Notice") is what actually reaches the wire (the old code
 *     hardcoded "promo" and silently ignored the choice), the optional
 *     link is forwarded, and success is only claimed after the server
 *     confirms. The History tab then shows the SERVER-backed log.
 *   • the Audit tab renders the trail rows
 */
import { test, expect } from "@playwright/test";

const ADMIN_COOKIES = [
  { name: "elbaz_auth_flag", value: "1", url: "http://localhost:4173" },
  { name: "elbaz_e2e_role", value: "admin", url: "http://localhost:4173" },
];

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

test("guest: /admin redirects to /login", async ({ page }) => {
  await acceptCookies(page);
  await page.goto("/admin");
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  expect(page.url()).toContain("/login");
});

test("admin: overview renders server stats + grouped sidebar", async ({ page }) => {
  await acceptCookies(page);
  await page.context().addCookies(ADMIN_COOKIES);
  await page.goto("/admin");

  // Sidebar groups exist and the admin identity was accepted (no bounce).
  await expect(page.getByText("لوحة التحكم").or(page.getByText("Dashboard")).first()).toBeVisible();

  // Revenue card is locale-independent ("45,750 EGP" from admin.stats).
  await expect(page.getByText("45,750 EGP")).toBeVisible();
  // Newest-users list is fed by admin.users.
  await expect(page.getByText("محمد أحمد").first()).toBeVisible();
});

test("admin: users tab renders the users list", async ({ page }) => {
  await acceptCookies(page);
  await page.context().addCookies(ADMIN_COOKIES);
  await page.goto("/admin");

  await page.getByText("Users", { exact: true }).or(page.getByText("المستخدمين", { exact: true })).first().click();
  await expect(page.getByText("mohamed")).toBeVisible();
  await expect(page.getByText("sara")).toBeVisible();
  await expect(page.getByText("mohamed@test.local")).toBeVisible();
});

test("admin: notifications composer forwards the REAL type + link (root fix)", async ({ page, request }) => {
  await acceptCookies(page);
  await page.context().addCookies(ADMIN_COOKIES);
  await page.goto("/admin");

  // Open the Notifications tab.
  await page.getByText("Notifications", { exact: true }).or(page.getByText("الإشعارات", { exact: true })).first().click();
  await expect(page.getByText("Notification Type").or(page.getByText("نوع الإشعار")).first()).toBeVisible();

  // The composer must speak the SERVER's vocabulary — 6 server types, and
  // the old phantom types (enrollment/update/custom) are gone.
  await expect(page.locator("[data-testid='notif-type-promo']")).toBeVisible();
  await expect(page.locator("[data-testid='notif-type-system']")).toBeVisible();
  await expect(page.locator("[data-testid='notif-type-lesson']")).toBeVisible();
  await expect(page.locator("[data-testid='notif-type-file']")).toBeVisible();
  await expect(page.locator("[data-testid='notif-type-software']")).toBeVisible();
  await expect(page.locator("[data-testid='notif-type-youtube']")).toBeVisible();

  // Pick "System Notice" — the ROOT FIX pins that this choice reaches the wire.
  await page.locator("[data-testid='notif-type-system']").click();

  // Bilingual fields are required by the form (server also validates length).
  await page.getByPlaceholder("Enter title in English...").fill("System Maintenance");
  await page.getByPlaceholder("أدخل العنوان بالعربية...").fill("صيانة النظام");
  await page.getByPlaceholder("Write the message in English...").fill("We will run maintenance tonight at 2 AM.");
  await page.getByPlaceholder("اكتب الرسالة بالعربية...").fill("سنجري صيانة الليلة في الثانية فجرا.");
  await page.getByPlaceholder("/courses/etap or https://...").fill("/courses/etap-basics");

  await page.locator("[data-testid='notif-send']").click();

  // Success is only claimed AFTER the server confirms (awaited onSend).
  await expect(
    page.getByText("Notification sent successfully!").or(page.getByText("تم إرسال الإشعار بنجاح!")).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Wire contract: the stub recorded EXACTLY what was posted — the picked
  // type ("system", NOT the old hardcoded "promo") and the click-through
  // link. Server contract: `title`/`message` carry the Arabic-first copy,
  // `titleEn`/`messageEn` the English fallback.
  const state = await (await request.get("/api/__e2e/trpc-state")).json();
  expect(state.broadcastCount).toBe(1);
  expect(state.lastBroadcast).toMatchObject({
    type: "system",
    title: "صيانة النظام", // Arabic-first primary display (Admin.tsx contract)
    message: "سنجري صيانة الليلة في الثانية فجرا.",
    url: "/courses/etap-basics",
    titleEn: "System Maintenance",
    messageEn: "We will run maintenance tonight at 2 AM.",
  });
});

test("admin: notifications History tab reads SERVER truth", async ({ page }) => {
  await acceptCookies(page);
  await page.context().addCookies(ADMIN_COOKIES);
  await page.goto("/admin");

  await page.getByText("Notifications", { exact: true }).or(page.getByText("الإشعارات", { exact: true })).first().click();
  await page.getByText("History").or(page.getByText("السجل")).first().click();

  // Server-backed rows from admin.broadcastHistory (stub seed).
  await expect(page.getByText("20% off ETAP course")).toBeVisible();
  await expect(page.getByText("/courses/etap-basics")).toBeVisible();
});

test("admin: audit tab renders the trail", async ({ page }) => {
  await acceptCookies(page);
  await page.context().addCookies(ADMIN_COOKIES);
  await page.goto("/admin");

  await page.getByText("Audit Log", { exact: true }).or(page.getByText("سجل العمليات", { exact: true })).first().click();
  await expect(page.getByText("admin.sendBroadcast").first()).toBeVisible();
});
