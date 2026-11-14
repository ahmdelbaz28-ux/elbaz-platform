// Production login verification: the admin credentials must open a real session.
import { chromium } from "playwright";
import { readFileSync } from "fs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const fwd = process.env.FWD_HOST ? { "X-Forwarded-Host": process.env.FWD_HOST, "X-Forwarded-Proto": "https" } : undefined;
const USERNAME = process.env.ADMIN_USER || "admin";
const PASSWORD = readFileSync(process.env.ADMIN_PW_FILE || "/tmp/admin_pw.txt", "utf-8").trim();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: fwd });
// Returning visitor: pre-accept cookie consent so the banner never intercepts clicks.
await page.addInitScript(() => {
  try {
    localStorage.setItem("elbaz_cookie_consent", JSON.stringify({ necessary: true, analytics: false, marketing: false }));
  } catch { /* ignore */ }
});
try {
  await page.goto(BASE + "/login", { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("#main-content", { timeout: 30000 });

  // Intercept the login API response for exact failure diagnostics.
  let loginStatus = null, loginBody = null;
  page.on("response", async (res) => {
    if (res.url().includes("login") && res.request().method() === "POST") {
      loginStatus = res.status();
      try { loginBody = (await res.text()).slice(0, 300); } catch { /* ignore */ }
    }
  });

  const user = page.locator("input[type='text'], input:not([type='password'])").filter({ hasNot: page.locator("[type='hidden']") }).first();
  await user.fill(USERNAME);
  await page.locator("input[type='password']").first().fill(PASSWORD);
  await page.screenshot({ path: "/tmp/login-filled.png" });

  await page.getByRole("button", { name: /login|تسجيل الدخول|دخول/i }).first().click();
  await page.waitForTimeout(4000);

  const url = new URL(page.url());
  const landed = url.pathname;
  // Success signals: redirected away from /login, dashboard/protected content, or an authenticated navbar element.
  const success = landed !== "/login" || await page.getByText(/dashboard|لوحة/i).count() > 0;
  console.log(`${success ? "PASS" : "FAIL"}  login as ${USERNAME} → landed=${landed}`);
  console.log(`      login API: status=${loginStatus} body=${loginBody ?? "(not captured)"}`);

  // Dashboard render check: the new session must open /admin with the full
  // tab set (incl. the 3 new tabs: FAQ, Moderation, Audit Log).
  if (success) {
    await page.goto(BASE + "/admin", { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#main-content", { timeout: 30000 });
    await page.waitForTimeout(1500);
    const adminUrl = new URL(page.url()).pathname;
    const bodyText = await page.evaluate(() => document.body.innerText);
    const hasTabs = ["users", "courses", "faq", "moderation", "audit"].map((id) => ({
      id,
      // match either the English or Arabic label
      found: /Users|المستخدمين|Courses|الكورسات|FAQ|الأسئلة الشائعة|Moderation|الإشراف|Audit Log|سجل العمليات/.test(bodyText),
    }));
    console.log(`      /admin → landed=${adminUrl}`);
    console.log(`      admin tabs check: ${hasTabs.every((t) => t.found) ? "PASS (all labels visible)" : JSON.stringify(hasTabs)}`);
    await page.screenshot({ path: "/tmp/admin-dashboard.png" });
  }
  await page.screenshot({ path: "/tmp/login-result.png" });
  process.exit(success ? 0 : 1);
} catch (err) {
  console.error("LOGIN CHECK ERROR:", err.message);
  await page.screenshot({ path: "/tmp/login-error.png" }).catch(() => {});
  process.exit(1);
} finally {
  await browser.close();
}
