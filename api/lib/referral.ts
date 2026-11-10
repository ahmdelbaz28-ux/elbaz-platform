/**
 * REFERRAL PROGRAM — student-to-student invitation rewards
 *
 * Flow:
 *  1. Every user can get a referral code (lazily generated on first profile
 *     view) → shared as /register?ref=CODE.
 *  2. When a new account registers with that code, BOTH sides win:
 *     - the referrer earns a reward coupon (10% off any future course),
 *     - the invited friend receives a welcome coupon (5% off).
 *  3. Coupons reuse the existing promoCodes table (already honored by
 *     /api/promo/validate + payment flow), so a future paid course works
 *     out of the box — no further plumbing needed.
 *
 * This module is deliberately DB-light and pure-function-first so the code
 * generation rules are unit-testable without a MySQL connection.
 */

import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { users, referrals, promoCodes } from "@db/schema";
import { logger } from "./logger.js";

// ─── Coupon policy (single source of truth) ─────────────────────────────────
export const REFERRAL_REWARD_PERCENT = 10;   // coupon granted to the referrer
export const REFERRAL_WELCOME_PERCENT = 5;   // coupon granted to the friend
export const REFERRAL_COUPON_VALID_DAYS = 90;

// ─── Pure helpers ───────────────────────────────────────────────────────────

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — unambiguous when read aloud

function randomSuffix(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Referral code from a username: keep the readable part (letters/digits,
 * max 8 chars) + a 4-char random tail, e.g. "AHMED-K42Q".
 * Deterministic format, always ≤ 24 chars, always unique thanks to the tail.
 */
export function generateReferralCode(username: string): string {
  const base = (username || "user")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8) || "USER";
  return `${base}-${randomSuffix(4)}`;
}

/** Discount coupon code, e.g. "REF-AHMED-K42Q" / "WELCOME-M3PX7TA2". */
export function generateCouponCode(prefix: string): string {
  const clean = (prefix || "PROMO").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return `${clean}-${randomSuffix(6)}`;
}

// ─── DB integration ─────────────────────────────────────────────────────────

/**
 * Return the user's referral code, generating + persisting one lazily on
 * first call. Retries on the (astronomically unlikely) unique-key collision.
 */
export async function ensureReferralCode(userId: number, username: string): Promise<string> {
  const db = getDb();
  const [user] = await db
    .select({ referralCode: users.referralCode })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user?.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode(username);
    try {
      await db.update(users).set({ referralCode: code }).where(eq(users.id, userId));
      return code;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("Duplicate") && !message.includes("unique")) {
        throw err;
      }
      logger.warn("[Referral] referralCode collision — regenerating", { userId, attempt });
    }
  }
  throw new Error("Failed to allocate a unique referral code after 5 attempts");
}

/**
 * Wire a freshly-registered user to their inviter and grant both coupons.
 * Returns null when refCode is empty/unknown/self — registration itself
 * MUST NOT fail because of referral problems, so callers wrap this in
 * try/catch and log.
 */
