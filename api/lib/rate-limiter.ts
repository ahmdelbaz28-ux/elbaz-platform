import { TRPCError } from "@trpc/server";

export type RateLimitAction = "login" | "register" | "forgotPassword" | "resetPassword" | "payment" | "quiz" | "api";

const configs = {
  login: { windowMs: 15 * 60 * 1000, maxAttempts: 5 },
  register: { windowMs: 60 * 60 * 1000, maxAttempts: 3 },
  forgotPassword: { windowMs: 15 * 60 * 1000, maxAttempts: 3 },
  resetPassword: { windowMs: 15 * 60 * 1000, maxAttempts: 5 },
  payment: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
  quiz: { windowMs: 5 * 60 * 1000, maxAttempts: 20 },
  api: { windowMs: 60 * 1000, maxAttempts: 60 },
};

const store = new Map<string, { count: number; start: number }>();

// ✅ OPTIMIZED: Periodic cleanup to prevent memory leaks from stale entries
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes
const MAX_STORE_SIZE = 10000; // Safety limit

setInterval(() => {
  const now = Date.now();
  // Find max window across all configs
  const maxWindow = Math.max(...Object.values(configs).map(c => c.windowMs));
  const cutoff = now - maxWindow * 2; // Remove entries older than 2x max window

  let cleaned = 0;
  for (const [key, entry] of store) {
    if (entry.start < cutoff) {
      store.delete(key);
      cleaned++;
    }
  }

  // Safety: if store grows too large, clear oldest entries
  if (store.size > MAX_STORE_SIZE) {
    const entries = Array.from(store.entries()).sort((a, b) => a[1].start - b[1].start);
    const toRemove = entries.slice(0, store.size - MAX_STORE_SIZE);
    for (const [key] of toRemove) {
      store.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log("[Rate Limiter] Cleaned " + cleaned + " stale entries, store size: " + store.size);
  }
}, CLEANUP_INTERVAL_MS).unref();

export async function checkRateLimit(ip: string, action: RateLimitAction = "api") {
  const c = configs[action];
  const key = `${action}:${ip}`;
  const r = store.get(key);
  if (!r || Date.now() - r.start > c.windowMs) {
    store.set(key, { count: 1, start: Date.now() });
    return;
  }
  if (r.count >= c.maxAttempts) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many requests." });
  }
  r.count++;
}

export function clearRateLimit(ip: string, action: RateLimitAction = "api") {
  store.delete(`${action}:${ip}`);
}