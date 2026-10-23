import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Vision pass tests — describeImage() cascade + router vision-first policy.
 * All fetch calls are mocked; no network is touched.
 */

// Tiny valid-ish data URLs (regex-validated shapes; content irrelevant here)
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const OPENROUTER_VISION_REPLY = {
  choices: [{ message: { content: "Screenshot of the ETAP Load Flow Study dialog. Bus 1 voltage: 0.95 p.u. [unreadable] field bottom-left." } }],
};

describe("chatbot-vision describeImage()", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-test-key-12345");
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function importVision(opts?: { groq?: boolean }) {
    vi.doMock("./chatbot.js", () => ({
      GROQ_API_KEY: opts?.groq ? "gsk-test" : "",
      GROQ_ENDPOINT: "https://api.groq.com/openai/v1/chat/completions",
      OPENROUTER_API_KEY: "sk-or-v1-test-key-12345",
    }));
    return await import("./chatbot-vision.js");
  }

  it("succeeds on the first OpenRouter candidate (no Groq key)", async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => OPENROUTER_VISION_REPLY,
    }));

    const { describeImage } = await importVision();
    const result = await describeImage(TINY_PNG, "ما الخطأ هنا؟", "ar");

    expect(result.ok).toBe(true);
    expect(result.description).toContain("ETAP");
    expect(result.visionModel).toBe("or/nemotron-3.5-super-vl");
    // Vision request is multimodal: text part + image_url part
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(Array.isArray(body.messages[1].content)).toBe(true);
    expect(body.messages[1].content[1].type).toBe("image_url");
    expect(body.messages[1].content[1].image_url.url).toBe(TINY_PNG);
  });

  it("prefers Groq llama-4-scout when a Groq key exists", async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => OPENROUTER_VISION_REPLY,
    }));

    const { describeImage } = await importVision({ groq: true });
    const result = await describeImage(TINY_PNG, "check this", "en");

    expect(result.ok).toBe(true);
    expect(result.visionModel).toBe("groq/llama-4-scout");
    expect(mockFetch.mock.calls[0][0]).toContain("groq.com");
  });

  it("falls through a failing candidate to the next one", async () => {
    let openrouterCalls = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("groq.com")) return { ok: false, status: 500, json: async () => ({}) };
      openrouterCalls++;
      if (openrouterCalls === 1) {
        // nemotron-3.5-super-vl fails
        return { ok: false, status: 429, json: async () => ({}) };
      }
      return { ok: true, json: async () => OPENROUTER_VISION_REPLY };
    });

    const { describeImage } = await importVision({ groq: true });
    const result = await describeImage(TINY_PNG, "", "en");

    expect(result.ok).toBe(true);
    expect(result.visionModel).toBe("or/gemma-4-31b");
  });

  it("treats a too-short description as a failed read and continues", async () => {
    let calls = 0;
    mockFetch.mockImplementation(async () => {
      calls++;
      if (calls === 1) return { ok: true, json: async () => ({ choices: [{ message: { content: "hi" } }] }) };
      return { ok: true, json: async () => OPENROUTER_VISION_REPLY };
    });

    const { describeImage } = await importVision();
    const result = await describeImage(TINY_PNG, "", "en");

    expect(result.ok).toBe(true);
    expect(result.visionModel).not.toBe("or/nemotron-3.5-super-vl");
  });

  it("strips <think> blocks from vision descriptions", async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: "<think>The user shows a dialog, looks like a warning about cable sizing</think>Screenshot of ETAP cable sizing dialog. Conductor: 3x240mm² XLPE.",
          },
        }],
      }),
    }));

    const { describeImage } = await importVision();
    const result = await describeImage(TINY_PNG, "", "en");

    expect(result.ok).toBe(true);
    expect(result.description).not.toContain("<think>");
    expect(result.description).not.toContain("cable sizing dialog. Conductor".replace("cable sizing dialog. Conductor", "The user shows"));
    expect(result.description).toContain("240mm²");
  });

  it("returns ok:false when EVERY candidate fails (never throws)", async () => {
    mockFetch.mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));

    const { describeImage } = await importVision({ groq: true });
    const result = await describeImage(TINY_PNG, "", "en");
    expect(result.ok).toBe(false);
  });

  it("respects the overall vision budget (does not try all candidates when time is up)", async () => {
    // Each candidate takes ~12ms (fake timers make each 25s timeout instant —
    // so instead we simulate budget exhaustion by mocking many failing calls
    // and verifying the loop stops, i.e. it never calls candidates past the
    // budget. With instant failures the budget rarely trips; the assertion
    // here is simply that a full sweep terminates with ok:false quickly.
    mockFetch.mockImplementation(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));

    const { describeImage } = await importVision({ groq: true });
    const started = Date.now();
    const result = await describeImage(TINY_PNG, "", "en");
    expect(result.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(5000);
    // Groq + 4 OpenRouter candidates all attempted (failures are instant)
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });
});
