import * as cookie from "cookie";
import { eq, sql } from "drizzle-orm";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions, AUTH_FLAG_COOKIE_NAME } from "./lib/cookies";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";

export const authRouter = createRouter({
  me: authedQuery.query((opts) => opts.ctx.user),
  logout: authedQuery.mutation(async ({ ctx }) => {
    // ✅ SECURITY FIX (audit run-1): bump tokenVersion so the presented JWT is
    // invalidated server-side. Clearing cookies alone left the token valid
    // until its 7-day expiry (and self-renewing via the sliding refresh).
    try {
      await getDb()
        .update(users)
        .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(eq(users.id, ctx.user.id));
    } catch {
      // Never block cookie clearing on a DB hiccup.
    }
    const opts = getSessionCookieOptions(ctx.req.headers);
    // Clear both the HttpOnly auth cookie and the non-HttpOnly flag cookie
    const clearAuth = cookie.serialize(Session.cookieName, "", {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: 0,
    });
    const clearFlag = cookie.serialize(AUTH_FLAG_COOKIE_NAME, "", {
      httpOnly: false,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: 0,
    });
    // Also clear legacy Kimi session cookie for backwards compatibility
    const clearLegacy = cookie.serialize(Session.legacyCookieName, "", {
      httpOnly: opts.httpOnly,
      path: opts.path,
      sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
      secure: opts.secure,
      maxAge: 0,
    });
    ctx.resHeaders.append("set-cookie", clearAuth);
    ctx.resHeaders.append("set-cookie", clearFlag);
    ctx.resHeaders.append("set-cookie", clearLegacy);
    return { success: true };
  }),
});
