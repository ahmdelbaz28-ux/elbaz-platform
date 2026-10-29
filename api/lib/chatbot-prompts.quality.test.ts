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
 * Option B — SMART SUPPORT PROTOCOL (distilled from the "Customer Service"
 * and "Support Responder" personas):
 *   5. Thinking prompts carry the empathy-first support layer; instant mode
 *      stays lean without it (speed budget).
 *   6. Composition order: platform core → support protocol → official links.
 *
 * Option D — PROMPT VERSIONING + 3-CASE MATRIX (see PROMPTS_CHANGELOG.md):
 *   7. PROMPT_VERSION is exported and matches the latest entry documented in
 *      PROMPTS_CHANGELOG.md (version drift fails CI).
 *   8. Happy-path / edge / failure-mode matrix over prompt composition:
 *      vision block only with vision=true, rolling summary only with a
 *      summary, catalog verbatim only when provided, fallback line when not.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { getSystemPrompt, PROMPT_VERSION, sanitizeReplyOutput } from "./chatbot-prompts";
import { COURSE_CATALOG_PLACEHOLDER, buildCourseCatalogBlock, sldSkillAr, sldSkillEn } from "./chatbot-skills";

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

// ─── Option B — Smart Support Protocol ──────────────────────────────────────

describe("Option B: smart support protocol (thinking mode)", () => {
  const arPrompt = getSystemPrompt("ar", "thinking");
  const enPrompt = getSystemPrompt("en", "thinking");

  it("Arabic thinking prompt carries the empathy-first support rules", () => {
    for (const anchor of ["بروتوكول الدعم الذكي", "سطر تعاطف", "لا تلوم المستخدم", "نظام التذاكر", "سؤال متابعة واحد"]) {
      expect(arPrompt).toContain(anchor);
    }
  });

  it("English thinking prompt carries the empathy-first support rules", () => {
    for (const anchor of ["SMART SUPPORT PROTOCOL", "ONE short empathetic line", "NEVER blame the user", "ticket system", "exactly ONE follow-up question"]) {
      expect(enPrompt).toContain(anchor);
    }
  });

  it("composes support protocol AFTER platform core and BEFORE official channels", () => {
    const idxPlatform = arPrompt.indexOf("الجنيه المصري (EGP)");
    const idxSupport = arPrompt.indexOf("بروتوكول الدعم الذكي");
    const idxChannels = arPrompt.indexOf("القنوات الرسمية للمنصة");
    expect(idxPlatform).toBeGreaterThan(-1);
    expect(idxSupport).toBeGreaterThan(idxPlatform);
    expect(idxChannels).toBeGreaterThan(idxSupport);
  });

  it("full support protocol NEVER leaks into instant mode (speed priority)", () => {
    for (const lang of ["ar", "en"] as const) {
      const p = getSystemPrompt(lang, "instant");
      expect(p).not.toContain("بروتوكول الدعم الذكي");
      expect(p).not.toContain("SMART SUPPORT PROTOCOL");
    }
  });

  it("support protocol never invents contact channels (aligns with link policy)", () => {
    expect(arPrompt).toContain("ولا تخترع أبداً بريداً أو هاتفاً");
    expect(enPrompt).toContain("NEVER invent an email or phone number");
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

// ─── Reach-gems — ANSWER-SOURCE (EVIDENCE) MODEL (Panniantong/Agent-Reach) ──

describe("Reach-gems: answer-source (evidence) model (thinking mode)", () => {
  const arPrompt = getSystemPrompt("ar", "thinking");
  const enPrompt = getSystemPrompt("en", "thinking");

  const evidenceAnchorsAr = [
    "نموذج مصدر الإجابة",
    "معرفة مؤكدة",
    "استنتاج هندسي",
    "بيانات ناقصة",
    "العنوان ليس محتوى",
    "داخل محتوى الكورس نفسه",
    "سلّم المتاح دائماً",
  ];

  const evidenceAnchorsEn = [
    "ANSWER-SOURCE (EVIDENCE) MODEL",
    "Certain knowledge",
    "Engineering derivation",
    "Missing data",
    "The title is not the content",
    "inside the course content itself",
    "Always deliver what you have",
  ];

  it("Arabic thinking prompt carries every evidence-model anchor", () => {
    for (const anchor of evidenceAnchorsAr) expect(arPrompt).toContain(anchor);
  });

  it("English thinking prompt carries every evidence-model anchor", () => {
    for (const anchor of evidenceAnchorsEn) expect(enPrompt).toContain(anchor);
  });

  it("composes the model AFTER the electrical depth pack and BEFORE the platform core", () => {
    const idxPack = arPrompt.indexOf("حزمة العمق الكهربائي");
    const idxEvidence = arPrompt.indexOf("نموذج مصدر الإجابة");
    const idxPlatform = arPrompt.indexOf("الجنيه المصري (EGP)");
    expect(idxPack).toBeGreaterThan(-1);
    expect(idxEvidence).toBeGreaterThan(idxPack);
    expect(idxPlatform).toBeGreaterThan(idxEvidence);
  });

  it("instant prompts carry the one-line evidence anchor only", () => {
    expect(getSystemPrompt("ar", "instant")).toContain("مرساة مصدر الإجابة");
    expect(getSystemPrompt("en", "instant")).toContain("Answer-source anchor");
  });

  it("full evidence model NEVER leaks into instant mode (speed priority)", () => {
    for (const lang of ["ar", "en"] as const) {
      const p = getSystemPrompt(lang, "instant");
      expect(p).not.toContain("نموذج مصدر الإجابة");
      expect(p).not.toContain("ANSWER-SOURCE (EVIDENCE) MODEL");
      expect(p).not.toContain("العنوان ليس محتوى");
    }
  });
});

describe("Reach-gems: behavioral contracts (Agent-Reach test philosophy)", () => {
  it("CONTRACT evidence-failure-not-a-guess: missing knowledge routes to MISSING + routing, never fabrication", () => {
    const arPrompt = getSystemPrompt("ar", "thinking");
    expect(arPrompt).toContain("MISSING");
    expect(arPrompt).toContain("بيانات مفقودة");
    expect(arPrompt).toContain("وجّه للخطوة التالية");
    const enPrompt = getSystemPrompt("en", "thinking");
    expect(enPrompt).toContain("MISSING");
    expect(enPrompt).toContain("route to the next step");
  });

  it("CONTRACT metadata-is-not-content: an unprovided lesson detail is admitted, not invented", () => {
    const arPrompt = getSystemPrompt("ar", "thinking");
    const enPrompt = getSystemPrompt("en", "thinking");
    expect(arPrompt).toContain("«هذا التفصيل داخل محتوى الكورس نفسه»");
    expect(arPrompt).toContain("ولا تختلق منهجاً أو محاضرات أو ملفات من عندك");
    expect(enPrompt).toContain('"that detail is inside the course content itself"');
    expect(enPrompt).toContain("never invent a curriculum, lectures or files");
  });

  it("CONTRACT unverified-attribution: attributed claims are rejected, not built upon", () => {
    const arPrompt = getSystemPrompt("ar", "thinking");
    const enPrompt = getSystemPrompt("en", "thinking");
    expect(arPrompt).toContain("النسبة المجهولة مرفوضة");
    expect(arPrompt).toContain("لا تصدّق النسبة");
    expect(arPrompt).toContain("ممنوع تسويق قيمة بلا مصدر");
    expect(enPrompt).toContain("Unverified attributions are rejected");
    expect(enPrompt).toContain("never legitimize a value without a source");
  });

  it("CONTRACT never-weaken-a-correction: soft framings closed (v3.3.1, live-eval evidence)", () => {
    const arPrompt = getSystemPrompt("ar", "thinking");
    const enPrompt = getSystemPrompt("en", "thinking");
    expect(arPrompt).toContain("التصحيح لا يُضعَف بعده");
    expect(arPrompt).toContain("بعض المصنعين يوصون بـ");
    expect(arPrompt).toContain("لا يُذكر من عندك أبداً");
    expect(enPrompt).toContain("never weaken a correction");
    expect(enPrompt).toContain("some manufacturers recommend");
    // instant anchors carry the compact form too (both languages)
    expect(getSystemPrompt("ar", "instant")).toContain("التصحيح لا يُضعَف بعده");
    expect(getSystemPrompt("en", "instant")).toContain("never weaken a correction");
  });

  it("CONTRACT empathy-gating: empathy only for explicit frustration, not technical openers", () => {
    const arPrompt = getSystemPrompt("ar", "thinking");
    const enPrompt = getSystemPrompt("en", "thinking");
    expect(arPrompt).toContain("التعاطف لإحباط صريح واصل من المستخدم فقط");
    expect(enPrompt).toContain("Empathy is for explicit user frustration only");
  });

  it("CONTRACT deliver-what-you-have: partial answers deliver the grounded part + name the gap", () => {
    const arPrompt = getSystemPrompt("ar", "thinking");
    expect(arPrompt).toContain("سلّم المتاح دائماً");
    expect(arPrompt).toContain("لا تصمت ولا تخترع بديلاً عن المفقود");
    const enPrompt = getSystemPrompt("en", "thinking");
    expect(enPrompt).toContain("Always deliver what you have");
    expect(enPrompt).toContain("never go silent, never fabricate a substitute");
  });

  it("CONTRACT name-standards-never-link: standards cited as text, official links only", () => {
    const arPrompt = getSystemPrompt("ar", "thinking");
    const enPrompt = getSystemPrompt("en", "thinking");
    expect(arPrompt).toContain("المعيار يُذكر باسمه وإصداره دون روابط");
    expect(enPrompt).toContain("Standards are named, never linked");
  });

  it("CONTRACT provider-secrecy: providers unnamed even in negations", () => {
    const arPrompt = getSystemPrompt("ar", "thinking");
    const enPrompt = getSystemPrompt("en", "thinking");
    expect(arPrompt).toContain("ولا تذكر أسماء مزودين أو شركات تقنية حتى في النفي");
    expect(enPrompt).toContain("Never name providers or tech companies even in negations");
  });

  it("CONTRACT layered-disclosure applies in BOTH modes (full model or quick anchor)", () => {
    for (const lang of ["ar", "en"] as const) {
      const thinking = getSystemPrompt(lang, "thinking");
      const instant = getSystemPrompt(lang, "instant");
      expect(thinking).toMatch(/استنتاج هندسي|Engineering derivation/);
      expect(instant).toMatch(/استنتاج هندسي|engineering derivation/i);
    }
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

// ─── SLD IMMEDIATE EXECUTION RULE (v3.4.0 — draw-now contract) ──────────────

describe("SLD immediate execution rule (thinking mode, v3.4.0)", () => {
  // The live failure this contract locks: the model promised "سأرسم لك
  // مخططاً…" and the reply got cut (or deferred) with NO spec board — the
  // user had to retype. The rule forces: sufficient data → draw in the SAME
  // reply; one missing essential fact → ONE question; assumable → assume + state.
  const arPrompt = getSystemPrompt("ar", "thinking");
  const enPrompt = getSystemPrompt("en", "thinking");

  it("HAPPY PATH: sufficient-data branch present in BOTH languages (draw in the same reply)", () => {
    expect(sldSkillAr).toContain("قاعدة التنفيذ الفوري");
    expect(sldSkillAr).toContain("ارسم فوراً في نفس الرد");
    expect(sldSkillAr).toContain("لوحة المواصفات تظهر في أول رد");
    expect(sldSkillEn).toContain("IMMEDIATE EXECUTION RULE");
    expect(sldSkillEn).toContain("draw IMMEDIATELY in the same reply");
    expect(sldSkillEn).toContain("the spec board appears in the very FIRST reply");
  });

  it("EDGE: missing-essential-fact branch → exactly ONE question OR assume-and-state (both languages)", () => {
    expect(sldSkillAr).toContain("سؤال واحد محدد فقط");
    expect(sldSkillAr).toContain("ممنوع قائمة أسئلة");
    expect(sldSkillAr).toContain("افترضت:");
    expect(sldSkillEn).toContain("exactly ONE specific question");
    expect(sldSkillEn).toContain("never a list of questions");
    expect(sldSkillEn).toContain("Assumed: X");
  });

  it("FAILURE MODE: the three observed promise patterns are banned VERBATIM in the rule text", () => {
    // The rule itself quotes the forbidden phrasings so the model sees them
    // as named-and-shamed patterns, not vague "avoid delays" guidance.
    expect(sldSkillAr).toContain("ممنوع منعاً باتاً: التوعّد");
    expect(sldSkillAr).toContain("«سأرسم لك»");
    expect(sldSkillAr).toContain("«قريباً»");
    expect(sldSkillAr).toContain("طلب الإذن («تحب أرسمه؟»)");
    expect(sldSkillEn).toContain("Strictly forbidden: promising");
    expect(sldSkillEn).toContain('"I\'ll draw it for you"');
    expect(sldSkillEn).toContain('asking permission ("want me to draw it?")');
  });

  it("the rule is composed into BOTH thinking prompts (and only there)", () => {
    expect(arPrompt).toContain("قاعدة التنفيذ الفوري");
    expect(enPrompt).toContain("IMMEDIATE EXECUTION RULE");
    // Deliberate: the SLD skill (and thus this rule) lives in thinking mode
    // only — instant mode keeps its token budget; the 📐 draw-now chip in the
    // UI covers instant-mode misses instead of inflating the speed prompt.
    expect(getSystemPrompt("ar", "instant")).not.toContain("قاعدة التنفيذ الفوري");
    expect(getSystemPrompt("en", "instant")).not.toContain("IMMEDIATE EXECUTION RULE");
  });

  it("the board example is still intact (rule did not displace the format contract)", () => {
    expect(sldSkillAr).toContain('"type":"grid"');
    expect(sldSkillAr).toContain("الأنواع المسموحة فقط");
    expect(sldSkillEn).toContain("Allowed types only");
  });

  it("PROMPTS_CHANGELOG.md documents 3.4.0 with the rule name (traceability)", () => {
    const changelog = readFileSync(new URL("../../PROMPTS_CHANGELOG.md", import.meta.url), "utf8");
    expect(changelog).toContain("## [3.4.0]");
    expect(changelog).toContain("SLD IMMEDIATE EXECUTION RULE");
  });
});
