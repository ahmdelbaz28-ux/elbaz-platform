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
import { classifyRawModel, maskApiKey, PROVIDER_CATALOG } from "./ai-router.js";

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
