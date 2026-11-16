/**
 * E2E — 🛡️ Desktop recovery & edge-challenge resilience (2026-11-16 incident).
 *
 * The owner reported: desktop refuses to load the site (reloading forever /
 * never rendering) while mobile worked. Root causes established live:
 *
 *   1. A STALE HTML SHELL (old SW precache / cached shell referencing dead
 *      hashed chunks) + a poisoned localStorage buildId passed the old
 *      cache-nuke version check forever → dead dark page with ZERO recovery
 *      (the old self-heal listener called a function that was never defined).
 *   2. The provider's Cloudflare edge answers flagged clients with
 *      `403 + cf-mitigated: challenge` on API calls — XHRs can never solve a
 *      challenge, so the shell rendered but all data died ("page won't load").
 *
 * These tests pin the NEW recovery contract (cache-nuke.js v3 + trpc.tsx
 * detector):
 *   - a stale shell auto-heals (cache/SW clear + one reload) and the app boots
 *   - a PERSISTENTLY stale shell cannot loop: after the per-session cap the
 *     recovery banner renders and reloads stop
 *   - an edge challenge (403 + cf-mitigated: challenge on tRPC) gets exactly
 *     ONE recovery navigation, then the guidance banner — the shell still works
 *   - a legit JSON 403 (API-level rejection, e.g. subscribe gate) NEVER
 *     triggers recovery
 *
 * Runs against the offline UI test server (scripts/ui-test-server.mjs).
 */
import { test, expect, type Page, type Route, type APIRequestContext } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

const STALE_BUILD = "stale0001";

const BANNER = "#elbaz-recovery-banner";

async function servedHtmlToken(request: APIRequestContext): Promise<string> {
  const res = await request.get("/");
  const html = await res.text();
  const match = /cache-nuke\.js\?v=([^"'&\s]+)/.exec(html);
  return match ? match[1] : "";
}

/**
 * Installs the routing needed for a recovery scenario:
 *  - /sw.js 404 → deterministic "no service worker" environment
 *  - /api/version → controlled buildId
 *  - document requests for "/" → stale shell for the first `staleDocs`
 *    document loads, fresh afterwards (staleDocs=Infinity → stale forever)
 */
async function installRoutes(
  page: Page,
  opts: { staleDocs: number; versionBuildId: string | null },
): Promise<{ docs: () => number }> {
  let docLoads = 0;
  await page.route("**/*", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/sw.js") {
      await route.fulfill({ status: 404, body: "no sw in recovery tests" });
      return;
    }
    if (url.pathname === "/api/version") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          opts.versionBuildId
            ? { version: "test", buildId: opts.versionBuildId }
            : { version: "ui-test" },
        ),
      });
      return;
    }
    if (
      req.resourceType() === "document" &&
      (url.pathname === "/" || url.pathname === "")
    ) {
      docLoads++;
      if (docLoads <= opts.staleDocs) {
        // Fetch the ORIGINAL shell via the API request context (bypasses the
        // page routes), then serve it as a "stale deploy": dead chunk hash +
        // stale cache-nuke token — exactly what an old SW precache serves.
        const res = await page.request.get(req.url());
        const html = await res.text();
        const stale = html
          .replace(/index-[A-Za-z0-9_-]{8}\.js/g, "index-STALEDEAD.js")
          .replace(/cache-nuke\.js\?v=[^"'&\s]+/g, `cache-nuke.js?v=${STALE_BUILD}`);
        await route.fulfill({
          status: res.status(),
          contentType: "text/html; charset=utf-8",
          body: stale,
        });
        return;
      }
    }
    await route.continue();
  });
  return { docs: () => docLoads };
}

function trackLoads(page: Page): void {
  void page.addInitScript(() => {
    try {
      const n = Number(sessionStorage.getItem("__e2e_doc_loads") || "0") + 1;
      sessionStorage.setItem("__e2e_doc_loads", String(n));
    } catch {
      /* storage unavailable — load assertions degrade, banner still works */
    }
  });
}

async function loadCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    Number(sessionStorage.getItem("__e2e_doc_loads") || "0"),
  );
}

