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
