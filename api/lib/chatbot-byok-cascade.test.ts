/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * BYOK CASCADE ORDER TESTS — the owner's product contract (2026-11):
 *
 *   1. A user who registered their own provider in the chatbot key menu gets
 *      that model FIRST — the platform never answers when their key works.
 *   2. If the user's key fails for ANY reason (quota exhausted 429, invalid
 *      401, provider error envelope, empty reply) the chat MUST still answer
 *      via the PLATFORM key (admin-configured cascade) — the user's setup
 *      can only ever ADD availability, never remove it.
 *   3. The user's endpoint is NEVER contacted for vision requests, and never
 *      contacted at all when no BYOK config exists.
 *
 * Strategy (same as chatbot.test.ts): vi.resetModules + dynamic imports +
 * mocked global fetch + mocked env. The dynamic router's DB pool load fails
 * gracefully in tests (no DB), so the "platform cascade" under test here is
 * the legacy OpenRouter lane — the exact same fallback position the dynamic
 * router occupies in production.
 */

const BYOK_BASE = "https://api.user-own-provider.test/v1";
const BYOK_URL = `${BYOK_BASE}/chat/completions`;
const USER_KEY = "sk-user-own-key-123456";
const USER_MODEL = "user-model-1";
const PLATFORM_REPLY = "إجابة منصة المنصة (platform key)";
const BYOK_REPLY = "إجابة نموذج المستخدم الخاص";

function byokConfig() {
  return { provider: "custom", baseUrl: BYOK_BASE, apiKey: USER_KEY, modelId: USER_MODEL };
}

/** OpenAI-compatible non-streaming success body. */
function jsonOk(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 3, completion_tokens: 7 },
    }),
    text: async () => "",
  };
}

/** OpenAI-compatible SSE success body (streaming lane). */
function sseOk(content: string) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    body,
    headers: new Headers({ "content-type": "text/event-stream" }),
  };
}

/** Failure body for the BYOK lane (non-stream lane reads response.text()). */
function httpFail(status: number, detail: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => detail,
    body: null,
  };
}

async function readStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const dec = new TextDecoder();
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

