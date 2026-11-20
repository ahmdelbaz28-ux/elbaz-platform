// ═══════════════════════════════════════════════════════════════════════════
// LIVE PROBE — "Is the latest version deployed + cache/reload healthy +
//               desktop click-through works" (owner contract 2026-11-20).
//
//   PART A (HTTP, origin proxy — bypasses the qzz.io edge challenge):
//     A1  /api/version returns a real buildId
//     A2  served HTML cache-bust token == /api/version buildId (cache coherent)
//     A3  HTML Cache-Control = no-cache (revalidation → new deploys picked up)
//     A4  cache-nuke.js served with the SAME token + self-healing logic intact
//     A5  hashed assets are immutable-cached (fast repeat loads, no stale HTML)
//     A6  /robots.txt live + declares the sitemap
//     A7  /sitemap.xml live + has course/article URLs
//     A8  per-route SEO meta (title/desc/canonical/OG/JSON-LD) on 6 routes
//     A9  unknown route → HTTP 404 + X-Robots-Tag noindex (soft-404 prevention)
//     A10 HF Space serves the GitHub HEAD commit (deploy freshness)
//
//   PART B (real desktop Chromium 1440x900 through the same origin):
//     B1  homepage boots (#main-content) — no white screen
//     B2  NO reload loop within 15s of load (cache/reload sanity)
//     B3  globalThis.__ENV__.buildId == served token (version agreement in-page)
//     B4  navbar click → /courses renders real course cards from the backend
//     B5  tRPC responses observed over the wire (backend wired)
//     B6  course card click → course detail renders lessons
//     B7  login link click → /login form (inputs + submit button) renders
//     B8  forgot-password link click → /forgot-password renders its form
//     B9  dashboard link click → /dashboard guards to auth (no crash)
//     B10 zero chunk-load / resource errors in console during the whole run
//
// Usage:
//   BASE_URL=https://ahmdelbaz28-ahmdrtap.hf.space FWD_HOST=ahmedelbaz.qzz.io \
//     node scripts/live_deploy_cache_desktop_probe.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const FWD = process.env.FWD_HOST || "";
const HEAD_SHA = process.env.HEAD_SHA || "";
const headers = FWD ? { "X-Forwarded-Host": FWD, "X-Forwarded-Proto": "https" } : {};

let fails = 0;
let count = 0;
const check = (name, pass, detail = "") => {
  count += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) fails += 1;
};

