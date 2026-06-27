/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Chatbot test file.
 *
 * Since chatbot.ts has module-level mutable state (apiKeyValid, modelFailCount, etc.),
 * we use vi.resetModules() + dynamic imports to get a fresh module instance per test.
 * We mock fetch globally and the env module so no real network calls are made.
 */

describe("Chatbot Module", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-test-key-12345");
    vi.stubEnv("CHATBOT_API_KEY", "");
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  /**
   * Helper: import the chatbot module with mocked env.
   * Must be called after vi.resetModules() so the module is freshly loaded.
   *
   * By default MODAL_API_KEY is omitted (undefined) so the PRIMARY Modal
   * provider is disabled and tests exercise the OpenRouter FALLBACK cascade.
   * Pass { modal: true } to enable Modal with a test key.
   */
  async function importChatbot(opts?: { modal?: boolean; groq?: boolean }) {
    vi.doMock("../lib/env", () => ({
      env: {
        OPENROUTER_API_KEY: "sk-or-v1-test-key-12345",
        CHATBOT_API_KEY: "",
        MODAL_API_KEY: opts?.modal ? "modal-test-key-12345" : "",
        GROQ_API_KEY: opts?.groq ? "groq-test-key-12345" : "",
        isProduction: false,
      },
    }));
    return await import("./chatbot");
  }

  // ─── getChatbotStats() ─────────────────────────────────────────────────

  describe("getChatbotStats()", () => {
    it("returns correct default values before any API calls", async () => {
      const { getChatbotStats } = await importChatbot();
      const stats = getChatbotStats();

      // Tier 1 (Modal) defaults
      expect(stats.tier1.provider).toBe("modal");
      expect(stats.tier1.configured).toBe(false); // no MODAL_API_KEY in mock
      expect(stats.tier1.consecFails).toBe(0);
      expect(stats.tier1.lastSuccessAgo).toBe("never");

      // Fallback (OpenRouter) defaults
      expect(stats.tier3.totalModels).toBe(21);
      expect(stats.tier3.lastWorkingModel).toBe("");
      expect(stats.tier3.lastWorkingTimeAgo).toBe("never");
      expect(stats.tier3.modelSuccessCounts).toEqual({});
      expect(stats.tier3.modelFailCounts).toEqual({});
    });
  });

  // ─── Model pool ────────────────────────────────────────────────────────

  describe("model pool", () => {
    it("has 21 models", async () => {
      const { getChatbotStats } = await importChatbot();
      expect(getChatbotStats().tier3.totalModels).toBe(21);
    });

    it("models are ordered by tier (all tier 1 before tier 2, etc.)", async () => {
      // Make all models fail so we can observe the full attempt order
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        // All model calls fail
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "overloaded" }),
        };
      });

      const { getChatResponse } = await importChatbot();
      await getChatResponse({
        messages: [{ role: "user", content: "hello" }],
      });

      // Collect model IDs from fetch calls (skip auth endpoint)
      const modelCalls = mockFetch.mock.calls.filter(
        (args: any[]) => !(args[0] as string).includes("/auth/key")
      );
      const modelIds = modelCalls.map(
        (args: any[]) => JSON.parse((args[1] as any).body).model
      );

      // Step 2 tries models tier by tier — first 21 calls should be all 21 models
      // in tier order. Collect the first 21 model IDs.
      const firstPass = modelIds.slice(0, 21);
      expect(firstPass).toHaveLength(21);

      // Known tier 1 model IDs (6 models)
      const tier1Ids = [
        "inclusionai/ring-2.6-1t:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
        "deepseek/deepseek-v4-flash:free",
        "minimax/minimax-m2.5:free",
        "z-ai/glm-4.5-air:free",
        "arcee-ai/trinity-large-thinking:free",
      ];

      // Known tier 2 model IDs (6 models)
      const tier2Ids = [
        "qwen/qwen3-coder:free",
        "google/gemma-4-31b-it:free",
        "google/gemma-4-26b-a4b-it:free",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "qwen/qwen3-next-80b-a3b-instruct:free",
        "meta-llama/llama-3.3-70b-instruct:free",
      ];

      // Verify all tier 1 models appear before any tier 2 model
      const tier1Indices = tier1Ids
        .map((id) => firstPass.indexOf(id))
        .filter((i) => i >= 0);
      const tier2Indices = tier2Ids
        .map((id) => firstPass.indexOf(id))
        .filter((i) => i >= 0);

      expect(tier1Indices).toHaveLength(6);
      expect(tier2Indices).toHaveLength(6);
      expect(Math.max(...tier1Indices)).toBeLessThan(Math.min(...tier2Indices));
    });
  });

  // ─── getChatResponse() ─────────────────────────────────────────────────

  describe("getChatResponse()", () => {
    it("returns error when API key is invalid (401 from auth endpoint)", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/auth/key")) {
          return {
            ok: false,
            status: 401,
            json: async () => ({ error: { message: "Invalid API key" } }),
          };
        }
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
        };
      });

      const { getChatResponse } = await importChatbot();
      const result = await getChatResponse({
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("API key");
    });

    it("falls back to next model when first model fails (500 then 200)", async () => {
      let modelCallCount = 0;
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        modelCallCount++;
        // First model fails, second succeeds
        if (modelCallCount === 1) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: "model overloaded" }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "Fallback response!" } }],
          }),
        };
      });

      const { getChatResponse } = await importChatbot();
      const result = await getChatResponse({
        messages: [{ role: "user", content: "hello" }],
      });

      expect(result.success).toBe(true);
      expect(result.reply).toBe("Fallback response!");
      expect(result.model).toBeDefined();
      // First model failed, second succeeded
      expect(modelCallCount).toBe(2);
    });

    it("returns error for empty messages array (all models fail)", async () => {
      mockFetch.mockImplementation(async (url: string, options: any) => {
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        // Simulate API returning error for requests with no user messages
        const body = JSON.parse(options.body);
        const userMessages = body.messages.filter(
          (m: any) => m.role !== "system"
        );
        if (userMessages.length === 0) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: { message: "messages array must not be empty" },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "Hello!" } }],
          }),
        };
      });

      const { getChatResponse } = await importChatbot();
      const result = await getChatResponse({ messages: [] });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("returns successful response with valid message", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [
              { message: { content: "Hello! I'm Engineer Bassem." } },
            ],
          }),
        };
      });

      const { getChatResponse } = await importChatbot();
      const result = await getChatResponse({
        messages: [{ role: "user", content: "Hi there!" }],
      });

      expect(result.success).toBe(true);
      expect(result.reply).toBe("Hello! I'm Engineer Bassem.");
      expect(result.model).toBeDefined();
      expect(typeof result.model).toBe("string");
    });
  });

  // ─── System prompt ─────────────────────────────────────────────────────

  describe("system prompt", () => {
    it("English system prompt mentions Elbaz and electrical-engineering focus", async () => {
      mockFetch.mockImplementation(async (url: string, options: any) => {
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        const body = JSON.parse(options.body);
        const systemMsg = body.messages.find((m: any) => m.role === "system");
        expect(systemMsg).toBeDefined();
        expect(systemMsg.content.toLowerCase()).toMatch(/elbaz/);
        expect(systemMsg.content).toMatch(/ETAP|SKM|PowerFactory|PVSyst/);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "Hi!" } }],
          }),
        };
      });

      const { getChatResponse } = await importChatbot();
      await getChatResponse({
        messages: [{ role: "user", content: "hello" }],
        language: "en",
      });
    });

    it("Arabic system prompt mentions 'الباز'", async () => {
      mockFetch.mockImplementation(async (url: string, options: any) => {
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        const body = JSON.parse(options.body);
        const systemMsg = body.messages.find((m: any) => m.role === "system");
        expect(systemMsg).toBeDefined();
        expect(systemMsg.content).toMatch(/الباز/);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "مرحبا!" } }],
          }),
        };
      });

      const { getChatResponse } = await importChatbot();
      await getChatResponse({
        messages: [{ role: "user", content: "مرحبا" }],
        language: "ar",
      });
    });
  });

  // ─── Stats after interaction ───────────────────────────────────────────

  describe("stats after successful response", () => {
    it("updates lastWorkingModel and modelSuccessCounts after success", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "Response text" } }],
          }),
        };
      });

      const { getChatResponse, getChatbotStats } = await importChatbot();
      const result = await getChatResponse({
        messages: [{ role: "user", content: "test" }],
      });

      expect(result.success).toBe(true);

      const stats = getChatbotStats();
      expect(stats.tier3.lastWorkingModel).toBe(result.model);
      expect(stats.tier3.lastWorkingTimeAgo).not.toBe("never");
      expect(stats.tier3.modelSuccessCounts[result.model!]).toBe(1);
    });
  });

  // ─── Modal (PRIMARY provider) ─────────────────────────────────────────

  describe("Modal primary provider", () => {
    it("uses Modal first when configured and returns content (not reasoning)", async () => {
      // Mock that returns BOTH reasoning_content and content, like the real GLM-5.1
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("modal.direct")) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: "Hello! I can confirm I am the Elbaz assistant.",
                    reasoning_content: "1. Internal thinking steps the user must never see.",
                  },
                },
              ],
            }),
          };
        }
        // OpenRouter should NOT be called
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "SHOULD NOT BE USED" } }],
          }),
        };
      });

      const { getChatResponse, getChatbotStats } = await importChatbot({ modal: true });
      const result = await getChatResponse({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.success).toBe(true);
      // The user-facing reply is the polished content, NOT the reasoning.
      expect(result.reply).toBe("Hello! I can confirm I am the Elbaz assistant.");
      expect(result.reply).not.toContain("Internal thinking");
      expect(result.model).toBe("zai-org/GLM-5.1-FP8");

      // Modal recorded as healthy; OpenRouter untouched.
      const stats = getChatbotStats();
      expect(stats.tier1.consecFails).toBe(0);
      expect(stats.tier1.lastSuccessAgo).not.toBe("never");
      expect(stats.tier3.lastWorkingModel).toBe(""); // OpenRouter never invoked
    });

    it("falls back to Groq then OpenRouter when Modal returns an error", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("modal.direct")) {
          return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
        }
        if (url.includes("groq.com")) {
          return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
        }
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        // OpenRouter succeeds
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "Recovered via OpenRouter!" } }],
          }),
        };
      });

      const { getChatResponse, getChatbotStats } = await importChatbot({ modal: true, groq: true });
      const result = await getChatResponse({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.success).toBe(true);
      expect(result.reply).toBe("Recovered via OpenRouter!");
      // Modal and OpenCode health degraded; OpenRouter has a working model.
      const stats = getChatbotStats();
      expect(stats.tier1.consecFails).toBeGreaterThan(0);
      expect(stats.tier3.lastWorkingModel).toBeTruthy();
    });

    it("treats a reply that is only reasoning (empty content) as a Modal failure", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("modal.direct")) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: null, // ran out of tokens during reasoning
                    reasoning_content: "long private chain-of-thought...",
                  },
                },
              ],
            }),
          };
        }
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "OpenRouter fallback answer" } }],
          }),
        };
      });

      const { getChatResponse } = await importChatbot({ modal: true });
      const result = await getChatResponse({
        messages: [{ role: "user", content: "Hi" }],
      });

      // Should NOT surface the reasoning — falls back to OpenRouter.
      expect(result.success).toBe(true);
      expect(result.reply).toBe("OpenRouter fallback answer");
      expect(result.reply).not.toContain("chain-of-thought");
    });
  });
});
