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

async function checkRateLimit(ip: string, _action: RateLimitAction): Promise<void> {
  const { env } = await import("./env.js");
  if (!redisClient && !redisWarningLogged) {
    redisWarningLogged = true;
    if (env.isProduction) {
      console.warn("[RateLimiter] Redis not configured — falling back to in-memory rate limiter");
    }
    // Fall through to in-memory rate limiter (initialized in getRateLimiter)
  }

  try {
    await rateLimit(`${ip}:${_action}`);
  } catch (rlRes: unknown) {
    // Only treat as rate limit if the error has the expected shape
    const msBeforeNext = (rlRes as { msBeforeNext?: number })?.msBeforeNext;
    if (typeof msBeforeNext === 'number' && msBeforeNext > 0) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Please try again later.",
        cause: { retryAfterMs: msBeforeNext },
      });
    }
    // Otherwise, log and allow the request through (fail-open for non-rate-limit errors)
    console.warn(`[RateLimiter] Non-rate-limit error for ${_action}:`, (rlRes as Error)?.message || rlRes);
  }
}

function clearRateLimit(ip: string, action: RateLimitAction): void {
  if (rateLimiter) {
    rateLimiter.delete(`${ip}:${action}`);
  }
}

export { initRedis, rateLimit, checkRateLimit, clearRateLimit };
export type { RateLimitAction };
