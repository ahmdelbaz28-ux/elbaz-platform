import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * TWO-PASS VISION tests — readImageViaVisionModels + augmentation builders.
 * ./chatbot.js and ./ai-router.js are mocked; no network, no DB.
 */

const MULTIMODAL_MESSAGES = [
  { role: "user", content: "سؤال سابق" },
  { role: "assistant", content: "جواب سابق" },
  {
    role: "user",
    content: [
      { type: "text", text: "ما الخطأ في هذه الشاشة؟" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ],
  },
] as unknown as Parameters<typeof import("./chatbot-vision.js")["buildAugmentedTextMessages"]>[0];

const EXTRACTION_REPLY =
  "لقطة شاشة من ETAP — نافذة Load Flow Study. القيمة: 0.95 p.u. حقل سفلي [غير مقروء].";

const GOOD_ROUTED = {
  ok: true as const,
  result: { reply: EXTRACTION_REPLY, model: "groq/meta-llama/llama-4-scout-17b-16e-instruct", providerId: 1, aiModelId: 1 },
};

describe("chatbot-vision (two-pass read)", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  async function importVision(opts?: { groqKey?: string; orKey?: string; routed?: unknown; routedThrows?: boolean }) {
    vi.doMock("./chatbot.js", () => ({
      GROQ_API_KEY: opts?.groqKey ?? "",
      GROQ_VISION_MODEL: "meta-llama/llama-4-scout-17b-16e-instruct",
      OPENROUTER_API_KEY: opts?.orKey ?? "",
      OPENROUTER_VISION_MODELS: ["nvidia/nemotron-3.5-super-vl:free"],
      tryGroq: vi.fn(async () => null),
      tryOpenRouterVision: vi.fn(async () => null),
    }));
    vi.doMock("./ai-router.js", () => ({
      routeChatCompletion: opts?.routedThrows
        ? vi.fn(async () => { throw new Error("db down"); })
        : vi.fn(async () => opts?.routed ?? { ok: false }),
    }));
    return await import("./chatbot-vision.js");
  }

  it("reads the image via the dynamic vision pool and caps the description", async () => {
    const mod = await importVision({ routed: GOOD_ROUTED, orKey: "sk-or-test" });
    const read = await mod.readImageViaVisionModels(MULTIMODAL_MESSAGES, "ar");
    expect(read.ok).toBe(true);
    expect(read.description).toContain("ETAP");
    expect(read.visionModel).toBeTruthy();
  });

  it("passes the RAW multimodal messages + extraction prompt to the vision pool", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let captured: any = null;
    vi.doMock("./chatbot.js", () => ({
      GROQ_API_KEY: "", OPENROUTER_API_KEY: "k",
      OPENROUTER_VISION_MODELS: [],
      tryGroq: vi.fn(async () => null),
      tryOpenRouterVision: vi.fn(async () => null),
    }));
    vi.doMock("./ai-router.js", () => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      routeChatCompletion: vi.fn(async (req: any) => {
        captured = req;
        return { ok: false };
      }),
    }));
    const mod = await import("./chatbot-vision.js");
    await mod.readImageViaVisionModels(MULTIMODAL_MESSAGES, "ar");

    expect(captured).toBeTruthy();
    expect(captured.vision).toBe(true); // only vision-capable models see the image
    expect(captured.systemPrompt).toContain("وصفها وصفاً واقعياً");
    expect(captured.systemPrompt).not.toContain("ETAP EXPERT"); // no persona in PASS 1
    // The image parts travel untouched
    const last = captured.messages[captured.messages.length - 1];
    expect(Array.isArray(last.content)).toBe(true);
  });

  it("falls back to the legacy Groq scout when the dynamic pool cannot serve", async () => {
    vi.doMock("./chatbot.js", () => ({
      GROQ_API_KEY: "gsk", GROQ_VISION_MODEL: "meta-llama/llama-4-scout-17b-16e-instruct",
      OPENROUTER_API_KEY: "",
      OPENROUTER_VISION_MODELS: [],
      tryGroq: vi.fn(async (_m, _p, model) =>
        model === "meta-llama/llama-4-scout-17b-16e-instruct"
          ? { reply: EXTRACTION_REPLY, model }
          : null),
      tryOpenRouterVision: vi.fn(async () => null),
    }));
    vi.doMock("./ai-router.js", () => ({ routeChatCompletion: vi.fn(async () => ({ ok: false })) }));
    const mod = await import("./chatbot-vision.js");
    const read = await mod.readImageViaVisionModels(MULTIMODAL_MESSAGES, "ar");
    expect(read.ok).toBe(true);
    expect(read.visionModel).toContain("llama-4-scout");
  });

  it("returns ok:false when every reader fails (honesty note path upstream)", async () => {
    const mod = await importVision({ groqKey: "gsk", orKey: "k" });
    const read = await mod.readImageViaVisionModels(MULTIMODAL_MESSAGES, "en");
    expect(read.ok).toBe(false);
  });

  it("buildAugmentedTextMessages replaces ONLY the last user message with description + question", async () => {
    const mod = await importVision({});
    const out = mod.buildAugmentedTextMessages(MULTIMODAL_MESSAGES, EXTRACTION_REPLY, "ar");
    expect(out).toHaveLength(3);
    expect(out[0].content).toBe("سؤال سابق"); // history untouched
    expect(out[2].role).toBe("user");
    const text = out[2].content as string;
    expect(typeof text).toBe("string");
    expect(text).toContain("تحليل الصورة الآلي");
    expect(text).toContain(EXTRACTION_REPLY);
    expect(text).toContain("ما الخطأ في هذه الشاشة؟");
    expect(text).not.toContain("image_url"); // image parts are gone — text-only lane
  });

  it("buildAugmentedTextMessages falls back to a default question for image-only messages", async () => {
    const mod = await importVision({});
    const imageOnly = [
      { role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
    ] as unknown as typeof MULTIMODAL_MESSAGES;
    const out = mod.buildAugmentedTextMessages(imageOnly, EXTRACTION_REPLY, "ar");
    expect(out[0].content).toContain("حلل هذه الصورة");
  });

  it("buildVisionFailureMessages injects the honesty note (never pretend to see)", async () => {
    const mod = await importVision({});
    const out = mod.buildVisionFailureMessages(MULTIMODAL_MESSAGES, "ar");
    const text = out[2].content as string;
    expect(text).toContain("تعذّر قراءة الصورة");
    expect(text).toContain("لا تدّعِ أبداً");
    expect(text).toContain("ما الخطأ في هذه الشاشة؟");
  });

  it("think-tag scrubbing: a reasoning VL model's <think> block never enters the description", async () => {
    vi.doMock("./chatbot.js", () => ({
      GROQ_API_KEY: "", OPENROUTER_API_KEY: "k",
      OPENROUTER_VISION_MODELS: [],
      tryGroq: vi.fn(async () => null),
      tryOpenRouterVision: vi.fn(async () => null),
    }));
    vi.doMock("./ai-router.js", () => ({
      routeChatCompletion: vi.fn(async () => ({
        ok: true,
        result: { reply: `<think>هذه لقطة شاشة، سأصف مكوناتها</think>${EXTRACTION_REPLY}`, model: "x/y", providerId: 1, aiModelId: 1 },
      })),
    }));
    const mod = await import("./chatbot-vision.js");
    const read = await mod.readImageViaVisionModels(MULTIMODAL_MESSAGES, "ar");
    expect(read.ok).toBe(true);
    expect(read.description).not.toContain("<think>");
    expect(read.description).not.toContain("سأصف مكوناتها");
    expect(read.description).toContain("ETAP");
  });

  it("memoizes the read per messages array — router persistence rounds never re-read the image", async () => {
    const routed = vi.fn(async () => GOOD_ROUTED);
    vi.doMock("./chatbot.js", () => ({
      GROQ_API_KEY: "", OPENROUTER_API_KEY: "",
      OPENROUTER_VISION_MODELS: [],
      tryGroq: vi.fn(async () => null),
      tryOpenRouterVision: vi.fn(async () => null),
    }));
    vi.doMock("./ai-router.js", () => ({ routeChatCompletion: routed }));
    const mod = await import("./chatbot-vision.js");

    const r1 = await mod.readImageViaVisionModels(MULTIMODAL_MESSAGES, "ar");
    const r2 = await mod.readImageViaVisionModels(MULTIMODAL_MESSAGES, "ar");
    const r3 = await mod.readImageViaVisionModels(MULTIMODAL_MESSAGES, "ar");
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    // ONE network read for THREE calls with the same request messages —
    // the streaming router's re-walk rounds hit the cache, not the vision lane.
    expect(routed).toHaveBeenCalledTimes(1);
    // A DIFFERENT messages array (a new request) reads again.
    const other = [{ role: "user", content: "سؤال آخر" }];
    await mod.readImageViaVisionModels(other as typeof MULTIMODAL_MESSAGES, "ar");
    expect(routed).toHaveBeenCalledTimes(2);
  });
});
