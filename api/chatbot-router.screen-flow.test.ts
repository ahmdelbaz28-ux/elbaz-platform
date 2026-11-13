/**
 * CHATBOT ROUTER — LIVE SCREEN FLOW tests (HTTP contract level).
 *
 * Regression lock for the 2026-11-13 root cures, exercised through the REAL
 * Hono router (no server, no DB):
 *   1. A screen_capture-tagged frame sets screenCapture=true on the request
 *      handed to the chatbot engine, on BOTH endpoints.
 *   2. The vision quota runs on the DEDICATED screen lane (key `<ip>#screen`,
 *      limit 60) for live frames — the 5/day attachment lane can no longer
 *      kill an ongoing screen-teacher session after five frames.
 *   3. Exhausted lanes answer 429 QUOTA_EXCEEDED with the lane-specific
 *      message (frames ≠ "صور").
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// ── Hoisted mocks (same pattern as chatbot-feedback-route.test.ts) ──

const resolveOptionalUser = vi.hoisted(() => vi.fn());
vi.mock("./context.js", () => ({ resolveOptionalUser }));

const getClientIpFromHono = vi.hoisted(() => vi.fn(() => "203.0.113.7"));
vi.mock("./lib/client-ip.js", () => ({ getClientIpFromHono }));

const getChatResponse = vi.hoisted(() => vi.fn());
const getStreamResponse = vi.hoisted(() => vi.fn());
vi.mock("./lib/chatbot.js", () => ({ getChatResponse, getStreamResponse }));

const getImageQuotaUsed = vi.hoisted(() => vi.fn());
const incrementImageQuota = vi.hoisted(() => vi.fn());
vi.mock("./lib/image-quota.js", () => ({
  getImageQuotaUsed,
  incrementImageQuota,
  DAILY_IMAGE_LIMIT: 5,
  DAILY_SCREEN_FRAME_LIMIT: 60,
  visionQuotaLane: (screenCapture: boolean, ip: string) =>
    screenCapture
      ? { key: `${ip}#screen`, limit: 60, screen: true }
      : { key: ip, limit: 5, screen: false },
}));

const persistChatRound = vi.hoisted(() => vi.fn());
const getChatHistory = vi.hoisted(() => vi.fn());
const getLatestSummaryText = vi.hoisted(() => vi.fn());
vi.mock("./lib/chat-history.js", () => ({
  persistChatRound,
  getChatHistory,
  getLatestSummaryText,
  maybeUpdateRollingSummary: vi.fn(),
  CHAT_HISTORY_LIMIT: 50,
}));

const getCourseCatalogText = vi.hoisted(() => vi.fn(async () => ""));
const getCourseCatalogLiteText = vi.hoisted(() => vi.fn(async () => ""));
vi.mock("./lib/course-catalog.js", () => ({ getCourseCatalogText, getCourseCatalogLiteText, COURSE_CATALOG_CACHE_KEY: "chatbot:course-catalog", COURSE_CATALOG_LITE_CACHE_KEY: "chatbot:course-catalog-lite" }));

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("./lib/logger.js", () => ({ logger }));

vi.mock("./chatbot-feedback-route.js", () => ({ chatbotFeedbackRoute: new Hono() }));

import { chatbotRouter } from "./chatbot-router";

const IMG = "data:image/jpeg;base64,AAAA"; // tiny — far below the caps

const screenParts = (text: string) => [
  { type: "text", text },
  { type: "image_url", image_url: { url: IMG }, source: "screen_capture" },
];

const plainParts = (text: string) => [
  { type: "text", text },
  { type: "image_url", image_url: { url: IMG } },
];

beforeEach(() => {
  resolveOptionalUser.mockReset().mockResolvedValue(null);
  getImageQuotaUsed.mockReset().mockResolvedValue(0);
  incrementImageQuota.mockReset().mockResolvedValue(undefined);
  getLatestSummaryText.mockReset().mockResolvedValue(null);
  persistChatRound.mockReset().mockResolvedValue(undefined);
  getChatResponse.mockReset();
  getStreamResponse.mockReset();
});

describe("POST /api/chatbot — live screen flow", () => {
  it("a screen_capture frame sets screenCapture=true and rides the #screen quota lane", async () => {
    getChatResponse.mockResolvedValue({ success: true, reply: "إجابة المعلّم", model: "mock/model" });
    const res = await chatbotRouter.request("/", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: screenParts("وين أنا في البرنامج؟") }], language: "ar" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; reply: string };
    expect(body.success).toBe(true);
    expect(body.reply).toContain("المعلّم");

    const req = getChatResponse.mock.calls[0]?.[0] as { vision: boolean; screenCapture: boolean };
    expect(req.vision).toBe(true);
    expect(req.screenCapture).toBe(true);

    // Pre-dispatch check + success increment, BOTH on the dedicated lane.
    expect(getImageQuotaUsed).toHaveBeenCalledWith("203.0.113.7#screen");
    expect(incrementImageQuota).toHaveBeenCalledWith("203.0.113.7#screen", 1);
  });

  it("a plain attachment rides the 5/day attachment lane (unchanged)", async () => {
    getChatResponse.mockResolvedValue({ success: true, reply: "تحليل الصورة", model: "mock/model" });
    const res = await chatbotRouter.request("/", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: plainParts("حلل الصورة") }], language: "ar" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(getImageQuotaUsed).toHaveBeenCalledWith("203.0.113.7");
    expect(incrementImageQuota).toHaveBeenCalledWith("203.0.113.7", 1);
  });

  it("an exhausted SCREEN lane answers 429 with the frame-specific message — session contract intact", async () => {
    // 60 frames already used → the NEXT frame exceeds the 60/day screen lane.
    getImageQuotaUsed.mockResolvedValue(60);
    const res = await chatbotRouter.request("/", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: screenParts("الخطوة التالية؟") }], language: "ar" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; code: string };
    expect(body.code).toBe("QUOTA_EXCEEDED");
    expect(body.error).toContain("لقطة شاشة حية");
    // No provider call was wasted on an over-quota request.
    expect(getChatResponse).not.toHaveBeenCalled();
  });

  it("59 used frames still pass — a real session is NOT killed after five exchanges", async () => {
    getImageQuotaUsed.mockResolvedValue(59);
    getChatResponse.mockResolvedValue({ success: true, reply: "تمام", model: "mock/model" });
    const res = await chatbotRouter.request("/", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: screenParts("كمّل") }], language: "ar" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    expect(getChatResponse).toHaveBeenCalledTimes(1);
  });

  it("an exhausted ATTACHMENT lane still answers with the 5-images message", async () => {
    getImageQuotaUsed.mockResolvedValue(5);
    const res = await chatbotRouter.request("/", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: plainParts("صورة") }], language: "ar" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; code: string };
    expect(body.code).toBe("QUOTA_EXCEEDED");
    expect(body.error).toContain("5 صور");
    expect(getChatResponse).not.toHaveBeenCalled();
  });

  it("a screen-tagged HISTORY image does NOT arm the lane (only the last user message counts)", async () => {
    getChatResponse.mockResolvedValue({ success: true, reply: "رد نصي", model: "mock/model" });
    const res = await chatbotRouter.request("/", {
      method: "POST",
      body: JSON.stringify({ messages: [
        { role: "user", content: screenParts("لقطة قديمة") },
        { role: "assistant", content: "رد قديم" },
        { role: "user", content: "سؤال نصي" },
      ], language: "ar" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const req = getChatResponse.mock.calls[0]?.[0] as { vision: boolean; screenCapture: boolean };
    expect(req.vision).toBe(false);
    expect(req.screenCapture).toBe(false);
    expect(incrementImageQuota).not.toHaveBeenCalled();
  });
});

describe("POST /api/chatbot/stream — live screen flow", () => {
  function sseStream(): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ text: "إجابة متدفقة" })}\n\n`));
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
  }

  it("a screen_capture frame threads screenCapture=true and rides the #screen lane on success", async () => {
    getStreamResponse.mockResolvedValue({ stream: sseStream(), model: "mock/model" });
    const res = await chatbotRouter.request("/stream", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: screenParts("وين أنا؟") }], language: "ar" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const req = getStreamResponse.mock.calls[0]?.[0] as { vision: boolean; screenCapture: boolean };
    expect(req.vision).toBe(true);
    expect(req.screenCapture).toBe(true);
    expect(getImageQuotaUsed).toHaveBeenCalledWith("203.0.113.7#screen");

    // Drain the stream to completion — quota increments AFTER the reply.
    await res.text();
    expect(incrementImageQuota).toHaveBeenCalledWith("203.0.113.7#screen", 1);
  });

  it("an exhausted SCREEN lane rejects BEFORE the walk with the frames message", async () => {
    getImageQuotaUsed.mockResolvedValue(60);
    const res = await chatbotRouter.request("/stream", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: screenParts("كمّل") }], language: "ar" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(429);
    const body = await res.json() as { error: string; code: string };
    expect(body.code).toBe("QUOTA_EXCEEDED");
    expect(body.error).toContain("لقطة شاشة حية");
    expect(getStreamResponse).not.toHaveBeenCalled();
  });
});
