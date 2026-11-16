/**
 * E2E — 🔒 Subscribe-to-the-channel HARD gate (owner contract 2026).
 *
 * Opening ANY course lesson video REQUIRES completing the subscribe flow
 * first — otherwise the video never opens. Enforced on BOTH layers:
 *
 *   UI layer (SubscribeGate): no skip button; the only path is
 *     «اشترك الآن» → YouTube → back → «اشتركت» → server-issued ticket.
 *
 *   API layer (stub server mirrors the REAL contract): while gated,
 *     lessonVideo/previewVideo answer 403 SUBSCRIBE_REQUIRED; the client
 *     must not even ASK for the video before unlocking; after unlocking
 *     every video fetch carries the signed ticket; a forged localStorage
 *     marker gets re-locked by the server's answer (self-heal).
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
const YT_PLAYER = "[data-youtube-player]";

interface TrpcStubState {
  gateMode: string;
  previewVideoCalls: Array<{ hasTicket: boolean; ticket: string | null }>;
  lessonVideoCalls: Array<{ hasTicket: boolean; ticket: string | null }>;
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

test("guest: the gate blocks playback completely — no player, no video request", async ({ page, request }) => {
  await openLesson(page);

  await expect(page.locator(GATE)).toBeVisible();
  // NOTHING player-like exists anywhere: no player mount, no YouTube frame.
  await expect(page.locator(YT_PLAYER)).toHaveCount(0);
  await expect(page.locator("iframe[src*='youtube']")).toHaveCount(0);
  // NO skip path: the unlock button does not exist before the subscribe click.
  await expect(page.locator(GATE_UNLOCK)).toHaveCount(0);
  // The client must not even ASK the server for the video while gated.
  const state = await trpcState(request);
  expect(state.previewVideoCalls.length).toBe(0);
});

test("guest: completing the flow is the ONLY unlock — and it mounts the player", async ({ page, request }) => {
  await openLesson(page);
  await expect(page.locator(GATE)).toBeVisible();

  await completeSubscribeFlow(page);

  // Gate gone, player mounted.
  await expect(page.locator(GATE)).toHaveCount(0);
  await expect(page.locator(YT_PLAYER)).toBeVisible();

  // Wire contract: the unlock went through the server, and the video fetch
  // carried the ticket (server-anchored, not a UI-only trick).
  const state = await trpcState(request);
  expect(state.unlockCalls).toBeGreaterThanOrEqual(1);
  expect(state.previewVideoCalls.length).toBeGreaterThanOrEqual(1);
  expect(state.previewVideoCalls.every((c) => c.hasTicket)).toBe(true);
});

test("guest: unlock persists across reload — no gate, player ready", async ({ page }) => {
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

test("authed student: the same hard gate applies before lessonVideo", async ({ page, request, context }) => {
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

test("self-heal: a forged unlock marker is re-locked by the server answer", async ({ page, request }) => {
  // Seed the UI marker WITHOUT a ticket — simulates a tampered device.
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
  expect(state.previewVideoCalls.length).toBeGreaterThanOrEqual(1);

  await expect(page.locator(GATE)).toBeVisible();
  await expect(page.locator(YT_PLAYER)).toHaveCount(0);
  // The forged marker was purged by the self-heal.
  const cleared = await page.evaluate(() => localStorage.getItem("elbaz-sub-gate-unlock"));
  expect(cleared).toBeNull();
});