describe("BYOK cascade order (user key first, platform always wins on failure)", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** Fresh chatbot module with the platform OpenRouter key configured. */
  async function importChatbot() {
    vi.doMock("../lib/env", () => ({
      env: {
        APP_SECRET: "a".repeat(32),
        OPENROUTER_API_KEY: "sk-or-v1-test-key-12345",
        CHATBOT_API_KEY: "",
        NVIDIA_API_KEY: "",
        GROQ_API_KEY: "",
        isProduction: false,
      },
    }));
    return await import("./chatbot");
  }

  async function importStream() {
    vi.doMock("../lib/env", () => ({
      env: {
        APP_SECRET: "a".repeat(32),
        OPENROUTER_API_KEY: "sk-or-v1-test-key-12345",
        CHATBOT_API_KEY: "",
        NVIDIA_API_KEY: "",
        GROQ_API_KEY: "",
        isProduction: false,
      },
    }));
    return await import("./chatbot-stream");
  }

  it("TEXT: BYOK success — the user's own model serves FIRST and the platform is never contacted", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      expect(url).toBe(BYOK_URL);
      return jsonOk(BYOK_REPLY);
    });
    const { getChatResponse } = await importChatbot();
    const result = await getChatResponse({
      messages: [{ role: "user", content: "ما هو محرك كهربائي؟" }],
      language: "ar",
      byok: byokConfig(),
    });
    expect(result.success).toBe(true);
    expect(result.model).toBe(`byok:${USER_MODEL}`);
    expect(result.reply).toContain(BYOK_REPLY);
    // Exactly one outbound call — the platform cascade was never burned.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // The request carried the USER's own key, never the platform key.
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${USER_KEY}`);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).model).toBe(USER_MODEL);
  });

  it("TEXT: BYOK quota exhausted (429) — the chat STILL answers via the platform key", async () => {
    // Owner scenario: the user's key ran out of tokens/credits mid-chat.
    mockFetch.mockImplementation(async (url: string) => {
      if (url === BYOK_URL) return httpFail(429, "quota exceeded");
      if (url.includes("/auth/key")) return { ok: true, status: 200, json: async () => ({}) };
      return jsonOk(PLATFORM_REPLY); // platform OpenRouter lane
    });
    const { getChatResponse } = await importChatbot();
    const result = await getChatResponse({
      messages: [{ role: "user", content: "ما هو محرك كهربائي؟" }],
      language: "ar",
      byok: byokConfig(),
    });
    expect(result.success).toBe(true);
    expect(result.reply).toContain(PLATFORM_REPLY);
    expect(result.model).not.toContain("byok");
    // Call order: user endpoint first (its shot), platform second.
    expect(mockFetch.mock.calls[0][0]).toBe(BYOK_URL);
    expect(mockFetch.mock.calls[0][0]).not.toContain("openrouter.ai");
    // The platform answer carried the PLATFORM key — never the user's key.
    const platformCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes("openrouter.ai/api/v1/chat/completions"));
    expect(platformCall).toBeDefined();
    expect(platformCall![1].headers.Authorization).toBe("Bearer sk-or-v1-test-key-12345");
  });

  it("TEXT: BYOK invalid key (401) — the chat STILL answers via the platform key", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === BYOK_URL) return httpFail(401, "invalid api key");
      if (url.includes("/auth/key")) return { ok: true, status: 200, json: async () => ({}) };
      return jsonOk(PLATFORM_REPLY);
    });
    const { getChatResponse } = await importChatbot();
    const result = await getChatResponse({
      messages: [{ role: "user", content: "hello" }],
      byok: byokConfig(),
    });
    expect(result.success).toBe(true);
    expect(result.reply).toContain(PLATFORM_REPLY);
    expect(result.model).not.toContain("byok");
    expect(mockFetch.mock.calls[0][0]).toBe(BYOK_URL);
  });

  it("TEXT: BYOK error envelope (HTTP 200 + error body) — falls back to platform", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === BYOK_URL) return { ok: true, status: 200, json: async () => ({ error: { message: "model overloaded" } }), text: async () => "" };
      if (url.includes("/auth/key")) return { ok: true, status: 200, json: async () => ({}) };
      return jsonOk(PLATFORM_REPLY);
    });
    const { getChatResponse } = await importChatbot();
    const result = await getChatResponse({
      messages: [{ role: "user", content: "hello" }],
      byok: byokConfig(),
    });
    expect(result.success).toBe(true);
    expect(result.reply).toContain(PLATFORM_REPLY);
    expect(result.model).not.toContain("byok");
  });

  it("TEXT: BYOK empty reply — falls back to platform", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === BYOK_URL) return jsonOk("");
      if (url.includes("/auth/key")) return { ok: true, status: 200, json: async () => ({}) };
      return jsonOk(PLATFORM_REPLY);
    });
    const { getChatResponse } = await importChatbot();
    const result = await getChatResponse({
      messages: [{ role: "user", content: "hello" }],
      byok: byokConfig(),
    });
    expect(result.success).toBe(true);
    expect(result.reply).toContain(PLATFORM_REPLY);
    expect(result.model).not.toContain("byok");
  });

  it("TEXT: no BYOK config (null) — the platform serves and the user endpoint is never contacted", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/auth/key")) return { ok: true, status: 200, json: async () => ({}) };
      return jsonOk(PLATFORM_REPLY);
    });
    const { getChatResponse } = await importChatbot();
    const result = await getChatResponse({
      messages: [{ role: "user", content: "hello" }],
      byok: null,
    });
    expect(result.success).toBe(true);
    expect(result.reply).toContain(PLATFORM_REPLY);
    const byokCalls = mockFetch.mock.calls.filter((c: any[]) => c[0].includes("user-own-provider.test"));
    expect(byokCalls).toHaveLength(0);
  });

  it("TEXT: vision request — the BYOK endpoint is NEVER contacted (platform two-pass only)", async () => {
    mockFetch.mockImplementation(async () => httpFail(500, "no vision models in test"));
    const { getChatResponse } = await importChatbot();
    await getChatResponse({
      messages: [{ role: "user", content: "حلل هذه الصورة" }],
      vision: true,
      byok: byokConfig(),
    });
    const byokCalls = mockFetch.mock.calls.filter((c: any[]) => c[0].includes("user-own-provider.test"));
    expect(byokCalls).toHaveLength(0);
  });

  it("STREAM: BYOK success — the user's model streams FIRST and the platform is never contacted", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      expect(url).toBe(BYOK_URL);
      return sseOk(BYOK_REPLY);
    });
    const { getStreamResponse } = await importStream();
    const result = await getStreamResponse({
      messages: [{ role: "user", content: "ما هو محرك كهربائي؟" }],
      language: "ar",
      byok: byokConfig(),
    });
    expect("error" in result).toBe(false);
    const won = result as { stream: ReadableStream<Uint8Array>; model: string };
    expect(won.model).toBe(`byok:${USER_MODEL}`);
    const text = await readStreamText(won.stream);
    expect(text).toContain(BYOK_REPLY);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${USER_KEY}`);
  });

  it("STREAM: BYOK quota exhausted (429) — the platform stream STILL answers", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === BYOK_URL) return httpFail(429, "quota exceeded");
      if (url.includes("/auth/key")) return { ok: true, status: 200, json: async () => ({}) };
      return sseOk(PLATFORM_REPLY);
    });
    const { getStreamResponse } = await importStream();
    const result = await getStreamResponse({
      messages: [{ role: "user", content: "ما هو محرك كهربائي؟" }],
      language: "ar",
      byok: byokConfig(),
    });
    expect("error" in result).toBe(false);
    const won = result as { stream: ReadableStream<Uint8Array>; model: string };
    expect(won.model).not.toContain("byok");
    const text = await readStreamText(won.stream);
    expect(text).toContain(PLATFORM_REPLY);
    // Call order: user endpoint had its shot, then the platform lane.
    expect(mockFetch.mock.calls[0][0]).toBe(BYOK_URL);
    const platformCall = mockFetch.mock.calls.find((c: any[]) => c[0].includes("openrouter.ai/api/v1/chat/completions"));
    expect(platformCall).toBeDefined();
    expect(platformCall![1].headers.Authorization).toBe("Bearer sk-or-v1-test-key-12345");
  });

  it("STREAM: BYOK invalid key (401) — the platform stream STILL answers", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === BYOK_URL) return httpFail(401, "invalid api key");
      if (url.includes("/auth/key")) return { ok: true, status: 200, json: async () => ({}) };
      return sseOk(PLATFORM_REPLY);
    });
    const { getStreamResponse } = await importStream();
    const result = await getStreamResponse({
      messages: [{ role: "user", content: "hello" }],
      byok: byokConfig(),
    });
    expect("error" in result).toBe(false);
    const won = result as { stream: ReadableStream<Uint8Array>; model: string };
    expect(won.model).not.toContain("byok");
    const text = await readStreamText(won.stream);
    expect(text).toContain(PLATFORM_REPLY);
  });
});
