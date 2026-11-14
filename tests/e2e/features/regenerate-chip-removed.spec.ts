/**
 * E2E — ↻ Regenerate chip REMOVED (owner directive 2026-11-14):
 * "بعد رد المساعد الذكي ليظهر في الشات كلمة regenerate reply — مش عاوز دي تظهر"
 * After the assistant's reply completes, NO "Regenerate reply" control may
 * exist anywhere in the chat — neither in English ("Regenerate reply") nor
 * in Arabic ("إعادة توليد الرد"), as a button, title, or aria-label.
 */
import { test, expect, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const SEND_LABEL = "Send";
const QUESTION = "What is ETAP used for?";

async function openChatAndSend(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Open AI Assistant" }).click();
  const input = page.getByLabel("Type your message");
  await expect(input).toBeVisible();
  await input.fill(QUESTION);
  await page.getByRole("button", { name: SEND_LABEL }).click();
}

test.beforeEach(async ({ request, context, page }) => {
  // The auth flag cookie enables the auth.me query → the FAB opens the chat.
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

test("after the assistant's reply completes, no regenerate control exists in the chat", async ({ page }) => {
  await openChatAndSend(page);

  // The reply streams to completion.
  await expect(page.getByText("قبل اكتمال الرد بالكامل.").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: SEND_LABEL })).toBeVisible();

  // NOTHING matching the regenerate control may exist — English, Arabic,
  // or as accessible name (title/aria-label), anywhere on the page.
  await expect(page.getByText("Regenerate reply")).toHaveCount(0);
  await expect(page.getByText("إعادة توليد الرد")).toHaveCount(0);
  await expect(page.getByText("اطلب رداً جديداً على نفس السؤال")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /regenerate/i })).toHaveCount(0);
  await expect(page.locator('[aria-label*="Regenerate" i], [title*="Regenerate" i], [aria-label*="إعادة توليد"]')).toHaveCount(0);
});
