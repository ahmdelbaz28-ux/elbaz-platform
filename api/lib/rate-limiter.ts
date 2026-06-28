import { Redis } from "ioredis";
import type { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { TRPCError } from "@trpc/server";

let redisClient: Redis | null = null;
let rateLimiter: RateLimiterMemory | null = null;
let redisWarningLogged = false;

async function initRedis(): Promise<void> {
  const { env } = await import("./env.js");
  if (!env.REDIS_URL) return;
  try {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy(times) {
        return Math.min(times * 200, 5000);
      },
      disconnectTimeout: 5000,
    });
    redisClient.on("error", (err) => {
      console.error("[RateLimiter] Redis error:", err.message);
    });
  } catch {
    console.warn("[RateLimiter] Redis unavailable, falling back to in-memory");
  }
}

async function getRateLimiter() {
  if (rateLimiter) return rateLimiter;

  const { RateLimiterMemory } = await import("rate-limiter-flexible");
  const { env } = await import("./env.js");

  if (redisClient) {
    try {
      const { RateLimiterRedis } = await import("rate-limiter-flexible");
      rateLimiter = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: "rl:",
        points: env.RATE_LIMIT_MAX_REQUESTS,
        duration: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000),
        blockDuration: 60,
        insuranceLimiter: new RateLimiterMemory({
          points: env.RATE_LIMIT_MAX_REQUESTS,
          duration: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000),
        }),
      }) as unknown as RateLimiterMemory;
      return rateLimiter;
    } catch {
      console.warn("[RateLimiter] RateLimiterRedis failed, using in-memory fallback");
    }
  }

  rateLimiter = new RateLimiterMemory({
    points: env.RATE_LIMIT_MAX_REQUESTS,
    duration: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000),
    blockDuration: 10,
  });

  return rateLimiter;
}

async function rateLimit(
  key: string,
  points?: number
): Promise<RateLimiterRes> {
  const limiter = await getRateLimiter();
  return limiter.consume(key, points ?? 1);
}

// ✅ NOTE: rateLimitByKeyPrefix was removed — it created a NEW RateLimiterMemory
// on every call, which is a memory leak. If you need per-key-prefix rate limiting,
// use the shared rateLimiter via checkRateLimit() which uses a single instance
// with automatic cleanup of expired entries.

type RateLimitAction = "login" | "register" | "forgotPassword" | "resetPassword" | "sendVerification" | "verifyEmail" | "api";

// 🔒 SECURITY FIX (Task ID 6): Per-action rate limits for sensitive auth flows.
// These are SEPARATE from the global API rate limit (300 req / 60s) — each auth
// action gets its own much-smaller bucket per IP, so an attacker cannot burn
// the login quota by hitting /register, etc.
//
// Values chosen to be friendly to humans (who rarely mistype a password more
// than 5 times in 15 minutes) but hostile to scripts:
//   login / register:        10 attempts / 15 min  (per IP)
//   forgotPassword:           5 attempts / 15 min  (per IP — prevents email bombing)
//   resetPassword:           10 attempts / 15 min  (per IP)
//   sendVerification:         5 attempts / 15 min  (per IP — prevents email bombing)
//   verifyEmail:             20 attempts / 15 min  (per IP — allows typo retries)
//
// On top of this per-action limit, the existing shieldMiddleware caps all HTTP
// requests at 200 / 10s per IP (DoS protection).
const AUTH_ACTION_LIMITS: Record<Exclude<RateLimitAction, "api">, { points: number; durationSec: number; blockSec: number }> = {
  login:            { points: 10, durationSec: 900, blockSec: 900 },
  register:         { points: 10, durationSec: 900, blockSec: 900 },
  forgotPassword:   { points: 5,  durationSec: 900, blockSec: 1800 },
  resetPassword:    { points: 10, durationSec: 900, blockSec: 900 },
  sendVerification: { points: 5,  durationSec: 900, blockSec: 1800 },
  verifyEmail:      { points: 20, durationSec: 900, blockSec: 900 },
};

const authActionLimiters = new Map<string, RateLimiterMemory>();

async function getAuthActionLimiter(action: Exclude<RateLimitAction, "api">): Promise<RateLimiterMemory> {
  const cached = authActionLimiters.get(action);
  if (cached) return cached;

  const { RateLimiterMemory } = await import("rate-limiter-flexible");
  const cfg = AUTH_ACTION_LIMITS[action];

  let limiter: RateLimiterMemory;
  if (redisClient) {
    try {
      const { RateLimiterRedis } = await import("rate-limiter-flexible");
      limiter = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: `rl:${action}:`,
        points: cfg.points,
        duration: cfg.durationSec,
        blockDuration: cfg.blockSec,
        insuranceLimiter: new RateLimiterMemory({
          points: cfg.points,
          duration: cfg.durationSec,
        }),
      }) as unknown as RateLimiterMemory;
    } catch {
      limiter = new RateLimiterMemory({
        points: cfg.points,
        duration: cfg.durationSec,
        blockDuration: cfg.blockSec,
      });
    }
  } else {
    limiter = new RateLimiterMemory({
      points: cfg.points,
      duration: cfg.durationSec,
      blockDuration: cfg.blockSec,
    });
  }

  authActionLimiters.set(action, limiter);
  return limiter;
}

async function checkRateLimit(ip: string, action: RateLimitAction): Promise<void> {
  const { env } = await import("./env.js");
  if (!redisClient && !redisWarningLogged) {
    redisWarningLogged = true;
    if (env.isProduction) {
      console.warn("[RateLimiter] Redis not configured — falling back to in-memory rate limiter");
    }
    // Fall through to in-memory rate limiter (initialized in getRateLimiter)
  }

  // For sensitive auth actions, use the stricter per-action limiter.
  if (action !== "api") {
    try {
      const authLimiter = await getAuthActionLimiter(action);
      await authLimiter.consume(`${ip}`);
    } catch (rlRes: unknown) {
      const msBeforeNext = (rlRes as { msBeforeNext?: number })?.msBeforeNext;
      if (typeof msBeforeNext === "number" && msBeforeNext > 0) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many ${action} attempts. Please try again in ${Math.ceil(msBeforeNext / 1000)}s.`,
          cause: { retryAfterMs: msBeforeNext, action },
        });
      }
      console.warn(`[RateLimiter] Non-rate-limit error for ${action}:`, (rlRes as Error)?.message || rlRes);
    }
  }

  // Always also consume from the global API limiter ("api" action).
  try {
    await rateLimit(`${ip}:${action}`);
  } catch (rlRes: unknown) {
    const msBeforeNext = (rlRes as { msBeforeNext?: number })?.msBeforeNext;
    if (typeof msBeforeNext === "number" && msBeforeNext > 0) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Please try again later.",
        cause: { retryAfterMs: msBeforeNext },
      });
    }
    console.warn(`[RateLimiter] Non-rate-limit error for ${action}:`, (rlRes as Error)?.message || rlRes);
  }
}

function clearRateLimit(ip: string, action: RateLimitAction): void {
  if (rateLimiter) {
    rateLimiter.delete(`${ip}:${action}`);
  }
  if (action !== "api") {
    const authLimiter = authActionLimiters.get(action);
    if (authLimiter) {
      authLimiter.delete(`${ip}`);
    }
  }
}

export { initRedis, rateLimit, checkRateLimit, clearRateLimit };
export type { RateLimitAction };
