import type { CookieOptions } from "hono/utils/cookie";
import * as cookie from "cookie";

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

export function getSessionCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalhost(headers);

  return {
    httpOnly: true,
    path: "/",
    sameSite: localhost ? "Lax" : "None",
    secure: !localhost,
  };
}

// ✅ SECURITY FIX: Auth cookie for JWT tokens (httpOnly, Secure, SameSite)
// Cookie name for local auth (separate from Kimi OAuth session)
export const AUTH_COOKIE_NAME = "elbaz_auth";
export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds (matches JWT TTL)

// ✅ FIX: Non-HttpOnly companion cookie — readable from JS to guard auth.me calls
// Prevents unnecessary auth.me requests on every page load for unauthenticated users
export const AUTH_FLAG_COOKIE_NAME = "elbaz_auth_flag";

/**
 * Build cookie options. When `remember` is false, NO maxAge is set → the
 * cookie becomes a "session cookie" that's automatically deleted when the
 * browser closes. When true (default), the cookie persists for 30 days.
 */
export function getAuthCookieOptions(headers: Headers, remember: boolean = true): CookieOptions {
  const localhost = isLocalhost(headers);
  const opts: CookieOptions = {
    httpOnly: true,
    path: "/",
    sameSite: localhost ? "Lax" : "None",
    secure: !localhost,
  };
  if (remember) {
    opts.maxAge = AUTH_COOKIE_MAX_AGE;
  }
  // When remember === false, omit maxAge entirely → session cookie
  return opts;
}

/** Serialize an auth cookie (set on login/register) */
export function serializeAuthCookie(headers: Headers, token: string, remember: boolean = true): string {
  const opts = getAuthCookieOptions(headers, remember);
  return cookie.serialize(AUTH_COOKIE_NAME, token, {
    httpOnly: opts.httpOnly,
    path: opts.path,
    sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
    secure: opts.secure,
    ...(opts.maxAge !== undefined ? { maxAge: opts.maxAge } : {}),
  });
}

/** Serialize a non-HttpOnly flag cookie (readable from JS to guard auth.me calls) */
export function serializeAuthFlagCookie(headers: Headers, remember: boolean = true): string {
  const opts = getAuthCookieOptions(headers, remember);
  return cookie.serialize(AUTH_FLAG_COOKIE_NAME, "1", {
    httpOnly: false, // Must be readable from JavaScript
    path: opts.path,
    sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
    secure: opts.secure,
    ...(opts.maxAge !== undefined ? { maxAge: opts.maxAge } : {}),
  });
}

/**
 * Serialize cleared auth cookies (set on logout).
 * ✅ FIX: Returns an ARRAY of Set-Cookie header values.
 * RFC 7230 §3.2.2 forbids folding multiple Set-Cookie headers into one
 * comma-separated value — each must be appended as a separate header.
 */
export function clearAuthCookies(headers: Headers): string[] {
  const opts = getAuthCookieOptions(headers);
  return [
    cookie.serialize(AUTH_COOKIE_NAME, "", {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: 0,
    }),
    cookie.serialize(AUTH_FLAG_COOKIE_NAME, "", {
      httpOnly: false,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: 0,
    }),
  ];
}


