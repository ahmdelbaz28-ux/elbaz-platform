/**
 * E2E — ⏹ Stop button (owner request 2026-11-14): the send button transforms
 * into a stop button the moment a message is sent, and pressing it aborts
 * the assistant's response FOR REAL:
 *   1. the in-flight SSE request dies (the test server sees the disconnect);
 *   2. nothing resurrects it — no silent retry, no non-stream fallback
 *      (the root bug this feature had to cure: the retry loop treated an
 *      abort as "unreachable" and the fallback fired a brand-new request);
 *   3. whatever text already streamed in is frozen as a real reply bubble;
 *   4. a stop before any text stays silent — never a soft-busy note.
 *
 * Runs against the offline UI test server (scripts/ui-test-server.mjs) whose
 * SSE stub streams a slow Arabic reply and records what happened to the
 * connection (/api/__e2e/stream-state).
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// The three journeys share one stub server with per-server telemetry — they
// must run one at a time (playwright.config has fullyParallel: true).
test.describe.configure({ mode: "serial" });

const STOP_LABEL = "Stop the assistant's response";
const SEND_LABEL = "Send";
const QUESTION = "What is ETAP used for?";

interface StreamState {
  requests: number;
  completed: number;
  aborted: number;
  lastAborted: boolean;
  lastCompleted: boolean;
  chunksSent: number;
  lastText: string;
  mode: string;
}

async function serverState(request: APIRequestContext): Promise<StreamState> {
  const res = await request.get("/api/__e2e/stream-state");
  return (await res.json()) as StreamState;
}

async function openChatAndSend(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Open AI Assistant" }).click();
  const input = page.getByLabel("Type your message");
  await expect(input).toBeVisible();
  await input.fill(QUESTION);
  await page.getByRole("button", { name: SEND_LABEL }).click();
}

test.beforeEach(async ({ request, context, page }) => {
  // The auth flag cookie enables the auth.me query → the FAB opens the chat
  // instead of redirecting to /login (auth.me is answered by the stub).
  await context.addCookies([
    { name: "elbaz_auth_flag", value: "1", url: "http://localhost:4173" },
  ]);
  // Pre-accept the cookie banner so it never intercepts the first click.
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "elbaz_cookie_consent",
        JSON.stringify({ necessary: true, analytics: false, marketing: false }),
      );
    } catch { /* storage unavailable — the banner is dismissible anyway */ }
  });
  await request.get("/api/__e2e/reset");
});

test("send → stop transformation: the button flips the moment a message goes out, then completes untouched", async ({ page, request }) => {
  await openChatAndSend(page);

  // The send button transforms into the stop button immediately.
  const stop = page.getByRole("button", { name: STOP_LABEL });
  await expect(stop).toBeVisible({ timeout: 3_000 });

  // Left untouched, the reply streams to completion and the button reverts
  // to send.
  const send = page.getByRole("button", { name: SEND_LABEL });
  await expect(send).toBeVisible({ timeout: 20_000 });
  await expect(stop).toHaveCount(0);

  // The FULL reply bubble is committed (the last chunk is on screen).
  await expect(page.getByText("قبل اكتمال الرد بالكامل.").first()).toBeVisible();

  const state = await serverState(request);
  expect(state.requests).toBe(1);
  expect(state.completed).toBe(1);
  expect(state.aborted).toBe(0);
});

test("stop mid-stream: request killed, partial reply frozen, nothing resurrects it", async ({ page, request }) => {
  await openChatAndSend(page);

  const stop = page.getByRole("button", { name: STOP_LABEL });
  await expect(stop).toBeVisible({ timeout: 3_000 });

  // Wait until the first streamed words are on screen, then press STOP.
  await expect(page.getByText("مرحبا بك!").first()).toBeVisible({ timeout: 5_000 });
  await stop.click();

  // The button reverts to send almost immediately (loading cleared).
  const send = page.getByRole("button", { name: SEND_LABEL });
  await expect(send).toBeVisible({ timeout: 3_000 });
  await expect(stop).toHaveCount(0);

  // The partial text is frozen as a real assistant bubble — the words the
  // user actually watched being typed.
  const partial = page.getByText("مرحبا بك!").first();
  await expect(partial).toBeVisible();
  const partialText = (await partial.innerText()).trim();
  expect(partialText.length).toBeGreaterThan(0);
  // Far short of the ~230-char full reply — it really was interrupted.
  expect(partialText.length).toBeLessThan(200);

  // The server saw the client disconnect (the request was really killed).
  const state = await serverState(request);
  expect(state.lastAborted).toBe(true);
  expect(state.lastCompleted).toBe(false);
  expect(state.chunksSent).toBeGreaterThan(0);

  // ✅ ROOT-CURE GUARD: wait past every silent-retry window (3 attempts +
  // backoffs span ~6s). The killed request must NOT be resurrected — the
  // pre-cure behavior re-sent it as a new fetch.
  await page.waitForTimeout(6_000);
  const stateAfter = await serverState(request);
  expect(stateAfter.requests).toBe(1);
  expect(stateAfter.aborted).toBe(1);
  expect(stateAfter.completed).toBe(0);

  // A deliberate stop is never a failure: no soft-busy noise (either language).
  await expect(page.getByText("under heavy load")).toHaveCount(0);
  await expect(page.getByText("الخدمة تمر بضغط عالٍ")).toHaveCount(0);
});

