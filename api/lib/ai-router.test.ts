import { describe, it, expect } from "vitest";

/**
 * AI ROUTER — pure-function tests (model classification + key masking)
 *
 * The classifier decides which discovered models serve TEXT vs VISION
 * requests; a false negative on a vision model would push image requests to
 * text-only models (forbidden), a false positive would waste vision quota on
 * text traffic. These tests pin the heuristics.
 */

// classifyRawModel is exported from ai-router.ts — importing the module must
// NOT require a database (lazy DB handle) by design.
import { classifyRawModel, maskApiKey, parseUpstreamSseLine, looksComplete, PROVIDER_CATALOG, SPECIALIST_CHAT_RE } from "./ai-router.js";

describe("AI Router — classifyRawModel", () => {
  it("classifies OpenRouter multimodal metadata as vision (authoritative signal)", () => {
    const cls = classifyRawModel({
      id: "some-provider/unknown-model:free",
      architecture: { input_modalities: ["text", "image"] },
      pricing: { prompt: "0", completion: "0" },
      context_length: 262144,
    });
    expect(cls).not.toBeNull();
    expect(cls!.supportsVision).toBe(true);
    expect(cls!.supportsChat).toBe(true);
    expect(cls!.isFree).toBe(true);
    expect(cls!.tier).toBe(1);
  });

  it("keeps text-only OpenRouter models out of the vision lane", () => {
    const cls = classifyRawModel({
      id: "nvidia/nemotron-3-super-120b-a12b:free",
      architecture: { input_modalities: ["text"] },
      pricing: { prompt: "0", completion: "0" },
      context_length: 262144,
    });
    expect(cls!.supportsVision).toBe(false);
    expect(cls!.supportsChat).toBe(true);
  });

  it("falls back to id heuristics when no modality metadata exists (Groq-style payload)", () => {
    const scout = classifyRawModel({ id: "meta-llama/llama-4-scout-17b-16e-instruct" });
    expect(scout!.supportsVision).toBe(true);

    const plain = classifyRawModel({ id: "llama-3.3-70b-versatile" });
    expect(plain!.supportsVision).toBe(false);
    expect(plain!.tier).toBe(1); // 70b → strongest tier
  });

  it("marks small/fast models tier 3 and mid models tier 2", () => {
    expect(classifyRawModel({ id: "llama-3.1-8b-instant" })!.tier).toBe(3);
    expect(classifyRawModel({ id: "qwen/qwen3-32b" })!.tier).toBe(2);
  });

  it("treats missing pricing as free (non-OpenRouter providers)", () => {
    expect(classifyRawModel({ id: "minimaxai/minimax-m3" })!.isFree).toBe(true);
  });

  it("treats non-zero pricing as paid (OpenRouter paid ids are not routed)", () => {
    const cls = classifyRawModel({ id: "openai/gpt-5", pricing: { prompt: "0.001", completion: "0.002" } });
    expect(cls!.isFree).toBe(false);
  });

  it("returns null for entries without a usable id", () => {
    expect(classifyRawModel({} as { id?: unknown })).toBeNull();
    expect(classifyRawModel({ id: 42 })).toBeNull();
  });
  it("excludes speech/embedding models from the chat lane (whisper/orpheus cannot do chat)", () => {
    const whisper = classifyRawModel({ id: "whisper-large-v3" });
    expect(whisper!.supportsChat).toBe(false);
    expect(whisper!.supportsVision).toBe(false);

    const tts = classifyRawModel({ id: "playai-tts" });
    expect(tts!.supportsChat).toBe(false);

    const embed = classifyRawModel({ id: "text-embedding-3-small" });
    expect(embed!.supportsChat).toBe(false);

    // chat-capable ids are untouched by the exclusion
    expect(classifyRawModel({ id: "llama-3.3-70b-versatile" })!.supportsChat).toBe(true);
  });
});

describe("AI Router — maskApiKey", () => {
  it("shows only first 3 + last 4 characters", () => {
    expect(maskApiKey("gsk_abcdefghijklmnop1234567890")).toBe("gsk…7890");
  });

  it("handles short keys and empty strings without throwing", () => {
    expect(maskApiKey("")).toBe("");
    expect(maskApiKey("short")).toBe("sh…");
  });
});

