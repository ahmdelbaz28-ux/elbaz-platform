/**
 * Comment-nudge unit tests — per-video one-shot state machine.
 * Covers: "new" default, opened/dismissed transitions, per-video isolation,
 * corrupt-payload resilience, private-browsing (throwing store) safety,
 * and clear().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCommentNudge,
  commentNudgeState,
  markCommentNudge,
} from "./comment-nudge";

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

const KEY = "elbaz-comment-nudge";
let now: number;

beforeEach(() => {
  now = 1_700_000_000_000;
  vi.stubGlobal("localStorage", fakeLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("comment nudge state", () => {
  it("starts 'new' for any video", () => {
    expect(commentNudgeState("vid1")).toBe("new");
  });

  it("empty/unknown videoIds are always 'new'", () => {
    expect(commentNudgeState("")).toBe("new");
    markCommentNudge("", "opened", now);
    expect(commentNudgeState("")).toBe("new");
  });

  it("opened marks the video as opened", () => {
    markCommentNudge("vid1", "opened", now);
    expect(commentNudgeState("vid1")).toBe("opened");
  });

  it("dismissed marks the video as dismissed", () => {
    markCommentNudge("vid1", "dismissed", now);
    expect(commentNudgeState("vid1")).toBe("dismissed");
  });

  it("state is per-video (one video's decision never leaks to another)", () => {
    markCommentNudge("vid1", "opened", now);
    markCommentNudge("vid2", "dismissed", now);
    expect(commentNudgeState("vid1")).toBe("opened");
    expect(commentNudgeState("vid2")).toBe("dismissed");
    expect(commentNudgeState("vid3")).toBe("new");
  });

  it("a later decision overwrites the earlier one", () => {
    markCommentNudge("vid1", "opened", now);
    markCommentNudge("vid1", "dismissed", now + 1000);
    expect(commentNudgeState("vid1")).toBe("dismissed");
  });

  it("treats corrupt payloads as 'new' and recovers on next write", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage({ [KEY]: "{not json" }));
    expect(commentNudgeState("vid1")).toBe("new");
    markCommentNudge("vid1", "dismissed", now);
    expect(commentNudgeState("vid1")).toBe("dismissed");
  });

  it("drops malformed entries from a partially-bad payload", () => {
    vi.stubGlobal("localStorage", fakeLocalStorage({
      [KEY]: JSON.stringify({
        good: { action: "opened", at: now },
        bad: { action: "explode", at: "nope" },
      }),
    }));
    expect(commentNudgeState("good")).toBe("opened");
    expect(commentNudgeState("bad")).toBe("new");
  });

  it("never throws when localStorage throws (private mode)", () => {
    vi.stubGlobal("localStorage", throwingLocalStorage());
    expect(() => commentNudgeState("vid1")).not.toThrow();
    expect(() => markCommentNudge("vid1", "opened", now)).not.toThrow();
    expect(() => clearCommentNudge("vid1")).not.toThrow();
    expect(commentNudgeState("vid1")).toBe("new");
  });

  it("clear forgets one video's state only", () => {
    markCommentNudge("vid1", "opened", now);
    markCommentNudge("vid2", "dismissed", now);
    clearCommentNudge("vid1");
    expect(commentNudgeState("vid1")).toBe("new");
    expect(commentNudgeState("vid2")).toBe("dismissed");
  });

  it("clear is a no-op on an empty store", () => {
    expect(() => clearCommentNudge("vid1")).not.toThrow();
  });
});