test("stop during the thinking phase: no reply, no busy note, no retry resurrection", async ({ page, request }) => {
  // Thinking phase: the stub holds the first text chunk back for 10s.
  await request.get("/api/__e2e/stream-mode?mode=silent-delay");
  await openChatAndSend(page);

  const stop = page.getByRole("button", { name: STOP_LABEL });
  await expect(stop).toBeVisible({ timeout: 3_000 });
  await stop.click();

  const send = page.getByRole("button", { name: SEND_LABEL });
  await expect(send).toBeVisible({ timeout: 3_000 });

  // Nothing had arrived → no reply bubble and no busy note; the question
  // stays in the conversation untouched.
  await expect(page.getByText("مرحبا بك!")).toHaveCount(0);
  await expect(page.getByText("under heavy load")).toHaveCount(0);
  await expect(page.getByText("الخدمة تمر بضغط عالٍ")).toHaveCount(0);
  await expect(page.getByText(QUESTION).first()).toBeVisible();

  // The server saw the disconnect; the full retry window produces no second
  // request (pre-cure this fired the non-stream fallback here).
  await page.waitForTimeout(6_000);
  const state = await serverState(request);
  expect(state.requests).toBe(1);
  expect(state.lastAborted).toBe(true);
});

// ═════════════════════════════════════════════════════════════════════════════
// Type-ahead + vision retry (proactive professional audit,
// 2026-11-14 — owner directive "do what YOU see is missing"):
//   5. type-ahead — the composer stays editable while the reply streams;
//      Enter mid-stream is swallowed by the guard, never a second request.
//   6. vision retry — an attached image that survived an all-fail outage is
//      CARRIED BACK on the retry request (root-cure: the retry used to drop
//      the image and answer a vision question blindly).
//   (The regenerate chip was REMOVED per owner directive 2026-11-14: no
//   "Regenerate reply" control may appear in the chat UI anymore.)
// ═════════════════════════════════════════════════════════════════════════════

const FULL_REPLY_END = "قبل اكتمال الرد بالكامل.";
const FOLLOW_UP = "How about short circuit analysis?";
const VISION_QUESTION = "What do you see in this diagram?";
// 1x1 PNG — compressImageFile re-encodes it through canvas; the stub only
// asserts an image_url part EXISTED in the request body.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("type-ahead: the composer stays editable mid-stream and sends afterwards", async ({ page, request }) => {
  await openChatAndSend(page);

  // Scope text assertions to the MESSAGES LOG: Playwright's getByText also
  // matches a <textarea>'s current VALUE — the prepared follow-up lives there
  // by design, so the raw page locator would false-positive on it.
  const log = page.getByRole("log", { name: "Chat messages" });

  // Mid-stream (stop button visible): the composer must accept typing.
  const stop = page.getByRole("button", { name: STOP_LABEL });
  await expect(stop).toBeVisible({ timeout: 3_000 });
  const input = page.getByLabel("Type your message");
  await input.fill(FOLLOW_UP);
  await expect(input).toHaveValue(FOLLOW_UP);

  // Enter mid-stream is swallowed by the send guard — no second request and
  // no follow-up MESSAGE bubble (only the composer value).
  await input.press("Enter");
  await page.waitForTimeout(1_500);
  let state = await serverState(request);
  expect(state.requests).toBe(1);
  await expect(log.getByText(FOLLOW_UP)).toHaveCount(0);

  // The reply completes untouched; the prepared follow-up is still in the box.
  await expect(page.getByRole("button", { name: SEND_LABEL })).toBeVisible({ timeout: 20_000 });
  await expect(input).toHaveValue(FOLLOW_UP);

  // And it sends normally as the NEXT message.
  await page.getByRole("button", { name: SEND_LABEL }).click();
  await expect(log.getByText(FOLLOW_UP)).toHaveCount(1);
  state = await serverState(request);
  expect(state.requests).toBe(2);
  expect(state.lastBodyText).toBe(FOLLOW_UP);
});

test("vision retry: the attached image rides the retry request after a full outage", async ({ page, request }) => {
  // Every attempt (stream + fallback) fails with the retryable soft-busy
  // shape → after the silent chain exhausts, the error bubble + Retry appear.
  await request.get("/api/__e2e/stream-mode?mode=all-fail");
  await page.goto("/");
  await page.getByRole("button", { name: "Open AI Assistant" }).click();

  const input = page.getByLabel("Type your message");
  await input.fill(VISION_QUESTION);

  // Attach the image through the hidden file input.
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Attach an image for analysis" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "sld.png", mimeType: "image/png", buffer: TINY_PNG });

  await page.getByRole("button", { name: SEND_LABEL }).click();

  // Silent chain exhausts (3 stream attempts + 3 fallbacks ≈ 8s) → soft note.
  const retry = page.getByRole("button", { name: "Retry" });
  await expect(retry).toBeVisible({ timeout: 20_000 });
  const failedState = await serverState(request);
  expect(failedState.requests).toBe(3); // three dead stream attempts
  expect(failedState.lastBodyHasImage).toBe(true); // even the failed sends carried it

  // Back to healthy, then RETRY — the image MUST ride again (root-cure).
  await request.get("/api/__e2e/stream-mode?mode=normal");
  await retry.click();
  await expect(page.getByText(FULL_REPLY_END).first()).toBeVisible({ timeout: 20_000 });

  const state = await serverState(request);
  expect(state.requests).toBe(4);
  expect(state.lastBodyHasImage).toBe(true);
  expect(state.completed).toBe(1);
});
