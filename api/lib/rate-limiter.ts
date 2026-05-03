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