describe("AI Router — provider catalog", () => {
  it("contains the seeded providers with valid OpenAI-compatible base URLs", () => {
    const slugs = PROVIDER_CATALOG.map((c) => c.slug);
    for (const required of ["groq", "openrouter", "nvidia", "custom"]) {
      expect(slugs).toContain(required);
    }
    for (const c of PROVIDER_CATALOG) {
      if (c.slug === "custom") continue;
      expect(c.baseUrl).toMatch(/^https:\/\/.+\/v1$/);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// GATED STREAMING REGRESSIONS — the "brain icon ON gives dumb fixed replies"
// production incident (lyria music model classified as a tier-1 chat model
// and pinned by lastWorkingByMode).
// ════════════════════════════════════════════════════════════════════════

describe("AI Router — non-chat guard (production incident regressions)", () => {
  it("excludes the lyria MUSIC model even though its id matches TIER1_RE (pro\\b)", () => {
    // google/lyria-3-pro-preview: "pro\b" made it tier 1 — the strongest
    // slot — while it can only generate music. It must never be chat.
    const cls = classifyRawModel({
      id: "google/lyria-3-pro-preview",
      pricing: { prompt: "0", completion: "0" },
      context_length: 32768,
    });
    expect(cls).not.toBeNull();
    expect(cls!.supportsChat).toBe(false);
    expect(cls!.supportsVision).toBe(false);
  });

  it("excludes models whose declared output modalities lack text (authoritative metadata)", () => {
    const audioOnly = classifyRawModel({
      id: "future/unknown-audio-model",
      architecture: { input_modalities: ["text"], output_modalities: ["audio"] },
      pricing: { prompt: "0", completion: "0" },
    });
    expect(audioOnly!.supportsChat).toBe(false);

    const imageOnly = classifyRawModel({
      id: "future/unknown-image-model",
      architecture: { input_modalities: ["text"], output_modalities: ["image"] },
      pricing: { prompt: "0", completion: "0" },
    });
    expect(imageOnly!.supportsChat).toBe(false);
  });

  it("keeps real chat models when output modalities include text", () => {
    const chat = classifyRawModel({
      id: "deepseek/deepseek-r1:free",
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0", completion: "0" },
    });
    expect(chat!.supportsChat).toBe(true);
    expect(chat!.isFree).toBe(true);
  });

  it("does not exclude genuine chat ids that merely CONTAIN a guard token substring", () => {
    // word-boundary safety: "video"/"audio"/"voice" tokens must not swallow
    // plausible chat model ids
    const ok1 = classifyRawModel({ id: "meta-llama/llama-4-scout-17b-16e-instruct" });
    expect(ok1!.supportsChat).toBe(true);
    const ok2 = classifyRawModel({ id: "qwen/qwen3-235b-a22b:free" });
    expect(ok2!.supportsChat).toBe(true);
  });
});

describe("AI Router — parseUpstreamSseLine (gate parser)", () => {
  it("parses content deltas", () => {
    const ev = parseUpstreamSseLine('data: {"choices":[{"delta":{"content":"مرحبا"}}]}');
    expect(ev).not.toBeNull();
    expect(ev!.text).toBe("مرحبا");
    expect(ev!.finish).toBeUndefined();
  });

  it("treats reasoning deltas as liveness without exposing them as text", () => {
    const ev = parseUpstreamSseLine('data: {"choices":[{"delta":{"reasoning_content":"فكر..."}}]}');
    expect(ev).not.toBeNull();
    expect(ev!.reasoning).toBe(true);
    expect(ev!.text).toBeUndefined();
  });

  it("parses finish_reason and [DONE]", () => {
    expect(parseUpstreamSseLine('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}')!.finish).toBe("stop");
    expect(parseUpstreamSseLine("data: [DONE]")!.done).toBe(true);
  });

  it("flags upstream error events delivered inside HTTP 200 streams", () => {
    const ev = parseUpstreamSseLine('data: {"error":{"message":"rate limited"}}');
    expect(ev).not.toBeNull();
    expect(ev!.error).toContain("rate limited");
  });

  it("ignores keep-alive comments, empty lines and malformed payloads", () => {
    expect(parseUpstreamSseLine(": OPENROUTER PROCESSING")).toBeNull();
    expect(parseUpstreamSseLine("")).toBeNull();
    expect(parseUpstreamSseLine("data: not-json")).toBeNull();
    expect(parseUpstreamSseLine("event: ping")).toBeNull();
  });
});

describe("AI Router — looksComplete (rescue heuristic)", () => {
  it("detects complete sentence endings (ar/en) and code fences", () => {
    expect(looksComplete("تم إعداد القاطع بنجاح.")).toBe(true);
    expect(looksComplete("That's the full procedure!")).toBe(true);
    expect(looksComplete("النتيجة 12.5 كيلو وات**")).toBe(true);
  });

  it("detects mid-sentence cuts like the truncated greeting in the incident", () => {
    expect(looksComplete("سأشرح لك خطوة بخطوة كيف تقوم")).toBe(false);
    expect(looksComplete("بالإضافة إلى آلية التحكم (Control Mechanism")).toBe(false);
    expect(looksComplete("")).toBe(false);
  });
});

describe("AI Router — SPECIALIST_CHAT_RE (wrong-specialization guard)", () => {
  it("excludes the live incident: cohere/north-mini-code never serves the chat lane", () => {
    expect(SPECIALIST_CHAT_RE.test("cohere/north-mini-code")).toBe(true);
  });

  it("catches the known code-only families", () => {
    for (const id of [
      "qwen/qwen3-coder:free",
      "poolside/laguna-s-2.1:free",
      "mistralai/devstral-small",
      "bigcode/starcoder2-15b",
      "baidu/cobuddy:free",
      "zai-org/codegeex-4",
      "dots-studio/dots-3-note-preview:free",
      "liquid/lfm-2.5-2.6b:free",
    ]) {
      expect(`${id} excluded`, id).toBeTruthy();
      expect(SPECIALIST_CHAT_RE.test(id)).toBe(true);
    }
  });

  it("never touches the vetted general models", () => {
    for (const id of [
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "nvidia/nemotron-3.5-super-vl:free",
      "google/gemma-4-31b-it:free",
      "thinkingmachines/inkling:free",
      "google/gemma-4-26b-a4b-it:free",
      "nvidia/nemotron-3.5-lightning:free",
      "meta-llama/llama-4-scout-17b-16e-instruct",
    ]) {
      expect(SPECIALIST_CHAT_RE.test(id), `${id} must stay in the chat lane`).toBe(false);
    }
  });
});
