/**
 * Unit tests — chat send→stop decision table (src/lib/chat-stop-flow.ts).
 *
 * The stop button's correctness lives in these pure decisions:
 * - a user stop must NEVER be resurrected by the silent-retry chain;
 * - a user stop must commit the text the user already saw (and NEVER the
 *   soft-busy note);
 * - clearChat (stale) must keep swallowing everything, as before.
 */
import { describe, expect, it } from "vitest";
import {
  resolveAfterAttempts,
  shouldAttemptNext,
  type AttemptGateInput,
  type AfterAttemptsInput,
} from "./chat-stop-flow";

const MAX = 3;

function gate(overrides: Partial<AttemptGateInput> = {}): AttemptGateInput {
  return { attempt: 0, maxAttempts: MAX, handled: false, stale: false, userStopped: false, ...overrides };
}

function after(overrides: Partial<AfterAttemptsInput> = {}): AfterAttemptsInput {
  return { handled: false, stale: false, userStopped: false, partialText: "", ...overrides };
}

describe("shouldAttemptNext — the stop gate", () => {
  it("allows attempts while the budget lasts and nothing intervened", () => {
    expect(shouldAttemptNext(gate({ attempt: 0 }))).toBe(true);
    expect(shouldAttemptNext(gate({ attempt: 1 }))).toBe(true);
    expect(shouldAttemptNext(gate({ attempt: 2 }))).toBe(true);
  });

  it("blocks once the attempt budget is exhausted", () => {
    expect(shouldAttemptNext(gate({ attempt: MAX }))).toBe(false);
    expect(shouldAttemptNext(gate({ attempt: MAX + 1 }))).toBe(false);
  });

  it("blocks after a handled reply", () => {
    expect(shouldAttemptNext(gate({ attempt: 0, handled: true }))).toBe(false);
  });

  it("blocks when clearChat bumped the generation (stale)", () => {
    expect(shouldAttemptNext(gate({ attempt: 0, stale: true }))).toBe(false);
  });

  it("✅ ROOT-CURE: blocks the very next attempt after a user stop — no retry resurrection", () => {
    expect(shouldAttemptNext(gate({ attempt: 1, userStopped: true }))).toBe(false);
    expect(shouldAttemptNext(gate({ attempt: 0, userStopped: true }))).toBe(false);
  });

  it("a stop wins even combined with a fresh (unbumped) loop", () => {
    expect(shouldAttemptNext(gate({ attempt: 0, userStopped: true, handled: false }))).toBe(false);
  });
});

describe("resolveAfterAttempts — what happens after the loop ends", () => {
  it("does nothing when a reply was fully handled", () => {
    expect(resolveAfterAttempts(after({ handled: true, partialText: "hello" }))).toEqual({ kind: "none" });
  });

  it("does nothing when clearChat made the send stale", () => {
    expect(resolveAfterAttempts(after({ stale: true, partialText: "hello" }))).toEqual({ kind: "none" });
  });

  it("✅ commits the partial text on a user stop (ChatGPT-style freeze)", () => {
    const action = resolveAfterAttempts(after({ userStopped: true, partialText: "إيه فايدة ETAP؟" }));
    expect(action).toEqual({ kind: "commit-partial", text: "إيه فايدة ETAP؟" });
  });

  it("✅ commits an English partial reply on a user stop", () => {
    const action = resolveAfterAttempts(after({ userStopped: true, partialText: "ETAP is used for" }));
    expect(action).toEqual({ kind: "commit-partial", text: "ETAP is used for" });
  });

  it("trims whitespace around the committed partial text", () => {
    const action = resolveAfterAttempts(after({ userStopped: true, partialText: "  partial answer  \n" }));
    expect(action).toEqual({ kind: "commit-partial", text: "partial answer" });
  });

  it("stays silent when the user stopped before ANY text arrived — no busy noise", () => {
    expect(resolveAfterAttempts(after({ userStopped: true, partialText: "" }))).toEqual({ kind: "none" });
    expect(resolveAfterAttempts(after({ userStopped: true, partialText: "   \n  " }))).toEqual({ kind: "none" });
  });

  it("✅ NEVER shows the soft-busy note for a deliberate user stop", () => {
    // with text
    expect(resolveAfterAttempts(after({ userStopped: true, partialText: "text" })).kind).not.toBe("soft-busy");
    // without text
    expect(resolveAfterAttempts(after({ userStopped: true, partialText: "" })).kind).not.toBe("soft-busy");
  });

  it("falls back to the soft-busy note when every attempt failed on its own (no stop)", () => {
    expect(resolveAfterAttempts(after({ partialText: "" }))).toEqual({ kind: "soft-busy" });
    expect(resolveAfterAttempts(after({ partialText: "" , stale: false }))).toEqual({ kind: "soft-busy" });
  });

  it("a stale send swallows even leftover text (clearChat owns the UI then)", () => {
    expect(resolveAfterAttempts(after({ stale: true, userStopped: true, partialText: "leftover" }))).toEqual({ kind: "none" });
  });
});
