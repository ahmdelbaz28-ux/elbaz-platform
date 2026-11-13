/**
 * PROMPT CACHE-LAYOUT TESTS — token optimization v3.6.0
 * ─────────────────────────────────────────────────────────────────────
 * The stable prefix contract: for a given mode+language, the system prompt
 * must start with a BYTE-IDENTICAL prefix across every request variant
 * (different catalog text / rolling summary / screen context / vision) —
 * this is what enables provider-side prompt caching to discount 50-90% of
 * the prompt tokens. The volatile payload (routed skills, vision, summary,
 * catalog, screen) must sit in the TAIL.
 */

import { describe, it, expect } from "vitest";
import { getSystemPrompt } from "./chatbot-prompts";
import { buildCourseCatalogBlock, buildCourseCatalogLiteBlock } from "./chatbot-skills";
import type { ParsedScreenContext } from "./chatbot-screen";

const screenA: ParsedScreenContext = {
  rawPath: "/courses/etap",
  pageType: "course",
  pageTitle: "كورس ETAP",
  details: "صفحة كورس",
  trail: [],
  auth: "user",
} as unknown as ParsedScreenContext;

const screenB: ParsedScreenContext = {
  rawPath: "/dashboard",
  pageType: "dashboard",
  pageTitle: "لوحة الطالب",
  details: "لوحة",
  trail: [],
  auth: "guest",
} as unknown as ParsedScreenContext;

const FULL_CATALOG = "- كورس أ | Course A — المستوى: مبتدئ | السعر: 100 EGP\n- كورس ب | Course B — المستوى: متقدم | السعر: 250 EGP";
const LITE_CATALOG = "- كورس أ | Course A — المستوى: مبتدئ | السعر: 100 EGP";

describe("stable prefix across request variants", () => {
  for (const mode of ["thinking", "instant"] as const) {
    for (const lang of ["ar", "en"] as const) {
      it(`${mode}/${lang}: fixed prefix is byte-identical regardless of catalog/summary/screen/vision`, () => {
        const variants = [
          getSystemPrompt(lang, mode, FULL_CATALOG, false, undefined, undefined, false),
          getSystemPrompt(lang, mode, FULL_CATALOG, true, "ملخص متداول قديم", screenA, false),
          getSystemPrompt(lang, mode, LITE_CATALOG, false, undefined, screenB, false),
          getSystemPrompt(lang, mode, "", false, undefined, undefined, false),
          getSystemPrompt(lang, mode, FULL_CATALOG, false, undefined, undefined, false, "احسب تيار القصر"),
          getSystemPrompt(lang, mode, FULL_CATALOG, false, undefined, undefined, false, "كم سعر كورس؟"),
        ];
        // The longest common prefix across ALL variants is the cacheable head.
        let prefixLen = variants[0].length;
        for (const v of variants) {
          let i = 0;
          while (i < Math.min(prefixLen, v.length) && variants[0][i] === v[i]) i++;
          prefixLen = i;
        }
        const head = variants[0].slice(0, prefixLen);
        // The head must carry the persona + mode + guard + language rules —
        // the core of the prompt — and be a substantial share of the prompt.
        // (Persona anchor is language-specific: the EN prompt never contains
        // the Arabic persona line.)
        expect(head).toContain(lang === "ar" ? "أنت المساعد الذكي الرسمي" : "official AI Assistant");
        expect(head.length).toBeGreaterThan(5_000);
        // Data blocks must NOT sit inside the stable head.
        expect(head).not.toContain("كتالوج كورسات المنصة");
        expect(head).not.toContain("عينة من أبرز كورسات");
        expect(head).not.toContain("ملخص متداول");
      });
    }
  }

  it("routed-skill variation also stays out of the prefix (routed zone last)", () => {
    // PVSyst mention forces the pvsyst-core pack — a routed selection that a
    // short-circuit calculation question can never share, so the divergence
    // point sits inside the routed zone (before catalog/summary/screen).
    const p1 = getSystemPrompt("ar", "thinking", FULL_CATALOG, false, undefined, undefined, false, "احسب تيار القصر عند البوس");
    const p2 = getSystemPrompt("ar", "thinking", FULL_CATALOG, false, undefined, undefined, false, "كم سعر كورس PVSyst؟");
    expect(p1).not.toBe(p2);
    let i = 0;
    while (i < Math.min(p1.length, p2.length) && p1[i] === p2[i]) i++;
    const head = p1.slice(0, i);
    // The persona + evidence model are stable; the routed SLD skill (varies)
    // and catalog (varies) must be after the divergence point.
    expect(head).toContain("أنت المساعد الذكي الرسمي");
    expect(head).not.toContain("كتالوج كورسات المنصة");
  });
});

describe("catalog block styles (full vs lite)", () => {
  it("full block carries the no-invention contract over the FULL text", () => {
    const block = buildCourseCatalogBlock(FULL_CATALOG);
    expect(block).toContain("كتالوج كورسات المنصة");
    expect(block).toContain("ولا تضف كورسات أو أسعاراً غير موجودة");
    expect(block).toContain("كورس ب");
  });

  it("lite block carries the sample contract and the honesty line", () => {
    const block = buildCourseCatalogLiteBlock(LITE_CATALOG);
    expect(block).toContain("عينة من أبرز كورسات المنصة");
    expect(block).toContain("لا تخترع كورسات أو أسعاراً");
    expect(block).toContain("القائمة الكاملة مع الأسعار متاحة في صفحة الكورسات");
    expect(block).toContain("كورس أ");
  });

  it("both blocks degrade to the same fail-open line on empty catalog", () => {
    expect(buildCourseCatalogBlock("")).toContain("لا تتوفر قائمة محدثة الآن");
    expect(buildCourseCatalogLiteBlock("")).toContain("لا تتوفر قائمة محدثة الآن");
    // No honesty line when there is no sample at all.
    expect(buildCourseCatalogLiteBlock("")).not.toContain("هذه عينة");
  });
});

describe("catalogMode wiring", () => {
  it("catalogMode='lite' renders the sample contract; default stays full (legacy callers unchanged)", () => {
    const full = getSystemPrompt("ar", "thinking", FULL_CATALOG);
    const lite = getSystemPrompt("ar", "thinking", FULL_CATALOG, false, undefined, undefined, false, undefined, false, "lite");
    expect(full).toContain("كتالوج كورسات المنصة");
    expect(lite).toContain("عينة من أبرز كورسات المنصة");
    // Default (no param) is full — every legacy call site is unchanged.
    expect(getSystemPrompt("ar", "thinking", FULL_CATALOG, false, undefined, undefined, false, undefined, false)).toBe(full);
  });
});
