/**
 * Shared constants between frontend and backend
 * Updated: Removed legacy Kimi OAuth references (kimi_sid, oauthCallback)
 */
export const Session = {
  /** Primary auth cookie name — used by api/context.ts */
  cookieName: "elbaz_auth",
  /** Legacy Kimi session cookie — cleared during logout for backwards compatibility */
  legacyCookieName: "kimi_sid",
  maxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days (reduced from 1 year)
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
} as const;
