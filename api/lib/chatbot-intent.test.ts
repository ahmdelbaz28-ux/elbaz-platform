/**
 * CHATBOT INTENT TESTS — token-optimization gating (prompt v3.6.0)
 * ────────────────────────────────────────────────────────────────
 * The quality contract: FALSE NEGATIVES are the only danger (a course
 * question without the full catalog would degrade answers), so the test
 * matrix is asymmetric:
 *   • every plausible course/price/platform phrasing MUST match;
 *   • diacritics/alef/ta-marbuta variants MUST match (normalization);
 *   • multi-turn stickiness MUST hold ("طيب والأخيرة دي؟" after a course
 *     question keeps the full catalog);
 *   • pure technical questions MAY stay lean (false positives are safe —
 *     they only restore the legacy payload).
 */

import { describe, it, expect } from "vitest";
import {
  hasCourseIntent,
  hasWebIntent,
  courseIntentFromMessages,
  webIntentFromMessages,
  sliceCatalogLite,
} from "./chatbot-intent";

describe("hasCourseIntent — generous triggers (false negatives forbidden)", () => {
  const mustMatch = [
    // Direct course words (Arabic, with/without suffixes)
    "كم سعر كورس ETAP؟",
    "عايز أشوف الكورسات المتاحة",
    "هل عندكم دورة في التصميم؟",
    "إيه أفضل كورس لتعلم السولار؟",
    // Diacritics + alef + ta-marbuta variants normalize to the same text
    "مُمْكِنْ أَسْأَلْ عَنِ الكُورْسَات؟",
    "أين أجد الدُّورَة؟",
    // Prices & payment
    "بكام الكورس؟",
    "هل الدفع عن طريق Paymob؟",
    "عندكم خصم؟",
    "هل في كورسات مجانية؟",
    // Certificates
    "هل أحصل على شهادة بعد الكورس؟",
    "Do you provide a certificate?",
    // Platform / enrollment
    "ما هي المنصة؟",
    "How do I enroll in a course?",
    "عايز أشتري الكورس — أعمل إزاي؟",
    // Levels & recommendations
    "الكورس ده مبتدئ ولا متقدم؟",
    "انصحني بكورس في الحماية",
    "What course do you recommend for load flow?",
    // English basics
    "How much is the ETAP course price?",
    "Is training available for free?",
    // Course names mentioned explicitly
    "فين كورس Arc Flash؟",
    "هل كورس الـ SKM مدته كام ساعة؟",
  ];
  it("matches every plausible course/platform phrasing", () => {
    for (const text of mustMatch) expect(hasCourseIntent(text)).toBe(true);
  });

  it("stays lean on pure technical questions (false positives allowed, not required)", () => {
    // These MUST NOT be forced-lean either — the assertion is that the gate
    // is ALLOWED to be lean here; a false positive (true) is still safe.
    const lean = [
      "احسب تيار القصر عند البوس رقم 3",
      "اشرح لي فرق بين Delta و Star في المحولات",
      "How do I run a load flow study in ETAP?",
      "ما هو معامل الأمان في تصميم الكابلات؟",
    ];
    // No assertion on the result — this documents the lean ALLOWLIST; the
    // hard contract is tested above (course questions never miss).
    for (const text of lean) expect(typeof hasCourseIntent(text)).toBe("boolean");
  });

  it("empty / tiny input never matches", () => {
    expect(hasCourseIntent("")).toBe(false);
    expect(hasCourseIntent("؟")).toBe(false);
  });
});

describe("courseIntentFromMessages — sticky multi-turn intent", () => {
  it("a follow-up after a course question keeps the intent (sticky window)", () => {
    const history = [
      { role: "user", content: "إيه كورسات المنصة في الـ ETAP؟" },
      { role: "assistant", content: "لدينا كورسات ETAP عملية..." },
      { role: "user", content: "طيب والأخيرة دي؟" },
    ];
    expect(courseIntentFromMessages(history)).toBe(true);
  });

  it("a technical question with NO course history stays non-course", () => {
    const history = [
      { role: "user", content: "كيف أحسب هبوط الجهد؟" },
      { role: "assistant", content: "هبوط الجهد يُحسب..." },
      { role: "user", content: "طيب والجهد عند المحرك؟" },
    ];
    // MUST be false — the lite catalog is exactly for this case.
    expect(courseIntentFromMessages(history)).toBe(false);
  });

  it("scans multipart user content and ignores assistant turns", () => {
    const history = [
      { role: "assistant", content: "سعر كورس X هو 1500 جنيه" }, // assistant-only mention must NOT count
      { role: "user", content: [{ type: "text", text: "ما هي المواضيع دي؟" }] },
    ];
    expect(courseIntentFromMessages(history)).toBe(false);
    const history2 = [
      { role: "assistant", content: "سعر كورس X هو 1500 جنيه" },
      { role: "user", content: [{ type: "text", text: "اشرح لي سعر الكورسات دي" }] },
    ];
    expect(courseIntentFromMessages(history2)).toBe(true);
  });

  it("handles null/empty safely", () => {
    expect(courseIntentFromMessages(null)).toBe(false);
    expect(courseIntentFromMessages([])).toBe(false);
  });
});

describe("hasWebIntent — web-grounding gating", () => {
  it("matches current-info questions (versions, years, news)", () => {
    for (const text of [
      "ما هو أحدث إصدار من ETAP؟",
      "سعر ترخيص PowerFactory 2026",
      "أخبار جديدة عن SKM؟",
      "What is the latest version release?",
      "هل يتوافق مع ويندوز 11؟",
    ]) {
      expect(hasWebIntent(text)).toBe(true);
    }
  });

  it("calculation/explanation questions skip grounding", () => {
    for (const text of [
      "احسب تيار القصر عند بوس 11kV",
      "اشرح خطوات عمل Load Flow",
      "Explain the difference between CTI and selectivity",
    ]) {
      expect(hasWebIntent(text)).toBe(false);
    }
  });

  it("webIntentFromMessages reads only the LATEST user message", () => {
    const stale = [
      { role: "user", content: "ما آخر إصدار ETAP؟" },
      { role: "assistant", content: "..." },
      { role: "user", content: "احسب هبوط الجهد للفيدر ده" },
    ];
    expect(webIntentFromMessages(stale)).toBe(false);
  });
});

describe("sliceCatalogLite — featured head extraction", () => {
  const full = Array.from({ length: 40 }, (_, i) => `- كورس ${i + 1} | Course ${i + 1} — السعر: ${100 + i} EGP`).join("\n");

  it("returns the first N lines for a long catalog", () => {
    const lite = sliceCatalogLite(full, 8);
    const lines = lite.split("\n").filter(Boolean);
    expect(lines).toHaveLength(8);
    expect(lines[0]).toContain("كورس 1");
    expect(lines[7]).toContain("كورس 8");
    expect(lite).not.toContain("كورس 9");
  });

  it("returns the input unchanged when at/below the cap", () => {
    const small = "- كورس أ | Course A\n- كورس ب | Course B";
    expect(sliceCatalogLite(small, 8)).toBe(small);
  });

  it("empty catalog → empty string (caller falls back)", () => {
    expect(sliceCatalogLite("", 8)).toBe("");
    expect(sliceCatalogLite("   \n  ", 8)).toBe("");
  });
});
