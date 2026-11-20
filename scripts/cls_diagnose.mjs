// Diagnose CLS sources + LCP element on the local static build (mobile viewport).
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4199";

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 412, height: 823 },
  userAgent:
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36",
});
const page = await ctx.newPage();

await page.addInitScript(() => {
  try {
    localStorage.setItem("elbaz_cookie_consent",
      JSON.stringify({ necessary: true, analytics: false, marketing: false }));
  } catch {}
  globalThis.__shifts = [];
  globalThis.__lcp = [];
  globalThis.__longtasks = [];
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.hadRecentInput) continue;
      const sources = (e.sources || []).map((s) => ({
        node: s.node
          ? s.node.nodeName +
            (s.node.className && typeof s.node.className === "string"
              ? "." + s.node.className.split(" ").slice(0, 3).join(".")
              : "") +
            (s.node.id ? "#" + s.node.id : "")
          : "(null)",
        prev: s.previousRect ? [s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height] : null,
        cur: s.currentRect ? [s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height] : null,
      }));
      globalThis.__shifts.push({ value: e.value, time: Math.round(e.startTime), sources });
    }
  });
  po.observe({ type: "layout-shift", buffered: true });
  const po2 = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      globalThis.__lcp.push({
        time: Math.round(e.startTime),
        size: e.size,
        tag: e.element ? e.element.tagName : "(none)",
        cls: e.element && e.element.className ? String(e.element.className).slice(0, 80) : "",
        id: e.element && e.element.id ? e.element.id : "",
        src: e.element && e.element.currentSrc ? e.element.currentSrc.slice(-60) : "",
        url: e.url ? e.url.slice(-60) : "",
      });
    }
  });
  po2.observe({ type: "largest-contentful-paint", buffered: true });
  try {
    const po3 = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        globalThis.__longtasks.push({ time: Math.round(e.startTime), dur: Math.round(e.duration) });
      }
    });
    po3.observe({ type: "longtask", buffered: true });
  } catch {}
});

await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
await page.waitForTimeout(12000);

const out = await page.evaluate(() => ({
  shifts: globalThis.__shifts,
  lcp: globalThis.__lcp.slice(-3),
  longtasks: (globalThis.__longtasks || []).slice(0, 12),
  fontsLoaded: document.fonts ? [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family + " " + f.weight).slice(0, 8) : [],
}));
console.log(JSON.stringify(out, null, 1));
await browser.close();
