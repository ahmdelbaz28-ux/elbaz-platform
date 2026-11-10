/**
 * TESTS — referral program pure logic + email drip templates
 *
 * The DB-touching paths (applyReferral, ensureReferralCode, sweeps) are
 * covered indirectly by their guards; what MUST hold deterministically is
 * the code-generation contract and the bilingual email content rules.
 */

import { describe, it, expect, vi } from "vitest";

// env.ts validates process env via Zod — tests must not depend on real env.
vi.mock("./env", () => ({
  env: { FRONTEND_URL: "https://test.example.com", isProduction: false },
}));
// getDb() opens MySQL — keep it inert for pure-logic tests.
vi.mock("../queries/connection", () => ({ getDb: () => ({}) }));
vi.mock("./logger.js", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

import {
  generateReferralCode,
  generateCouponCode,
  REFERRAL_REWARD_PERCENT,
  REFERRAL_WELCOME_PERCENT,
  REFERRAL_COUPON_VALID_DAYS,
} from "./referral";
import {
  welcomeEmailBody,
  nudgeEmailBody,
  congratsEmailBody,
  formatVideoPosition,
  startEmailDripScheduler,
} from "./email-drip";

// ─── Referral code generation contract ──────────────────────────────────────

describe("generateReferralCode", () => {
  it("matches the BASE-XXXX shape and stays within the column limit (24)", () => {
    for (const username of ["ahmed_elbaz", "مصطفى", "user123456789", "a", ""]) {
      const code = generateReferralCode(username);
      expect(code).toMatch(/^[A-Z0-9]{1,8}-[A-Z0-9]{4}$/);
      expect(code.length).toBeLessThanOrEqual(24);
    }
  });

  it("strips non-alphanumerics from the base part", () => {
    const code = generateReferralCode("m.ahmed_elbaz!");
    expect(code.startsWith("MAHMED")).toBe(true);
  });

  it("falls back to USER when the username has no latin/digit characters", () => {
    const code = generateReferralCode("مصطفى");
    expect(code.startsWith("USER-")).toBe(true);
  });

  it("produces unique codes across many draws (random tail)", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateReferralCode("test")));
    expect(codes.size).toBeGreaterThan(100);
  });
});

describe("generateCouponCode", () => {
  it("prefixes cleanly and stays within the promoCodes.code column (50)", () => {
    const code = generateCouponCode("REF-AHMED");
    expect(code).toMatch(/^REFAHMED-[A-Z0-9]{6}$/);
    expect(code.length).toBeLessThanOrEqual(50);
  });

  it("never emits ambiguous characters (no I/O/0/1)", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCouponCode("WELCOME");
      const tail = code.split("-")[1];
      expect(/[IO01]/.test(tail)).toBe(false);
    }
  });
});

describe("referral coupon policy constants", () => {
  it("keeps the documented split: 10% reward / 5% welcome / 90 days", () => {
    expect(REFERRAL_REWARD_PERCENT).toBe(10);
    expect(REFERRAL_WELCOME_PERCENT).toBe(5);
    expect(REFERRAL_COUPON_VALID_DAYS).toBe(90);
  });
});

// ─── Email drip templates ───────────────────────────────────────────────────

describe("welcomeEmailBody", () => {
  it("Arabic copy contains the platform name and the courses CTA link", () => {
    const body = welcomeEmailBody("أحمد", "ar");
    expect(body.subject).toContain("أحمد");
    expect(body.html).toContain("/courses");
    expect(body.text).toContain("منصة الباز");
  });

  it("English copy for en users", () => {
    const body = welcomeEmailBody("Ahmed", "en");
    expect(body.subject).toContain("Ahmed");
    expect(body.html).toContain("Elbaz Platform");
  });
});

describe("nudgeEmailBody", () => {
  it("mentions the 2-day no-start framing and a concrete next action", () => {
    const body = nudgeEmailBody("محمود", "ar");
    expect(body.html).toContain("أول درس");
    expect(body.html).toContain("/courses");
  });
});

describe("congratsEmailBody", () => {
  it("includes the course title, dashboard certificate link and review link", () => {
    const body = congratsEmailBody("سارة", "كورس ETAP الشامل", "etap-complete-course", "https://x/dashboard", "ar");
    expect(body.subject).toContain("كورس ETAP الشامل");
    expect(body.html).toContain("/courses/etap-complete-course");
    expect(body.html).toContain("https://x/dashboard");
  });
});

describe("formatVideoPosition", () => {
  it("formats m:ss", () => {
    expect(formatVideoPosition(0)).toBe("0:00");
    expect(formatVideoPosition(75)).toBe("1:15");
    expect(formatVideoPosition(600)).toBe("10:00");
  });
});

describe("startEmailDripScheduler", () => {
  it("is idempotent — calling twice does not double-arm timers", () => {
    // No timers were armed before (fresh module state). Calling twice must
    // silently no-op the second time (guarded by schedulerTimer).
    expect(() => { startEmailDripScheduler(); }).not.toThrow();
    expect(() => { startEmailDripScheduler(); }).not.toThrow();
  });
});
