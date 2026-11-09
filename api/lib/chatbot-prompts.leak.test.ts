import { describe, expect, it } from "vitest";
import { containsPromptLeak, promptLeakRefusal } from "./chatbot-prompts.js";

/**
 * PROMPT-LEAK TRIPWIRE tests (pre-launch audit run-2, chatbot.prompt-leak).
 * The chatbot must never emit verbatim system-prompt text. containsPromptLeak
 * is the deterministic backstop used by both chat endpoints.
 */
describe("containsPromptLeak", () => {
  it("flags verbatim guard scaffolding", () => {
    expect(containsPromptLeak("⛔ OUTPUT RULES (critical):\n- Reply ONLY...")).toBe(true);
  });

  it("flags the English persona opener", () => {
    expect(containsPromptLeak("You are the official AI Assistant of the Elbaz Platform.")).toBe(true);
  });

  it("flags the Arabic persona opener", () => {
    expect(containsPromptLeak("أنت المساعد الذكي الرسمي لمنصة الباز")).toBe(true);
  });

  it("flags internal protocol headers case-insensitively", () => {
    expect(containsPromptLeak("deep-analysis protocol (internal only)")).toBe(true);
    expect(containsPromptLeak("etap quick reference (instant mode)")).toBe(true);
  });

  it("passes normal engineering answers", () => {
    expect(containsPromptLeak("Short circuit study per IEEE 3002.3: first build the impedance bus matrix...")).toBe(false);
    expect(containsPromptLeak("حساب تيار القصر يحتاج تحويل الدائرة إلى ثايفنن مكافئ...")).toBe(false);
    expect(containsPromptLeak("")).toBe(false);
  });

  it("detection is case-insensitive for latin markers", () => {
    expect(containsPromptLeak("OUTPUT rules (CRITICAL)")).toBe(true);
  });
});

describe("promptLeakRefusal", () => {
  it("returns the Arabic refusal for ar", () => {
    expect(promptLeakRefusal("ar")).toContain("تعليماتي");
  });
  it("returns the English refusal for en/undefined", () => {
    expect(promptLeakRefusal("en")).toContain("confidential");
    expect(promptLeakRefusal(undefined)).toContain("confidential");
  });
});
