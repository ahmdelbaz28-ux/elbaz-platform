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
export const AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

export function getAuthCookieOptions(headers: Headers): CookieOptions {
  const localhost = isLocalhost(headers);
  return {
    httpOnly: true,
    path: "/",
    sameSite: localhost ? "Lax" : "None",
    secure: !localhost,
    maxAge: AUTH_COOKIE_MAX_AGE,
  };
}

/** Serialize an auth cookie (set on login/register) */
export function serializeAuthCookie(headers: Headers, token: string): string {
  const opts = getAuthCookieOptions(headers);
  return cookie.serialize(AUTH_COOKIE_NAME, token, {
    httpOnly: opts.httpOnly,
    path: opts.path,
    sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
    secure: opts.secure,
    maxAge: opts.maxAge,
  });
}

/** Serialize a cleared auth cookie (set on logout) */
export function clearAuthCookie(headers: Headers): string {
  const opts = getAuthCookieOptions(headers);
  return cookie.serialize(AUTH_COOKIE_NAME, "", {
    httpOnly: opts.httpOnly,
    path: opts.path,
    sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
    secure: opts.secure,
    maxAge: 0,
  });
}
