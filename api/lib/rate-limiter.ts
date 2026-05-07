/**
 * Rate Limiter — Redis-backed with In-Memory Fallback
 *
 * Uses the unified cache layer (Redis or MemoryLRU) to store rate limit counters.
 * This means:
 * - With Redis: Rate limits work across multiple server instances
 * - Without Redis: Rate limits work within a single instance (resets on restart)
 */

import { TRPCError } from "@trpc/server";
import { getCache, cacheKeys, CACHE_TTL } from "./cache";

export type RateLimitAction =
  | "login"
  | "register"
  | "forgotPassword"
  | "resetPassword"
  | "payment"
  | "quiz"
  | "api"
  | "heartbeat"
  | "chatbot";

interface RateLimitConfig {
  windowMs: number;
  maxAttempts: number;
}

const configs: Record<RateLimitAction, RateLimitConfig> = {
  login: { windowMs: 15 * 60 * 1000, maxAttempts: 5 },
  register: { windowMs: 60 * 60 * 1000, maxAttempts: 3 },
  forgotPassword: { windowMs: 15 * 60 * 1000, maxAttempts: 3 },
  resetPassword: { windowMs: 15 * 60 * 1000, maxAttempts: 5 },
  payment: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
  quiz: { windowMs: 5 * 60 * 1000, maxAttempts: 20 },
  api: { windowMs: 60 * 1000, maxAttempts: 60 },
  heartbeat: { windowMs: 60 * 1000, maxAttempts: 30 },
  chatbot: { windowMs: 60 * 1000, maxAttempts: 10 },
};

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export async function checkRateLimit(
  identifier: string,
  action: RateLimitAction = "api"
): Promise<{ remaining: number; resetMs: number }> {
  const config = configs[action];
  const cache = getCache();
  const key = cacheKeys.rateLimit(identifier, action);
  const ttlSeconds = Math.ceil(config.windowMs / 1000);

  const existing = await cache.get<RateLimitEntry>(key);

  if (!existing || Date.now() - existing.windowStart > config.windowMs) {
    // New window
    const entry: RateLimitEntry = { count: 1, windowStart: Date.now() };
    await cache.set(key, entry, ttlSeconds);
    return { remaining: config.maxAttempts - 1, resetMs: config.windowMs };
  }

  if (existing.count >= config.maxAttempts) {
    const resetMs = config.windowMs - (Date.now() - existing.windowStart);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Rate limit exceeded. Try again in ${Math.ceil(resetMs / 1000)}s.`,
    });
  }

  const updated: RateLimitEntry = {
    count: existing.count + 1,
    windowStart: existing.windowStart,
  };
  await cache.set(key, updated, ttlSeconds);

  return {
    remaining: config.maxAttempts - updated.count,
    resetMs: config.windowMs - (Date.now() - updated.windowStart),
  };
}

export async function clearRateLimit(
  identifier: string,
  action: RateLimitAction = "api"
): Promise<void> {
  const cache = getCache();
  const key = cacheKeys.rateLimit(identifier, action);
  await cache.del(key);
}
