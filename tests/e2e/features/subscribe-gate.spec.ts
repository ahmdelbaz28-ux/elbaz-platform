/**
 * E2E — 🔒 Login-first + Subscribe-to-the-channel HARD gate (owner contract
 * 2026-11-22: ANY content — video, article, download — requires LOGIN first).
 *
 * Opening ANY course lesson video now requires TWO gates, in order:
 *   1. LOGIN (new): a guest who clicks a lesson sees the login wall —
 *      no subscribe gate, no player, and the client must not even ASK the
 *      server for any video/unlock procedure (previewVideo was REMOVED
 *      server-side; completeSubscribeUnlock is authed-only).
 *   2. SUBSCRIBE (existing): a signed-in user must still complete the
 *      channel-subscribe flow before lessonVideo answers with playback.
 *
 * Enforced on BOTH layers:
 *   UI layer: lesson-login wall for guests; SubscribeGate (no skip button)
 *     for signed-in users: «اشترك الآن» → YouTube → back → «اشتركت» → ticket.
 *   API layer (stub mirrors the REAL contract): while gated, lessonVideo
 *     answers 403 SUBSCRIBE_REQUIRED; completeSubscribeUnlock answers 401
 *     UNAUTHORIZED for guests; a forged localStorage marker gets re-locked
 *     by the server's answer (self-heal).
 *
 * Runs against the offline UI test server (scripts/ui-test-server.mjs).
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// Serial: the stub server carries per-server telemetry (one stub process).
test.describe.configure({ mode: "serial" });

const COURSE_URL = "/courses/etap-basics";
const LESSON_LABEL = /Intro to ETAP/;
const GATE = "[data-testid='subscribe-gate']";
const GATE_OPEN = "[data-testid='subscribe-gate-open']";
const GATE_UNLOCK = "[data-testid='subscribe-gate-unlock']";
const LOGIN_WALL = "[data-testid='lesson-login-wall']";
const YT_PLAYER = "[data-youtube-player]";

interface TrpcStubState {
  gateMode: string;
  previewVideoCalls: Array<{ hasTicket: boolean; ticket: string | null }>;
  lessonVideoCalls: Array<{ hasTicket: boolean; ticket: string | null }>;
  unauthVideoCalls: number;
  unlockCalls: number;
}

async function trpcState(request: APIRequestContext): Promise<TrpcStubState> {
  const res = await request.get("/api/__e2e/trpc-state");
  return (await res.json()) as TrpcStubState;
}

async function openLesson(page: Page): Promise<void> {
  await page.goto(COURSE_URL);
  const lesson = page.getByRole("button", { name: LESSON_LABEL });
  await expect(lesson).toBeVisible();
  await lesson.click();
}

async function completeSubscribeFlow(page: Page): Promise<void> {
  await page.locator(GATE_OPEN).click();
  // The confirm step arms AFTER the subscribe click — before it, NO unlock
  // path exists at all (the gate has no skip button).
  await expect(page.locator(GATE_UNLOCK)).toBeVisible();
  await page.locator(GATE_UNLOCK).click();
}

test.beforeEach(async ({ request, page }) => {
  await request.get("/api/__e2e/reset");
  // Pre-accept the cookie banner so it never intercepts interactions.
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "elbaz_cookie_consent",
        JSON.stringify({ necessary: true, analytics: false, marketing: false }),
      );
    } catch { /* storage unavailable — the banner is dismissible anyway */ }
  });
});

