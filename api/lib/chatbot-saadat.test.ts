/**
 * SAADAT ACADEMIC CORE — tests (v1.0.0)
 * ────────────────────────────────────────────────────────────────────────
 * 3-case matrix per the prompt-as-code discipline (happy / edge / failure):
 *   1. HAPPY: the KB integrity (181 problems × 12 chapters), deterministic
 *      problem-ID resolution from Arabic/English academic queries, BM25
 *      retrieval grounding conceptual questions in the right chapter, and
 *      the ±0.5% verification contract against the book's own numbers.
 *   2. EDGE: registry routing selects saadat-academic-core on academic
 *      intent and drops it on non-technical messages; instant-mode context
 *      stays token-light; the RAG block never exceeds its budget.
 *   3. FAILURE MODE: no academic intent → empty context block (prompt
 *      byte-unchanged); unknown problem id → verify returns verified=null;
 *      a wrong number against the book → verified=false.
 */

import { describe, it, expect } from "vitest";

import {
  SAADAT_CORE_BLOCKS,
  buildSaadatContextBlock,
  hasSaadatIntent,
  normalizeSaadatText,
  resolveProblemId,
  retrieveSaadat,
  verifyAgainstBook,
} from "./chatbot-saadat";
import { SAADAT_META, SAADAT_PROBLEMS, SAADAT_TOC } from "./chatbot-saadat-kb";
import { getSystemPrompt } from "./chatbot-prompts";
import { SKILL_REGISTRY, routeSkills } from "./chatbot-skillnet";

// ─── 1. Knowledge base integrity (evaluate) ────────────────────────────────

describe("SAADAT-KB integrity", () => {
  it("carries the full manual: 181 problems across 12 chapters", () => {
    expect(SAADAT_META.problemCount).toBe(181);
    expect(SAADAT_PROBLEMS.length).toBe(181);
    expect(SAADAT_TOC.length).toBe(12);
  });

  it("has unique problem ids that match the TOC per chapter", () => {
    const ids = SAADAT_PROBLEMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const toc of SAADAT_TOC) {
      const inChapter = SAADAT_PROBLEMS.filter((p) => p.ch === toc.ch);
      expect(inChapter.length).toBe(toc.problems.length);
      for (const p of inChapter) {
        expect(toc.problems).toContain(p.id);
        expect(p.page).toBeGreaterThanOrEqual(toc.from);
        expect(p.page).toBeLessThanOrEqual(toc.to);
      }
    }
  });

  it("keeps verbatim book text with the stated final answers at the tail", () => {
    const p27 = SAADAT_PROBLEMS.find((p) => p.id === "2.7");
    expect(p27).toBeDefined();
    expect(p27!.page).toBe(16);
    // The book's own final answer (from the manual's solution text):
    expect(p27!.text).toContain("530.5");
    expect(p27!.text).toContain("µF");
  });
});

// ─── 2. Intent gate + problem-ID resolution ────────────────────────────────

describe("hasSaadatIntent + resolveProblemId", () => {
  it("fires on Arabic and English academic phrasing (normalized)", () => {
    expect(hasSaadatIntent("حل مسألة 2.7 من كتاب سعدت")).toBe(true);
    expect(hasSaadatIntent("شرح خطوات الحل بتدفق الأحمال")).toBe(true);
    expect(hasSaadatIntent("عندي سؤال في معادلة التأرجح")).toBe(true);
    expect(hasSaadatIntent("how do I build a Ybus matrix?")).toBe(true);
    expect(hasSaadatIntent("explain per unit conversion")).toBe(true);
    expect(hasSaadatIntent("solve problem 6.9 from the manual")).toBe(true);
  });

  it("stays quiet on course/platform chatter (no academic intent)", () => {
    expect(hasSaadatIntent("كام سعر كورس ETAP؟")).toBe(false);
    expect(hasSaadatIntent("hello, how are you?")).toBe(false);
    expect(hasSaadatIntent("")).toBe(false);
  });

  it("resolves explicit problem references in both languages", () => {
    expect(resolveProblemId("حل المسألة 2.7")).toBe("2.7");
    expect(resolveProblemId("solve problem 6.9")).toBe("6.9");
    expect(resolveProblemId("تمرين 11.5 خطوة بخطوة")).toBe("11.5");
    expect(resolveProblemId("شرح مساله 10.3")).toBe("10.3");
  });

  it("refuses stray decimals and out-of-range chapters", () => {
    // No academic anchor + an id that does not exist in the KB:
    expect(resolveProblemId("اشتري 2.7 كيلو")).toBeNull();
    expect(resolveProblemId("Chapter 13 problem 13.1")).toBeNull();
  });
});

