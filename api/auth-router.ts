import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { getSessionCookieOptions, AUTH_FLAG_COOKIE_NAME } from "./lib/cookies";
import { createRouter, authedQuery } from "./middleware";

export const authRouter = createRouter({
  me: authedQuery.query((opts) => opts.ctx.user),
  logout: authedQuery.mutation(async ({ ctx }) => {
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
