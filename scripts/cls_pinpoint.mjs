// Pinpoint which elements grow in height right before the big layout shift.
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4199";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 823 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem("elbaz_cookie_consent",
      JSON.stringify({ necessary: true, analytics: false, marketing: false }));
  } catch {}
});
await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });

// Poll document.body scrollHeight + top-level section rects every 40ms
const timeline = await page.evaluate(() => new Promise((resolve) => {
  const snaps = [];
  const t0 = performance.now();
  const iv = setInterval(() => {
    const secs = [];
    const root = document.querySelector("#root");
    if (root) {
      for (const el of root.querySelectorAll("section, footer, header, [class*='min-h'], [class*='py-'], img")) {
        if (secs.length > 24) break;
        const r = el.getBoundingClientRect();
        if (r.height > 0) secs.push(`${el.tagName}.${String(el.className).split(" ").slice(0, 2).join(".")} h=${Math.round(r.height)} y=${Math.round(r.top)}`);
      }
    }
    snaps.push({ t: Math.round(performance.now() - t0), bodyH: document.body.scrollHeight, secs });
    if (performance.now() - t0 > 1600) { clearInterval(iv); resolve(snaps); }
  }, 40);
}));
let prev = null;
for (const s of timeline) {
  const delta = prev ? s.bodyH - prev.bodyH : 0;
  if (delta !== 0) {
    console.log(`t=${s.t} bodyH ${prev.bodyH} → ${s.bodyH} (Δ${delta > 0 ? "+" : ""}${delta})`);
    // print sections whose height changed
    if (prev) {
      for (const cur of s.secs) {
        const old = prev.secs.find((x) => x.split(" h=")[0] === cur.split(" h=")[0]);
        if (old) {
          const oh = Number(old.split(" h=")[1].split(" y=")[0]);
          const nh = Number(cur.split(" h=")[1].split(" y=")[0]);
          if (oh !== nh) console.log(`   ${cur.split(" h=")[0]}: ${oh} → ${nh}`);
        } else {
          console.log(`   NEW: ${cur}`);
        }
      }
    }
  }
  prev = s;
}
await browser.close();
