/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("Rate Limiter Module", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("./env", () => ({
      env: {
        REDIS_URL: "",
        RATE_LIMIT_MAX_REQUESTS: 100,
        RATE_LIMIT_WINDOW_MS: 60000,
        isProduction: false,
      },
    }));
    vi.doMock("ioredis", () => ({ default: class Redis {} }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  async function getModule() {
    const mod = await import("./rate-limiter");
    return mod;
  }

  // ─── Basic functionality ───────────────────────────────────────────────

  describe("checkRateLimit()", () => {
    it("allows the first request without error", async () => {
      const { checkRateLimit } = await getModule();
      await expect(
        checkRateLimit("10.0.0.1", "login")
      ).resolves.toBeUndefined();
    });

    it("allows up to per-action limit for auth actions (login = 10)", async () => {
      // 🔒 SECURITY FIX (Task ID 6): auth actions now have stricter per-action limits.
      // login: 10 attempts / 15 min (was previously 100/min shared with all API traffic)
      const { checkRateLimit } = await getModule();
      for (let i = 0; i < 10; i++) {
        await expect(
          checkRateLimit("10.0.0.2", "login")
        ).resolves.toBeUndefined();
      }
    });

    it("throws TOO_MANY_REQUESTS on (per-action limit + 1) for login", async () => {
      const { checkRateLimit } = await getModule();
      for (let i = 0; i < 10; i++) {
        await checkRateLimit("10.0.0.3", "login");
      }
      // 11th login attempt should throw with the per-action message
      await expect(
        checkRateLimit("10.0.0.3", "login")
      ).rejects.toThrow(/Too many login attempts/);
    });

    it("throws 'Too many requests' for the generic 'api' action when exhausted", async () => {
      const { checkRateLimit } = await getModule();
      for (let i = 0; i < 100; i++) {
        await checkRateLimit("10.0.0.4", "api");
      }
      try {
        await checkRateLimit("10.0.0.4", "api");
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("Too many requests");
      }
    });

    it("allows independent per-action limits for different actions", async () => {
      // 🔒 SECURITY FIX: login and register have SEPARATE per-action buckets.
      // Exhausting login does NOT block register (and vice versa).
      const { checkRateLimit } = await getModule();
      // Exhaust login per-action limit (10)
      for (let i = 0; i < 10; i++) {
        await checkRateLimit("10.0.0.5", "login");
      }
      await expect(
        checkRateLimit("10.0.0.5", "login")
      ).rejects.toThrow();
      // register should still work (separate per-action bucket)
      await expect(
        checkRateLimit("10.0.0.5", "register")
      ).resolves.toBeUndefined();
    });
  });

  // ─── Per-IP + action combination ───────────────────────────────────────

  describe("per IP + action isolation", () => {
    it("rate limit is per IP: different IPs have independent counters", async () => {
      const { checkRateLimit } = await getModule();
      // Exhaust IP A's login limit
      for (let i = 0; i < 10; i++) {
        await checkRateLimit("192.168.1.1", "login");
      }
      await expect(
        checkRateLimit("192.168.1.1", "login")
      ).rejects.toThrow();

      // IP B should still be able to login
      await expect(
        checkRateLimit("192.168.1.2", "login")
      ).resolves.toBeUndefined();
    });

    it("rate limit is per action: same IP can use different actions", async () => {
      const { checkRateLimit } = await getModule();
      // Exhaust login
      for (let i = 0; i < 10; i++) {
        await checkRateLimit("192.168.2.1", "login");
      }
      await expect(
        checkRateLimit("192.168.2.1", "login")
      ).rejects.toThrow();

      // Same IP, different action should work
      await expect(
        checkRateLimit("192.168.2.1", "register")
      ).resolves.toBeUndefined();
    });
  });

  // ─── clearRateLimit() ──────────────────────────────────────────────────

  describe("clearRateLimit()", () => {
    it("clearRateLimit resets the per-action counter so the next call succeeds", async () => {
      const { checkRateLimit, clearRateLimit } = await getModule();
      const ip = "10.0.0.50";

      // Exhaust login limit
      for (let i = 0; i < 10; i++) {
        await checkRateLimit(ip, "login");
      }
      await expect(
        checkRateLimit(ip, "login")
      ).rejects.toThrow();

      // clearRateLimit simulates what window expiry does internally
      clearRateLimit(ip, "login");

      // Should now succeed — same behavior as window expiry resetting the counter
      await expect(
        checkRateLimit(ip, "login")
      ).resolves.toBeUndefined();
    });

    it("rate limit persists across consecutive requests within window", async () => {
      const { checkRateLimit } = await getModule();
      const ip = "10.0.0.51";

      // Exhaust login limit
      for (let i = 0; i < 10; i++) {
        await checkRateLimit(ip, "login");
      }
      await expect(
        checkRateLimit(ip, "login")
      ).rejects.toThrow();

      // Verify rate limit persists for multiple subsequent requests
      for (let i = 0; i < 5; i++) {
        await expect(
          checkRateLimit(ip, "login")
        ).rejects.toThrow();
      }
    });
  });
});