async function waitForShellBoot(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const root = document.getElementById("root");
    return !!root && root.children.length > 0 && !document.getElementById("boot-splash");
  }, undefined, { timeout: 20_000 });
}

test.beforeEach(async ({ request }) => {
  await request.get("/api/__e2e/reset");
});

test("stale HTML shell + poisoned localStorage: auto-heals with ONE reload and boots", async ({ page }) => {
  // Sanity: the served shell really carries a cache-bust token — and the
  // "live" server build id in this scenario IS that token (a fresh shell
  // always matches /api/version).
  const liveToken = await servedHtmlToken(page.request);
  expect(liveToken).not.toBe("");

  const tracker = await installRoutes(page, { staleDocs: 1, versionBuildId: liveToken });
  trackLoads(page);
  // Poison exactly like the incident: the browser already stored the LIVE
  // build id while holding a STALE shell — the old version-check passed forever.
  await page.addInitScript((bid) => {
    try {
      localStorage.setItem("elbaz_build_id", bid);
    } catch {
      /* ignore */
    }
  }, liveToken);

  await page.goto("/");
  await waitForShellBoot(page);
  await expect(page.locator(BANNER)).toHaveCount(0);
  const loads = await loadCount(page);
  expect(loads).toBeLessThanOrEqual(2);
  expect(tracker.docs()).toBeGreaterThanOrEqual(2); // stale load + fresh load happened
});

test("persistently stale shell: cap stops the loop and the guidance banner renders", async ({ page }) => {
  const liveToken = await servedHtmlToken(page.request);
  expect(liveToken).not.toBe("");
  const tracker = await installRoutes(page, {
    staleDocs: Number.POSITIVE_INFINITY,
    versionBuildId: liveToken,
  });
  trackLoads(page);
  await page.addInitScript((bid) => {
    try {
      localStorage.setItem("elbaz_build_id", bid);
    } catch {
      /* ignore */
    }
  }, liveToken);

  await page.goto("/");
  await expect(page.locator(BANNER)).toBeVisible({ timeout: 30_000 });
  // Loop firewall: initial load + at most 2 nuke reloads, then STOP.
  expect(tracker.docs()).toBeLessThanOrEqual(3);
  const loads = await loadCount(page);
  expect(loads).toBeLessThanOrEqual(3);
  await page.waitForTimeout(3000);
  expect(await loadCount(page)).toBe(loads); // nothing reloads anymore — loop impossible
});

test("edge challenge on tRPC (403 + cf-mitigated): one recovery navigation, then banner; shell still renders", async ({ page }) => {
  const tracker = await installRoutes(page, { staleDocs: 0, versionBuildId: null });
  trackLoads(page);
  await page.route("**/api/trpc/**", async (route) => {
    await route.fulfill({
      status: 403,
      headers: { "cf-mitigated": "challenge" },
      contentType: "text/html; charset=utf-8",
      body: "<html><body>challenge</body></html>",
    });
  });

  await page.goto("/");
  // First load: shell boots, detector fires, ONE sanctioned reload happens.
  await expect
    .poll(() => loadCount(page), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
  // Second load: challenge persists → banner, and NO further reloads.
  await expect(page.locator(BANNER)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);
  expect(await loadCount(page)).toBeLessThanOrEqual(2);
  expect(tracker.docs()).toBeLessThanOrEqual(2);
  // The app shell itself is healthy — React mounted (only the data layer was
  // challenged). This is the exact "site looks broken" UX the detector now
  // turns into an actionable message.
  await waitForShellBoot(page);
});

test("legit JSON 403 (API-level rejection) never triggers recovery", async ({ page }) => {
  await installRoutes(page, { staleDocs: 0, versionBuildId: null });
  trackLoads(page);
  await page.route("**/api/trpc/auth.me**", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "FORBIDDEN", message: "json 403" } }),
    });
  });

  await page.goto("/");
  await waitForShellBoot(page);
  await page.waitForTimeout(2000);
  await expect(page.locator(BANNER)).toHaveCount(0);
  expect(await loadCount(page)).toBe(1); // no reload at all
});
