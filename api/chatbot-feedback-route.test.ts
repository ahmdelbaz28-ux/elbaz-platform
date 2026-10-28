import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (same pattern as push-subscription-route.test.ts) ──
const resolveOptionalUser = vi.hoisted(() => vi.fn());
vi.mock("./context", () => ({ resolveOptionalUser }));

const getClientIpFromHono = vi.hoisted(() => vi.fn(() => "203.0.113.7"));
vi.mock("./lib/client-ip", () => ({ getClientIpFromHono }));

const recordChatbotFeedback = vi.hoisted(() => vi.fn());
vi.mock("./lib/chatbot-feedback", () => ({
  recordChatbotFeedback,
  FEEDBACK_COMMENT_CAP: 600,
}));

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("./lib/logger", () => ({ logger }));

import { chatbotFeedbackRoute } from "./chatbot-feedback-route";

const VALID_VOTE = {
  chatId: "11111111-1111-4111-8111-111111111111",
  rating: "up",
  question: "ايه الفرق بين خط النقل والتوزيع؟",
  answer: "خط النقل جهد عالي ومسافات طويلة…",
  language: "ar",
  mode: "instant",
};

beforeEach(() => {
  resolveOptionalUser.mockReset().mockResolvedValue(null);
  recordChatbotFeedback.mockReset().mockResolvedValue(true);
});

describe("POST / (chatbot feedback)", () => {
  it("records an anonymous vote", async () => {
    const res = await chatbotFeedbackRoute.request("/", {
      method: "POST",
      body: JSON.stringify(VALID_VOTE),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(recordChatbotFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ rating: "up", source: "web", userId: null })
    );
  });

  it("attaches the site user id when logged in", async () => {
    resolveOptionalUser.mockResolvedValue({ id: 42, role: "user" });
    await chatbotFeedbackRoute.request("/", {
      method: "POST",
      body: JSON.stringify(VALID_VOTE),
      headers: { "Content-Type": "application/json" },
    });
    expect(recordChatbotFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42 })
    );
  });

  it("rejects an invalid rating", async () => {
    const res = await chatbotFeedbackRoute.request("/", {
      method: "POST",
      body: JSON.stringify({ ...VALID_VOTE, rating: "meh" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(recordChatbotFeedback).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const res = await chatbotFeedbackRoute.request("/", {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  it("maps a storage failure to a clean 500 (never throws)", async () => {
    recordChatbotFeedback.mockResolvedValue(false);
    const res = await chatbotFeedbackRoute.request("/", {
      method: "POST",
      body: JSON.stringify(VALID_VOTE),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(500);
  });

  it("rate limits flood votes (30 per 10 min per IP)", async () => {
    let last = 200;
    for (let i = 0; i < 31; i++) {
      const res = await chatbotFeedbackRoute.request("/", {
        method: "POST",
        body: JSON.stringify(VALID_VOTE),
        headers: { "Content-Type": "application/json" },
      });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
