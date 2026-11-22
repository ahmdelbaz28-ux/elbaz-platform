// Focused diagnostics for the 3 button-probe misses — screenshots + body dumps.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://ahmdelbaz28-ahmdrtap.hf.space";
const FWD = process.env.FWD_HOST || "";

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  if (FWD) await ctx.setExtraHTTPHeaders({ "X-Forwarded-Host": FWD, "X-Forwarded-Proto": "https" });
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/sw.js") {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "// no sw" });
      return;
    }
    try { await route.fulfill({ response: await route.fetch() }); }
    catch { await route.continue().catch(() => {}); }
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("elbaz_cookie_consent", JSON.stringify({ necessary: true, analytics: false, marketing: false })); } catch {}
  });
  const page = await ctx.newPage();

  // ── A. FAB click ──
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => (document.getElementById("root")?.innerText ?? "").trim().length > 30, { timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  const fabInfo = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const fab = btns.find((b) => /المساعد الذكي|Open AI Assistant/.test(b.getAttribute("aria-label") ?? ""));
    if (!fab) return { found: false };
    const r = fab.getBoundingClientRect();
    const style = getComputedStyle(fab);
    return { found: true, visible: r.width > 0 && style.visibility !== "hidden", opacity: style.opacity, z: style.zIndex, rect: { x: r.x, y: r.y, w: r.width } };
  });
  console.log("FAB:", JSON.stringify(fabInfo));
  if (fabInfo.found) {
    await page.locator("button[aria-label*='المساعد الذكي'], button[aria-label*='Open AI Assistant']").first().click({ force: true });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "/tmp/diag_fab.png" });
    const body = await page.evaluate(() => (document.body.innerText ?? "").replace(/\n+/g, " | ").slice(0, 400));
    const textareas = await page.evaluate(() => [...document.querySelectorAll("textarea")].map((t) => t.placeholder));
    console.log("AFTER-FAB body:", body.slice(0, 220));
    console.log("AFTER-FAB textareas:", JSON.stringify(textareas));
  }

  // ── B. Course page ──
  await page.goto(`${BASE}/courses/etap-complete-course`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => (document.getElementById("root")?.innerText ?? "").trim().length > 30, { timeout: 30000 });
  await page.waitForTimeout(2000);
  const courseBody = await page.evaluate(() => (document.body.innerText ?? "").replace(/\n+/g, " | "));
  console.log("COURSE body (600):", courseBody.slice(0, 600));
  await page.screenshot({ path: "/tmp/diag_course.png" });

  // ── C. Login error ──
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("input[type='password']", { timeout: 20000 });
  const inputs = await page.evaluate(() => [...document.querySelectorAll("input")].map((i) => ({ type: i.type, name: i.name, id: i.id, placeholder: i.placeholder })));
  console.log("LOGIN inputs:", JSON.stringify(inputs));
  await page.screenshot({ path: "/tmp/diag_login_filled.png" });
  // fill carefully by type order
  const userField = page.locator("input[type='text']").first();
  const hasTextField = (await userField.count()) > 0;
  if (hasTextField) await userField.fill("admin");
  else await page.locator("input:not([type='password'])").first().fill("admin");
  await page.locator("input[type='password']").first().fill("wrong-password-probe-99");
  // capture the login POST
  const loginResp = { status: null, body: null };
  page.on("response", async (res) => {
    if (res.url().includes("login") && res.request().method() === "POST") {
      loginResp.status = res.status();
      try { loginResp.body = (await res.text()).slice(0, 200); } catch {}
    }
  });
  await page.locator("button[type='submit']").first().click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "/tmp/diag_login_after.png" });
  const afterBody = await page.evaluate(() => (document.body.innerText ?? "").replace(/\n+/g, " | "));
  console.log("LOGIN-RESP:", JSON.stringify(loginResp));
  console.log("AFTER-LOGIN body (400):", afterBody.slice(0, 400));

  await browser.close();
}
main().catch((e) => { console.error("DIAG-CRASH", e?.message ?? e); process.exit(2); });
