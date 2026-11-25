/**
 * ✅ ROOT-CURE (remember-device round 3, 2026-11-26): "the app forgets I was
 * logged in the moment I leave and come back".
 *
 * Measured production evidence (live probes + Space logs, 2026-11-25/26):
 * the session cookies themselves are sound (30-day HttpOnly elbaz_auth +
 * 30-day flag, JWT 7d + 30-day grace renewal). What was NOT sound is the
 * BOOT-TIME VERIFICATION RACE on an edge we do not control:
 *
 *   • The canonical domain ahmedelbaz.qzz.io sits behind an external
 *     Cloudflare edge (qzz.io provider infra) that answers requests —
 *     INCLUDING /api/* XHRs — with `403 + cf-mitigated: challenge`
 *     ("Just a moment…") whenever its bot score dislikes the client.
 *     Live-captured on 2026-11-25 for /api/health and
 *     /api/trpc/auth.sessionProbe. An XHR can never solve an interactive
 *     challenge, so during any challenge window EVERY tRPC call dies.
 *   • The HF Space container restarts on every deploy (frequent pushes) and
 *     can briefly 502/503 while a healthcheck reboots it or a cold start
 *     finishes. Same effect: the first auth.me after returning to the site
 *     fails WITHOUT the server ever reaching the auth pipeline.
 *
 * The old client treated "auth.me errored" as "the user is logged out":
 * auth.me ran with retry:false, the error flipped isAuthenticated to false,
 * and ProtectedRoute navigated straight to /login — while the user's 30-day
 * Remember-this-device cookie was still sitting in the browser, perfectly
 * valid. The user then re-entered credentials ("log in a SECOND time") even
 * though the session had never died. That is exactly the reported bug.
 *
 * THE POLICY (encoded here and consumed by useAuth):
 *   • Only a server-confirmed UNAUTHORIZED from auth.me is a session death.
 *     UNAUTHORIZED can only be produced by our own origin's auth pipeline
 *     (cryptographic verification + DB tokenVersion check) — the edge cannot
 *     forge it, so it is the ONLY safe destruction trigger.
 *   • Every other failure (challenge 403 HTML, 5xx, network, JSON parse of a
 *     challenge page, cold-start timeout) is "verification UNAVAILABLE",
 *     never "verification FAILED": the client keeps the stored session and
 *     reconnects automatically (bounded React-Query retries, then a slow
 *     refetchInterval) until the server can actually answer.
 *
 * Destroying a session is a one-way door (the user loses their remembered
 * login); this module makes that door require proof.
 */

/** Shape of the tRPC error the client actually observes. */
export type AuthErrorLike = { data?: { code?: string } | null } | null | undefined;

/** Extract the tRPC error code from any thrown/failure value (null-safe). */
export function authErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as AuthErrorLike)?.data?.code;
  return typeof code === "string" ? code : null;
}

/**
 * TRUE only when the SERVER ITSELF confirmed the session is dead.
 *
 * A 403 edge challenge page, a 502 from a restarting Space, a network
 * timeout, a "Unexpected token '<'" JSON parse of an HTML challenge — none
 * of these ever reached the auth pipeline, so none of them knows anything
 * about the session. Only UNAUTHORIZED (issued by requireAuth AFTER the
 * token was cryptographically verified and the user/allowlist/tokenVersion
 * row was loaded from the DB) is a confirmed rejection.
 */
export function isConfirmedAuthRejection(error: unknown): boolean {
  return authErrorCode(error) === "UNAUTHORIZED";
}

/**
 * Retry policy for the auth.me boot query: never retry a CONFIRMED rejection
 * (its terminal state is the destruction trigger and must not be delayed),
 * but give transient failures 2 quick attempts (≈1s → 2s backoff) before the
 * slow reconnect cadence takes over. This alone covers most cold-start and
 * brief-challenge windows — the user never sees the login page for them.
 */
export const AUTH_VERIFICATION_MAX_QUICK_RETRIES = 2;

export function authMeRetry(failureCount: number, error: unknown): boolean {
  if (isConfirmedAuthRejection(error)) return false;
  return failureCount < AUTH_VERIFICATION_MAX_QUICK_RETRIES;
}

/** Exponential-ish backoff for the quick retries: 1s, 2s (capped 4s). */
export function authMeRetryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** Math.max(0, attemptIndex), 4000);
}

/**
 * While the session verification is stuck on a TRANSIENT failure, keep
 * re-asking the server at a slow human-friendly cadence (15s) until it can
 * actually answer — the moment one attempt succeeds, auth.me returns the
 * user and the UI flips back to logged-in with NO user interaction. A
 * confirmed rejection disables the interval entirely (the death is terminal
 * and useAuth's error effect owns the cleanup).
 */
export const AUTH_RECONNECT_INTERVAL_MS = 15_000;

/** Minimal shape of the React-Query query object v5 passes to refetchInterval. */
export interface AuthRefetchIntervalQuery {
  state?: { error?: unknown; data?: unknown };
}

export function authMeRefetchInterval(query: AuthRefetchIntervalQuery): number | false {
  const error = query?.state?.error;
  if (!error) return false;
  return isConfirmedAuthRejection(error) ? false : AUTH_RECONNECT_INTERVAL_MS;
}
