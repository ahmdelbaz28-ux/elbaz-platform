/**
 * TOKEN USAGE TELEMETRY TESTS (v3.6.0)
 * ─────────────────────────────────────
 * parseUsage must accept every OpenAI-compatible shape in the wild and
 * reject junk without throwing (telemetry can never break a chat).
 */

import { describe, it, expect } from "vitest";
import { parseUsage, reportTokenUsage, resetTokenUsageAggregates } from "./token-usage";

describe("parseUsage — OpenAI-compatible shapes", () => {
  it("parses the standard shape", () => {
    const u = parseUsage({ prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540 });
    expect(u).toEqual({ prompt: 1200, completion: 340, total: 1540, cached: 0 });
  });

  it("parses prompt_tokens_details.cached_tokens (OpenAI)", () => {
    const u = parseUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      total_tokens: 1100,
      prompt_tokens_details: { cached_tokens: 800 },
    });
    expect(u?.cached).toBe(800);
  });

  it("parses a flattened cached_tokens (some providers)", () => {
    const u = parseUsage({ prompt_tokens: 1000, completion_tokens: 100, cached_tokens: 512 });
    expect(u?.cached).toBe(512);
  });

  it("derives total when missing", () => {
    const u = parseUsage({ prompt_tokens: 100, completion_tokens: 20 });
    expect(u?.total).toBe(120);
  });

  it("rejects null / non-object / zero-token payloads", () => {
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage(undefined)).toBeNull();
    expect(parseUsage("usage")).toBeNull();
    expect(parseUsage({})).toBeNull();
    expect(parseUsage({ prompt_tokens: 0, completion_tokens: 0 })).toBeNull();
  });

  it("ignores negative / non-numeric token fields safely", () => {
    const u = parseUsage({ prompt_tokens: -5, completion_tokens: "x", total_tokens: null });
    expect(u).toBeNull(); // 0+0 → no usable tokens
    const u2 = parseUsage({ prompt_tokens: 100, completion_tokens: -3 });
    expect(u2?.prompt).toBe(100);
    expect(u2?.completion).toBe(0);
  });
});

describe("reportTokenUsage — never throws, aggregates reset", () => {
  it("never throws on junk input", () => {
    expect(() => reportTokenUsage("test", "m", null)).not.toThrow();
    expect(() => reportTokenUsage("test", "m", undefined)).not.toThrow();
    expect(() => reportTokenUsage("test", "m", { prompt_tokens: "bad" })).not.toThrow();
  });

  it("resetTokenUsageAggregates returns a snapshot and zeroes the counters", () => {
    reportTokenUsage("test", "m", { prompt_tokens: 100, completion_tokens: 10 });
    const snap = resetTokenUsageAggregates();
    expect(snap.calls).toBeGreaterThanOrEqual(1);
    expect(snap.prompt).toBeGreaterThanOrEqual(100);
    const after = resetTokenUsageAggregates();
    expect(after.calls).toBe(0);
    expect(after.prompt).toBe(0);
  });
});
