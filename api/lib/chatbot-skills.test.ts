/**
 * CHATBOT SKILLS TESTS — skills composition + course-catalog injection
 *
 * Verifies (chatbot-skills.ts + chatbot-prompts.ts + chatbot.ts):
 *   1. Thinking mode composes the full skill set (version rule, mentor,
 *      source-routing, PF/SKM/PVSyst cores, platform facts, safety) and keeps
 *      them BEFORE the ETAP expert core (per design).
 *   2. Instant mode gets the token-light skills (no full research protocol,
 *      no PF/SKM/PVSyst cores) — instant has a 1024-token output budget.
 *   3. The course catalog is injected verbatim in BOTH modes when provided,
 *      and the fallback line appears when it is empty.
 *   4. No `__COURSE_CATALOG__` placeholder literal leaks into any prompt.
 *   5. No CJK characters anywhere in prompts (regression: 官网 leak).
 *   6. getChatResponse forwards the catalog into the actual provider request.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { getSystemPrompt, sanitizeReplyOutput } from "./chatbot-prompts";
import {
  buildCourseCatalogBlock,
  COURSE_CATALOG_PLACEHOLDER,
  OFFICIAL_LINKS,
  officialChannelsAr,
  officialChannelsEn,
} from "./chatbot-skills";

const MOCK_CATALOG = [
  "- ETAP من الصفر إلى الاحتراف | ETAP From Zero to Pro — المستوى/Level: مبتدئ | السعر/Price: 1,999 EGP | المدة/Duration: 25 ساعة | مدفوع/Premium — داخل المنصة (on-platform path): /courses/etap-pro",
  "- تنسيق الحماية العملي | Practical Protection Coordination — المستوى/Level: متقدم | السعر/Price: مجاني / Free — داخل المنصة (on-platform path): /courses/protection-coordination",
].join("\n");

// Markers that must exist in the THINKING prompt (full skill set)
const THINKING_MARKERS = [
  "قاعدة وعي الإصدار",                          // versionRuleAr
  "بروتوكول البحث والتوجيه للمصادر",            // researchSkillAr
  "DIgSILENT POWERFACTORY KNOWLEDGE CORE",       // pfCore
  "SKM PTW (POWER*TOOLS) KNOWLEDGE CORE",        // skmCore
  "PVSYST KNOWLEDGE CORE",                       // pvsystCore
  "مرافق تعليمي للطالب",                         // mentorProtocolAr
  "الجنيه المصري (EGP)",                         // platformCoreAr
  "قاعدة السلامة الكهربائية",                    // safetyRuleAr
  "ETAP EXPERT SYSTEM",                          // etapExpertCore (kept)
];

describe("getSystemPrompt — thinking mode", () => {
  it("composes the full skill set in Arabic thinking prompt", () => {
    const p = getSystemPrompt("ar", "thinking");
    for (const marker of THINKING_MARKERS) {
      expect(p).toContain(marker);
    }
  });

  it("composes the full skill set in English thinking prompt", () => {
    const p = getSystemPrompt("en", "thinking");
    expect(p).toContain("VERSION-AWARENESS RULE");
    expect(p).toContain("RESEARCH & SOURCE-ROUTING PROTOCOL");
    expect(p).toContain("learning companion");
    expect(p).toContain("Egyptian Pound (EGP)");
    expect(p).toContain("ELECTRICAL SAFETY RULE");
    expect(p).toContain("ETAP EXPERT SYSTEM");
  });

  it("places skills BEFORE the ETAP expert core and catalog at the END", () => {
    const p = getSystemPrompt("ar", "thinking", MOCK_CATALOG);
    const researchIdx = p.indexOf("بروتوكول البحث والتوجيه للمصادر");
    const etapIdx = p.indexOf("ETAP EXPERT SYSTEM");
    const catalogIdx = p.indexOf("كتالوج كورسات المنصة");
    expect(researchIdx).toBeGreaterThan(-1);
    expect(etapIdx).toBeGreaterThan(researchIdx); // skills before expert core
    expect(catalogIdx).toBeGreaterThan(etapIdx);  // catalog last (recency)
  });

  it("injects the real catalog verbatim when provided", () => {
    const p = getSystemPrompt("ar", "thinking", MOCK_CATALOG);
    expect(p).toContain("ETAP من الصفر إلى الاحتراف");
    expect(p).toContain("1,999 EGP");
    expect(p).toContain("/courses/etap-pro");
  });

  it("shows the fallback line when catalog is empty", () => {
    const p = getSystemPrompt("ar", "thinking", "");
    expect(p).toContain("كتالوج كورسات المنصة");
    expect(p).toContain("لا تتوفر قائمة محدثة الآن");
  });
});

describe("getSystemPrompt — instant mode (token-light)", () => {
  it("contains the condensed skills but NOT the heavy blocks", () => {
    const p = getSystemPrompt("ar", "instant", MOCK_CATALOG);
    expect(p).toContain("قواعد سريعة إجبارية");      // instantSkillsAr
    expect(p).toContain("وعي الإصدار");              // condensed version-awareness
    // Mandatory literal version-question template (live-behavior fix: the model
    // used to silently drop the trailing version question in instant mode)
    expect(p).toContain("قل لي إصدار البرنامج");
    expect(p).not.toContain("DIgSILENT POWERFACTORY KNOWLEDGE CORE"); // no pfCore
    expect(p).not.toContain("بروتوكول البحث والتوجيه للمصادر");       // no full research protocol
    expect(p).not.toContain("20 CRITICAL RULES");                     // no full expert core
  });

  it("injects the catalog in instant mode too (real prices fix)", () => {
    const p = getSystemPrompt("en", "instant", MOCK_CATALOG);
    expect(p).toContain("MANDATORY QUICK RULES");
    expect(p).toContain("Tell me your software version"); // mandatory version line (EN)
    expect(p).toContain("1,999 EGP");
  });

  it("keeps platform facts + safety in instant mode", () => {
    const p = getSystemPrompt("ar", "instant");
    expect(p).toContain("الجنيه المصري (EGP)");
    expect(p).toContain("قاعدة السلامة الكهربائية");
  });
});

describe("sanitizeReplyOutput — CJK leak enforcement (regression: 下游/官网)", () => {
  it("strips CJK ideographs, kana, hangul, CJK punctuation and fullwidth forms", () => {
    expect(sanitizeReplyOutput("الريلايات下游 (Downstream) بفاصل CTI")).toBe("الريلايات (Downstream) بفاصل CTI");
    expect(sanitizeReplyOutput("راجع 官网 الصفحة")).toBe("راجع الصفحة");
    expect(sanitizeReplyOutput("3相 fault")).toBe("3 fault");
    expect(sanitizeReplyOutput("テストabc")).toBe("abc");
    expect(sanitizeReplyOutput("결함abc")).toBe("abc");
    expect(sanitizeReplyOutput("خطوة１٢３ (نهاية)")).toBe("خطوة٢ (نهاية)"); // fullwidth 1/3 stripped; Arabic-Indic 2 kept
  });

  it("keeps Arabic, English, markdown and normal punctuation intact", () => {
    const fine = "** CTI ≥ 0.3s ** — راجع ETAP Help ← search: relay coordination";
    expect(sanitizeReplyOutput(fine)).toBe(fine);
    expect(sanitizeReplyOutput("```python\nprint('a b')\n```")).toContain("print('a b')");
  });

  it("cleans empty parens and doubled spaces left by the strip", () => {
    expect(sanitizeReplyOutput("حماية (下游) أساسية")).toBe("حماية أساسية");
    expect(sanitizeReplyOutput("قيمة  下游  قيمة")).toBe("قيمة قيمة");
  });

  it("is delta-safe: never trims, so SSE chunks concatenate correctly", () => {
    expect(sanitizeReplyOutput("hello ")).toBe("hello "); // trailing space kept
    expect(sanitizeReplyOutput(" world")).toBe(" world"); // leading space kept
    expect(sanitizeReplyOutput("")).toBe("");
  });
});

describe("catalog block + hygiene", () => {
  it("buildCourseCatalogBlock never leaks the placeholder literal", () => {
    expect(buildCourseCatalogBlock(MOCK_CATALOG)).not.toContain(COURSE_CATALOG_PLACEHOLDER);
    expect(buildCourseCatalogBlock("")).not.toContain(COURSE_CATALOG_PLACEHOLDER);
    expect(buildCourseCatalogBlock("")).toContain("لا تتوفر قائمة محدثة الآن");
  });

  it("no prompt (any mode/language) contains the placeholder literal", () => {
    for (const lang of ["ar", "en", undefined]) {
      for (const mode of ["thinking", "instant"] as const) {
        const p = getSystemPrompt(lang, mode, MOCK_CATALOG);
        expect(p).not.toContain("__COURSE_CATALOG__");
      }
    }
  });

  it("no CJK characters in any prompt (regression: 官网 leak)", () => {
    const cjkRe = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
    for (const lang of ["ar", "en", undefined]) {
      for (const mode of ["thinking", "instant"] as const) {
        expect(getSystemPrompt(lang, mode, MOCK_CATALOG)).not.toMatch(cjkRe);
      }
    }
  });
});

describe("getChatResponse — catalog forwarding", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("forwards the catalog text inside the provider system message", async () => {
    vi.doMock("../lib/env", () => ({
      env: {
        OPENROUTER_API_KEY: "",
        CHATBOT_API_KEY: "",
        NVIDIA_API_KEY: "nvapi-test-key",
        GROQ_API_KEY: "",
        isProduction: false,
      },
    }));
    const { getChatResponse } = await import("./chatbot");

    mockFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "إجابة تجريبية" } }],
      }),
    }));

    const result = await getChatResponse({
      messages: [{ role: "user", content: "كم سعر كورس ETAP؟" }],
      language: "ar",
      mode: "thinking",
      catalog: MOCK_CATALOG,
    });

    expect(result.success).toBe(true);
    const call = mockFetch.mock.calls.find(([url]) => String(url).includes("nvidia"));
    expect(call).toBeDefined();
    const body = JSON.parse(call![1].body);
    const systemMsg = body.messages.find((m: { role: string }) => m.role === "system");
    expect(systemMsg.content).toContain("ETAP من الصفر إلى الاحتراف");
    expect(systemMsg.content).toContain("1,999 EGP");
    expect(systemMsg.content).toContain("قاعدة وعي الإصدار");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// OFFICIAL CHANNELS & LINK POLICY — the only allowed URLs + invitation style
// (owner mandate: ETAP-download questions → Telegram channel link with a
// value-first "files reach members first" nudge; platform questions → the
// exact platform link; NEVER forcing phrasing — the user must feel THEY
// benefit from subscribing)
// ═════════════════════════════════════════════════════════════════════════

const ALL_OFFICIAL_URLS = Object.values(OFFICIAL_LINKS);

describe("official channels block — link registry", () => {
  it("registers the six official URLs verbatim in both language blocks", () => {
    for (const url of ALL_OFFICIAL_URLS) {
      expect(officialChannelsAr).toContain(url);
      expect(officialChannelsEn).toContain(url);
    }
  });

  it("keeps Instagram/TikTok canonical (no share-tracking params)", () => {
    expect(OFFICIAL_LINKS.instagram).not.toContain("exln=");
    expect(OFFICIAL_LINKS.tiktok).not.toContain("_t=");
  });

  it("encodes the ETAP-download → Telegram rule and the first-hand-files value", () => {
    expect(officialChannelsAr).toContain("تحميل برنامج ETAP");
    expect(officialChannelsAr).toContain("أول بأول");
    expect(officialChannelsEn).toContain("ETAP software");
    expect(officialChannelsEn).toContain("FIRST");
  });

  it("bans forcing phrasing and caps the invitation at one per reply", () => {
    expect(officialChannelsAr).toContain("ممنوع منعاً باتاً صيغة الإجبار");
    expect(officialChannelsAr).toContain("دعوة واحدة فقط");
    expect(officialChannelsEn).toContain("NEVER use forcing or commanding phrasing");
    expect(officialChannelsEn).toContain("ONE invitation per reply");
  });

  it("requires Markdown link format so anchors render clickable", () => {
    expect(officialChannelsAr).toContain("[الاسم](الرابط)");
    expect(officialChannelsEn).toContain("[Name](url)");
  });
});

describe("getSystemPrompt — official channels composition", () => {
  const MODES = ["thinking", "instant"] as const;

  it("injects the Telegram link + usage rules into ALL four paths (mode × language)", () => {
    for (const mode of MODES) {
      const ar = getSystemPrompt("ar", mode);
      const en = getSystemPrompt("en", mode);
      // Every path carries the full registry + the Telegram-download rule.
      for (const url of ALL_OFFICIAL_URLS) {
        expect(ar).toContain(url);
        expect(en).toContain(url);
      }
      expect(ar).toContain("قواعد استخدام الروابط");
      expect(ar).toContain("دعوة واحدة فقط");
      expect(en).toContain("LINK-USAGE RULES");
      expect(en).toContain("ONE invitation per reply");
    }
  });

  it("keeps the no-invented-URLs rule standing alongside the official registry", () => {
    const p = getSystemPrompt("ar", "thinking");
    expect(p).toContain("لا تخترع روابط");
    expect(p.indexOf("لا تخترع روابط")).toBeLessThan(p.indexOf("القنوات الرسمية للمنصة"));
  });
});