// ─── 3. Retrieval (BM25 + deterministic id) ────────────────────────────────

describe("retrieveSaadat", () => {
  it("pins the exact problem first for a direct-ID query", () => {
    const hits = retrieveSaadat("حل مسألة 2.7 بالخطوات", 4);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe("2.7");
    expect(hits[0].reason).toBe("problem-id");
  });

  it("grounds conceptual queries in the right chapter", () => {
    const ybus = retrieveSaadat("how to obtain the bus admittance matrix for a network", 3);
    expect(ybus[0].ch).toBe(6);

    const swing = retrieveSaadat("critical clearing angle swing equation stability", 3);
    expect(swing[0].ch).toBe(11);

    const seq = retrieveSaadat("symmetrical components of unbalanced voltages", 3);
    expect(seq[0].ch).toBe(10);

    const dispatch = retrieveSaadat("economic dispatch fuel cost incremental cost", 3);
    expect(dispatch[0].ch).toBe(7);
  });

  it("grounds ARABIC conceptual queries via the bilingual topic aliases", () => {
    // The manual text is English — without the Arabic chapter aliases this
    // query would find zero matches (regression guard for the Arabic-first
    // platform audience):
    const seqAr = retrieveSaadat("شرح المكونات المتماثلة للأعطال غير المتماثلة", 3);
    expect(seqAr.length).toBeGreaterThan(0);
    expect(seqAr[0].ch).toBe(10);

    const stabAr = retrieveSaadat("ازاي أحل مسائل معادلة التأرجح والاستقرارية", 3);
    expect(stabAr.length).toBeGreaterThan(0);
    expect(stabAr[0].ch).toBe(11);
  });

  it("returns [] for empty/irrelevant queries", () => {
    expect(retrieveSaadat("", 4)).toEqual([]);
    expect(retrieveSaadat("zzz qqq xxx", 4)).toEqual([]);
  });
});

// ─── 4. ±0.5% verification contract ────────────────────────────────────────

describe("verifyAgainstBook", () => {
  it("verifies the book's own stated value (happy path)", () => {
    // P 2.7 states C = 530.5 µF in the manual's solution:
    const ok = verifyAgainstBook("2.7", 530.5);
    expect(ok.verified).toBe(true);
    expect(ok.matched).toBeCloseTo(530.5, 6);
    expect(ok.matchedContext).toContain("530.5");
  });

  it("accepts values within the ±0.5% tolerance", () => {
    // +0.19% off the book value — inside the tolerance contract:
    const near = verifyAgainstBook("2.7", 531.5);
    expect(near.verified).toBe(true);
    expect(near.deviationPct).toBeLessThan(0.5);
  });

  it("rejects a materially wrong number (failure mode)", () => {
    const wrong = verifyAgainstBook("2.7", 500);
    expect(wrong.verified).toBe(false);
    expect(wrong.deviationPct).toBeGreaterThan(0.5);
  });

  it("returns verified=null for an unknown problem id", () => {
    expect(verifyAgainstBook("99.9", 42).verified).toBeNull();
    expect(verifyAgainstBook("13.1", 42).verified).toBeNull();
  });
});

// ─── 5. Prompt blocks + dynamic RAG block ──────────────────────────────────

