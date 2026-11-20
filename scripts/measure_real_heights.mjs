// Measure REAL content heights on the live site (mobile viewport) so the
// homepage skeletons can be sized to match — eliminating the pending→content
// swap layout shift (CLS 0.4 measured).
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://ahmdelbaz28-ahmdrtap.hf.space";
const FWD = process.env.FWD_HOST || "ahmedelbaz.qzz.io";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 823 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36",
});
if (FWD) await ctx.setExtraHTTPHeaders({ "X-Forwarded-Host": FWD, "X-Forwarded-Proto": "https" });
await ctx.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === "/sw.js") return route.fulfill({ status: 404, body: "no" });
  try { await route.fulfill({ response: await route.fetch() }); }
  catch { await route.continue().catch(() => {}); }
});
await page_init(ctx);
const page = await ctx.newPage();
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(6000); // data hydrates

const m = await page.evaluate(() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().height) : null;
  };
  const all = (sel, n = 3) => [...document.querySelectorAll(sel)].slice(0, n).map((el) => Math.round(el.getBoundingClientRect().height));
  const secs = [...document.querySelectorAll("section")].map((s) => ({
    cls: String(s.className).split(" ").slice(0, 3).join("."),
    h: Math.round(s.getBoundingClientRect().height),
  }));
  return {
    categoryCard: all("section a[href*='category'] > div", 2),
    courseCard: all("section a[href^='/courses/']", 3),
    courseCardArticle: all("main a[href^='/courses/']", 3),
    articlesSectionPresent: !!document.querySelector("section img[alt*='مقال']"),
    heroImg: pick("img[src*='hero-main']"),
    heroImgAttrs: (() => { const i = document.querySelector("img[src*='hero-main']"); return i ? { w: i.getAttribute("width"), h: i.getAttribute("height") } : null; })(),
    sections: secs,
    bodyH: document.body.scrollHeight,
  };
});
console.log(JSON.stringify(m, null, 1));
await browser.close();

async function page_init(ctx) {
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("elbaz_cookie_consent",
        JSON.stringify({ necessary: true, analytics: false, marketing: false }));
    } catch {}
  });
}
