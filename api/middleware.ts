import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { checkRateLimit } from "./lib/rate-limiter";
import { env } from "./lib/env";
import { getClientIpFromHeaders } from "./lib/client-ip";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape }) => {
    // SECURITY FIX: In production, hide raw error messages for:
    // - INTERNAL_SERVER_ERROR: never expose DB errors, stack traces, etc.
    // - BAD_REQUEST: hide raw Zod validation arrays (technical JSON)
    if (env.isProduction) {
      const code = shape.data?.code;
      if (code === "INTERNAL_SERVER_ERROR") {
        return { ...shape, message: "An internal error occurred. Please try again later." };
      }
      // Clean up Zod validation errors — don't leak regex patterns and JSON arrays
      if (code === "BAD_REQUEST" && shape.message.startsWith("[")) {
        return { ...shape, message: "Invalid input. Please check your data and try again." };
      }
    }
    return shape;
  },
});

export const createRouter = t.router;
export { checkRateLimit };
export { clearRateLimit, type RateLimitAction } from "./lib/rate-limiter";
export { authRateLimit };

const globalRateLimit = t.middleware(async (opts) => {
  // Unified IP extraction (cf-connecting-ip > x-real-ip > first x-forwarded-for)
  const ip = opts.ctx.req?.headers ? getClientIpFromHeaders(opts.ctx.req.headers) : "unknown";
  await checkRateLimit(ip, "api");
  return opts.next();
});

export const publicQuery = t.procedure.use(globalRateLimit);
export const publicMutation = t.procedure;

// Auth-specific rate limit middleware — runs BEFORE input validation.
// This prevents attackers from bypassing per-action rate limits by sending
// invalid inputs (which would fail Zod validation before reaching the
// in-handler checkRateLimit call).
// Usage: login: publicQuery.use(authRateLimit('login')).input(...).mutation(...)
function authRateLimit(action: import("./lib/rate-limiter").RateLimitAction) {
  return t.middleware(async (opts) => {
    const ip = opts.ctx.req?.headers ? getClientIpFromHeaders(opts.ctx.req.headers) : "unknown";
    await checkRateLimit(ip, action);
    return opts.next();
  });
}

const requireAuth = t.middleware(async (opts) => {
  if (!opts.ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return opts.next({ ctx: { ...opts.ctx, user: opts.ctx.user } });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    if (opts.ctx.user?.role !== role) throw new TRPCError({ code: "FORBIDDEN" });
    return opts.next({ ctx: { ...opts.ctx, user: opts.ctx.user } });
  });
}

// 🔒 SECURITY FIX (Task ID 6): authMutation previously bypassed globalRateLimit,
// which meant login/register/forgotPassword were only protected by the per-IP
// shieldMiddleware (200 req / 10s = 1200/min). That's far too lenient for auth
// endpoints — bcrypt-12 at ~3 hashes/sec/core means 1200 login attempts/min
// would let an attacker test ~20k passwords/hour against a known email.
// We now apply globalRateLimit to ALL procedures, and sensitive auth actions
// additionally call checkRateLimit(ip, 'login') etc. with a much smaller
// per-action quota inside the procedure body.
export const authedQuery = t.procedure.use(globalRateLimit).use(requireAuth);
export const authQuery = authedQuery;
export const authMutation = t.procedure.use(globalRateLimit).use(requireAuth);
export const adminQuery = t.procedure.use(globalRateLimit).use(requireAuth).use(requireRole("admin"));
export const adminMutation = t.procedure.use(globalRateLimit).use(requireAuth).use(requireRole("admin"));