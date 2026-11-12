/**
 * Caller-aware abort composition (review fix 2026-11-11).
 *
 * ✅ ROOT FIX: the failover walks checked the caller's abort signal only
 * BETWEEN attempts — an in-flight fetch (up to a 60s stream timeout) kept
 * its connection open and kept burning provider quota after the client was
 * gone or the endpoint hard cap fired. `AbortSignal.any` composes the
 * caller's signal with the per-attempt internal signal, so a disconnect
 * cancels the HTTP request itself instead of merely skipping the NEXT
 * attempt. Available since Node 20.3; the platform runs Node 22+.
 */

/**
 * Compose a caller signal with an attempt's internal signal (header-timeout
 * controller, deadline controller, …). Without a caller signal the internal
 * signal is returned unchanged — zero behavior change for internal callers.
 */
export function withCallerAbort(caller: AbortSignal | undefined, attemptSignal: AbortSignal): AbortSignal {
  return caller ? AbortSignal.any([caller, attemptSignal]) : attemptSignal;
}

/** The common case: an attempt bounded by a timeout, plus the caller's abort. */
export function callerAwareTimeout(caller: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return withCallerAbort(caller, AbortSignal.timeout(timeoutMs));
}

/**
 * ✅ ROOT-CURE (2026-11-13, silent truncation of long answers): for STREAM
 * fetches the timeout must bound only the HEADER wait. AbortSignal.timeout()
 * stays attached to the body and aborts any generation that streams longer
 * than the timeout mid-sentence — the dynamic router fixed exactly this in
 * rawUpstreamFetch; this helper gives the legacy cascade the same contract.
 *
 * Returns a composed signal plus the `done()` disarm callback: call it as
 * soon as `fetch` resolves (headers arrived) — the body read is then
 * unbounded by the timer, and stall/death detection stays the stream
 * pipeline's job (idle timeout + finish-marker checks).
 */
export function headerTimeoutSignal(
  caller: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("upstream header timeout")), timeoutMs);
  return {
    signal: withCallerAbort(caller, ctrl.signal),
    done: () => clearTimeout(timer),
  };
}
