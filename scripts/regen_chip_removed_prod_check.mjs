// Production verification: the "Regenerate reply" chip is GONE from the live
// HF Space build (owner directive 2026-11-14 — no regenerate control in chat).
//
// Method: crawl every JS asset reachable from the production index.html
// (including lazily-loaded dynamic chunks, which appear as "assets/*.js"
// string literals inside other bundles) and assert:
//   1. the removed chip strings ("Regenerate reply", its title tooltip) are
//      NOWHERE in any served bundle;
//   2. positive markers ("Open AI Assistant", "chatbot-fab") ARE present —
//      proving the crawl actually reached the chunk(s) hosting ChatBot, so
//      an absence here is meaningful, not a crawl miss.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const fwd = process.env.FWD_HOST ? { "X-Forwarded-Host": process.env.FWD_HOST, "X-Forwarded-Proto": "https" } : undefined;
const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};

const headers = fwd || {};
const seen = new Set();
const bodies = []; // { url, text }

async function fetchText(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function assetUrlsFrom(html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)=["'](\/?assets\/[^"']+\.js)["']/g)) {
    urls.add(m[1].startsWith("/") ? m[1] : "/" + m[1]);
  }
  return urls;
}
function chunkUrlsFrom(js) {
  const urls = new Set();
  for (const m of js.matchAll(/["'](\/?assets\/[A-Za-z0-9_.-]+\.js)["']/g)) {
    urls.add(m[1].startsWith("/") ? m[1] : "/" + m[1]);
  }
  return urls;
}

try {
  // ── 1. Production homepage serves + mounts (SPA lazy-load signal) ──
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: headers });
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("#main-content", { timeout: 60000 });
  await page.waitForSelector("button.chatbot-fab", { timeout: 60000 }).catch(() => {});
  const chipOnHome = await page.getByText("Regenerate reply").count();
  ok("prod: home page mounts, no regenerate text in initial DOM", chipOnHome === 0, `count=${chipOnHome}`);
  await browser.close();

  // ── 2. Crawl ALL served JS bundles ──
  const html = await fetchText(BASE + "/");
  let queue = assetUrlsFrom(html);
  ok("prod: index.html references JS bundles", queue.size > 0, `found=${queue.size}`);
  while (queue.size) {
    const next = new Set();
    for (const path of queue) {
      if (seen.has(path)) continue;
      seen.add(path);
      const text = await fetchText(BASE + path);
      bodies.push({ url: path, text });
      for (const u of chunkUrlsFrom(text)) if (!seen.has(u)) next.add(u);
    }
    queue = next;
  }
  ok("prod: JS crawl completed", true, `bundles_scanned=${bodies.length}`);

  // ── 3. Removed strings must be absent from EVERY bundle ──
  const removed = ["Regenerate reply", "Ask the same question again"];
  for (const needle of removed) {
    const hits = bodies.filter((b) => b.text.includes(needle));
    ok(`prod: "${needle}" absent from all ${bodies.length} bundles`, hits.length === 0,
      hits.length ? "hit: " + hits.map((h) => h.url).join(", ") : "clean");
  }

  // ── 4. Positive markers: the scan truly reached the ChatBot code ──
  for (const marker of ["Open AI Assistant", "chatbot-fab", "Type your message"]) {
    const hits = bodies.filter((b) => b.text.includes(marker));
    ok(`prod: marker "${marker}" present (crawl validity)`, hits.length > 0,
      hits.length ? hits[0].url : "NOT FOUND — scan did not reach chat chunk");
  }

  // ── 5. The retry (error) control must REMAIN untouched ──
  const retryAlive = bodies.some((b) => b.text.includes("إعادة المحاولة"));
  ok("prod: error-retry control still intact (unrelated, must stay)", retryAlive);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
} catch (err) {
  console.error("CHECK ERROR:", err.message);
  process.exit(1);
}
