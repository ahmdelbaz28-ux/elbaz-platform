// Web-vitals style metrics on the LIVE homepage + courses page (real Chrome).
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://ahmdelbaz28-ahmdrtap.hf.space";
const FWD = process.env.FWD_HOST || "";

async function measure(page, url, label) {
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3500); // let LCP settle
  const m = await page.evaluate(() => new Promise((resolve) => {
    const out = {};
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      if (nav) {
        out.ttfb = Math.round(nav.responseStart);
        out.domContentLoaded = Math.round(nav.domContentLoadedEventEnd);
        out.loadEvent = Math.round(nav.loadEventEnd);
      }
      const paints = performance.getEntriesByType("paint");
      const fcp = paints.find((p) => p.name === "first-contentful-paint");
      if (fcp) out.fcp = Math.round(fcp.startTime);
      // LCP via observer on live page
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) {
          const last = entries[entries.length - 1];
          out.lcp = Math.round(last.startTime);
          out.lcpElement = (last.element?.tagName ?? "?") + "." + String(last.element?.className ?? "").split(" ")[0].slice(0, 30);
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
      // CLS
      let cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
      setTimeout(() => {
        out.cls = Math.round(cls * 1000) / 1000;
        const longtasks = performance.getEntriesByType("longtask");
        out.longTasks = longtasks.length;
        out.tbt = Math.round(longtasks.reduce((s, t) => s + (t.duration - 50), 0));
        resolve(out);
      }, 600);
    } catch (e) {
      resolve({ error: String(e) });
    }
  }));
  console.log(label, JSON.stringify(m));
  return m;
}

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
  const page = await ctx.newPage();

  const home = await measure(page, `${BASE}/`, "HOME ");
  const courses = await measure(page, `${BASE}/courses`, "COURSES ");

  const verdicts = [];
  const judge = (name, v, good, warn) => verdicts.push(`${name}: ${v} ${v <= good ? "GOOD" : v <= warn ? "OK" : "POOR"}`);
  judge("TTFB", home.ttfb, 800, 1800);
  judge("FCP", home.fcp, 1800, 3000);
  judge("LCP", home.lcp, 2500, 4000);
  judge("CLS", home.cls, 0.1, 0.25);
  judge("TBT", home.tbt, 300, 600);
  console.log("\n" + verdicts.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error("PERF-CRASH", e?.message ?? e); process.exit(2); });
