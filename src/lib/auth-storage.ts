/**
 * Cross-platform auth token storage.
 * - Web: uses HttpOnly cookies (handled by server)
 * - Capacitor/Mobile: stores JWT in localStorage for Authorization header
 */

const TOKEN_KEY = 'elbaz_auth_token';

export function isNativePlatform(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
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
