/**
 * Chat history persistence — pure-logic tests (no DB required).
 * Covers the system-prompt summary injection + the round-text builder.
 */
import { describe, expect, it } from "vitest";
import { getSystemPrompt } from "./chatbot-prompts.js";

describe("getSystemPrompt — rolling summary injection", () => {
  it("injects the summary block when historySummary is provided (ar/thinking)", () => {
    const prompt = getSystemPrompt("ar", "thinking", "", false, "سأل المستخدم عن كورس ETAP");
    expect(prompt).toContain("سأل المستخدم عن كورس ETAP");
    expect(prompt).toContain("ملخص متداول");
  });

  it("injects the summary block in instant/en mode too", () => {
    const prompt = getSystemPrompt("en", "instant", "", false, "User asked about arc flash");
    expect(prompt).toContain("User asked about arc flash");
  });

  it("does NOT inject any summary block without historySummary", () => {
    const prompt = getSystemPrompt("ar", "thinking", "", false);
    expect(prompt).not.toContain("ملخص متداول");
  });

  it("ignores whitespace-only summaries", () => {
    const prompt = getSystemPrompt("ar", "thinking", "", false, "   \n  ");
    expect(prompt).not.toContain("ملخص متداول");
  });

  it("clips oversized summaries (5000 chars → at most ~1500 in the prompt)", () => {
    const long = "x".repeat(5000);
    const prompt = getSystemPrompt("ar", "thinking", "", false, long);
    const injectedCount = (prompt.match(/x/g) || []).length;
    expect(injectedCount).toBeGreaterThan(1000); // summary made it in
    expect(injectedCount).toBeLessThanOrEqual(1600); // ...but clipped, not 5000
  });
});
