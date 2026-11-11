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
