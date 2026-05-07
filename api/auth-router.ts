import { Session } from "@contracts/constants";
import { createRouter, authedQuery } from "./middleware";
import { clearAuthCookie } from "./context";

export const authRouter = createRouter({
  me: authedQuery.query((opts) => opts.ctx.user),
  logout: authedQuery.mutation(async ({ ctx }) => {
    // Clear the primary HttpOnly auth cookie
    clearAuthCookie(ctx.req.headers, ctx.resHeaders);

    // Also clear legacy Kimi session cookie if present (backwards compatibility)
    const { default: cookie } = await import("cookie");
    const isLocalhost = (ctx.req.headers.get("host") || "").startsWith("localhost:");
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.legacyCookieName, "", {
        httpOnly: true,
        path: "/",
        sameSite: isLocalhost ? "Lax" : "None",
        secure: !isLocalhost,
        maxAge: 0,
      }),
    );

    return { success: true };
  }),
});
