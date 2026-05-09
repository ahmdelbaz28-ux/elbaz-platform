/**
 * Cross-platform auth token storage.
 * - Web: uses HttpOnly cookies (handled by server)
 * - Capacitor/Mobile: stores JWT in localStorage for Authorization header
 */

const TOKEN_KEY = 'elbaz_auth_token';

function isCapacitor(): boolean {
  return !!(window as any).Capacitor?.isNativePlatform?.();
}

export function getStoredToken(): string | null {
  if (!isCapacitor()) return null;
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  if (!isCapacitor()) return;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // localStorage may be unavailable in private browsing
  }
}

export function removeStoredToken(): void {
  if (!isCapacitor()) return;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function isNativePlatform(): boolean {
  return isCapacitor();
}

export function hasStoredAuth(): boolean {
  // On web, check for the auth flag cookie (non-HttpOnly companion)
  if (!isCapacitor()) {
    if (typeof document === 'undefined') return false;
    return document.cookie.split(';').some(
      (c) => c.trim().startsWith('elbaz_auth_flag='),
    );
  }
  // On native, check localStorage for the JWT
  return !!getStoredToken();
}
