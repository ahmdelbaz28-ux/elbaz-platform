import { describe, it, expect } from "vitest";
import { withCallerAbort, callerAwareTimeout } from "./abort-utils";

/** Resolve when `signal` aborts (or reject after `ms`). */
function aborted(signal: AbortSignal, ms = 500): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => reject(new Error("signal never aborted")), ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

describe("abort-utils — caller abort cancels in-flight attempts", () => {
  it("without a caller signal the attempt signal is returned unchanged", () => {
    const ctrl = new AbortController();
    expect(withCallerAbort(undefined, ctrl.signal)).toBe(ctrl.signal);
  });

  it("withCallerAbort: aborting the CALLER aborts the composite signal", async () => {
    const caller = new AbortController();
    const attempt = new AbortController();
    const combined = withCallerAbort(caller.signal, attempt.signal);
    expect(combined.aborted).toBe(false);
    caller.abort(new Error("client gone"));
    expect(combined.aborted).toBe(true);
    await aborted(combined, 50);
  });

  it("withCallerAbort: aborting the ATTEMPT signal still aborts the composite", async () => {
    const caller = new AbortController();
    const attempt = new AbortController();
    const combined = withCallerAbort(caller.signal, attempt.signal);
    attempt.abort(new Error("header timeout"));
    expect(combined.aborted).toBe(true);
    await aborted(combined, 50);
  });

  it("callerAwareTimeout: fires on its own timeout", async () => {
    const combined = callerAwareTimeout(undefined, 10);
    await aborted(combined);
    expect(combined.aborted).toBe(true);
  });

  it("callerAwareTimeout: a caller abort fires it BEFORE the timeout", async () => {
    const caller = new AbortController();
    const combined = callerAwareTimeout(caller.signal, 30_000);
    caller.abort();
    expect(combined.aborted).toBe(true); // no 30s wait — the caller fired it now
  });
});
