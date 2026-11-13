/**
 * DOMAIN SCOPE tests — the bot helps with ELECTRICAL ENGINEERING ONLY.
 *
 * Locks the owner requirement across ALL FOUR persona variants (AR/EN ×
 * thinking/instant) and BOTH vision lanes:
 *   - the persona declares the electrical-engineering specialization,
 *   - the off-topic decline rule is present (non-engineering asks are
 *     politely refused),
 *   - the live-screen teacher block scopes guidance to engineering programs
 *     (ETAP / SKM / PowerFactory) and the image-extraction prompt scopes
 *     READING to the electrical-engineering platform,
 *   - the always-on technical floor (ETAP core + electrical depth pack)
 *     survives even the leanest routed prompt — an off-topic question still
 *     meets an assistant that knows its electrical identity.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("./ai-router.js", () => ({
  routeChatCompletion: vi.fn(async () => ({ ok: false })),
  isDiscoveredModelId: vi.fn(() => false),
}));
vi.mock("./chatbot.js", () => ({
  GROQ_API_KEY: "",
  GROQ_VISION_MODEL: "meta-llama/llama-4-scout-17b-16e-instruct",
  tryGroq: vi.fn(async () => null),
  tryOpenRouterVision: vi.fn(async () => null),
}));

import { getSystemPrompt } from "./chatbot-prompts";
import { visionExtractionPrompt } from "./chatbot-vision";
import { routeSkills } from "./chatbot-skillnet";

describe("domain scope — electrical engineering only (all persona variants)", () => {
  const variants = [
    { lang: "ar" as const, mode: "thinking" as const },
    { lang: "ar" as const, mode: "instant" as const },
    { lang: "en" as const, mode: "thinking" as const },
    { lang: "en" as const, mode: "instant" as const },
  ];

  for (const v of variants) {
    it(`${v.lang}/${v.mode}: persona declares electrical specialization + off-topic decline rule`, () => {
      const p = getSystemPrompt(v.lang, v.mode);
      if (v.lang === "ar") {
        expect(p).toContain("الهندسة الكهربية");
        expect(p).toContain("ETAP");
        expect(p).toContain("إذا سُئلت عن تخصص خارج الهندسة الكهربية، اعتذر بلباقة ووضح تخصصك");
      } else {
        expect(p).toContain("Electrical Engineering");
        expect(p).toContain("ETAP");
        expect(p).toContain("If asked about non-engineering topics, politely decline and state your expertise");
      }
    });
  }

  it("AR off-topic rule keeps technical terms English-safe (no CJK, ever)", () => {
    for (const v of variants) {
      expect(getSystemPrompt(v.lang, v.mode)).not.toMatch(/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/);
    }
  });

  it("live-screen teacher block scopes guidance to engineering programs (both languages)", () => {
    const ar = getSystemPrompt("ar", "thinking", undefined, true, undefined, undefined, true);
    expect(ar).toContain("برنامج هندسي");
    expect(ar).toContain("ETAP أو SKM أو PowerFactory");
    const en = getSystemPrompt("en", "instant", undefined, true, undefined, undefined, true);
    expect(en).toContain("engineering program");
    expect(en).toContain("ETAP, SKM, or PowerFactory");
  });

  it("screen-extraction prompt (PASS 1) scopes reading to the electrical-engineering platform", () => {
    expect(visionExtractionPrompt("ar", true)).toContain("منصة هندسة كهربائية");
    expect(visionExtractionPrompt("en", true)).toContain("electrical-engineering platform");
  });

  it("the technical floor (ETAP core + depth pack) survives even a lean routed prompt", () => {
    // A deliberately off-topic, non-technical signal — the router goes LEAN,
    // yet the always-on identity cores keep the electrical persona grounded.
    const decision = routeSkills({ signal: "اكتب لي قصة قصيرة", lang: "ar", mode: "thinking" });
    const ids = decision.selected.map((s) => s.id);
    expect(ids).toContain("etap-expert-core");
    expect(ids).toContain("electrical-depth-pack");
  });
});