test("guest: clicking a lesson shows the LOGIN wall — no gate, no player, zero video requests", async ({ page, request }) => {
  await openLesson(page);

  // The LOGIN wall is the ONLY thing in the video slot.
  await expect(page.locator(LOGIN_WALL)).toBeVisible();
  // No subscribe gate for guests — login comes FIRST (owner contract).
  await expect(page.locator(GATE)).toHaveCount(0);
  await expect(page.locator(GATE_UNLOCK)).toHaveCount(0);
  // NOTHING player-like exists anywhere: no player mount, no YouTube frame.
  await expect(page.locator(YT_PLAYER)).toHaveCount(0);
  await expect(page.locator("iframe[src*='youtube']")).toHaveCount(0);

  // Wire contract: the client never even ASKS for a video or an unlock
  // ticket while logged out (previewVideo was removed server-side entirely).
  const state = await trpcState(request);
  expect(state.lessonVideoCalls.length).toBe(0);
  expect(state.previewVideoCalls.length).toBe(0);
  expect(state.unlockCalls).toBe(0);
  expect(state.unauthVideoCalls).toBe(0);
});

test("guest wire contract: anonymous unlock attempt answers 401 UNAUTHORIZED", async ({ request }) => {
  // Direct API call mirroring a hand-crafted request — the real server
  // (authMutation) throws UNAUTHORIZED; the stub mirrors it.
  const res = await request.post("/api/trpc/course.completeSubscribeUnlock", {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body?.error?.json?.data?.code).toBe("UNAUTHORIZED");
});

test("authed student: the subscribe gate applies before lessonVideo — then the player mounts", async ({ page, request, context }) => {
  // The auth flag cookie enables the auth.me query (answered by the stub).
  await context.addCookies([
    { name: "elbaz_auth_flag", value: "1", url: "http://localhost:4173" },
  ]);
  await openLesson(page);

  await expect(page.locator(GATE)).toBeVisible();
  await expect(page.locator(YT_PLAYER)).toHaveCount(0);
  const pre = await trpcState(request);
  expect(pre.lessonVideoCalls.length).toBe(0); // never asked while gated

  await completeSubscribeFlow(page);

  await expect(page.locator(GATE)).toHaveCount(0);
  await expect(page.locator(YT_PLAYER)).toBeVisible();
  const post = await trpcState(request);
  expect(post.unlockCalls).toBeGreaterThanOrEqual(1);
  expect(post.lessonVideoCalls.length).toBeGreaterThanOrEqual(1);
  expect(post.lessonVideoCalls.every((c) => c.hasTicket)).toBe(true);
});

test("authed student: unlock persists across reload — no gate, player ready", async ({ page, context }) => {
  await context.addCookies([
    { name: "elbaz_auth_flag", value: "1", url: "http://localhost:4173" },
  ]);
  await openLesson(page);
  await expect(page.locator(GATE)).toBeVisible();
  await completeSubscribeFlow(page);
  await expect(page.locator(YT_PLAYER)).toBeVisible();

  await page.reload();
  const lesson = page.getByRole("button", { name: LESSON_LABEL });
  await expect(lesson).toBeVisible();
  await lesson.click();

  // Already unlocked on this device: no gate, straight to the player.
  await expect(page.locator(GATE)).toHaveCount(0);
  await expect(page.locator(YT_PLAYER)).toBeVisible();
});

test("self-heal: a forged unlock marker is re-locked by the server answer", async ({ page, request, context }) => {
  // Signed-in user (the only one who can reach the gate) seeds the UI marker
  // WITHOUT a ticket — simulates a tampered device.
  await context.addCookies([
    { name: "elbaz_auth_flag", value: "1", url: "http://localhost:4173" },
  ]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "elbaz-sub-gate-unlock",
        JSON.stringify({ until: Date.now() + 30 * 24 * 60 * 60 * 1000, via: "forged" }),
      );
    } catch { /* ignore */ }
  });
  await openLesson(page);

  // The forged marker made the client ASK; the server answered
  // SUBSCRIBE_REQUIRED; the device must re-lock itself — no reload.
  const state = await trpcState(request);
  expect(state.lessonVideoCalls.length).toBeGreaterThanOrEqual(1);

  await expect(page.locator(GATE)).toBeVisible();
  await expect(page.locator(YT_PLAYER)).toHaveCount(0);
  // The forged marker was purged by the self-heal.
  const cleared = await page.evaluate(() => localStorage.getItem("elbaz-sub-gate-unlock"));
  expect(cleared).toBeNull();
});
