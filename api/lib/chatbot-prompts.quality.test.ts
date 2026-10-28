/**
 * CHATBOT PROMPT QUALITY TESTS — agency-distill work (Options A / B / D)
 * ────────────────────────────────────────────────────────────────────────
 * Option A — ELECTRICAL DEPTH PACK (distilled from the "Electrical Engineer"
 * specialist persona, msitarzewski/agency-agents, MIT):
 *   1. Thinking prompts (AR + EN) carry the full depth pack with its key
 *      engineering anchors (IEEE 485 / IEC 62305 / ISO 8528 / X/R / 1.25).
 *   2. Instant prompts carry ONLY the token-light quick anchors — the full
 *      pack must NEVER leak into the speed-priority mode (token budget guard).
 *   3. The pack composes AFTER the ETAP expert core and BEFORE the platform
 *      core (documented design order).
 *   4. House rules survive the addition: no CJK, no placeholder leak, table
 *      ban + language rule + safety rule + reasoning guard all present.
 *
 * Option D — PROMPT VERSIONING + 3-CASE MATRIX (see PROMPTS_CHANGELOG.md):
 *   5. PROMPT_VERSION is exported and matches the latest entry documented in
 *      PROMPTS_CHANGELOG.md (version drift fails CI).
 *   6. Happy-path / edge / failure-mode matrix over prompt composition:
 *      vision block only with vision=true, rolling summary only with a
 *      summary, catalog verbatim only when provided, fallback line when not.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { getSystemPrompt, PROMPT_VERSION, sanitizeReplyOutput } from "./chatbot-prompts";
import { COURSE_CATALOG_PLACEHOLDER, buildCourseCatalogBlock } from "./chatbot-skills";

// ─── Option A — Electrical Depth Pack ───────────────────────────────────────

describe("Option A: electrical depth pack (thinking mode)", () => {
  const arPrompt = getSystemPrompt("ar", "thinking");
  const enPrompt = getSystemPrompt("en", "thinking");

  const depthAnchorsAr = [
    "حزمة العمق الكهربائي",       // pack header
    "IEEE 485",                    // battery sizing standard
    "معامل التقادم 1.25",          // ageing factor
    "IEC 62305",                   // lightning protection series
    "IEEE 80",                     // grounding touch/step
    "IEC 60909",                   // IEC short-circuit standard
    "X/R",                         // X/R ratio discipline
    "ISO 8528",                    // generator ratings/derating
    "wet stacking",                // minimum-loading failure mode
    "soil resistivity",            // measured input discipline
    "MISSING",                     // missing-input protocol
    "kW",                          // kW/kVA discipline
  ];

  const depthAnchorsEn = [
    "ELECTRICAL DEPTH PACK",
    "IEEE 485",
    "1.25 ageing factor",
    "IEC 62305",
    "IEEE 80",
    "IEC 60909",
    "X/R",
    "ISO 8528",
    "wet stacking",
    "soil resistivity",
    "MISSING",
    "kW",
  ];

  it("Arabic thinking prompt carries every depth-pack anchor", () => {
    for (const anchor of depthAnchorsAr) expect(arPrompt).toContain(anchor);
  });

  it("English thinking prompt carries every depth-pack anchor", () => {
    for (const anchor of depthAnchorsEn) expect(enPrompt).toContain(anchor);
  });

  it("composes the pack AFTER the ETAP expert core and BEFORE the platform core", () => {
    const idxEtap = arPrompt.indexOf("ETAP EXPERT SYSTEM");
    const idxPack = arPrompt.indexOf("حزمة العمق الكهربائي");
    const idxPlatform = arPrompt.indexOf("الجنيه المصري (EGP)");
    expect(idxEtap).toBeGreaterThan(-1);
    expect(idxPack).toBeGreaterThan(idxEtap);
    expect(idxPlatform).toBeGreaterThan(idxPack);
  });

  it("keeps the pack bilingual — EN thinking gets the EN pack, not the AR one", () => {
    expect(enPrompt).toContain("ELECTRICAL DEPTH PACK");
    expect(enPrompt).not.toContain("حزمة العمق الكهربائي");
  });
});

describe("Option A: instant mode token budget guard", () => {
  it("instant prompts carry the quick anchors (one-line version)", () => {
    expect(getSystemPrompt("ar", "instant")).toContain("مراسٍ كهربائية سريعة");
    expect(getSystemPrompt("en", "instant")).toContain("Electrical quick anchors");
  });

  it("full depth pack NEVER leaks into instant mode (speed priority)", () => {
    for (const lang of ["ar", "en"] as const) {
      const p = getSystemPrompt(lang, "instant");
      expect(p).not.toContain("حزمة العمق الكهربائي");
      expect(p).not.toContain("ELECTRICAL DEPTH PACK");
      expect(p).not.toContain("wet stacking"); // full-pack-only detail
      expect(p).not.toContain("ETSI EN 300 132-2"); // full-pack-only detail
    }
  });

  it("instant prompt stays below the instant size ceiling (chars)", () => {
    // Guard against accidental instant-mode bloat (speed-first mode).
    expect(getSystemPrompt("ar", "instant").length).toBeLessThan(22_000);
    expect(getSystemPrompt("en", "instant").length).toBeLessThan(22_000);
  });
});

// ─── Option D — versioning + changelog drift guard ─────────────────────────

describe("Option D: prompt versioning (prompt-as-code)", () => {
  it("exports a semver PROMPT_VERSION", () => {
    expect(PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("PROMPTS_CHANGELOG.md documents the current version (no drift)", () => {
    const changelog = readFileSync(new URL("../../PROMPTS_CHANGELOG.md", import.meta.url), "utf8");
    expect(changelog).toContain(`## [${PROMPT_VERSION}]`);
  });

  it("changelog references the depth-pack introduction (traceability)", () => {
    const changelog = readFileSync(new URL("../../PROMPTS_CHANGELOG.md", import.meta.url), "utf8");
    expect(changelog).toContain("ELECTRICAL DEPTH PACK");
    expect(changelog).toContain("msitarzewski/agency-agents");
  });
});

// ─── composition matrix (core invariants, applies to every variant) ─────────

describe("composition matrix (core invariants, applies to every variant)", () => {
  const MOCK_CATALOG = "- ETAP من الصفر إلى الاحتراف | السعر: 1,999 EGP";

  it("HAPPY PATH: vision + summary + catalog all present when provided", () => {
    const p = getSystemPrompt("ar", "thinking", MOCK_CATALOG, true, "سأل سابقاً عن تنسيق الحماية");
    expect(p).toContain("وضع تحليل الصور");           // vision block
    expect(p).toContain("ملخص متداول");               // rolling summary
    expect(p).toContain("ETAP من الصفر إلى الاحتراف"); // catalog verbatim
  });

  it("EDGE: guest/no-image/no-summary prompts contain none of the optional blocks", () => {
    const p = getSystemPrompt("ar", "thinking");
    expect(p).not.toContain("وضع تحليل الصور");
    expect(p).not.toContain("ملخص متداول");
    expect(p).toContain("لا تتوفر قائمة محدثة الآن"); // catalog fallback line
  });

  it("EDGE: instant mode stays lean — no full research protocol / PF·SKM·PVSyst cores", () => {
    const p = getSystemPrompt("ar", "instant");
    expect(p).not.toContain("بروتوكول البحث والتوجيه للمصادر");
    expect(p).not.toContain("DIgSILENT POWERFACTORY KNOWLEDGE CORE");
    expect(p).not.toContain("PVSYST KNOWLEDGE CORE");
  });

  it("FAILURE MODE: no placeholder literal, no CJK, house rules intact in all 4 variants", () => {
    for (const lang of ["ar", "en"] as const) {
      for (const mode of ["thinking", "instant"] as const) {
        const p = getSystemPrompt(lang, mode);
        expect(p).not.toContain(COURSE_CATALOG_PLACEHOLDER);
        expect(p).not.toMatch(/[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF01-\uFF5E\uFF61-\uFF9F]/);
        expect(p).toContain("OUTPUT RULES");                                   // reasoning guard
        expect(p).toContain("Markdown tables");                                 // table ban (EN text inside both)
        const hasSafetyRule = p.includes("السلامة الكهربائية") || p.includes("ELECTRICAL SAFETY RULE");
        expect(hasSafetyRule).toBe(true);
      }
    }
  });

  it("FAILURE MODE: sanitizer strips CJK from user-facing replies (delta-safe)", () => {
    expect(sanitizeReplyOutput("مرحبا 官网 world")).toBe("مرحبا world");
    expect(sanitizeReplyOutput("التعايث () اختبار")).toBe("التعايث اختبار");
    expect(sanitizeReplyOutput("clean text")).toBe("clean text");
  });

  it("FAILURE MODE: catalog builder never leaks the placeholder into prompts", () => {
    expect(buildCourseCatalogBlock("")).not.toContain(COURSE_CATALOG_PLACEHOLDER);
    expect(buildCourseCatalogBlock(MOCK_CATALOG)).toContain(MOCK_CATALOG);
  });
});
