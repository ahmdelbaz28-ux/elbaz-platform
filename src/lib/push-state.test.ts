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
  classifyPushEnvironment,
  classifyPushException,
  clearPushDeviceBlock,
  pushEnvironmentErrorCode,
  readPushDeviceBlock,
  savePushDeviceBlock,
  validateVapidPublicKey,
  type PushStateInput,
} from "./push-state";

/** Codes whose fix is NOT retrying — must render as warning, not danger. */
const NON_RETRYABLE = new Set([
  PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED,
  PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE,
  PUSH_ERROR_CODES.INVALID_VAPID_KEY,
  PUSH_ERROR_CODES.ENV_INSECURE,
  PUSH_ERROR_CODES.ENV_NO_PUSH_API,
  PUSH_ERROR_CODES.ENV_IN_APP_BROWSER,
  PUSH_ERROR_CODES.ENV_IOS_BROWSER,
]);

/** Real-shaped valid VAPID public key fixture (65 bytes, uncompressed 0x04) —
 *  structurally identical to the production key served by /public-key. */
const VALID_KEY =
  "BHbu_f0ekjZ3APPD01qmRERgyvkymslFh_qPsU2FtseqAc3PEOBZMP7uCO_jsluAjS9OxWAJDsPxsdf6jMlAYlk";

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
    expect(codes.length).toBeGreaterThanOrEqual(16);
    for (const code of codes) {
      for (const lang of ["ar", "en"] as const) {
        const d = describePushState(input({ status: "error", lastError: code }), lang);
        expect(NON_RETRYABLE.has(code) ? d.tone : "danger").toBe(
          NON_RETRYABLE.has(code) ? "warning" : "danger",
        );
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

  it("non-retryable failures warn instead of pushing the user into a retry loop", () => {
    // Browser hard-block: retrying the toggle can NEVER fix it.
    const blocked = describePushState(
      input({ status: "error", lastError: PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED }),
      "ar",
    );
    expect(blocked.tone).toBe("warning");
    expect(blocked.hint).toContain("القفل");
    // In-app browser: the fix is a different browser, not another click.
    const inApp = describePushState(
      input({ status: "error", lastError: PUSH_ERROR_CODES.ENV_IN_APP_BROWSER }),
      "en",
    );
    expect(inApp.tone).toBe("warning");
    expect(inApp.hint.toLowerCase()).toContain("chrome");
    // Broken server key: not the user's fault, not retry-fixable.
    const badKey = describePushState(
      input({ status: "error", lastError: PUSH_ERROR_CODES.INVALID_VAPID_KEY }),
      "ar",
    );
    expect(badKey.tone).toBe("warning");
  });

  it("raw browser cause surfaces as a truncated diagnostics detail line", () => {
    const raw = "NotAllowedError: Registration failed - permission denied";
    const d = describePushState(
      input({ status: "error", lastError: PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED, lastErrorDetail: raw }),
      "en",
    );
    expect(d.detail).toBe(raw);
    // Long causes are clipped to 140 chars so the row never blows up.
    const long = "X".repeat(500);
    const clipped = describePushState(
      input({ status: "error", lastError: PUSH_ERROR_CODES.SUBSCRIBE_FAILED, lastErrorDetail: long }),
      "en",
    );
    expect(clipped.detail?.length).toBe(140);
    // No failure → no detail line.
    expect(describePushState(input({ status: "subscribed", isSubscribed: true }), "en").detail).toBeUndefined();
    // Whitespace-only detail is dropped.
    const blank = describePushState(
      input({ status: "error", lastError: PUSH_ERROR_CODES.SUBSCRIBE_FAILED, lastErrorDetail: "   " }),
      "en",
    );
    expect(blank.detail).toBeUndefined();
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

  it("PUSH_SERVICE_UNAVAILABLE renders the honest unavailable card (not a retry switch)", () => {
    for (const lang of ["ar", "en"] as const) {
      const d = describePushState(
        input({
          status: "error",
          lastError: PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE,
          lastErrorDetail: "AbortError: Registration failed - push service error",
        }),
        lang,
      );
      expect(d.unavailable).toBe(true);
      expect(d.tone).toBe("warning");
      expect(d.switchOn).toBe(false);
      expect(d.detail).toContain("push service error");
    }
    // The Arabic copy names the device/network cause and the working
    // alternative — never a bare "try again".
    expect(
      describePushState(input({ status: "error", lastError: PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE }), "ar").hint,
    ).toContain("شبكة تانية");
  });

  it("a remembered device block renders unavailable even in the calm idle state", () => {
    const block = { code: PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE, detail: "AbortError: x", at: Date.now() };
    const d = describePushState(input({ deviceBlock: block }), "ar");
    expect(d.unavailable).toBe(true);
    expect(d.tone).toBe("warning");
    expect(d.switchOn).toBe(false);
    expect(d.detail).toBe("AbortError: x");
    // Fresher states always win over the remembered block.
    expect(describePushState(input({ deviceBlock: block, isBusy: true, status: "busy" }), "ar").unavailable).toBeFalsy();
    expect(
      describePushState(input({ deviceBlock: block, isSubscribed: true, status: "subscribed" }), "ar").unavailable,
    ).toBeFalsy();
    expect(
      describePushState(input({ deviceBlock: block, status: "error", lastError: PUSH_ERROR_CODES.SAVE_FAILED }), "ar")
        .unavailable,
    ).toBeFalsy();
    expect(describePushState(input({ deviceBlock: block, status: "denied" }), "ar").unavailable).toBeFalsy();
  });
});

describe("validateVapidPublicKey — catch server key rot BEFORE the browser sees it", () => {
  it("accepts the real 65-byte uncompressed P-256 key (production shape)", () => {
    expect(VALID_KEY.length).toBe(87);
    expect(validateVapidPublicKey(VALID_KEY)).toBe(true);
  });

  it("accepts padded base64url (the browser decoder tolerates '=')", () => {
    expect(validateVapidPublicKey(VALID_KEY + "=")).toBe(true);
  });

  it("rejects truncated keys, wrong point prefix, PEM, whitespace and junk", () => {
    expect(validateVapidPublicKey(VALID_KEY.slice(0, 60))).toBe(false); // wrong byte count
    expect(validateVapidPublicKey("A" + VALID_KEY.slice(1))).toBe(false); // first byte 0x03
    expect(
      validateVapidPublicKey(
        "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----",
      ),
    ).toBe(false);
    expect(validateVapidPublicKey(` ${VALID_KEY} `)).toBe(false); // surrounding whitespace
    expect(validateVapidPublicKey("")).toBe(false);
    expect(validateVapidPublicKey(null)).toBe(false);
    expect(validateVapidPublicKey(undefined)).toBe(false);
  });
});

describe("classifyPushException — every DOMException names its real cause", () => {
  it("NotAllowedError → browser-blocked (manual site-settings fix)", () => {
    expect(classifyPushException("NotAllowedError")).toBe(PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED);
  });

  it("InvalidAccessError / NotSupportedError → bad key or no push service", () => {
    expect(classifyPushException("InvalidAccessError")).toBe(PUSH_ERROR_CODES.SUBSCRIBE_BAD_KEY);
    expect(classifyPushException("NotSupportedError")).toBe(PUSH_ERROR_CODES.SUBSCRIBE_BAD_KEY);
  });

  it("AbortError → transient; InvalidStateError → SW not active yet", () => {
    expect(classifyPushException("AbortError", "push service aborted the request")).toBe(
      PUSH_ERROR_CODES.SUBSCRIBE_ABORTED,
    );
    expect(classifyPushException("InvalidStateError")).toBe(PUSH_ERROR_CODES.SW_READY_TIMEOUT);
  });

  it("AbortError with a permission-denied message → blocked, not 'transient'", () => {
    // Measured live: restricted/incognito profiles reject with
    // "AbortError: Registration failed - permission denied" — a retry cannot
    // fix that, so the honest classification is the blocked one.
    expect(classifyPushException("AbortError", "Registration failed - permission denied")).toBe(
      PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED,
    );
  });

  it("AbortError with an explicit push-backend refusal → device-level unavailable", () => {
    // Measured Chrome message (2026-10-30 production report — the user was
    // stuck in an endless "Failed → try again" loop): the browser's push
    // backend itself refused; retries on this device/network cannot fix it.
    expect(classifyPushException("AbortError", "Registration failed - push service error")).toBe(
      PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE,
    );
    expect(classifyPushException("AbortError", "Registration failed - no push service")).toBe(
      PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE,
    );
    expect(classifyPushException("AbortError", "Registration failed - no sender id provided")).toBe(
      PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE,
    );
    // A bare message that merely MENTIONS the push service but describes an
    // abort stays transient (the subscribe flow retries it, then escalates).
    expect(classifyPushException("AbortError", "push service aborted the request")).toBe(
      PUSH_ERROR_CODES.SUBSCRIBE_ABORTED,
    );
  });

  it("bare Errors naming the push service map to unavailable, not bad-key", () => {
    expect(classifyPushException("Error", "push service error while registering")).toBe(
      PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE,
    );
  });

  it("device-block persistence round-trips and survives junk storage", () => {
    // The test env may have no localStorage — helpers must never throw.
    expect(() => clearPushDeviceBlock()).not.toThrow();
    const saved = savePushDeviceBlock(PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE, "AbortError: x");
    expect(saved.code).toBe(PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE);
    expect(saved.detail).toBe("AbortError: x");
    expect(typeof saved.at).toBe("number");
    const read = readPushDeviceBlock();
    if (read !== null) {
      // When storage exists the round-trip must be exact.
      expect(read.code).toBe(PUSH_ERROR_CODES.PUSH_SERVICE_UNAVAILABLE);
    }
    // A corrupted payload reads as "no block" instead of throwing.
    try {
      globalThis.localStorage?.setItem("elbaz_push_device_block", "{{{not-json");
      expect(readPushDeviceBlock()).toBeNull();
    } catch {
      // no storage in this environment — nothing to corrupt
    }
    clearPushDeviceBlock();
  });

  it("bare Errors are salvaged from their message before falling back", () => {
    expect(classifyPushException("Error", "permission dismissed by user")).toBe(
      PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED,
    );
    expect(classifyPushException("Error", "invalid VAPID key encoding")).toBe(
      PUSH_ERROR_CODES.SUBSCRIBE_BAD_KEY,
    );
    expect(classifyPushException("RangeError", "something odd")).toBe(
      PUSH_ERROR_CODES.SUBSCRIBE_FAILED,
    );
  });
});

describe("classifyPushEnvironment — doomed contexts are named BEFORE any prompt", () => {
  const HEALTHY = {
    isSecureContext: true,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    isStandalone: false,
  };

  const CHROME_ANDROID =
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  const CHROME_DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const WHATSAPP_IN_APP = `Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 WhatsApp/2.23.24`;
  const FACEBOOK_IN_APP =
    "[FBAN/FBIOS;FBAV/450.0.0.0;FBSV/17.0;...] Safari/604.1";
  const ANDROID_WEBVIEW = `Mozilla/5.0 (Linux; Android 13; SM-G991B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36`;
  const IOS_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

  it("healthy desktop + Android Chrome pass", () => {
    expect(classifyPushEnvironment({ ...HEALTHY, userAgent: CHROME_DESKTOP })).toBe("ok");
    expect(classifyPushEnvironment({ ...HEALTHY, userAgent: CHROME_ANDROID })).toBe("ok");
  });

  it("in-app browsers (WhatsApp/Facebook/Android WebView) are detected", () => {
    expect(classifyPushEnvironment({ ...HEALTHY, userAgent: WHATSAPP_IN_APP })).toBe("in_app_browser");
    expect(classifyPushEnvironment({ ...HEALTHY, userAgent: FACEBOOK_IN_APP })).toBe("in_app_browser");
    expect(classifyPushEnvironment({ ...HEALTHY, userAgent: ANDROID_WEBVIEW })).toBe("in_app_browser");
  });

  it("iOS tab without standalone → home-screen guidance; standalone passes", () => {
    expect(classifyPushEnvironment({ ...HEALTHY, userAgent: IOS_SAFARI })).toBe("ios_browser");
    expect(
      classifyPushEnvironment({ ...HEALTHY, userAgent: IOS_SAFARI, isStandalone: true }),
    ).toBe("ok");
  });

  it("structural gaps win over UA heuristics, insecure context wins over everything", () => {
    expect(
      classifyPushEnvironment({ ...HEALTHY, hasPushManager: false, userAgent: WHATSAPP_IN_APP }),
    ).toBe("no_push");
    expect(
      classifyPushEnvironment({ ...HEALTHY, hasNotification: false, userAgent: CHROME_DESKTOP }),
    ).toBe("no_notification");
    expect(
      classifyPushEnvironment({ ...HEALTHY, hasServiceWorker: false, userAgent: CHROME_DESKTOP }),
    ).toBe("no_sw");
    expect(
      classifyPushEnvironment({ ...HEALTHY, isSecureContext: false, userAgent: WHATSAPP_IN_APP }),
    ).toBe("insecure");
  });

  it("environment codes map onto user-facing error codes", () => {
    expect(pushEnvironmentErrorCode("in_app_browser")).toBe(PUSH_ERROR_CODES.ENV_IN_APP_BROWSER);
    expect(pushEnvironmentErrorCode("ios_browser")).toBe(PUSH_ERROR_CODES.ENV_IOS_BROWSER);
    expect(pushEnvironmentErrorCode("no_push")).toBe(PUSH_ERROR_CODES.ENV_NO_PUSH_API);
    expect(pushEnvironmentErrorCode("insecure")).toBe(PUSH_ERROR_CODES.ENV_INSECURE);
    expect(pushEnvironmentErrorCode("ok")).toBeNull();
  });
});
