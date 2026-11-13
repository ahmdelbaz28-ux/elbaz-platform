/**
 * CHAT HISTORY TRIM TESTS — token-optimization sliding window (v3.6.0)
 * ────────────────────────────────────────────────────────────────────
 * Quality contract:
 *   • the LAST user message (the current question) is NEVER clipped;
 *   • the last 2 assistant messages stay FULL (the direct thread);
 *   • older turns clip deterministically with a visible marker;
 *   • image-parts messages pass through untouched;
 *   • normalization end-to-end still validates (vision flags, blank guard).
 */

import { describe, it, expect } from "vitest";
import {
  normalizeChatInput,
  trimHistoryForContext,
  TRIM_RECENT_ASSISTANT_FULL,
  TRIMMED_ASSISTANT_CHARS,
  TRIMMED_USER_CHARS,
} from "./chatbot-normalize";

const repeat = (s: string, n: number) => s.repeat(n);
const longText = (n: number) => repeat("x", n);

describe("trimHistoryForContext — clipping invariants", () => {
  it("never clips the last user message (the current question)", () => {
    const question = longText(3_000);
    const out = trimHistoryForContext([
      { role: "user", content: longText(1_500) },
      { role: "assistant", content: longText(2_000) },
      { role: "user", content: question },
    ]);
    const last = out[out.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toBe(question);
  });

  it(`keeps the last ${TRIM_RECENT_ASSISTANT_FULL} assistant replies full`, () => {
    const a1 = longText(1_500);
    const a2 = longText(1_800);
    const out = trimHistoryForContext([
      { role: "user", content: "س1" },
      { role: "assistant", content: a1 },
      { role: "user", content: "س2" },
      { role: "assistant", content: a2 },
      { role: "user", content: "س3" },
    ]);
    expect(out[1].content).toBe(a1); // last assistant #1 — full
    expect(out[3].content).toBe(a2); // last assistant #2 — full
  });

  it("clips OLDER assistant replies with a marker (3+ replies: only the last 2 stay full)", () => {
    const old = longText(2_000);
    const out = trimHistoryForContext([
      { role: "user", content: "س1" },
      { role: "assistant", content: old },
      { role: "user", content: "س2" },
      { role: "assistant", content: longText(700) }, // last-2 → full
      { role: "user", content: "س3" },
      { role: "assistant", content: longText(2_500) }, // last-1 → full
      { role: "user", content: "س4" },
    ]);
    const clipped = out[1].content as string;
    expect(clipped.length).toBeLessThanOrEqual(TRIMMED_ASSISTANT_CHARS + 30);
    expect(clipped).toContain("مختصر");
    expect(out[3].content).toHaveLength(700);
    expect(out[5].content).toHaveLength(2_500);
  });

  it("clips OLDER user messages but keeps their meaning boundary", () => {
    const oldQuestion = longText(2_500);
    const out = trimHistoryForContext([
      { role: "user", content: oldQuestion },
      { role: "assistant", content: "ج1" },
      { role: "user", content: "السؤال الحالي؟" },
    ]);
    const clipped = out[0].content as string;
    expect(clipped.length).toBeLessThanOrEqual(TRIMMED_USER_CHARS + 30);
    expect(clipped).toContain("مختصر");
  });

  it("passes image-parts messages through untouched", () => {
    const parts = [
      { type: "text" as const, text: "علل الصورة" },
      { type: "image_url" as const, image_url: { url: `data:image/jpeg;base64,${"A".repeat(1_000)}` } },
    ];
    const out = trimHistoryForContext([{ role: "user", content: parts }]);
    expect(out[0].content).toBe(parts);
  });

  it("short conversations return byte-identical messages", () => {
    const msgs = [
      { role: "user", content: "سؤال قصير" },
      { role: "assistant", content: "رد قصير" },
      { role: "user", content: "متابعة؟" },
    ];
    const out = trimHistoryForContext(msgs);
    expect(out.map((m) => m.content)).toEqual(["سؤال قصير", "رد قصير", "متابعة؟"]);
  });

  it("a huge 12-round conversation shrinks massively (token savings)", () => {
    // Realistic platform shape: 1.5k user questions, 6k assistant replies.
    const big = Array.from({ length: 12 }, () => [
      { role: "user", content: longText(1_500) },
      { role: "assistant", content: longText(6_000) },
    ]).flat();
    const out = trimHistoryForContext(big);
    const before = big.reduce((s, m) => s + (m.content as string).length, 0);
    const after = out.reduce((s, m) => s + (m.content as string).length, 0);
    // 2 full assistants (12k) + 10 old assistants (~6.3k) + 11 old users (~8.9k)
    // + 1 full user (1.5k) ≈ 28.7k < a third of the 90k original.
    expect(after).toBeLessThan(before / 3);
  });
});

describe("normalizeChatInput end-to-end with trimming", () => {
  it("reports the TRIMMED total and preserves vision/screenCapture flags", () => {
    const messages = [
      { role: "user", content: longText(2_000) },
      { role: "assistant", content: longText(2_000) },
      { role: "user", content: "سؤال حالي مع صورة" },
    ];
    // Build a parts-array last user message with a screen-capture image.
    const raw = [
      ...messages.slice(0, 2),
      {
        role: "user",
        content: [
          { type: "text", text: "سؤال حالي مع صورة" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64," + longText(100) }, source: "screen_capture" },
        ],
      },
    ];
    const result = normalizeChatInput(raw);
    if (!result.ok) throw new Error(`normalize failed: ${JSON.stringify(result.failure)}`);
    expect(result.data.vision).toBe(true);
    expect(result.data.screenCapture).toBe(true);
    // trimmed: old user ~800 + old assistant ~600 + current text ≪ 4_000
    expect(result.data.totalTextChars).toBeLessThan(4_000);
  });

  it("still rejects fully blank conversations (ROOT-CURE guard intact)", () => {
    const result = normalizeChatInput([
      { role: "user", content: "   " },
      { role: "assistant", content: "" },
      { role: "user", content: "" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.status).toBe(400);
  });

  it("clipping never flips a non-blank conversation to blank (and vice versa)", () => {
    const ok = normalizeChatInput([
      { role: "user", content: "   " },
      { role: "assistant", content: "رد قديم" },
      { role: "user", content: "سؤال حقيقي" },
    ]);
    expect(ok.ok).toBe(true);
  });
});
