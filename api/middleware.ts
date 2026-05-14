import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { checkRateLimit, clearRateLimit, type RateLimitAction } from "./lib/rate-limiter";
import { env } from "./lib/env";

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
export { checkRateLimit, clearRateLimit, type RateLimitAction };

const globalRateLimit = t.middleware(async (opts) => {
  const forwarded = opts.ctx.req?.headers?.get("x-forwarded-for");
  const cfIp = opts.ctx.req?.headers?.get("cf-connecting-ip");
  const realIp = opts.ctx.req?.headers?.get("x-real-ip");
  // Unified IP extraction: cf-connecting-ip (set by Cloudflare) > x-real-ip > first x-forwarded-for
  // Using first IP from x-forwarded-for is correct when the first proxy is trusted (Cloudflare)
  const ip = cfIp || realIp || (forwarded ? forwarded.split(",").shift()?.trim() || "unknown" : "unknown");
  await checkRateLimit(ip, "api");
  return opts.next();
});

export const publicQuery = t.procedure.use(globalRateLimit);

const requireAuth = t.middleware(async (opts) => {
  if (!opts.ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return opts.next({ ctx: { ...opts.ctx, user: opts.ctx.user } });
});

function requireRole(role: string) {
  return t.middleware(async (opts) => {
    if (!opts.ctx.user || opts.ctx.user.role !== role) throw new TRPCError({ code: "FORBIDDEN" });
    return opts.next({ ctx: { ...opts.ctx, user: opts.ctx.user } });
  });
}

export const authedQuery = t.procedure.use(globalRateLimit).use(requireAuth);
export const adminQuery = t.procedure.use(globalRateLimit).use(requireAuth).use(requireRole("admin"));