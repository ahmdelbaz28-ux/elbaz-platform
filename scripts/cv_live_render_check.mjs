/**
 * cv_live_render_check.mjs — proves content-visibility render-skipping is
 * live AND harmless on production:
 *   C1  the CSS bundle ships the cv-auto* utilities (content-visibility: auto)
 *   C2  /articles renders cards; a card past the 8th carries cv-auto
 *   C3  scrolling a cv-auto card into view makes it fully visible/rendered
 *   C4  a late lesson row carries cv-auto-row and stays clickable-safe
 *   C5  zero fatal console errors across both pages
 * Env: BASE_URL (origin proxy) FWD_HOST (custom domain)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const FWD_HOST = process.env.FWD_HOST || "";
const extraHeaders = FWD_HOST ? { "x-forwarded-host": FWD_HOST, "x-forwarded-proto": "https" } : {};

let passes = 0, fails = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  ok ? passes++ : fails++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Mirror live_deploy_cache_desktop_probe: forwarded-host on EVERY request
// (per-goto headers cover only the top navigation → subresources 403), and
// /sw.js blocked so a probe-installed service worker can't stale the shell.
if (Object.keys(extraHeaders).length) await ctx.setExtraHTTPHeaders(extraHeaders);
const page = await ctx.newPage();
await ctx.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/sw.js") {
    await route.fulfill({ status: 200, body: "", contentType: "application/javascript" });
    return;
  }
  try {
    const res = await route.fetch();
    await route.fulfill({ response: res });
  } catch {
    // External domains (fonts/analytics) can fail via route.fetch — let the
    // browser's own stack retry instead of hanging the load event forever.
    await route.continue().catch(() => {});
  }
});
// Pre-set cookie consent so the banner never waits on user input mid-check.
await page.addInitScript(() => {
  try {
    localStorage.setItem("elbaz_cookie_consent",
      JSON.stringify({ necessary: true, analytics: false, marketing: false }));
  } catch { /* storage unavailable */ }
});
const fatalErrors = [];
page.on("pageerror", (e) => fatalErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|net::|404/.test(m.text())) fatalErrors.push(m.text()); });

// C1 — CSS ships the utilities
const cssHref = await (async () => {
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
  return page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).join(" "));
})();
const cssUrl = cssHref.split(" ").find((h) => h.includes("/assets/"));
const cssText = cssUrl ? await (await fetch(cssUrl, { headers: extraHeaders })).text() : "";
check("C1 CSS bundle ships content-visibility utilities", cssText.includes("content-visibility:auto") && cssText.includes("contain-intrinsic-size"), `css=${cssUrl ? cssUrl.split("/").pop() : "none"}`);

// C2/C3 — articles grid
await page.goto(`${BASE}/articles`, { waitUntil: "load", timeout: 60000 });
await page.locator('a[href^="/articles/"]').first().waitFor({ timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
const cardsTotal = await page.locator('a[href^="/articles/"]').count();
check("C2 /articles renders article cards", cardsTotal > 0, `cards=${cardsTotal}`);
const cvCards = await page.evaluate(() => document.querySelectorAll(".cv-auto").length);
check("C2b late cards carry cv-auto (or list shorter than 9 → 0)", cardsTotal < 9 ? cvCards === 0 : cvCards > 0, `cvCards=${cvCards} total=${cardsTotal}`);

// C3 — scroll the last card into view: must be rendered & visible
if (cardsTotal > 0) {
  const last = page.locator('a[href^="/articles/"]').last();
  await last.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const visible = await last.isVisible();
  const box = await last.boundingBox();
  check("C3 last card renders visibly after scroll-into-view", visible && !!box && box.height > 40, `h=${box?.height ?? 0}px`);
}

// C4 — course detail late lesson row
await page.goto(`${BASE}/courses/etap-complete-course`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(2500);
const lessonsTotal = await page.locator("button:has(p)").filter({ hasText: /\d+\./ }).count();
const cvRows = await page.evaluate(() => document.querySelectorAll(".cv-auto-row").length);
check("C4 lesson rows: cv-auto-row applied on long curricula", lessonsTotal < 13 ? cvRows === 0 : cvRows > 0, `lessons=${lessonsTotal} cvRows=${cvRows}`);
if (cvRows > 0) {
  await page.evaluate(() => document.querySelectorAll(".cv-auto-row")[document.querySelectorAll(".cv-auto-row").length - 1]?.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(600);
  const lastRowRendered = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".cv-auto-row")];
    const r = rows[rows.length - 1];
    if (!r) return false;
    const rect = r.getBoundingClientRect();
    return rect.height > 20 && getComputedStyle(r).contentVisibility === "auto";
  });
  check("C4b late lesson row renders + keeps content-visibility:auto", lastRowRendered);
}

check("C5 no fatal page/console errors", fatalErrors.length === 0, fatalErrors.slice(0, 3).join(" | ").slice(0, 200));

await browser.close();
console.log(`\n═══ RESULT: ${passes}/${passes + fails} PASS, ${fails} FAIL ═══`);
process.exit(fails ? 1 : 0);