export async function applyReferral(
  refCode: string,
  newUserId: number,
): Promise<{ rewardCode: string; friendCode: string; referrerUsername: string } | null> {
  const db = getDb();
  const code = (refCode || "").trim().toUpperCase();
  if (!code) return null;

  const [referrer] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.referralCode, code))
    .limit(1);

  if (!referrer) {
    logger.info("[Referral] unknown referral code ignored", { code, newUserId });
    return null;
  }
  if (referrer.id === newUserId) {
    return null; // self-referral — ignore
  }

  const now = new Date();
  const validUntil = new Date(now.getTime() + REFERRAL_COUPON_VALID_DAYS * 24 * 3600 * 1000);
  const rewardCode = generateCouponCode(`REF-${referrer.username}`);
  const friendCode = generateCouponCode("WELCOME");

  // ── 1. Attribution FIRST (the core link) ──
  // referrals.referredUserId is UNIQUE so an account can be attributed to at
  // most one inviter even under double-submit races.
  await db.insert(referrals).values({
    referrerUserId: referrer.id,
    referredUserId: newUserId,
    rewardPromoCode: rewardCode,
    friendPromoCode: friendCode,
  });
  await db.update(users).set({ referredByUserId: referrer.id }).where(eq(users.id, newUserId));

  // ── 2. Coupons SECOND (best-effort rewards) ──
  // Uses the SAME minimal column set as the proven working admin promo
  // create — older live databases may predate optional columns like
  // description/maxUsesPerUser/isValidForAllCourses, and rewards must never
  // fail registration (or the attribution above).
  const grantCoupon = async (couponCode: string, discountPercent: number) => {
    try {
      await db.insert(promoCodes).values({
        code: couponCode,
        discountType: "percentage",
        discountValue: String(discountPercent),
        maxUses: 1,
        validUntil,
        createdBy: referrer.id,
        isActive: true,
      });
      return true;
    } catch (err) {
      logger.warn("[Referral] coupon grant failed (attribution kept)", {
        couponCode,
        newUserId,
        referrer: referrer.id,
        message: err instanceof Error ? err.message : String(err),
        cause: err instanceof Error && err.cause instanceof Error ? err.cause.message : String((err as { cause?: unknown })?.cause ?? ""),
      });
      return false;
    }
  };

  const rewardOk = await grantCoupon(rewardCode, REFERRAL_REWARD_PERCENT);
  const friendOk = await grantCoupon(friendCode, REFERRAL_WELCOME_PERCENT);

  logger.info("[Referral] applied", {
    referrer: referrer.id,
    newUser: newUserId,
    rewardCode,
    friendCode,
    rewardOk,
    friendOk,
  });

  return { rewardCode, friendCode, referrerUsername: referrer.username };
}

export interface ReferralOverview {
  referralCode: string;
  invitedCount: number;
  rewardCoupons: { code: string; discountValue: string; validUntil: Date | null; isActive: boolean }[];
  welcomeCoupon: { code: string; discountValue: string; validUntil: Date | null; isActive: boolean } | null;
}

/** Everything the profile page renders in one query round. */
export async function getReferralOverview(userId: number, username: string): Promise<ReferralOverview> {
  const db = getDb();
  const referralCode = await ensureReferralCode(userId, username);

  const invitedRows = await db
    .select({ rewardPromoCode: referrals.rewardPromoCode })
    .from(referrals)
    .where(eq(referrals.referrerUserId, userId));

  const rewardCodes = invitedRows.map((r) => r.rewardPromoCode).filter((c): c is string => !!c);
  const rewardCoupons = rewardCodes.length > 0
    ? await db
        .select({
          code: promoCodes.code,
          discountValue: promoCodes.discountValue,
          validUntil: promoCodes.validUntil,
          isActive: promoCodes.isActive,
        })
        .from(promoCodes)
        .where(sql`${promoCodes.code} IN (${sql.join(rewardCodes.map((c) => sql`${c}`), sql`, `)})`)
    : [];

  const [invitedRow] = await db
    .select({ friendPromoCode: referrals.friendPromoCode })
    .from(referrals)
    .where(eq(referrals.referredUserId, userId))
    .limit(1);

  let welcomeCoupon: ReferralOverview["welcomeCoupon"] = null;
  if (invitedRow?.friendPromoCode) {
    const [coupon] = await db
      .select({
        code: promoCodes.code,
        discountValue: promoCodes.discountValue,
        validUntil: promoCodes.validUntil,
        isActive: promoCodes.isActive,
      })
      .from(promoCodes)
      .where(eq(promoCodes.code, invitedRow.friendPromoCode))
      .limit(1);
    if (coupon) welcomeCoupon = coupon;
  }

  return {
    referralCode,
    invitedCount: invitedRows.length,
    rewardCoupons,
    welcomeCoupon,
  };
}
