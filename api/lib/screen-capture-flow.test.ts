/**
 * LIVE SCREEN-CAPTURE FLOW tests — the "teacher beside you" vision lane.
 *
 * Covers the three server-side seams of the feature:
 *   1. normalizeChatInput (api/lib/chatbot-normalize.ts) — the
 *      `source: "screen_capture"` tag is honored ONLY on the last user
 *      message, unknown tags are ignored, size/count guards still hold.
 *   2. getSystemPrompt — screenCapture=true arms the screen-teacher block
 *      (grounded step-by-step guidance, zero guessing) and REPLACES the
 *      generic vision block; false keeps the exact legacy behavior.
 *   3. visionExtractionPrompt — the screen variant demands verbatim UI text,
 *      explicit "[غير مقروء]" for unreadable values and "not visible" for
 *      absent elements — the no-guessing contract at the READ pass.
 */

import { describe, it, expect, vi } from "vitest";

// chatbot-vision.js pulls ./chatbot.js → ./env.js (env validation) — mock the
// provider layer so the extraction-prompt tests stay pure (same pattern as
// chatbot-vision.test.ts). visionExtractionPrompt itself touches none of it.
vi.mock("./chatbot.js", () => ({
  GROQ_API_KEY: "",
  GROQ_VISION_MODEL: "meta-llama/llama-4-scout-17b-16e-instruct",
  tryGroq: vi.fn(async () => null),
  tryOpenRouterVision: vi.fn(async () => null),
}));
vi.mock("./ai-router.js", () => ({
  routeChatCompletion: vi.fn(async () => ({ ok: false })),
  isDiscoveredModelId: vi.fn(() => false),
}));

import { normalizeChatInput } from "./chatbot-normalize";
import { getSystemPrompt } from "./chatbot-prompts";
import { visionExtractionPrompt } from "./chatbot-vision";

const IMG = "data:image/jpeg;base64,AAAA"; // 4 chars — far below the cap

const parts = (text: string, url: string, source?: string) => [
  { type: "text", text },
  { type: "image_url", image_url: { url }, ...(source !== undefined ? { source } : {}) },
];

// ─── 1) normalizeChatInput — screen_capture flag threading ──────────────────

describe("normalizeChatInput — screen_capture flag", () => {
  it("marks a screen_capture-tagged image on the LAST user message", () => {
    const res = normalizeChatInput([
      { role: "user", content: "سؤال سابق" },
      { role: "assistant", content: "جواب سابق" },
      { role: "user", content: parts("وين أنا في البرنامج؟", IMG, "screen_capture") },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.vision).toBe(true);
    expect(res.data.screenCapture).toBe(true);
    expect(res.data.imageCount).toBe(1);
  });

  it("ignores the tag on a plain file attachment (no source)", () => {
    const res = normalizeChatInput([{ role: "user", content: parts("حلل الصورة", IMG) }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.vision).toBe(true);
    expect(res.data.screenCapture).toBe(false);
  });

  it("rejects unknown source tags (never trusted)", () => {
    const res = normalizeChatInput([{ role: "user", content: parts("سؤال", IMG, "screen") }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.screenCapture).toBe(false);
  });

  it("flattens screen-tagged images in HISTORY (only the last user message counts)", () => {
    const res = normalizeChatInput([
      { role: "user", content: parts("لقطة قديمة", IMG, "screen_capture") },
      { role: "assistant", content: "رد قديم" },
      { role: "user", content: "سؤال نصي بدون صور" },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.vision).toBe(false);
    expect(res.data.screenCapture).toBe(false);
    const first = res.data.messages[0];
    expect(typeof first.content).toBe("string");
    expect(first.content).toContain("[صورة مرفقة]");
  });

  it("keeps the no-images contract (vision=false, screenCapture=false)", () => {
    const res = normalizeChatInput([{ role: "user", content: "ايه فايدة ETAP؟" }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.vision).toBe(false);
    expect(res.data.screenCapture).toBe(false);
  });

  it("still enforces the image count guard", () => {
    const res = normalizeChatInput([{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: IMG } },
        { type: "image_url", image_url: { url: IMG } },
        { type: "image_url", image_url: { url: IMG } },
      ],
    }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.status).toBe(400);
    expect(res.failure.code).toBe("BAD_INPUT");
  });

  it("still rejects remote (non data:) image URLs", () => {
    const res = normalizeChatInput([{ role: "user", content: parts("سؤال", "https://evil.example/steal.png", "screen_capture") }]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.failure.status).toBe(413);
    expect(res.failure.code).toBe("TOO_LARGE");
  });
});

// ─── 2) getSystemPrompt — the screen-teacher block ───────────────────────────

describe("getSystemPrompt — screen teacher mode", () => {
  it("AR thinking: arms the teacher block and replaces the generic vision block", () => {
    const p = getSystemPrompt("ar", "thinking", undefined, true, undefined, undefined, true);
    expect(p).toContain("وضع المعلّم المباشر");
    expect(p).toContain("ممنوع التخمين");
    expect(p).toContain("Process → Run Load Flow");
    expect(p).toContain("لا تفترض قيمتها أبدًا");
    expect(p).not.toContain("وضع تحليل الصور");
  });

  it("EN instant: arms the teacher block too (both modes/languages)", () => {
    const p = getSystemPrompt("en", "instant", undefined, true, undefined, undefined, true);
    expect(p).toContain("LIVE SCREEN TEACHER MODE");
    expect(p).toContain("guessing is absolutely forbidden");
    expect(p).not.toContain("IMAGE ANALYSIS MODE");
  });

  it("plain attachment (vision, no screenCapture) keeps the legacy vision block", () => {
    const p = getSystemPrompt("ar", "thinking", undefined, true);
    expect(p).toContain("وضع تحليل الصور");
    expect(p).not.toContain("وضع المعلّم المباشر");
  });

  it("text-only requests carry neither block (screenCapture alone never arms it)", () => {
    const noVision = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, true);
    expect(noVision).not.toContain("وضع المعلّم المباشر");
    const plain = getSystemPrompt("ar", "thinking");
    expect(plain).not.toContain("وضع تحليل الصور");
    expect(plain).not.toContain("وضع المعلّم المباشر");
  });
});

// ─── 3) visionExtractionPrompt — the READ-pass no-guessing contract ─────────

describe("visionExtractionPrompt — screen variant", () => {
  it("AR screen variant: verbatim UI reading + explicit unreadable/absent markers", () => {
    const p = visionExtractionPrompt("ar", true);
    expect(p).toContain("لقطة مباشرة من شاشة حاسوب المستخدم");
    expect(p).toContain("[غير مقروء]");
    expect(p).toContain("غير ظاهر في اللقطة");
    expect(p).toContain("وصف الشاشة فقط");
    // reading focus: active window + selected element + verbatim menu names
    expect(p).toContain("عنوان النافذة النشطة");
    expect(p).toContain("العنصر المحدد/النشط");
  });

  it("EN screen variant carries the same contract", () => {
    const p = visionExtractionPrompt("en", true);
    expect(p).toContain("LIVE frame of the user's computer screen");
    expect(p).toContain("[unreadable]");
    expect(p).toContain("not visible in this frame");
  });

  it("no screenCapture → the generic image-extraction prompt (unchanged)", () => {
    const p = visionExtractionPrompt("ar");
    expect(p).not.toContain("لقطة مباشرة من شاشة حاسوب المستخدم");
    expect(p).toContain("وصفاً واقعياً كاملاً");
    expect(p).toContain("[غير مقروء]");
  });
});
