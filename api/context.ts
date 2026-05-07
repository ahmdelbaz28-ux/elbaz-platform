import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { verifyToken } from "./lib/jwt";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import * as cookie from "cookie";

// SECURITY: Exclude passwordHash from context
export type SafeUser = Omit<User, "passwordHash">;

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: SafeUser;
};

const AUTH_COOKIE_NAME = "elbaz_auth";
// FIX: Reduced from 1 year to 30 days — limits damage window if token is stolen
// TODO: Add refresh-token rotation for long-lived sessions (Udemy pattern)
const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get("cookie") || "";
  return cookie.parse(header);
}

function isLocalhost(headers: Headers): boolean {
  const host = headers.get("host") || "";
  return host.startsWith("localhost:") || host.startsWith("127.0.0.1:");
}

export function getAuthCookieOptions(headers: Headers) {
  const localhost = isLocalhost(headers);
  return {
    httpOnly: true,
    path: "/",
    sameSite: localhost ? "Lax" : "None" as const,
    secure: !localhost,
    maxAge: AUTH_COOKIE_MAX_AGE,
  };
}

export function setAuthCookie(headers: Headers, token: string, resHeaders: Headers) {
  const opts = getAuthCookieOptions(headers);
  resHeaders.append(
    "set-cookie",
    cookie.serialize(AUTH_COOKIE_NAME, token, {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite,
      secure: opts.secure,
      maxAge: opts.maxAge,
    }),
  );
}

export function clearAuthCookie(headers: Headers, resHeaders: Headers) {
  const opts = getAuthCookieOptions(headers);
  resHeaders.append(
    "set-cookie",
    cookie.serialize(AUTH_COOKIE_NAME, "", {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite,
      secure: opts.secure,
      maxAge: 0,
    }),
  );
}

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };

  try {
    // FIX #1: Cookie-only auth — removed header fallback to prevent XSS token theft
    // HttpOnly cookies cannot be read by JavaScript, headers can
    const cookies = parseCookies(opts.req);
    const token = cookies[AUTH_COOKIE_NAME];

    if (token) {
      const payload = await verifyToken(token);
      if (payload) {
        const db = getDb();
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, payload.userId))
          .limit(1);

        if (user) {
          // FIX #4: Clear stale cookie + log when tokenVersion mismatch (token revoked)
          if (payload.tokenVersion !== undefined && payload.tokenVersion !== user.tokenVersion) {
            console.warn(
              "[Auth] Stale token for user " + payload.userId +
              " (token v" + payload.tokenVersion + " != db v" + user.tokenVersion + ") — cookie cleared"
            );
            clearAuthCookie(opts.req.headers, ctx.resHeaders);
            return ctx;
          }

          const { passwordHash: _ph, ...safeUser } = user;
          ctx.user = safeUser;
        }
      }
    }
  } catch (error) {
    // FIX #2: Log auth errors for monitoring instead of silent swallow
    console.error(
      "[Auth] createContext error:",
      error instanceof Error ? error.message : String(error)
    );
  }

  return ctx;
}