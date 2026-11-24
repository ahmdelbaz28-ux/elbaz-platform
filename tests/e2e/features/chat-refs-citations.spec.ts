/**
 * E2E — TECHNICAL REFERENCES rendering contract (agent-architecture-audit
 * layer 10: platform rendering must never mutate or drop a valid answer):
 *   1. the markdown price table renders through the app's documented
 *      table→bullets transform (chat-format.convertMarkdownTables) — every
 *      labelled cell survives, no raw pipe rows leak through;
 *   2. Latin Product IDs inside RTL text stay verbatim (no bidi mangling);
 *   3. the citation lines survive to the user verbatim, LAST in the bubble.
 * Runs against the offline UI test server in "refs-citations" stream mode
 * (deterministic chunks — no model variance, no real API cost).
 */
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const SEND_LABEL = "Send";
const QUESTION = "من قائمة أسعار شنايدر: قاطع Masterpact 1600 أمبير بالـ Product ID والسعر";
const CITATION_SCHNEIDER =
  "[Schneider Electric Egypt — Breakers & Switches Price List 2026، 1 - ACB Range، ص.10، Product ID: TABEAAANN]";
const CITATION_DPS = "[SEC DPS-01 — Estimation of Customer Load Guideline، Table 11، ص.32]";

async function setStreamMode(request: APIRequestContext, mode: string): Promise<void> {
  await request.get(`/api/__e2e/stream-mode?mode=${encodeURIComponent(mode)}`);
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
  await context.addCookies([
    { name: "elbaz_auth_flag", value: "1", url: "http://localhost:4173" },
  ]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "elbaz_cookie_consent",
        JSON.stringify({ necessary: true, analytics: false, marketing: false }),
      );
    } catch { /* storage unavailable */ }
  });
  await request.get("/api/__e2e/reset");
});

test("refs answer renders the price table as a real table with verbatim Product IDs", async ({ page, request }) => {
  await setStreamMode(request, "refs-citations");
  await openChatAndSend(page);

  // the streamed reply bubble completes (stop button back to send = done)
  const bubble = page.locator(".chatbot-bubble").last();
  await expect(bubble).toContainText("Masterpact MTZ1", { timeout: 15_000 });

  // 1) markdown table → the documented bullets transform, every cell intact
  await expect(bubble).toContainText("Product ID: TABEAAANN");
  await expect(bubble).toContainText("196,383");
  await expect(bubble).toContainText("215,104");
  // no raw pipe row leaks through the transform
  expect(await bubble.innerText()).not.toMatch(/\|\s*---/);

  // 2) citation lines survive verbatim — condition-wait for the LAST chunk
  // (streaming), then assert on DOM text order (textContent), NOT innerText:
  // bidi visual reordering would reshuffle the Latin/Arabic runs of a mixed
  // citation line while the actual characters are intact.
  await expect(bubble).toContainText(CITATION_DPS, { timeout: 15_000 });
  const text = await bubble.textContent();
  expect(text).toContain(CITATION_SCHNEIDER);
  expect(text).toContain(CITATION_DPS);
  expect((text ?? "").trimEnd().endsWith(CITATION_DPS)).toBe(true);
});