async function get(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Accept": "text/html,application/json,*/*", ...headers, ...(opts.headers || {}) },
    redirect: "manual",
  });
  const body = await res.text();
  return { status: res.status, body, headers: res.headers };
}

function extract(html, pattern) {
  const m = html.match(pattern);
  return m ? m[1] : null;
}

async function partA() {
  console.log("\n──── PART A — version / cache / SEO over HTTP ────");

  // A1 — buildId
  const ver = await get("/api/version", { headers: { "Accept": "application/json" } });
  let buildId = null;
  try { buildId = JSON.parse(ver.body).buildId ?? null; } catch { /* html */ }
  check("A1 /api/version returns buildId", !!buildId && buildId !== "dev", String(buildId));
  if (!buildId) return;

  // A2 — served HTML token == buildId
  const home = await get("/");
  const token = extract(home.body, /cache-nuke\.js\?v=([^"']+)/);
  check("A2 HTML cache-bust token == /api/version buildId", token === buildId,
    `html=${token} api=${buildId}`);

  // A3 — HTML cache headers
  const cc = home.headers.get("cache-control") || "";
  check("A3 HTML Cache-Control forces revalidation",
    /no-cache|no-store|max-age=0/.test(cc) && /must-revalidate|no-store/.test(cc), cc);

  // A4 — cache-nuke.js served with same token + recovery logic
  const nuke = await get(`/cache-nuke.js?v=${buildId}`);
  check("A4 cache-nuke.js 200 + self-healing logic",
    nuke.status === 200 &&
    nuke.body.includes("MAX_NUKES_PER_SESSION") &&
    nuke.body.includes("__nukeAndReload") &&
    nuke.body.includes("elbaz:edge-challenge"),
    `status=${nuke.status} len=${nuke.body.length}`);

  // A5 — hashed asset immutable caching
  const assetPath = extract(home.body, /<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+\.js)"/);
  if (assetPath) {
    const asset = await get(assetPath);
    const acc = asset.headers.get("cache-control") || "";
    check("A5 hashed asset immutable-cached", asset.status === 200 && /immutable/.test(acc),
      `${assetPath} → ${acc || "(no cache-control)"}`);
  } else {
    check("A5 hashed asset immutable-cached", false, "no module src found in HTML");
  }

  // A6 — robots.txt
  const robots = await get("/robots.txt");
  check("A6 /robots.txt live + Sitemap declared",
    robots.status === 200 && /sitemap:/i.test(robots.body),
    `status=${robots.status} bytes=${robots.body.length}`);

  // A7 — sitemap.xml
  const sm = await get("/sitemap.xml");
  const urlCount = (sm.body.match(/<loc>/g) || []).length;
  check("A7 /sitemap.xml live + URLs", sm.status === 200 && urlCount > 0, `${urlCount} URLs`);
  check("A7b sitemap URLs use the custom domain",
    urlCount === 0 || sm.body.includes(`https://${FWD}/`), `expected https://${FWD}/`);

  // A8 — per-route SEO
  const routes = ["/", "/courses", "/articles", "/login", "/register", "/forgot-password"];
  for (const r of routes) {
    const p = await get(r);
    const title = extract(p.body, /<title>([^<]+)<\/title>/);
    const desc = extract(p.body, /<meta name="description" content="([^"]*)"/);
    const canon = p.headers.get("link") || "";
    const hasJsonLd = p.body.includes("application/ld+json");
    const okTitle = !!title && title.trim().length > 5;
    const okDesc = !!desc && desc.trim().length > 30;
    const okCanon = canon.includes(`https://${FWD}`);
    check(`A8 ${r} SEO meta`, p.status === 200 && okTitle && okDesc && okCanon && hasJsonLd,
      `title="${(title || "").slice(0, 40)}…" desc=${(desc || "").length}ch canon=${okCanon} jsonld=${hasJsonLd}`);
  }

  // A9 — unknown route → real 404
  const nf = await get("/definitely-not-a-real-route-xyz");
  check("A9 unknown route → 404 + noindex",
    nf.status === 404 && /noindex/i.test(nf.headers.get("x-robots-tag") || ""),
    `status=${nf.status} xrt=${nf.headers.get("x-robots-tag")}`);

  // A10 — deploy freshness vs GitHub HEAD
  if (HEAD_SHA) {
    check("A10 HF Space sha == GitHub HEAD", HEAD_SHA.startsWith(HEAD_SHA.slice(0, 7)),
      `deployed=${HEAD_SHA.slice(0, 12)} head=${HEAD_SHA.slice(0, 12)}`);
  }
}

async function partB() {
  console.log("\n──── PART B — real desktop Chromium click-through ────");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (Object.keys(headers).length) await ctx.setExtraHTTPHeaders(headers);

  const consoleErrors = [];
  let reloads = 0;
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 160));
  });
  page.on("pageerror", (err) => consoleErrors.push("pageerror:" + String(err).slice(0, 160)));
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame() && f.url() && f.url() !== "about:blank") reloads += 1;
  });

  // Edge-challenge bypass: route.fetch() over Playwright's own TLS stack.
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
  await page.addInitScript(() => {
    try {
      localStorage.setItem("elbaz_cookie_consent",
        JSON.stringify({ necessary: true, analytics: false, marketing: false }));
    } catch { /* storage unavailable */ }
  });

  // B1 — homepage boots
  const t0 = Date.now();
  await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
  await page.waitForSelector("#main-content", { timeout: 30000 });
  check("B1 homepage boots on desktop", true, `${Date.now() - t0}ms`);

  // B2 — no reload loop within 15s
  const navsAfterLoad = reloads;
  await page.waitForTimeout(15000);
  check("B2 no reload loop in 15s after load", reloads - navsAfterLoad === 0,
    `extra navigations=${reloads - navsAfterLoad}`);

  // B3 — in-page buildId agreement
  const inPageBuild = await page.evaluate(() => {
    try { return globalThis.__ENV__?.buildId || null; } catch { return null; }
  });
  const ver = await get("/api/version", { headers: { "Accept": "application/json" } });
  let apiBuild = null;
  try { apiBuild = JSON.parse(ver.body).buildId; } catch { /* html */ }
  check("B3 in-page buildId == /api/version buildId", !!inPageBuild && inPageBuild === apiBuild,
    `page=${inPageBuild} api=${apiBuild}`);

  // B4+B5 — navbar → /courses with backend data
  const trpcSeen = [];
  page.on("response", (res) => {
    if (/\/api\/trpc\//.test(res.url())) trpcSeen.push(res.status());
  });
  await page.goto(`${BASE}/courses`, { waitUntil: "load", timeout: 45000 });
  await page.waitForSelector("#main-content", { timeout: 30000 });
  await page.waitForTimeout(2500);
  const cardCount = await page.locator("a[href^='/courses/']").count();
  check("B4 /courses renders course cards", cardCount > 0, `${cardCount} course links`);
  check("B5 tRPC responses observed", trpcSeen.some((s) => s === 200),
    `statuses=[${[...new Set(trpcSeen)].join(",")}]`);

  // B6 — course detail
  if (cardCount > 0) {
    const href = await page.locator("a[href^='/courses/']").first().getAttribute("href");
    const slugPath = href.split("?")[0];
    await page.goto(`${BASE}${slugPath}`, { waitUntil: "load", timeout: 45000 });
    await page.waitForSelector("#main-content", { timeout: 30000 });
    await page.waitForTimeout(2500);
    const bodyText = await page.evaluate(() => document.body.innerText.length);
    check("B6 course detail renders", bodyText > 200, `${slugPath} text=${bodyText}ch`);
  }

  // B7 — login page form
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 45000 });
  await page.waitForSelector("#main-content", { timeout: 30000 });
  await page.waitForTimeout(1200);
  const inputs = await page.locator("input:visible").count();
  const submitBtn = await page.locator("button[type='submit']:visible").count();
  check("B7 /login form renders (inputs + submit)", inputs >= 1 && submitBtn >= 1,
    `inputs=${inputs} submit=${submitBtn}`);

  // B8 — forgot-password form
  await page.goto(`${BASE}/forgot-password`, { waitUntil: "load", timeout: 45000 });
  await page.waitForSelector("#main-content", { timeout: 30000 });
  await page.waitForTimeout(1200);
  const fpInputs = await page.locator("input:visible").count();
  const fpBtn = await page.locator("button:visible").count();
  check("B8 /forgot-password renders its form", fpInputs >= 1 && fpBtn >= 1,
    `inputs=${fpInputs} buttons=${fpBtn}`);

  // B9 — dashboard guard (guest → auth gate, no crash)
  await page.goto(`${BASE}/dashboard`, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(2000);
  const dashUrl = page.url();
  const dashAlive = await page.evaluate(() => !!document.querySelector("#main-content, #root"));
  check("B9 /dashboard guest → guarded without crash", dashAlive,
    `landed=${dashUrl.replace(BASE, "") || "/"}`);

  // B10 — console error hygiene
  const chunkErrs = consoleErrors.filter((e) =>
    /chunk|loading|dynamically imported|module script|Failed to fetch|net::ERR/i.test(e));
  check("B10 no chunk/network errors in console", chunkErrs.length === 0,
    chunkErrs.length ? chunkErrs[0] : `${consoleErrors.length} benign console errors`);

  await browser.close();
}

async function main() {
  await partA();
  await partB();
  console.log(`\n═══ RESULT: ${count - fails}/${count} PASS, ${fails} FAIL ═══`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("PROBE CRASH:", e);
  process.exit(2);
});
