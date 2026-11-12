/**
 * Subscribe-gate unit tests — device unlock state machine + URL builder.
 * Covers: locked default, unlock/expiry, extend-not-shorten, clear, the
 * private-browsing (throwing localStorage) safety path, and the
 * ?sub_confirmation=1 URL construction on all channel-URL shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSubscribeUrl,
  clearSubscribeFlow,
  clearSubscribeUnlock,
  hasPressedSubscribe,
  isSubscribeUnlocked,
  markSubscribePressed,
  subscribeUnlockUntil,
  unlockSubscribe,
} from "./subscribe-gate";

type Store = Record<string, string>;

function fakeLocalStorage(initial: Store = {}): Storage {
  const data: Store = { ...initial };
  return {
    get length() { return Object.keys(data).length; },
    clear() { for (const k of Object.keys(data)) delete data[k]; },
    getItem: (k: string) => (k in data ? data[k] : null),
    key: (i: number) => Object.keys(data)[i] ?? null,
    removeItem: (k: string) => { delete data[k]; },
    setItem: (k: string, v: string) => { data[k] = String(v); },
  };
}

function throwingLocalStorage(): Storage {
  return {
    length: 0,
    clear() { throw new Error("blocked"); },
    getItem() { throw new Error("blocked"); },
    key() { return null; },
    removeItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
}

const DAY = 24 * 60 * 60 * 1000;
let now: number;

beforeEach(() => {
  now = 1_700_000_000_000;
  vi.stubGlobal("Date", { ...Date, now: () => now });
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearSubscribeUnlock();
});

describe("subscribe gate unlock state", () => {
  it("starts locked with an empty store", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    expect(subscribeUnlockUntil()).toBe(0);
    expect(isSubscribeUnlocked()).toBe(false);
  });

  it("starts locked when localStorage is missing entirely (SSR/private)", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(isSubscribeUnlocked()).toBe(false);
  });

  it("unlocks for the requested days and expires afterwards", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    unlockSubscribe(30, now);
    expect(isSubscribeUnlocked(now + 29 * DAY)).toBe(true);
    expect(isSubscribeUnlocked(now + 30 * DAY + 1)).toBe(false);
  });

  it("re-unlocking extends from the later of now/current expiry (never shortens)", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    unlockSubscribe(30, now);
    const firstExpiry = subscribeUnlockUntil();
    unlockSubscribe(5, now + 1 * DAY); // shorter request must not shrink
    expect(subscribeUnlockUntil()).toBe(firstExpiry);
    unlockSubscribe(30, now + 1 * DAY); // longer request extends past it
    expect(subscribeUnlockUntil()).toBe(now + 31 * DAY); // from the later base (now+1d)
  });

  it("treats corrupt stored payloads as locked", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage({ "elbaz-sub-gate-unlock": "{not json" }));
    expect(isSubscribeUnlocked()).toBe(false);
    vi.stubGlobal("localStorage", fakeLocalStorage({ "elbaz-sub-gate-unlock": JSON.stringify({ until: "NaN" }) }));
    expect(isSubscribeUnlocked()).toBe(false);
  });

  it("stays locked (and never throws) when localStorage itself throws", () => {
    vi.stubGlobal("localStorage", throwingLocalStorage());
    expect(() => isSubscribeUnlocked()).not.toThrow();
    expect(() => unlockSubscribe(30, now)).not.toThrow();
    expect(isSubscribeUnlocked()).toBe(false);
  });

  it("clear removes the unlock", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    unlockSubscribe(7, now);
    expect(isSubscribeUnlocked()).toBe(true);
    clearSubscribeUnlock();
    expect(isSubscribeUnlocked()).toBe(false);
  });

  it("clamps days to a sane minimum (>= 1)", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage());
    unlockSubscribe(0, now);
    expect(isSubscribeUnlocked(now + 1)).toBe(true); // 1-day floor applied
  });
});

describe("subscribe flow marker (pressed-subscribe state)", () => {
  beforeEach(() => {
    vi.stubGlobal("sessionStorage", fakeLocalStorage());
  });

  afterEach(() => {
    clearSubscribeFlow();
  });

  it("starts with no pressed marker (gate fully armed)", () => {
    expect(hasPressedSubscribe()).toBe(false);
  });

  it("marks pressed and stays valid inside the TTL window", () => {
    markSubscribePressed(now);
    expect(hasPressedSubscribe(now)).toBe(true);
    expect(hasPressedSubscribe(now + 59 * 60 * 1000)).toBe(true); // 59 min later
  });

  it("expires the marker after the TTL (1 hour)", () => {
    markSubscribePressed(now);
    expect(hasPressedSubscribe(now + 60 * 60 * 1000 + 1)).toBe(false);
  });

  it("treats corrupt payloads as not-pressed", () => {
    vi.stubGlobal("sessionStorage", fakeLocalStorage({ "elbaz-sub-gate-flow": "not-a-number" }));
    expect(hasPressedSubscribe()).toBe(false);
    vi.stubGlobal("sessionStorage", undefined);
    expect(hasPressedSubscribe()).toBe(false);
  });

  it("never throws when sessionStorage throws (private mode)", () => {
    vi.stubGlobal("sessionStorage", throwingLocalStorage());
    expect(() => hasPressedSubscribe()).not.toThrow();
    expect(() => markSubscribePressed(now)).not.toThrow();
    expect(hasPressedSubscribe()).toBe(false);
  });

  it("clear removes the marker", () => {
    markSubscribePressed(now);
    expect(hasPressedSubscribe()).toBe(true);
    clearSubscribeFlow();
    expect(hasPressedSubscribe()).toBe(false);
  });

  it("records the honest via marker on new unlocks", () => {
    const store = fakeLocalStorage();
    vi.stubGlobal("localStorage", store);
    unlockSubscribe(30, now);
    const raw = JSON.parse(store.getItem("elbaz-sub-gate-unlock") ?? "{}") as { until?: number; via?: string };
    expect(raw.until).toBe(now + 30 * DAY);
    expect(raw.via).toBe("subscribe-flow");
  });
});

describe("buildSubscribeUrl", () => {
  it("appends sub_confirmation to a plain handle URL", () => {
    expect(buildSubscribeUrl("https://www.youtube.com/@AhmedElbazEng"))
      .toBe("https://www.youtube.com/@AhmedElbazEng?sub_confirmation=1");
  });

  it("preserves existing query params", () => {
    expect(buildSubscribeUrl("https://www.youtube.com/@AhmedElbazEng?si=abc"))
      .toBe("https://www.youtube.com/@AhmedElbazEng?si=abc&sub_confirmation=1");
  });

  it("falls back to the channel handle when the URL is empty", () => {
    expect(buildSubscribeUrl("   ")).toBe("https://www.youtube.com/@AhmedElbazEng?sub_confirmation=1");
  });
});