describe("SAADAT prompt blocks + buildSaadatContextBlock", () => {
  it("provides full bilingual content for both modes", () => {
    for (const mode of ["thinking", "instant"] as const) {
      for (const lang of ["ar", "en"] as const) {
        expect(SAADAT_CORE_BLOCKS[mode][lang].length).toBeGreaterThan(150);
      }
    }
    // Instant anchors stay token-light (≈4 chars/token discipline):
    expect(SAADAT_CORE_BLOCKS.instant.ar.length).toBeLessThan(900);
    expect(SAADAT_CORE_BLOCKS.instant.en.length).toBeLessThan(900);
  });

  it("injects the retrieved manual text only on academic intent", () => {
    const block = buildSaadatContextBlock("حل مسألة 2.7 بالتفصيل", "ar");
    expect(block).toContain("SAADAT-KB");
    expect(block).toContain("2.7");
    expect(block).toContain("[Saadat, Solutions Manual");

    // Course-price question → empty block, prompt untouched:
    expect(buildSaadatContextBlock("كام سعر كورس ETAP؟", "ar")).toBe("");
  });

  it("respects the thinking/instant size budgets (edge)", () => {
    const heavy = buildSaadatContextBlock("شرح Ybus وتدفق الأحمال ونيوتن رافسون بالتفصيل", "ar");
    expect(heavy.length).toBeGreaterThan(0);
    expect(heavy.length).toBeLessThan(5400);

    const quick = buildSaadatContextBlock("شرح Ybus وتدفق الأحمال ونيوتن رافسون بالتفصيل", "ar", "instant");
    expect(quick.length).toBeGreaterThan(0);
    expect(quick.length).toBeLessThan(2100);
  });

  it("never drops the direct-ID hit from the composed block", () => {
    const block = buildSaadatContextBlock("حل المسألة 6.9", "en");
    expect(block).toContain("6.9");
    expect(block).toContain("Requested problem");
  });
});

// ─── 6. Router + prompt composition integration ────────────────────────────

describe("SKILL_REGISTRY routing + getSystemPrompt integration", () => {
  it("registers the saadat-academic-core skill (both modes, valid)", () => {
    const entry = SKILL_REGISTRY.find((s) => s.id === "saadat-academic-core");
    expect(entry).toBeDefined();
    expect(entry!.modes).toContain("thinking");
    expect(entry!.modes).toContain("instant");
  });

  it("routes academic questions to the saadat core (happy path)", () => {
    const decision = routeSkills({ signal: "حل مسألة 2.7 من كتاب سعدت", lang: "ar", mode: "thinking" });
    expect(decision.selected.some((s) => s.id === "saadat-academic-core")).toBe(true);
    const prompt = getSystemPrompt("ar", "thinking", "", false, undefined, undefined, false, "حل مسألة 2.7 من كتاب سعدت");
    expect(prompt).toContain("SAADAT-KB");
    expect(prompt).toContain("[Saadat, Solutions Manual");
  });

  it("drops the academic core on non-technical chat (lean)", () => {
    const decision = routeSkills({ signal: "ازيك عامل ايه", lang: "ar", mode: "thinking" });
    expect(decision.selected.some((s) => s.id === "saadat-academic-core")).toBe(false);
    expect(decision.strategy).toBe("lean");
  });

  it("keeps the prompt byte-identical without saadatContext (failure-mode guard)", () => {
    const withoutSaadat = getSystemPrompt("en", "instant");
    const withEmpty = getSystemPrompt("en", "instant", undefined, false, undefined, undefined, false, undefined, false, "full", "");
    expect(withEmpty).toBe(withoutSaadat);
  });

  it("keeps the instant prompt inside its token budget (regression guard)", () => {
    const arPrompt = getSystemPrompt("ar", "instant");
    const enPrompt = getSystemPrompt("en", "instant");
    expect(arPrompt.length).toBeLessThan(22_000);
    expect(enPrompt.length).toBeLessThan(22_000);
  });

  it("normalizer matches SkillNet's canonical Arabic form", () => {
    expect(normalizeSaadatText("مسألة")).toBe("مساله");
    expect(normalizeSaadatText("الإستقرارية")).toBe("الاستقراريه");
    expect(normalizeSaadatText("YBus")).toBe("ybus");
  });
});
