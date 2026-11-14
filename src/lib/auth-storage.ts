/**
 * Cross-platform auth token storage.
 * - Web: uses HttpOnly cookies (handled by server)
 * - Capacitor/Mobile: stores JWT in localStorage for Authorization header
 */

const TOKEN_KEY = 'elbaz_auth_token';

export function isNativePlatform(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(globalThis as any).Capacitor?.isNativePlatform?.();
}

export function getStoredToken(): string | null {
  if (!isNativePlatform()) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  if (!isNativePlatform()) return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage may be unavailable in private browsing
  }
}

export function removeStoredToken(): void {
  if (!isNativePlatform()) return;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/**
 * Clear the web auth-flag companion cookie (elbaz_auth_flag).
 *
 * Called when the server rejects the session (401 UNAUTHORIZED). The flag
 * cookie is non-HttpOnly and lives up to 30 days — it can easily outlive the
 * actual HttpOnly session cookie (expired JWT, server-side revocation, space
 * restart). Without clearing it, hasStoredAuth() keeps returning true, the
 * auth.me query keeps firing and every refetch comes back 401 — an infinite
 * UNAUTHORIZED refetch loop that keeps authLoading stuck true and swallows
 * ChatBot FAB clicks ("no reaction" bug).
 */
export function clearAuthFlagCookie(): void {
  if (isNativePlatform()) return;
  if (typeof document === "undefined") return;
  try {
    // Must match the path the flag was set with (path=/) for the browser to
    // overwrite/delete it. Best-effort — failures are non-fatal.
    // biome-ignore lint/suspicious/noDocumentCookie: intentional best-effort deletion of the legacy auth flag cookie (must match the path=/ it was set with)
    document.cookie = "elbaz_auth_flag=; Max-Age=0; path=/";
  } catch {
    // ignore
  }
}

export function hasStoredAuth(): boolean {
  // On web, check for the auth flag cookie (non-HttpOnly companion)
  if (!isNativePlatform()) {
    if (typeof document === 'undefined') return false;
    return document.cookie.split(';').some(
      (c) => c.trim().startsWith('elbaz_auth_flag='),
    );
  }
  // On native, check localStorage for the JWT
  return !!getStoredToken();
}

// ✅ ROOT-CURE (remember-device, 2026-11-14): one-time zombie-session probe.
//
// The web auth gate reads the JS-readable `elbaz_auth_flag` cookie, but the
// REAL session lives in the HttpOnly `elbaz_auth` cookie that JS can neither
// read nor check. If the flag ever dies while the real session cookie survives
// (privacy tools, per-cookie eviction quirks, a stale 401 from an older build),
// the app never asked the server again — it showed the login page forever with
// a perfectly valid session sitting in the browser, no matter how many times
// "Remember me" was checked. The probe lets the boot sequence ask the server
// ONCE per tab when the flag is missing: a live session is restored silently
// (and the server re-set the flag on that success), a dead one costs exactly
// one request.
//
// The sessionStorage key records the CONCLUSION (probe settled — success or
// rejection), never the attempt. That distinction is what lets every useAuth
// instance mounted LATER during an in-flight probe (Navbar, ProtectedRoute,
// lazily-loaded ChatBot) join the probe instead of wrongly concluding "no
// session" and bouncing to /login — the exact W7 race the first cut had.
// Guests pay at most one 401 per fresh tab.
const SESSION_PROBE_KEY = "elbaz_session_probe_v1";

export function markSessionProbeDone(): void {
  try {
    sessionStorage.setItem(SESSION_PROBE_KEY, "1");
  } catch {
    // sessionStorage unavailable (private mode) — probe still runs, the guard
    // simply cannot persist; the query parking below prevents loops anyway.
  }
}

export function isSessionProbeDone(): boolean {
  try {
    return sessionStorage.getItem(SESSION_PROBE_KEY) === "1";
  } catch {
    return false;
  }
}
