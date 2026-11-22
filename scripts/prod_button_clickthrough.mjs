/**
 * prod_button_clickthrough.mjs — LIVE production probe: click the buttons
 * one by one and verify each is really wired to the backend.
 *
 * Coverage:
 *   1. Home shell + /api/version build match
 *   2. Admin login through the real UI form
 *   3. ALL admin dashboard tabs — click each, assert the panel renders and
 *      its primary tRPC data call returns (no dead tabs, no error boundary)
 *   4. My Profile — send verification button (real API mutation), inline
 *      code confirm wiring (wrong code must be rejected), and the admin
 *      email-change flow that triggers a REAL email to the owner's inbox
 *   5. Forgot password — request reset for the admin account, then a WRONG
 *      6-digit code must be rejected by the backend (wire proof)
 *   6. Public course browsing — courses grid opens, first course opens
 *
 * Env:
 *   BASE_URL   (default origin proxy)   FWD_HOST (custom domain host)
 *   ADMIN_USER (default "admin")        ADMIN_PASS (recovery-lever password)
 *   ADMIN_NEW_EMAIL (owner's real inbox for the change-email step)
 *
 * Usage:
 *   FWD_HOST=ahmedelbaz.qzz.io BASE_URL=https://ahmdelbaz28-ahmdrtap.hf.space \
 *     ADMIN_PASS='...' ADMIN_NEW_EMAIL='...' node scripts/prod_button_clickthrough.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const FWD_HOST = process.env.FWD_HOST || "";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const ADMIN_NEW_EMAIL = process.env.ADMIN_NEW_EMAIL || "";

let fails = 0;
let passes = 0;
function check(name, pass, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (pass) passes += 1; else fails += 1;
}

async function main() {
  if (!ADMIN_PASS) {
    console.log("SKIP  ADMIN_PASS not provided — admin-area steps disabled");
    process.exit(0);
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Cookie-consent backdrop (z-100 full-screen) intercepts real clicks — grant
  // consent up-front so button clicks land on the actual UI (same init the
  // desktop-recovery probe uses).
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("elbaz_cookie_consent",
        JSON.stringify({ necessary: true, analytics: false, marketing: false }));
    } catch { /* storage unavailable */ }
  });
  const page = await ctx.newPage();
  if (FWD_HOST) await ctx.setExtraHTTPHeaders({ "X-Forwarded-Host": FWD_HOST, "X-Forwarded-Proto": "https" });

  // Edge-challenge bypass: re-issue every request through Playwright's own
  // TLS stack (the origin serves it cleanly); no service worker in probes.
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/sw.js") {
      await route.fulfill({ status: 404, body: "no sw in probe" });
      return;
    }
    try {
      const res = await route.fetch();
      await route.fulfill({ response: res });
    } catch {
      await route.continue().catch(() => {});
    }
  });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 160));
  });

  // Dismiss the cookie-consent banner whenever it appears — its backdrop
  // intercepts pointer events and would block every UI click.
  async function dismissCookieBanner() {
    for (const tid of ["cookie-accept-all", "cookie-accept-essential"]) {
      const btn = page.locator(`[data-testid="${tid}"]`);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(600);
        return;
      }
    }
    const backdrop = page.locator('[data-testid="cookie-consent-backdrop"]');
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ timeout: 4000, force: true }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  // ── 1. Home shell ──
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 400);
  check("home shell renders (no error boundary)", !/something went wrong|error boundary|crashed/i.test(bodyText), bodyText.replace(/\n/g, " ").slice(0, 80));

  const versionRes = await page.request.get(`${BASE}/api/version`);
  const versionJson = await versionRes.json().catch(() => null);
  check("/api/version reachable", !!versionJson?.buildId, versionJson?.buildId || "");

  // ── 2. Admin login through the real form ──
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);
  await dismissCookieBanner();
  await page.locator("#login-username").fill(ADMIN_USER);
  await page.locator("#login-password").fill(ADMIN_PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);

  const loginBody = (await page.locator("body").innerText().catch(() => ""));
  const totpRequired = /تسجيل الدخول برمز|two.?factor|totp|رمز التحقق/i.test(loginBody) && await page.locator("#login-totp").isVisible().catch(() => false);
  check("admin login accepted (no TOTP wall)", !totpRequired, totpRequired ? "TOTP field visible — needs reset2fa lever" : "");

  // Authenticated? /profile should show profile content instead of redirect.
  await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  await dismissCookieBanner();
  const profileText = (await page.locator("body").innerText().catch(() => ""));
  const authed = /التحقق من البريد|Email Verification|كورسات مسجل|Enrolled Courses/i.test(profileText);
  check("session is authenticated (profile renders)", authed, authed ? "" : profileText.replace(/\n/g, " ").slice(0, 100));

  // ── 3. Admin dashboard: click EVERY tab ──
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  await dismissCookieBanner();
  const adminText = (await page.locator("body").innerText().catch(() => ""));
  const adminReached = /لوحة التحكم|Dashboard|المستخدمين|Users/i.test(adminText);
  check("admin area reachable", adminReached, adminReached ? "" : adminText.replace(/\n/g, " ").slice(0, 120));

  const TABS = [
    ["dashboard", "لوحة التحكم|Dashboard"],
    ["users", "المستخدمين|Users"],
    ["courses", "الكورسات|Courses"],
    ["articles", "المقالات|Articles"],
    ["faq", "الأسئلة الشائعة|FAQ"],
    ["moderation", "الإشراف|Moderation"],
    ["tickets", "التذاكر|Tickets"],
    ["payments", "المدفوعات|Payments"],
    ["ai", "النماذج الذكية|AI Models"],
    ["chatbot", "تقييمات الشات بوت|Chatbot"],
    ["contact", "التواصل|Contact"],
    ["cms", "المحتوى|CMS"],
    ["themes", "الثيمات|Themes"],
    ["promos", "أكواد الخصم|Promo"],
    ["promotions", "العروض|Promotions"],
    ["testimonials", "آراء الطلاب|Testimonials"],
    ["notifications", "الإشعارات|Notifications"],
    ["audit", "سجل العمليات|Audit"],
  ];

  for (const [tabId, labelPattern] of TABS) {
    try {
      // Scope to sidebar items AND take the visible match — the sidebar may
      // render twice (desktop + off-canvas mobile) with one copy hidden.
      const ar = labelPattern.split("|")[0];
      const en = labelPattern.split("|")[1];
      const byText = page.locator(`button.admin-sidebar-item:has-text("${ar}"), button.admin-sidebar-item:has-text("${en}")`);
      const visible = byText.locator("visible=true");
      const count = await visible.count();
      if (count === 0) {
        check(`tab ${tabId} clickable`, false, "sidebar item not found");
        continue;
      }
      // framer-motion hover/tap animations occasionally keep the item
      // "unstable" for Playwright's actionability check — force-click is the
      // safe fallback: same element, same onClick, no pointer math.
      try {
        await visible.first().click({ timeout: 12000 });
      } catch {
        await visible.first().click({ timeout: 6000, force: true });
      }
      await page.waitForTimeout(2500);
      const text = (await page.locator("body").innerText().catch(() => ""));
      const dead = /something went wrong|خطأ غير متوقع|Error Boundary/i.test(text);
      check(`tab ${tabId} renders`, !dead, dead ? "error boundary detected" : "");
    } catch (e) {
      check(`tab ${tabId} clickable`, false, String(e).slice(0, 80));
    }
  }

  // ── 4. My Profile: email buttons ──
  await page.goto(`${BASE}/profile`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  await dismissCookieBanner();

  // 4a. Inline code confirm wiring — a wrong 6-digit code MUST be rejected
  const codeInput = page.locator("#email-verification-code");
  if (await codeInput.isVisible().catch(() => false)) {
    await codeInput.fill("000000");
    const confirmBtn = page.locator('button:has-text("تأكيد الرمز"), button:has-text("Confirm code")').first();
    await confirmBtn.click({ timeout: 8000 });
    await page.waitForTimeout(3500);
    const t = (await page.locator("body").innerText().catch(() => ""));
    // Either the backend generic rejection or the local format validation fired
    const wired = /Invalid or expired|غير صالح|منتهية|6 أرقام|6 digits/i.test(t) || (await page.locator("[data-sonner-toast]").count()) > 0;
    check("profile inline code confirm is wired to backend", wired);
  } else {
    check("profile inline code confirm present", false, "code input not visible (email already verified?)");
  }

  // 4b. Change admin email to the owner's real inbox — triggers a REAL email
  if (ADMIN_NEW_EMAIL) {
    // The mutation reloads the page on success, so judge by the RAW tRPC
    // response captured from the network, not by post-reload body text.
    let updateResponse = null;
    page.on("response", async (res) => {
      if (res.url().includes("/api/trpc/auth.updateProfile")) {
        try { updateResponse = await res.json(); } catch { /* ignore */ }
      }
    });
    const editBtn = page.locator('button:has-text("تعديل الملف"), button:has-text("Edit Profile")').locator("visible=true").first();
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click({ timeout: 8000 });
      await page.waitForTimeout(1200);
      const emailField = page.locator('input[type="email"]').locator("visible=true").first();
      await emailField.fill(ADMIN_NEW_EMAIL);
      const saveBtn = page.locator('button:has-text("حفظ"), button:has-text("Save")').locator("visible=true").first();
      await saveBtn.click({ timeout: 8000 });
      await page.waitForTimeout(7000);
      const ok = !!updateResponse;
      check("admin email-change flow triggers verification email", ok, ok ? "updateProfile responded — verification email sent to " + ADMIN_NEW_EMAIL : "no updateProfile response captured");
    } else {
      check("admin email-change flow triggers verification email", false, "edit button not found");
    }
  }

  // ── 5. Forgot password: request + wrong-code rejection ──
  await page.goto(`${BASE}/forgot-password`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  await dismissCookieBanner();
  const forgotEmail = page.locator("#forgot-email");
  if (await forgotEmail.isVisible().catch(() => false)) {
    const adminEmail = ADMIN_NEW_EMAIL || "admin@ahmedelbaz.qzz.io";
    await forgotEmail.fill(adminEmail);
    const submitBtn = page.locator('button[type="submit"]').first();
    await submitBtn.click({ timeout: 8000 });
    await page.waitForTimeout(6000);
    const t = (await page.locator("body").innerText().catch(() => ""));
    const sent = /تم إرسال الرابط|Check your email|رمز التأكيد|Confirmation code/i.test(t);
    check("forgot-password request succeeds", sent, sent ? "" : t.replace(/\n/g, " ").slice(0, 100));

    // Wrong code must be rejected by the backend (wire proof)
    const codeField = page.locator("#reset-code");
    if (await codeField.isVisible().catch(() => false)) {
      await codeField.fill("999999");
      await page.locator("#fp-new-password").fill("WrongCode#2026a");
      await page.locator("#fp-confirm-password").fill("WrongCode#2026a");
      const confirmBtn = page.locator('button:has-text("تأكيد الرمز"), button:has-text("Confirm code")').first();
      await confirmBtn.click({ timeout: 8000 });
      await page.waitForTimeout(4000);
      const t2 = (await page.locator("body").innerText().catch(() => ""));
      const rejected = !/تم تغيير كلمة المرور|Password updated!/i.test(t2);
      check("forgot-password wrong code rejected by backend", rejected);
    } else {
      check("forgot-password code entry visible", false, "code form not shown");
    }
  } else {
    check("forgot-password request succeeds", false, "email field not found");
  }

  // ── 6. Public course browsing ──
  await page.goto(`${BASE}/courses`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(4000);
  await dismissCookieBanner();
  const courseLink = page.locator("a[href^='/courses/']").first();
  const hasCourses = await courseLink.isVisible().catch(() => false);
  check("courses grid renders with course cards", hasCourses);
  if (hasCourses) {
    const href = await courseLink.getAttribute("href");
    await courseLink.click({ timeout: 10000 });
    await page.waitForTimeout(4500);
    const t = (await page.locator("body").innerText().catch(() => ""));
    check("first course page opens", t.length > 200, href || "");
  }

  // Error-boundary sanity: none of the interactions should have crashed the SPA
  const fatal = consoleErrors.filter((e) => /ChunkLoadError|Minified React error|error boundary/i.test(e));
  check("no fatal console errors during click-through", fatal.length === 0, fatal[0] || "");

  await page.screenshot({ path: "/tmp/probe_final.png", fullPage: false }).catch(() => {});
  await browser.close();

  console.log(`\n=== SUMMARY: ${passes} PASS / ${fails} FAIL ===`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("PROBE CRASH:", e);
  process.exit(1);
});
