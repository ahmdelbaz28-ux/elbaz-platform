// Focused probe: is the cookie banner dismissible on production?
// Tests ALL three dismissal paths with the component's REAL test ids:
//   1. "Accept all" button  (data-testid=cookie-accept-all)
//   2. "Essential only" button (data-testid=cookie-accept-essential)
//   3. Backdrop click + Escape key
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const fwd = process.env.FWD_HOST ? { "X-Forwarded-Host": process.env.FWD_HOST, "X-Forwarded-Proto": "https" } : undefined;
const headers = fwd || {};

async function freshPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  if (headers && Object.keys(headers).length) {
    await ctx.setExtraHTTPHeaders(headers);
  }
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 45000 });
  await page.waitForSelector("#main-content", { timeout: 30000 });
  await page.waitForSelector("[data-testid='cookie-consent-banner']", { timeout: 15000 });
  return { ctx, page };
}

const browser = await chromium.launch();
let fails = 0;
const check = (name, pass, detail) => { console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); if (!pass) fails++; };

// Path 1: Accept all
{
  const { ctx, page } = await freshPage(browser);
  await page.getByTestId("cookie-accept-all").click({ timeout: 8000 });
  await page.waitForTimeout(900);
  const left = await page.getByTestId("cookie-consent-banner").count();
  const stored = await page.evaluate(() => localStorage.getItem("elbaz_cookie_consent"));
  check("Accept all dismisses banner", left === 0, `remaining=${left} stored=${stored}`);
  await ctx.close();
}
// Path 2: Essential only
{
  const { ctx, page } = await freshPage(browser);
  await page.getByTestId("cookie-accept-essential").click({ timeout: 8000 });
  await page.waitForTimeout(900);
  const left = await page.getByTestId("cookie-consent-banner").count();
  const stored = await page.evaluate(() => localStorage.getItem("elbaz_cookie_consent"));
  check("Essential only dismisses banner", left === 0, `remaining=${left} stored=${stored}`);
  await ctx.close();
}
// Path 3: Backdrop click
{
  const { ctx, page } = await freshPage(browser);
  await page.getByTestId("cookie-consent-backdrop").click({ timeout: 8000, position: { x: 40, y: 40 } });
  await page.waitForTimeout(900);
  const left = await page.getByTestId("cookie-consent-banner").count();
  check("Backdrop click dismisses banner", left === 0, `remaining=${left}`);
  await ctx.close();
}
// Path 4: Escape key
{
  const { ctx, page } = await freshPage(browser);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);
  const left = await page.getByTestId("cookie-consent-banner").count();
  check("Escape key dismisses banner", left === 0, `remaining=${left}`);
  await ctx.close();
}
// Path 5: After dismissal the chatbot FAB is clickable (root UX flow)
{
  const { ctx, page } = await freshPage(browser);
  await page.getByTestId("cookie-accept-essential").click({ timeout: 8000 });
  await page.waitForSelector("button.chatbot-fab", { timeout: 15000 });
  await page.locator("button.chatbot-fab").click({ timeout: 10000 });
  const opened = await page.waitForSelector("textarea, [role='log']", { timeout: 15000 }).then(() => true).catch(() => false);
  check("After dismissal: chat panel opens from FAB", opened);
  await page.screenshot({ path: "/tmp/banner-dismiss-then-chat.png" });
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${5 - fails}/5 passed — BANNER PROBLEM CONFIRMED` : "\n5/5 passed — banner fully functional");
process.exit(fails ? 1 : 0);
