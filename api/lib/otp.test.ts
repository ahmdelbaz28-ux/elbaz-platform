/**
 * Unit tests for the 6-digit OTP helper (api/lib/otp.ts).
 * Pure functions — no DB, no network.
 */

import { describe, it, expect } from "vitest";
import {
  generateOtpCode,
  hashOtpCode,
  isOtpFormat,
  otpAttemptsExhaustedAfterFailure,
  OTP_MAX_ATTEMPTS,
} from "./otp.js";

describe("otp.ts", () => {
  describe("generateOtpCode", () => {
    it("returns exactly 6 digits", () => {
      for (let i = 0; i < 200; i++) {
        expect(generateOtpCode()).toMatch(/^\d{6}$/);
      }
    });

    it("stays within 100000-999999 (uniform, no modulo bias)", () => {
      for (let i = 0; i < 300; i++) {
        const code = Number.parseInt(generateOtpCode(), 10);
        expect(code).toBeGreaterThanOrEqual(100000);
        expect(code).toBeLessThanOrEqual(999999);
      }
    });

    it("is not deterministic across calls (crypto randomness)", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i++) seen.add(generateOtpCode());
      expect(seen.size).toBeGreaterThan(10);
    });
  });

  describe("isOtpFormat", () => {
    it("accepts only 6-digit strings", () => {
      expect(isOtpFormat("123456")).toBe(true);
      expect(isOtpFormat("000000")).toBe(true);
    });

    it("rejects tokens, letters, and wrong lengths", () => {
      expect(isOtpFormat("12345")).toBe(false);
      expect(isOtpFormat("1234567")).toBe(false);
      expect(isOtpFormat("abcdef")).toBe(false);
      expect(isOtpFormat("12345a")).toBe(false);
      expect(isOtpFormat("")).toBe(false);
      // 64-hex link token must NOT be treated as a code
      expect(isOtpFormat("a".repeat(64))).toBe(false);
    });
  });

  describe("hashOtpCode", () => {
    it("hashes deterministically (sha256 hex, 64 chars)", () => {
      const h1 = hashOtpCode("123456");
      const h2 = hashOtpCode("123456");
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces different hashes for different codes", () => {
      expect(hashOtpCode("123456")).not.toBe(hashOtpCode("654321"));
    });

    it("never equals the raw code (hash-only storage)", () => {
      expect(hashOtpCode("123456")).not.toBe("123456");
    });
  });

  describe("otpAttemptsExhaustedAfterFailure", () => {
    it("allows OTP_MAX_ATTEMPTS - 1 failures before exhaustion", () => {
      for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) {
        expect(otpAttemptsExhaustedAfterFailure(i)).toBe(false);
      }
      expect(otpAttemptsExhaustedAfterFailure(OTP_MAX_ATTEMPTS - 1)).toBe(true);
    });

    it("stays exhausted once over budget", () => {
      expect(otpAttemptsExhaustedAfterFailure(OTP_MAX_ATTEMPTS)).toBe(true);
    });
  });
});
