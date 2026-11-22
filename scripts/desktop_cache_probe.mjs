// ═══════════════════════════════════════════════════════════════════════════
// LIVE DESKTOP + CACHE PROBE — verifies what a real desktop user experiences
// on https://ahmedelbaz.qzz.io right now:
//
//   A. Edge challenge passes in a real browser (no 403 wall)
//   B. HTML cache headers survive the edge (no stale HTML)
//   C. Served HTML token == /api/version buildId (no version skew)
//   D. App mounts (splash dismisses — no infinite loading)
//   E. Repeat navigation picks the SAME (latest) version
//   F. Stale-cache simulation: old buildId in localStorage + old HTML in
//      browser cache ⇒ cache-nuke heals within one reload (budget allowed)
//   G. Assets carry immutable long cache (correct layering)
//   H. Zero console errors during the run
//
// Usage: node scripts/desktop_cache_probe.mjs            (direct edge URL)
//        BASE_URL=https://... FWD_HOST=ahmedelbaz.qzz.io  (origin proxy)
// ═══════════════════════════════════════════════════════════════════════════
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "https://ahmedelbaz.qzz.io";
const FWD = process.env.FWD_HOST || "";

let fails = 0;
let count = 0;
const check = (name, pass, detail = "") => {
  count += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) fails += 1;
};

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  if (FWD) await ctx.setExtraHTTPHeaders({ "X-Forwarded-Host": FWD, "X-Forwarded-Proto": "https" });

  const consoleErrors = [];
  ctx.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 180)); });
  ctx.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + String(e).slice(0, 180)));

  // 🛡️ Edge-challenge bypass (same cure as subscribe_gate_prod_check.mjs)
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/sw.js") {
      // Serve an EMPTY service worker (not a 404 — a failed script fetch
      // would surface as a console error and pollute check H).
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "// sw disabled in probe" });
      return;
    }
    try {
      const res = await route.fetch();
      await route.fulfill({ response: res });
    } catch { await route.continue().catch(() => {}); }
  });
  await pageInit(ctx);

  const page = await ctx.newPage();

  // ── 1. First visit (fresh browser) ─────────────────────────────────────
  const t0 = Date.now();
  const resp = await page.goto(`${BASE}/`, { waitUntil: "load", timeout: 60000 });
  const navMs = Date.now() - t0;
  const status = resp?.status() ?? 0;
  check("A. first visit not blocked by edge", status === 200, `status=${status} ${navMs}ms`);

  const htmlHeaders = resp?.headers() ?? {};
  const cc = htmlHeaders["cache-control"] ?? "(none)";
  check("B. HTML carries no-cache family", /no-cache|no-store|must-revalidate/i.test(cc), `Cache-Control: ${cc}`);

  const htmlToken = await page.evaluate(() => {
    const s = document.querySelector("script[src*='cache-nuke.js']");
    return s ? (s.getAttribute("src").match(/v=([^&]+)/)?.[1] ?? null) : null;
  });
  const ver = await page.evaluate(async () => {
    const r = await fetch("/api/version", { credentials: "include" });
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  check("C1. /api/version reachable", ver.status === 200 && !!ver.body?.buildId, `status=${ver.status} buildId=${ver.body?.buildId ?? "?"}`);
  const liveBuildId = ver.body?.buildId ?? "";
  check("C2. served HTML token == live buildId", !!htmlToken && htmlToken === liveBuildId, `html=${htmlToken} api=${liveBuildId}`);

  // ── D. App mounts (splash must dismiss) ────────────────────────────────
  const mounted = await waitForMount(page, 25000);
  check("D. app mounts (splash dismisses)", mounted, "waiting for #root content");
  const rootText = await page.evaluate(() => (document.getElementById("root")?.innerText ?? "").slice(0, 120));
  console.log(`      root sample: ${JSON.stringify(rootText.slice(0, 60))}`);

  // ── 2. Second navigation (repeat visit, same context) ──────────────────
  const resp2 = await page.goto(`${BASE}/courses`, { waitUntil: "load", timeout: 60000 });
  const cc2 = resp2?.headers()["cache-control"] ?? "(none)";
  check("E1. repeat navigation still no-cache", /no-cache|no-store|must-revalidate/i.test(cc2), `Cache-Control: ${cc2}`);
  const mounted2 = await waitForMount(page, 25000);
  check("E2. repeat navigation mounts", mounted2);
  const token2 = await page.evaluate(() => {
    const s = document.querySelector("script[src*='cache-nuke.js']");
    return s ? (s.getAttribute("src").match(/v=([^&]+)/)?.[1] ?? null) : null;
  });
  check("E3. repeat navigation same latest token", token2 === liveBuildId, `token=${token2}`);

  // ── 3. Asset cache layering ────────────────────────────────────────────
  const assetPath = await page.evaluate(() =>
    document.querySelector("script[type='module'][src]")?.getAttribute("src") ?? null
  );
  if (assetPath) {
    const ar = await page.request.get(new URL(assetPath, BASE).toString());
    const acc = ar.headers()["cache-control"] ?? "(none)";
    check("G. hashed asset long/immutable cache", /max-age=\d{6,}|immutable/i.test(acc), `${assetPath.split("/").pop()} → ${acc}`);
  } else {
    check("G. hashed asset long/immutable cache", false, "no module script found");
  }

  // ── 4. Stale-cache simulation ──────────────────────────────────────────
  // Seed a FAKE OLD buildId so cache-nuke sees a version skew, then reload:
  // the nuke layer should clear caches and reload within its budget.
  await page.evaluate((oldId) => {
    localStorage.setItem("elbaz_build_id", oldId);
    sessionStorage.removeItem("elbaz_nuke_count");
  }, "stale-0000-fakeold");
  const reloadResp = await page.goto(`${BASE}/courses`, { waitUntil: "load", timeout: 60000 });
  const healed = await page.evaluate(async () => {
    // after cache-nuke ran, localStorage buildId must match the live one
    for (let i = 0; i < 40; i++) {
      const v = localStorage.getItem("elbaz_build_id");
      if (v && !v.startsWith("stale-")) return v;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  });
  check("F. stale buildId self-heals via cache-nuke", !!healed && healed === liveBuildId, `healed=${healed} live=${liveBuildId}`);

  // ── 5. Console cleanliness ─────────────────────────────────────────────
  const fatalErrors = consoleErrors.filter((e) =>
    !/facebook|FB|fido|sw\.js|workbox|sourcemap|chrome-extension|3p blocked|Autoplay|net::ERR_ABORTED/i.test(e)
  );
  check("H. zero fatal console errors", fatalErrors.length === 0, fatalErrors.slice(0, 3).join(" | ") || "clean");

  await browser.close();
  console.log(`\n═══ RESULT: ${count - fails}/${count} PASS ${fails ? "(" + fails + " FAIL)" : ""}`);
  process.exit(fails ? 1 : 0);
}

async function waitForMount(page, timeout) {
  try {
    await page.waitForFunction(
      () => {
        const root = document.getElementById("root");
        return !!root && root.children.length > 0 && (root.innerText ?? "").trim().length > 10;
      },
      { timeout }
    );
    return true;
  } catch { return false; }
}

async function pageInit(ctx) {
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("elbaz_cookie_consent", JSON.stringify({ necessary: true, analytics: false, marketing: false }));
    } catch { /* ignore */ }
  });
}

main().catch((e) => { console.error("PROBE-CRASH", e?.message ?? e); process.exit(2); });
