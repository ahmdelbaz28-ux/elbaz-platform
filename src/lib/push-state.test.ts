/**
 * Unit tests for the Web Push toggle state model (src/lib/push-state.ts).
 *
 * Contract under test: describePushState is a TOTAL function — every
 * (status, isBusy, isSubscribed, lastError) combination maps to a complete
 * descriptor with non-empty copy for BOTH languages. This is the anti-regression
 * net for the silent-failure bug where the toggle did nothing visible.
 */
import { describe, expect, it } from "vitest";
import {
  describePushState,
  PUSH_ERROR_CODES,
  type PushStateInput,
} from "./push-state";

function input(overrides: Partial<PushStateInput> = {}): PushStateInput {
  return {
    status: "idle",
    isBusy: false,
    isSubscribed: false,
    lastError: null,
    ...overrides,
  };
}

describe("describePushState — browser notifications row (silent-failure fix)", () => {
  it("idle + not subscribed → Off pill, idle tone, switch off", () => {
    for (const lang of ["ar", "en"] as const) {
      const d = describePushState(input(), lang);
      expect(d.tone).toBe("idle");
      expect(d.switchOn).toBe(false);
      expect(d.pill.length).toBeGreaterThan(0);
      expect(d.hint.length).toBeGreaterThan(0);
    }
    expect(describePushState(input(), "ar").hint).toContain("فعّلها");
    expect(describePushState(input(), "en").hint).toContain("Enable to get");
  });

  it("subscribed → On pill, active tone, switch on, closed-tab promise", () => {
    for (const lang of ["ar", "en"] as const) {
      const d = describePushState(input({ status: "subscribed", isSubscribed: true }), lang);
      expect(d.tone).toBe("active");
      expect(d.switchOn).toBe(true);
      expect(d.hint).toContain("✓");
    }
    expect(describePushState(input({ status: "subscribed", isSubscribed: true }), "ar").hint).toContain(
      "حتى والموقع مقفول",
    );
  });

  it("busy while subscribing → working pill + approve-the-prompt hint, switch still off", () => {
    const d = describePushState(input({ status: "busy", isBusy: true }), "ar");
    expect(d.tone).toBe("active");
    expect(d.switchOn).toBe(false);
    expect(d.hint).toContain("وافق");
    const en = describePushState(input({ status: "busy", isBusy: true }), "en");
    expect(en.hint.toLowerCase()).toContain("approve");
  });

  it("busy while unsubscribing → unsubscribe hint, switch still on during flight", () => {
    const d = describePushState(
      input({ status: "busy", isBusy: true, isSubscribed: true }),
      "ar",
    );
    expect(d.switchOn).toBe(true);
    expect(d.hint).toContain("بنلغي");
  });

  it("status=busy alone (without isBusy) still renders the busy state", () => {
    const d = describePushState(input({ status: "busy", isBusy: false }), "en");
    expect(d.hint.toLowerCase()).toContain("approve");
  });

  it("denied → Blocked pill, warning tone, switch off, manual lock-icon fix in both languages", () => {
    const ar = describePushState(input({ status: "denied" }), "ar");
    expect(ar.tone).toBe("warning");
    expect(ar.switchOn).toBe(false);
    expect(ar.hint).toContain("أيقونة القفل");
    const en = describePushState(input({ status: "denied" }), "en");
    expect(en.tone).toBe("warning");
    expect(en.hint.toLowerCase()).toContain("lock icon");
  });

  it("denied wins over subscribed — revoked permission shows the fix, not a fake On", () => {
    const d = describePushState(
      input({ status: "denied", isSubscribed: true }),
      "ar",
    );
    expect(d.tone).toBe("warning");
    expect(d.switchOn).toBe(false);
  });

  it("error overrides busy — a failed op must never render as 'working…'", () => {
    const d = describePushState(
      input({ status: "error", isBusy: true, lastError: PUSH_ERROR_CODES.SAVE_FAILED }),
      "ar",
    );
    expect(d.tone).toBe("danger");
    expect(d.hint).not.toContain("بنجهّز");
    expect(d.hint).toContain("جرب تاني");
  });

  it("every known error code maps to a non-generic, non-empty hint (ar+en)", () => {
    const codes = Object.values(PUSH_ERROR_CODES);
    expect(codes.length).toBeGreaterThanOrEqual(8);
    for (const code of codes) {
      for (const lang of ["ar", "en"] as const) {
        const d = describePushState(input({ status: "error", lastError: code }), lang);
        expect(d.tone).toBe("danger");
        expect(d.pill.length).toBeGreaterThan(0);
        expect(d.hint.length).toBeGreaterThan(10);
      }
    }
    // Spot-check semantic mapping (auth speaks about sign-in, not retry-only).
    expect(
      describePushState(input({ status: "error", lastError: PUSH_ERROR_CODES.AUTH_REQUIRED }), "ar").hint,
    ).toContain("سجّل");
    expect(
      describePushState(input({ status: "error", lastError: PUSH_ERROR_CODES.SW_READY_TIMEOUT }), "ar").hint,
    ).toContain("المتصفح");
  });

  it("unknown / missing error code falls back to the generic retry hint", () => {
    const unknown = describePushState(
      input({ status: "error", lastError: "SOMETHING_ELSE" }),
      "ar",
    );
    expect(unknown.tone).toBe("danger");
    expect(unknown.hint).toContain("أعد المحاولة");

    const none = describePushState(input({ status: "error", lastError: null }), "en");
    expect(none.hint.toLowerCase()).toContain("retry");
  });

  it("error state keeps the switch mirroring the actual subscription flag", () => {
    const stillOn = describePushState(
      input({ status: "error", isSubscribed: true, lastError: PUSH_ERROR_CODES.UNSUBSCRIBE_FAILED }),
      "en",
    );
    expect(stillOn.switchOn).toBe(true);
    const off = describePushState(
      input({ status: "error", isSubscribed: false, lastError: PUSH_ERROR_CODES.SUBSCRIBE_FAILED }),
      "en",
    );
    expect(off.switchOn).toBe(false);
  });

  it("isBusy alone (stale status) still renders busy — UI can never dead-lock", () => {
    const d = describePushState(input({ status: "idle", isBusy: true }), "ar");
    expect(d.hint).toContain("بنجهّز");
  });
});
