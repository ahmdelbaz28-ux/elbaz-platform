import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { verifyToken } from "./lib/jwt";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { AUTH_COOKIE_NAME } from "./lib/cookies";
import { parse } from "cookie";

// ✅ SECURITY FIX: Define a SafeUser type that excludes passwordHash
// The full User object (including passwordHash) should NEVER be in the tRPC context
// because any route using authedQuery has access to ctx.user — accidentally
// returning it in a response would leak the bcrypt hash.
export type SafeUser = Omit<User, "passwordHash">;

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: SafeUser;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };

  // Try local auth token
  try {
    // ✅ SECURITY FIX: Check httpOnly cookie first, then fallback to header
    // Cookie-based auth is the primary method (XSS-safe)
    let token: string | undefined;

    // 1. Try httpOnly cookie (preferred — XSS cannot steal httpOnly cookies)
    const cookieHeader = opts.req.headers.get("cookie") || "";
    const parsedCookies = parse(cookieHeader);
    if (parsedCookies[AUTH_COOKIE_NAME]) {
      token = parsedCookies[AUTH_COOKIE_NAME];
    }

    // 2. Fallback to Authorization header (for backward compatibility during migration)
    if (!token) {
      token =
        opts.req.headers.get("x-auth-token") ||
        opts.req.headers.get("authorization")?.replace("Bearer ", "");
    }
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
          // ✅ SECURITY FIX: Verify tokenVersion to support token revocation
          // If admin changed user's role or user changed password, tokenVersion
          // in DB will be higher than in the JWT, invalidating the token
          if (payload.tokenVersion !== undefined && payload.tokenVersion !== user.tokenVersion) {
            // Token has been revoked — do not authenticate
            return ctx;
          }

          // ✅ SECURITY FIX: Strip passwordHash before putting user in context
          const { passwordHash: _ph, ...safeUser } = user;
          ctx.user = safeUser;
        }
      }
    }
  } catch {
    // Authentication is optional
  }

  return ctx;
}
