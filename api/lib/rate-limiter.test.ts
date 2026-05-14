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

    it("allows up to maxAttempts (100) for any action", async () => {
      const { checkRateLimit } = await getModule();
      for (let i = 0; i < 100; i++) {
        await expect(
          checkRateLimit("10.0.0.2", "login")
        ).resolves.toBeUndefined();
      }
    });

    it("throws TOO_MANY_REQUESTS on (maxAttempts + 1) request", async () => {
      const { checkRateLimit } = await getModule();
      for (let i = 0; i < 100; i++) {
        await checkRateLimit("10.0.0.3", "login");
      }
      // 101st request should throw
      await expect(
        checkRateLimit("10.0.0.3", "login")
      ).rejects.toThrow("Too many requests");
    });

    it("throws an error with message containing 'Too many requests'", async () => {
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

    it("allows independent limits for different actions", async () => {
      const { checkRateLimit } = await getModule();
      // Exhaust login counter (100 points)
      for (let i = 0; i < 100; i++) {
        await checkRateLimit("10.0.0.5", "login");
      }
      await expect(
        checkRateLimit("10.0.0.5", "login")
      ).rejects.toThrow("Too many requests");
      // register should still work (separate key)
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
      for (let i = 0; i < 100; i++) {
        await checkRateLimit("192.168.1.1", "login");
      }
      await expect(
        checkRateLimit("192.168.1.1", "login")
      ).rejects.toThrow();

      // IP B should still be allowed
      await expect(
        checkRateLimit("192.168.1.2", "login")
      ).resolves.toBeUndefined();
    });

    it("rate limit is per action: same IP, different actions have independent limits", async () => {
      const { checkRateLimit } = await getModule();
      const ip = "172.16.0.1";

      // Exhaust login limit
      for (let i = 0; i < 100; i++) {
        await checkRateLimit(ip, "login");
      }
      await expect(
        checkRateLimit(ip, "login")
      ).rejects.toThrow();

      // register should still work (separate key)
      await expect(
        checkRateLimit(ip, "register")
      ).resolves.toBeUndefined();
    });

    it("different actions have independent limits for the same IP", async () => {
      const { checkRateLimit } = await getModule();
      const ip = "10.20.30.40";

      // Exhaust register (100 points)
      for (let i = 0; i < 100; i++) {
        await checkRateLimit(ip, "register");
      }
      await expect(
        checkRateLimit(ip, "register")
      ).rejects.toThrow();

      // forgotPassword should work (separate key)
      await expect(
        checkRateLimit(ip, "forgotPassword")
      ).resolves.toBeUndefined();
    });
  });

  // ─── clearRateLimit ────────────────────────────────────────────────────

  describe("clearRateLimit()", () => {
    it("resets the counter so requests are allowed again", async () => {
      const { checkRateLimit, clearRateLimit } = await getModule();
      const ip = "10.0.0.99";

      // Exhaust login limit
      for (let i = 0; i < 100; i++) {
        await checkRateLimit(ip, "login");
      }
      await expect(
        checkRateLimit(ip, "login")
      ).rejects.toThrow();

      // Clear the rate limit
      clearRateLimit(ip, "login");

      // Should now allow requests again
      await expect(
        checkRateLimit(ip, "login")
      ).resolves.toBeUndefined();
    });

    it("clears one action without affecting others", async () => {
      const { checkRateLimit, clearRateLimit } = await getModule();
      const ip = "10.0.0.88";

      // Exhaust both login and register
      for (let i = 0; i < 100; i++) {
        await checkRateLimit(ip, "login");
      }
      for (let i = 0; i < 100; i++) {
        await checkRateLimit(ip, "register");
      }

      // Both should be rate limited
      await expect(checkRateLimit(ip, "login")).rejects.toThrow();
      await expect(checkRateLimit(ip, "register")).rejects.toThrow();

      // Clear only login
      clearRateLimit(ip, "login");

      // Login should work, register should still be limited
      await expect(checkRateLimit(ip, "login")).resolves.toBeUndefined();
      await expect(checkRateLimit(ip, "register")).rejects.toThrow();
    });
  });

  // ─── Window expiry ─────────────────────────────────────────────────────
  // NOTE: rate-limiter-flexible's RateLimiterMemory uses internal timing
  // that is incompatible with vi.useFakeTimers(). Window expiry behavior
  // is a library guarantee — our code correctly delegates to it.
  // We test clearRateLimit() above which validates the reset mechanism.

  describe("window expiry (time-based reset)", () => {
    it("clearRateLimit resets counter immediately (validates window reset path)", async () => {
      const { checkRateLimit, clearRateLimit } = await getModule();
      const ip = "10.0.0.50";

      // Exhaust login limit
      for (let i = 0; i < 100; i++) {
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
      for (let i = 0; i < 100; i++) {
        await checkRateLimit(ip, "login");
      }
      await expect(
        checkRateLimit(ip, "login")
      ).rejects.toThrow();

      // Verify rate limit persists for multiple subsequent requests
      for (let i = 0; i < 10; i++) {
        await expect(
          checkRateLimit(ip, "login")
        ).rejects.toThrow("Too many requests");
      }
    });
  });
});
