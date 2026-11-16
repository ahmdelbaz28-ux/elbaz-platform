// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTION PROBE — the HARD "subscribe to the channel before watching"
// gate (owner contract 2026). Verifies on the LIVE server that:
//
//   UI  1. a guest opening ANY accessible lesson video sees the gate
//       2. NO player / no YouTube iframe exists while gated
//       3. the ONLY unlock is the enforced flow (open channel → confirm)
//       4. after the flow the player mounts
//
//   API 5. course.previewVideo WITHOUT a ticket ⇒ 403 SUBSCRIBE_REQUIRED
//       6. course.completeSubscribeUnlock ⇒ issues a signed ticket
//       7. course.previewVideo WITH the ticket ⇒ 200 kind=youtube
//       8. (authed) register+login a throwaway student: lessonVideo without
//          ticket ⇒ 403 — with ticket ⇒ 200
//
// Usage:
//   FWD_HOST=ahmedelbaz.qzz.io BASE_URL=https://ahmdelbaz28-ahmdrtap.hf.space \
//     node scripts/subscribe_gate_prod_check.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const fwd = process.env.FWD_HOST ? { "X-Forwarded-Host": process.env.FWD_HOST, "X-Forwarded-Proto": "https" } : undefined;
const headers = fwd || {};

let fails = 0;
let count = 0;
const check = (name, pass, detail = "") => {
  count += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!pass) fails += 1;
};

const GATE = "[data-testid='subscribe-gate']";
const GATE_OPEN = "[data-testid='subscribe-gate-open']";
const GATE_UNLOCK = "[data-testid='subscribe-gate-unlock']";
const YT_PLAYER = "[data-youtube-player]";

/** Same-origin tRPC GET fetch inside the page (shares cookies + shield). */
async function trpcGet(page, proc, input) {
  const qs = encodeURIComponent(JSON.stringify({ json: input }));
  return page.evaluate(async ({ url }) => {
    const r = await fetch(url, { credentials: "include" });
    let body = null;
    try { body = await r.json(); } catch { /* html */ }
    return { status: r.status, body };
  }, { url: `/api/trpc/${proc}?input=${qs}` });
}

