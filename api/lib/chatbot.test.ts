/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Chatbot test file.
 *
 * Since chatbot.ts has module-level mutable state (apiKeyValid, modelFailCount, etc.),
 * we use vi.resetModules() + dynamic imports to get a fresh module instance per test.
 * We mock fetch globally and the env module so no real network calls are made.
 *
 * Cascade under test (mode-aware, Modal removed — service permanently 503):
 *   thinking (default) → NVIDIA (MiniMax-M3) → OpenRouter (tier1 first) → Groq
 *   instant            → Groq (fastest) → NVIDIA → OpenRouter
 *   Modes also differ in prompt + temperature + max_tokens (MODE_TUNING).
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
   * By default NVIDIA_API_KEY and GROQ_API_KEY are empty and OpenRouter is
   * enabled, so tests exercise the OpenRouter cascade. Pass { nvidia: true }
   * / { groq: true } to enable them, or { openrouter: false } to disable it.
   */
  async function importChatbot(opts?: { nvidia?: boolean; groq?: boolean; openrouter?: boolean }) {
    vi.doMock("../lib/env", () => ({
      env: {
        OPENROUTER_API_KEY: opts?.openrouter === false ? "" : "sk-or-v1-test-key-12345",
        CHATBOT_API_KEY: "",
        NVIDIA_API_KEY: opts?.nvidia ? "nvapi-test-key-12345" : "",
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

      // Tier 1 (NVIDIA) defaults
      expect(stats.tier1.provider).toBe("nvidia");
      expect(stats.tier1.configured).toBe(false); // no NVIDIA_API_KEY in mock
      expect(stats.tier1.consecFails).toBe(0);
      expect(stats.tier1.lastSuccessAgo).toBe("never");

      // Tier 2 (OpenRouter) defaults
      expect(stats.tier2.provider).toBe("openrouter");
      expect(stats.tier2.totalModels).toBe(16);
      expect(stats.tier2.lastWorkingModel).toBe("");
      expect(stats.tier2.lastWorkingTimeAgo).toBe("never");
      expect(stats.tier2.modelSuccessCounts).toEqual({});
      expect(stats.tier2.modelFailCounts).toEqual({});

      // Tier 3 (Groq) defaults
      expect(stats.tier3.provider).toBe("groq");
      expect(stats.tier3.configured).toBe(false);
    });
  });

  // ─── Model pool ────────────────────────────────────────────────────────

  describe("model pool", () => {
    it("has 16 models", async () => {
      const { getChatbotStats } = await importChatbot();
      expect(getChatbotStats().tier2.totalModels).toBe(16);
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

      // First pass tries models tier by tier — first 16 calls should be all 16
      // models in tier order. Collect the first 16 model IDs.
      const firstPass = modelIds.slice(0, 16);
      expect(firstPass).toHaveLength(16);

      // Known tier 1 model IDs (first two of the tier-1 block)
      const tier1Ids = [
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "nvidia/nemotron-3-super-120b-a12b:free",
      ];

      // Verify all tier 1 models appear before any tier 2 model
      const tier1Indices = tier1Ids
        .map((id) => firstPass.indexOf(id))
        .filter((i) => i >= 0);
      const tier2FirstIndex = 16; // tier 2 starts after tier 1

      // Tier 1 models should be at positions 0 and 1 (first two)
      expect(tier1Indices).toHaveLength(2);
      expect(Math.max(...tier1Indices)).toBeLessThan(tier2FirstIndex);

      // Strongest model first: nemotron-ultra-550b at position 0
      expect(firstPass[0]).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
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
      expect(stats.tier2.lastWorkingModel).toBe(result.model);
      expect(stats.tier2.lastWorkingTimeAgo).not.toBe("never");
      expect(stats.tier2.modelSuccessCounts[result.model!]).toBe(1);
    });
  });

  // ─── NVIDIA (PRIMARY provider) ────────────────────────────────────────

  describe("NVIDIA primary provider", () => {
    it("uses NVIDIA first when configured and never touches OpenRouter", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("integrate.api.nvidia.com")) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: "Hello! I can confirm I am the Elbaz assistant.",
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

      const { getChatResponse, getChatbotStats } = await importChatbot({ nvidia: true });
      const result = await getChatResponse({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.success).toBe(true);
      expect(result.reply).toBe("Hello! I can confirm I am the Elbaz assistant.");
      expect(result.model).toBe("minimaxai/minimax-m3");

      // NVIDIA recorded as healthy; OpenRouter untouched.
      const stats = getChatbotStats();
      expect(stats.tier1.consecFails).toBe(0);
      expect(stats.tier1.lastSuccessAgo).not.toBe("never");
      expect(stats.tier2.lastWorkingModel).toBe(""); // OpenRouter never invoked
    });

    it("falls back to OpenRouter when NVIDIA fails (failover proof)", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("integrate.api.nvidia.com")) {
          return { ok: false, status: 503, json: async () => ({ error: "unavailable" }) };
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

      const { getChatResponse, getChatbotStats } = await importChatbot({ nvidia: true });
      const result = await getChatResponse({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.success).toBe(true);
      expect(result.reply).toBe("Recovered via OpenRouter!");
      // NVIDIA health degraded; OpenRouter has a working model.
      const stats = getChatbotStats();
      expect(stats.tier1.consecFails).toBeGreaterThan(0);
      expect(stats.tier2.lastWorkingModel).toBeTruthy();
    });

    it("falls through OpenRouter to Groq when both NVIDIA and OpenRouter fail", async () => {
      let sawGroqCall = false;
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("integrate.api.nvidia.com")) {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        if (url.includes("groq.com")) {
          sawGroqCall = true;
          return {
            ok: true,
            json: async () => ({
              choices: [{ message: { content: "Recovered via Groq!" } }],
            }),
          };
        }
        // OpenRouter: all models fail fast
        return { ok: false, status: 429, json: async () => ({ error: "rate limited" }) };
      });

      const { getChatResponse } = await importChatbot({ nvidia: true, groq: true });
      const result = await getChatResponse({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.success).toBe(true);
      expect(result.reply).toBe("Recovered via Groq!");
      expect(sawGroqCall).toBe(true);
    });
  });

  // ─── pickWorkingModel (streaming provider order) ──────────────────────

  describe("pickWorkingModel (streaming)", () => {
    it("prefers NVIDIA when configured, then OpenRouter tier-1", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/auth/key")) {
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({}) };
      });

      const withNvidia = await importChatbot({ nvidia: true });
      const pick1 = await withNvidia.pickWorkingModel(
        [{ role: "user", content: "hi" }],
        "en"
      );
      expect(pick1?.provider).toBe("nvidia");

      vi.resetModules(); // fresh module state before re-importing
      const withoutNvidia = await importChatbot();
      const pick2 = await withoutNvidia.pickWorkingModel(
        [{ role: "user", content: "hi" }],
        "en"
      );
      expect(pick2?.provider).toBe("openrouter");
      // Best (strongest) tier-1 model chosen
      expect(pick2?.modelId).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
    });
  });

  // ─── Mode differentiation (thinking vs instant) ───────────────────────

  describe("mode differentiation", () => {
    it("instant mode routes Groq FIRST even when NVIDIA is configured", async () => {
      const calledUrls: string[] = [];
      mockFetch.mockImplementation(async (url: string) => {
        calledUrls.push(url);
        if (url.includes("groq.com")) {
          return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: "Fast Groq reply!" } }] }),
          };
        }
        // NVIDIA / OpenRouter would also succeed — they must NOT be reached first
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "WRONG PROVIDER" } }] }),
        };
      });

      const { getChatResponse } = await importChatbot({ nvidia: true, groq: true });
      const result = await getChatResponse({
        messages: [{ role: "user", content: "hi" }],
        mode: "instant",
      });

      expect(result.success).toBe(true);
      expect(result.reply).toBe("Fast Groq reply!");
      expect(result.model).toBe("llama-3.3-70b-versatile");
      const firstProviderCall = calledUrls.find((u) => !u.includes("/auth/key"));
      expect(firstProviderCall).toContain("groq.com");
    });

    it("thinking mode routes NVIDIA FIRST even when Groq is configured", async () => {
      const calledUrls: string[] = [];
      mockFetch.mockImplementation(async (url: string) => {
        calledUrls.push(url);
        if (url.includes("integrate.api.nvidia.com")) {
          return {
            ok: true,
            json: async () => ({ choices: [{ message: { content: "Deep NVIDIA reply!" } }] }),
          };
        }
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: "WRONG PROVIDER" } }] }),
        };
      });

      const { getChatResponse } = await importChatbot({ nvidia: true, groq: true });
      const result = await getChatResponse({
        messages: [{ role: "user", content: "hi" }],
        mode: "thinking",
      });

      expect(result.success).toBe(true);
      expect(result.reply).toBe("Deep NVIDIA reply!");
      expect(result.model).toBe("minimaxai/minimax-m3");
      const firstProviderCall = calledUrls.find((u) => !u.includes("/auth/key"));
      expect(firstProviderCall).toContain("integrate.api.nvidia.com");
    });

    it("pickWorkingModel: instant → groq, thinking → nvidia (both keys configured)", async () => {
      mockFetch.mockImplementation(async () => ({ ok: true, json: async () => ({}) }));

      const mod = await importChatbot({ nvidia: true, groq: true });
      const instantPick = await mod.pickWorkingModel([{ role: "user", content: "hi" }], "en", "instant");
      expect(instantPick?.provider).toBe("groq");

      vi.resetModules();
      const mod2 = await importChatbot({ nvidia: true, groq: true });
      const thinkingPick = await mod2.pickWorkingModel([{ role: "user", content: "hi" }], "en", "thinking");
      expect(thinkingPick?.provider).toBe("nvidia");
    });

    it("modes send different generation params: instant 0.7/1024 vs thinking 0.3/4096", async () => {
      const capturedBodies: any[] = [];
      mockFetch.mockImplementation(async (url: string, options: any) => {
        if (url.includes("/auth/key")) return { ok: true, json: async () => ({}) };
        if (url.includes("groq.com")) {
          capturedBodies.push(JSON.parse(options.body));
          return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
        }
        return { ok: false, status: 429, json: async () => ({}) };
      });

      // Groq-only (OpenRouter disabled) so the Groq call carries the mode params
      const mod = await importChatbot({ groq: true, openrouter: false });
      await mod.getChatResponse({ messages: [{ role: "user", content: "hi" }], mode: "instant" });
      await mod.getChatResponse({ messages: [{ role: "user", content: "hi" }], mode: "thinking" });

      expect(capturedBodies).toHaveLength(2);
      expect(capturedBodies[0].temperature).toBe(0.7);
      expect(capturedBodies[0].max_tokens).toBe(1024);
      expect(capturedBodies[1].temperature).toBe(0.3);
      expect(capturedBodies[1].max_tokens).toBe(4096);
    });

    it("modes send different system prompts: instant concise vs thinking deep", async () => {
      const capturedPrompts: string[] = [];
      mockFetch.mockImplementation(async (url: string, options: any) => {
        if (url.includes("/auth/key")) return { ok: true, json: async () => ({}) };
        if (url.includes("groq.com")) {
          const body = JSON.parse(options.body);
          capturedPrompts.push(body.messages.find((m: any) => m.role === "system").content);
          return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
        }
        return { ok: false, status: 429, json: async () => ({}) };
      });

      const mod = await importChatbot({ groq: true, openrouter: false });
      await mod.getChatResponse({ messages: [{ role: "user", content: "hi" }], language: "en", mode: "instant" });
      await mod.getChatResponse({ messages: [{ role: "user", content: "hi" }], language: "en", mode: "thinking" });

      expect(capturedPrompts).toHaveLength(2);
      const instantPrompt = capturedPrompts[0];
      const thinkingPrompt = capturedPrompts[1];

      // Distinct mode markers
      expect(instantPrompt).toContain("INSTANT MODE");
      expect(thinkingPrompt).toContain("DEEP THINKING MODE");
      // Instant carries the condensed core only — no deep-analysis protocol, no output templates
      expect(instantPrompt).not.toContain("DEEP-ANALYSIS PROTOCOL");
      expect(instantPrompt).not.toContain("INTERNAL 6-STEP WORKFLOW");
      expect(instantPrompt).not.toContain("Template A"); // exact output templates removed
      // Thinking carries the full deep-analysis protocol
      expect(thinkingPrompt).toContain("DEEP-ANALYSIS PROTOCOL");
      expect(thinkingPrompt).toContain("INTERNAL 6-STEP WORKFLOW");
      // Persona shared by both (tests above assert it too, kept here for isolation)
      expect(instantPrompt.toLowerCase()).toMatch(/elbaz/);
      expect(thinkingPrompt.toLowerCase()).toMatch(/elbaz/);
    });
    it("instant never inherits thinking's last-working OpenRouter model (no mode collapse)", async () => {
      mockFetch.mockImplementation(async (url: string, options: any) => {
        if (url.includes("/auth/key")) return { ok: true, json: async () => ({}) };
        const model = JSON.parse(options.body).model;
        // Both models succeed
        return { ok: true, json: async () => ({ choices: [{ message: { content: `reply from ${model}` } }] }) };
      });

      // OpenRouter-only environment (Groq/NVIDIA keys absent) — the exact
      // production scenario where both modes would otherwise land on the
      // same tier-1 model.
      const mod = await importChatbot();

      // 1) thinking succeeds → lastWorkingModel = tier-1 nemotron
      const thinkRes = await mod.getChatResponse({
        messages: [{ role: "user", content: "deep question" }],
        mode: "thinking",
      });
      expect(thinkRes.model).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");

      // 2) streaming picker (thinking) reuses the healthy tier-1 model
      const thinkingPick = await mod.pickWorkingModel([{ role: "user", content: "hi" }], "en", "thinking");
      expect(thinkingPick?.modelId).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");

      // 3) instant must NOT reuse nemotron — it starts from its fast model
      const instantRes = await mod.getChatResponse({
        messages: [{ role: "user", content: "quick question" }],
        mode: "instant",
      });
      expect(instantRes.model).toBe("google/gemma-4-26b-a4b-it:free");
      expect(instantRes.model).not.toBe(thinkRes.model);

      // 4) streaming picker agrees: instant stays on its fast model
      const instantPick = await mod.pickWorkingModel([{ role: "user", content: "hi" }], "en", "instant");
      expect(instantPick?.provider).toBe("openrouter");
      expect(instantPick?.modelId).toBe("google/gemma-4-26b-a4b-it:free");
    });

    it("instant fast lane: skips dead fast models and never falls straight to thinking's tier-1", async () => {
      const calledModels: string[] = [];
      mockFetch.mockImplementation(async (url: string, options: any) => {
        if (url.includes("/auth/key")) return { ok: true, json: async () => ({}) };
        const model = JSON.parse(options.body).model;
        calledModels.push(model);
        // gemma (preferred) is dead, xingchen (2nd fast) works,
        // nemotron-ultra (thinking tier-1) would also work but must not be reached first
        if (model === "google/gemma-4-26b-a4b-it:free") {
          return { ok: false, status: 429, json: async () => ({ error: "rate limited" }) };
        }
        return { ok: true, json: async () => ({ choices: [{ message: { content: `reply from ${model}` } }] }) };
      });

      const mod = await importChatbot();
      const res = await mod.getChatResponse({
        messages: [{ role: "user", content: "quick" }],
        mode: "instant",
      });

      expect(res.model).toBe("xingchen-agi/xing4.0-29b-a4b:free");
      // The thinking tier-1 model was never attempted — the fast lane caught it
      expect(calledModels).not.toContain("nvidia/nemotron-3-ultra-550b-a55b:free");
    });

    it("thinking never inherits instant's fast-lane last-working model (mirror collapse guard)", async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.includes("/auth/key")) return { ok: true, json: async () => ({}) };
        return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
      });

      const mod = await importChatbot();

      // 1) instant succeeds first → instant-lane lastWorking = fast gemma
      const instantRes = await mod.getChatResponse({
        messages: [{ role: "user", content: "quick" }],
        mode: "instant",
      });
      expect(instantRes.model).toBe("google/gemma-4-26b-a4b-it:free");

      // 2) thinking must NOT reuse the fast-lane model — it goes to tier-1
      const thinkRes = await mod.getChatResponse({
        messages: [{ role: "user", content: "deep" }],
        mode: "thinking",
      });
      expect(thinkRes.model).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
      expect(thinkRes.model).not.toBe(instantRes.model);
    });
  });
});
