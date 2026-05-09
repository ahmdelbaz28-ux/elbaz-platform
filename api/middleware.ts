import { ErrorMessages } from "@contracts/constants";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { checkRateLimit, clearRateLimit, type RateLimitAction } from "./lib/rate-limiter";
import { env } from "./lib/env";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => {
    if (env.isProduction && shape.data?.code === "INTERNAL_SERVER_ERROR") {
      return { ...shape, message: "An internal error occurred." };
    }
    return shape;
  },
});

export const createRouter = t.router;
export const publicQuery = t.procedure;
export { checkRateLimit, clearRateLimit, type RateLimitAction };

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

const globalRateLimit = t.middleware(async (opts) => {
  // ✅ FIX: Use rightmost IP from X-Forwarded-For (set by last trusted proxy)
  // Leftmost IPs can be spoofed by clients; rightmost is from Cloudflare/proxy
  const forwarded = opts.ctx.req?.headers?.get("x-forwarded-for");
  const cfIp = opts.ctx.req?.headers?.get("cf-connecting-ip");
  const ip = cfIp || (forwarded ? forwarded.split(",").pop()?.trim() || "unknown" : "unknown");
  await checkRateLimit(ip, "api");
  return opts.next();
});

export const authedQuery = t.procedure.use(globalRateLimit).use(requireAuth);
export const adminQuery = t.procedure.use(globalRateLimit).use(requireAuth).use(requireRole("admin"));