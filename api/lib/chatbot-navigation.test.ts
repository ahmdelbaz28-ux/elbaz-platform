/**
 * CHATBOT NAVIGATION + TABLE-FREE OUTPUT TESTS (live user feedback 2026-10)
 *
 * Two production complaints are locked down here:
 *   1. The bot answered with Markdown tables that the chat UI cannot render
 *      (broken pipe grids) — the ban must exist in EVERY prompt combination
 *      (ar/en × thinking/instant), in the shared guard AND the per-language
 *      format rules, and it must also forbid ANNOUNCING a table.
 *   2. When guiding users inside software (ETAP etc.) the bot described
 *      navigation loosely and guessed UI names — the guided-hands navigation
 *      protocol (mouse-level steps, committed literal names, absolute
 *      no-guessing rule) must be present in thinking prompts (full) and
 *      instant prompts (condensed), in both languages.
 */

import { describe, it, expect } from "vitest";

import { getSystemPrompt } from "./chatbot-prompts";

const TABLE_BAN_GUARD = "NEVER use Markdown tables in any reply and NEVER announce that you will present a table";
// ✅ ARCH-AUDIT FIX (prompt dedup): the table ban is stated ONCE in the
// bilingual shared guard (TABLE_BAN_GUARD) — the per-language duplicates
// (TABLE_BAN_AR/EN in the format rules) were removed. TABLE_BAN_EN is kept
// as a second guard-phrase check below.

const NAV_FULL_AR = "بروتوكول التوجيه اليدوي الدقيق";
const NAV_FULL_EN = "GUIDED HANDS NAVIGATION PROTOCOL";
const NAV_NO_GUESS_AR = "حظر التخمين المطلق في التوجيه";
const NAV_NO_GUESS_EN = "ABSOLUTE NO-GUESSING RULE in navigation";

const NAV_CONDENSED_AR = "توجيه يدوي دقيق: عند شرح أي خطوات داخل برنامج";
const NAV_CONDENSED_EN = "Guided hands navigation: when explaining in-software steps";

describe("chatbot prompts — table-free output enforcement", () => {
  it("thinking/ar forbids tables via the shared guard (dedup: single canonical rule)", () => {
    const p = getSystemPrompt("ar", "thinking");
    expect(p).toContain(TABLE_BAN_GUARD);
    expect(p.match(/NEVER use Markdown tables/g)?.length).toBe(1); // exactly one occurrence
  });

  it("thinking/en forbids tables via the shared guard (dedup: single canonical rule)", () => {
    const p = getSystemPrompt("en", "thinking");
    expect(p).toContain(TABLE_BAN_GUARD);
    expect(p.match(/NEVER use Markdown tables/g)?.length).toBe(1);
  });

  it("instant/ar forbids tables via the shared guard (dedup: single canonical rule)", () => {
    const p = getSystemPrompt("ar", "instant");
    expect(p).toContain(TABLE_BAN_GUARD);
    expect(p.match(/NEVER use Markdown tables/g)?.length).toBe(1);
  });

  it("instant/en forbids tables via the shared guard (dedup: single canonical rule)", () => {
    const p = getSystemPrompt("en", "instant");
    expect(p).toContain(TABLE_BAN_GUARD);
    expect(p.match(/NEVER use Markdown tables/g)?.length).toBe(1);
  });
});

describe("chatbot prompts — guided hands navigation protocol", () => {
  it("thinking/ar carries the full mouse-level protocol with the no-guessing rule", () => {
    const p = getSystemPrompt("ar", "thinking");
    expect(p).toContain(NAV_FULL_AR);
    expect(p).toContain(NAV_NO_GUESS_AR);
    // mouse-level step commitment + literal-name commitment
    expect(p).toContain("اشرح كأن يدك تمسك فأرة المستخدم");
    expect(p).toContain("ممنوع نهائياً أي جملة توجيه غامضة بلا نقرة أو إدخال محدد");
  });

  it("thinking/en carries the full mouse-level protocol with the no-guessing rule", () => {
    const p = getSystemPrompt("en", "thinking");
    expect(p).toContain(NAV_FULL_EN);
    expect(p).toContain(NAV_NO_GUESS_EN);
    expect(p).toContain("as if your hand is on the user's mouse");
    expect(p).toContain("NEVER give a vague instruction without a specific click or input");
  });

  it("instant/ar carries the condensed navigation rule (no guessing, click-by-click)", () => {
    const p = getSystemPrompt("ar", "instant");
    expect(p).toContain(NAV_CONDENSED_AR);
    expect(p).toContain("ممنوع منعاً باتاً تخمين أو افتراض اسم أي أيقونة أو تبويب أو مسار");
  });

  it("instant/en carries the condensed navigation rule (no guessing, click-by-click)", () => {
    const p = getSystemPrompt("en", "instant");
    expect(p).toContain(NAV_CONDENSED_EN);
    expect(p).toContain("NEVER guess or assume any icon/tab/path name");
  });

  it("the ETAP expert core requires mouse-level paths and never guessing names", () => {
    const thinking = getSystemPrompt("en", "thinking");
    expect(thinking).toContain("mouse-level navigation steps committing to the exact tab/button names");
    expect(thinking).toContain("NEVER guess a name you are not sure of");
    const instant = getSystemPrompt("en", "instant");
    expect(instant).toContain("never guess a tab/button/icon name");
  });

  it("thinking prompts place the navigation protocol BEFORE the ETAP expert core", () => {
    const p = getSystemPrompt("ar", "thinking");
    const navIdx = p.indexOf(NAV_FULL_AR);
    const etapIdx = p.indexOf("ETAP EXPERT SYSTEM");
    expect(navIdx).toBeGreaterThan(-1);
    expect(etapIdx).toBeGreaterThan(-1);
    expect(navIdx).toBeLessThan(etapIdx);
  });
});
