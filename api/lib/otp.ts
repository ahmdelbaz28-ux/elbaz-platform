/**
 * OTP helper — 6-digit email confirmation codes.
 *
 * Why: users think of email confirmation in terms of a CODE (رمز التأكيد),
 * not a link. The emails now carry BOTH: a prominent 6-digit code (typed in
 * the UI) and the classic one-click link. Both verify through the same
 * hardened storage: SHA-256 hash of the code is persisted, the raw code
 * never touches the database.
 *
 * Security posture (audited design, kept intact):
 * - Entropy: 100000-999999 (uniform, no leading-zero ambiguity).
 * - Attempts: 5 wrong entries invalidate the code (user must resend).
 * - Rate limits: authRateLimit('verifyEmail' | 'resetPassword') per IP on
 *   top — brute-forcing 900k codes through 20 req/15min/IP is impractical.
 * - Expiry: shared with the parent token (15 min reset / 30 min verify).
 * - Single-use: cleared on success, invalidated on attempt exhaustion.
 */

import crypto from "node:crypto";

/** Wrong-entry attempts allowed before the code is invalidated. */
export const OTP_MAX_ATTEMPTS = 5;

/** True when the string looks exactly like a 6-digit confirmation code. */
export function isOtpFormat(value: string): boolean {
  return /^\d{6}$/.test(value);
}

/**
 * Generate a uniformly random 6-digit code (100000-999999).
 * Rejection sampling avoids modulo bias of `random % 900000 + 100000`.
 */
export function generateOtpCode(): string {
  const min = 100000;
  const span = 900000;
  // Largest multiple of span below 2^32 keeps rejection probability tiny.
  const limit = Math.floor(0x100000000 / span) * span;
  for (;;) {
    const n = crypto.randomBytes(4).readUInt32BE(0);
    if (n < limit) {
      return String(min + (n % span));
    }
  }
}

/** SHA-256 of the code — the only form ever persisted. */
export function hashOtpCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Register a wrong attempt. Returns true when the code must be invalidated
 * (attempt budget exhausted). Attempts count is stored next to the hash.
 */
export function otpAttemptsExhaustedAfterFailure(previousAttempts: number): boolean {
  return previousAttempts + 1 >= OTP_MAX_ATTEMPTS;
}
