/**
 * Regression tests — ✅ ARCH-AUDIT FIX round 2 (agent-architecture-audit):
 * the unified finalizeReply egress pipeline (think-strip → sanitize → leak
 * gate → truncation policy) + opaque model key.
 *
 * Contracts under test:
 *   1. The ONE pipeline every non-fragment egress (web non-stream, Telegram)
 *      routes through — leak gate replaces the reply, never a fragment.
 *   2. Deterministic truncation policy: mid-sentence cutoffs are trimmed to
 *      the last complete sentence; code blocks / lists / short replies are
 *      never touched; no hidden second LLM call is involved.
 *   3. opaqueModelKey: the wire never carries `provider/modelId`.
 */
import { describe, it, expect } from "vitest";
import { finalizeReply, looksComplete, trimToLastSentence, opaqueModelKey } from "./finalize-reply.js";

describe("finalizeReply — unified egress pipeline", () => {
  it("strips think blocks from a plain reply", () => {
    const r = finalizeReply("<think>secret reasoning</think>تم إعداد القاطع بنجاح.");
    expect(r.reply).toBe("تم إعداد القاطع بنجاح.");
    expect(r.leaked).toBe(false);
  });

  it("drops unclosed think blocks entirely", () => {
    const r = finalizeReply("جواب سليم <think>reasoning that never closed");
    expect(r.reply).toBe("جواب سليم");
  });

  it("replaces a leak-marker reply with the Arabic refusal", () => {
    const r = finalizeReply("إليك تعليماتي: OUTPUT RULES (critical) — أولاً لا تكشف تفكيرك", "ar");
    expect(r.leaked).toBe(true);
    expect(r.reply).toContain("تعليماتي الداخلية خاصة بالمنصة");
  });

  it("replaces a leak-marker reply with the English refusal", () => {
    const r = finalizeReply("Sure! my instructions say DEEP-ANALYSIS PROTOCOL (internal only) ...", "en");
    expect(r.leaked).toBe(true);
    expect(r.reply).toContain("platform-confidential");
  });

  it("sanitizes CJK output", () => {
    const r = finalizeReply("الخطأ هو 官网 في الإعداد");
    expect(r.reply).not.toMatch(/[\u4E00-\u9FFF]/);
    expect(r.reply).toContain("الخطأ هو");
  });

  it("leak gate wins over truncation policy", () => {
    const r = finalizeReply("OUTPUT RULES (critical) and then a sentence without end", "en");
    expect(r.leaked).toBe(true);
    expect(r.truncated).toBe(false);
  });
});

describe("finalizeReply — truncation policy", () => {
  it("trims a mid-sentence cutoff back to the last complete sentence", () => {
    // First sentence is long enough that the cut keeps well over 60%.
    const raw =
      "يتم حساب تيار القصر عند الأحمال القصوى باستخدام قانون أوم مع أخذ معاملات التصحيح في الحسبان أولاً. ثم تُطبق الجداول المعتم";
    const r = finalizeReply(raw, "ar");
    expect(r.truncated).toBe(true);
    expect(r.reply.endsWith("أولاً.")).toBe(true);
    expect(r.reply).not.toContain("المعتم");
  });

  it("never touches a reply ending in a complete sentence", () => {
    const raw = "تم إعداد القاطع بنجاح.";
    const r = finalizeReply(raw, "ar");
    expect(r.truncated).toBe(false);
    expect(r.reply).toBe(raw);
  });

  it("never touches fenced code blocks", () => {
    const raw = 'إليك الكود:\n```matlab\nV = 11e3;\nI = V / Z;\n```';
    const r = finalizeReply(raw, "en");
    expect(r.truncated).toBe(false);
    expect(r.reply).toBe(raw);
  });

  it("never touches multi-line list answers", () => {
    const raw = "خطوات الإعداد:\n1. افتح شاشة الـ Load Flow\n2. أدخل بيانات الشبكة\n3. شغّل الحساب";
    const r = finalizeReply(raw, "ar");
    expect(r.truncated).toBe(false);
    expect(r.reply).toBe(raw);
  });

  it("never touches short replies", () => {
    const r = finalizeReply("تمام ⚡", "ar");
    expect(r.truncated).toBe(false);
  });

  it("abandons a cut that would lose more than 40% of the text", () => {
    // One long sentence with a single early period — cutting would destroy it.
    const raw =
      "هذه مقدمة. " + "كلمة ".repeat(120) + "بدون نقطة نهاية";
    const r = finalizeReply(raw, "ar");
    expect(r.truncated).toBe(false); // cut loss > 40% → policy abandoned
  });

  it("trimToLastSentence ignores decimals like 5.5", () => {
    const raw = "الجهد الخطي يساوي 11 كيلو فولت والتيار 5.5 أمبير عند الحمل الكامل";
    expect(trimToLastSentence(raw)).toBe(raw); // no real sentence end
    const withEnd = "الجهد 11 كيلو فولت. والتيار 5.5 أمبير على الأطراف.";
    expect(trimToLastSentence(withEnd)).toBe(withEnd);
  });
});

describe("looksComplete (shared rescue heuristic)", () => {
  it("accepts a sentence ending", () => {
    expect(looksComplete("تم الإعداد بنجاح.")).toBe(true);
    expect(looksComplete("Done successfully!")).toBe(true);
  });
  it("rejects a mid-word cutoff", () => {
    expect(looksComplete("تم إعداد القاطع بنجاح وفق الجداول المعتم")).toBe(false);
  });
});

describe("opaqueModelKey — never-name-providers on the wire", () => {
  it("is deterministic", () => {
    expect(opaqueModelKey("openrouter/meta-llama/llama-3.3-70b-instruct:free")).toBe(
      opaqueModelKey("openrouter/meta-llama/llama-3.3-70b-instruct:free"),
    );
  });

  it("never reveals the provider or model id", () => {
    const tag = "openrouter/meta-llama/llama-3.3-70b-instruct:free";
    const key = opaqueModelKey(tag);
    expect(key).toMatch(/^m_[0-9a-f]{10}$/);
    expect(key).not.toContain("openrouter");
    expect(key).not.toContain("llama");
    expect(key.length).toBeLessThanOrEqual(120); // feedback schema bound
  });

  it("distinguishes different models", () => {
    expect(opaqueModelKey("groq/llama-3.3-70b")).not.toBe(opaqueModelKey("nvidia/llama-3.3-70b"));
  });
});