async function trpcPost(page, proc, input) {
  return page.evaluate(async ({ url, payload }) => {
    const r = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: payload }),
    });
    let body = null;
    try { body = await r.json(); } catch { /* html */ }
    return { status: r.status, body };
  }, { url: `/api/trpc/${proc}`, payload: input });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  if (headers && Object.keys(headers).length) await ctx.setExtraHTTPHeaders(headers);
  // Pre-accept the cookie banner — its full-screen backdrop would otherwise
  // intercept every click below (same root cure as the E2E specs).
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "elbaz_cookie_consent",
        JSON.stringify({ necessary: true, analytics: false, marketing: false }),
      );
    } catch { /* storage unavailable */ }
  });

  // ── Find a course with a FREE (guest-accessible) lesson ──
  // Harvest course slugs straight from the /courses page (real navigation
  // path — no dependence on the list API's pagination envelope).
  await page.goto(`${BASE}/courses`, { waitUntil: "load", timeout: 45000 });
  await page.waitForSelector("#main-content", { timeout: 30000 });
  await page.waitForTimeout(1200); // course cards hydrate
  const hrefs = await page.$$eval("a[href^='/courses/']", (as) =>
    as.map((a) => a.getAttribute("href")).filter((h) => h && h.length > "/courses/".length),
  );
  const slugs = [...new Set(hrefs.map((h) => h.replace("/courses/", "").split(/[?#]/)[0]))];
  check("course links harvested from /courses", slugs.length > 0, `found ${slugs.length}`);

  let slug = null;
  let freeLessonId = null;
  for (const s of slugs.slice(0, 8)) {
    const bySlug = await trpcGet(page, "course.bySlug", { slug: s });
    const course = bySlug?.body?.result?.data?.json;
    const freeLesson = course?.lessons?.find((l) => l.isFree && l.isPublished !== false);
    if (freeLesson) { slug = s; freeLessonId = freeLesson.id; break; }
  }
  check("guest-accessible lesson found", !!slug && !!freeLessonId, `slug=${slug} lesson=${freeLessonId}`);

  // ── UI: gate blocks playback ──
  await page.goto(`${BASE}/courses/${slug}`, { waitUntil: "load", timeout: 45000 });
  await page.waitForSelector("#main-content", { timeout: 30000 });
  const lessonBtn = page.locator("button").filter({ hasText: /\d+\./ }).first();
  await lessonBtn.waitFor({ state: "visible", timeout: 20000 });
  await lessonBtn.click();

  await page.waitForSelector(GATE, { timeout: 15000 });
  check("gate visible for guest on lesson click", true);

  const playerCount = await page.locator(YT_PLAYER).count();
  const iframeCount = await page.locator("iframe[src*='youtube']").count();
  check("no player/iframe while gated", playerCount === 0 && iframeCount === 0, `player=${playerCount} iframe=${iframeCount}`);

  const unlockBefore = await page.locator(GATE_UNLOCK).count();
  check("no skip path (unlock hidden before subscribe click)", unlockBefore === 0);

  // ── API: previewVideo without ticket must be REFUSED ──
  const denied = await trpcGet(page, "course.previewVideo", { lessonId: freeLessonId });
  const deniedMsg = denied?.body?.error?.json?.message || "";
  check("previewVideo w/o ticket ⇒ 403 SUBSCRIBE_REQUIRED", denied.status === 403 && deniedMsg.includes("SUBSCRIBE_REQUIRED"), `status=${denied.status} msg=${deniedMsg.slice(0, 60)}`);

  // ── API: the ONLY unlock — completeSubscribeUnlock issues a ticket ──
  const unlock = await trpcPost(page, "course.completeSubscribeUnlock", { deviceId: `dprodprobe-${Date.now().toString(36)}` });
  const ticket = unlock?.body?.result?.data?.json?.ticket;
  check("completeSubscribeUnlock issues a ticket", unlock.status === 200 && typeof ticket === "string" && ticket.includes("."), `status=${unlock.status} hasTicket=${!!ticket}`);

  // ── API: with the ticket the video answers ──
  const allowed = await trpcGet(page, "course.previewVideo", { lessonId: freeLessonId, subTicket: ticket });
  const allowedData = allowed?.body?.result?.data?.json || {};
  check("previewVideo with ticket ⇒ 200 kind=youtube", allowed.status === 200 && allowedData.kind === "youtube", `status=${allowed.status} kind=${allowedData.kind}`);

  // ── UI: complete the flow → player mounts ──
  await page.locator(GATE_OPEN).click();
  await page.waitForSelector(GATE_UNLOCK, { timeout: 10000 });
  await page.locator(GATE_UNLOCK).click();
  await page.waitForSelector(YT_PLAYER, { timeout: 20000 });
  const gateAfter = await page.locator(GATE).count();
  const playerAfter = await page.locator(YT_PLAYER).count();
  check("flow completion mounts the player", gateAfter === 0 && playerAfter === 1, `gate=${gateAfter} player=${playerAfter}`);

  // ── AUTHED path: throwaway student + lessonVideo server gate ──
  const uname = `gateprobe${Date.now().toString(36).slice(-8)}`;
  const password = `Gp${Date.now().toString(36)}A1b`;
  const reg = await trpcPost(page, "auth.register", { username: uname, password, name: "Gate Probe" });
  const regOk = reg.status === 200;
  check("throwaway student registered", regOk, `status=${reg.status}`);

  if (regOk) {
    const login = await trpcPost(page, "auth.login", { username: uname, password, remember: false });
    check("throwaway student logged in", login.status === 200, `status=${login.status}`);

    // lessonVideo WITHOUT ticket ⇒ 403 SUBSCRIBE_REQUIRED
    const lvDenied = await trpcGet(page, "course.lessonVideo", { lessonId: freeLessonId });
    const lvMsg = lvDenied?.body?.error?.json?.message || "";
    check("lessonVideo w/o ticket ⇒ 403 SUBSCRIBE_REQUIRED", lvDenied.status === 403 && lvMsg.includes("SUBSCRIBE_REQUIRED"), `status=${lvDenied.status} msg=${lvMsg.slice(0, 60)}`);

    // lessonVideo WITH the guest device ticket (device-level unlock ⇒ valid)
    const lvAllowed = await trpcGet(page, "course.lessonVideo", { lessonId: freeLessonId, subTicket: ticket });
    check("lessonVideo with ticket ⇒ 200", lvAllowed.status === 200, `status=${lvAllowed.status}`);
  }

  await browser.close();

  console.log(`\n═══ RESULT: ${count - fails}/${count} PASS${fails === 0 ? " — subscribe gate fully enforced on production" : " — FAILURES ABOVE"}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
