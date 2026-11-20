/**
 * Email & Password Reset System
 *
 * 🟠 CRITICAL FIX: Previously, users who forgot their password were permanently
 * locked out — no reset mechanism existed. This module provides:
 *
 * 1. Password reset token generation & verification
 * 2. Email sending abstraction (configurable provider)
 * 3. Token expiry (15 minutes) + single-use enforcement
 *
 * Email Provider Options:
 * - Development: Console logger (prints emails to terminal)
 * - Production: SendGrid / Mailgun / AWS SES / Resend
 */

import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { users } from "@db/schema";
import { env, getActiveFrontendUrl } from "./env";
import { logger, maskEmail } from "./logger.js";
import { generateOtpCode, hashOtpCode, isOtpFormat, otpAttemptsExhaustedAfterFailure, OTP_MAX_ATTEMPTS } from "./otp.js";
import { buildResetEmail, buildVerificationEmail } from "./email-templates.js";
// ✅ SECURITY FIX (pre-launch audit run-2): instant cache eviction after
// password reset revokes sessions (no 30s cache window for the old JWT).
// Import direction is safe: context.ts does not import email.ts.
import { evictUserAuthCache } from "../context.js";

// ─── Configuration ───
const RESET_TOKEN_EXPIRY_MINUTES = 15;
const RESET_TOKEN_LENGTH = 32;
const EMAIL_VERIFICATION_EXPIRY_MINUTES = 30;
const EMAIL_VERIFICATION_TOKEN_LENGTH = 32;

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function getFrontendUrl(headers?: Headers): string {
  if (!headers) return env.FRONTEND_URL;
  const forwardedHost = headers.get("x-forwarded-host");
  const host = forwardedHost || headers.get("host");
  if (!host) return env.FRONTEND_URL;
  const protocol = headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return getActiveFrontendUrl(`${protocol}://${host}`);
}

/**
 * Send an email using the configured provider.
 * In development, just logs to console.
 * In production, use a real email service.
 *
 * Returns an object with `ok` + optional diagnostics so callers can surface
 * a useful error to the user (e.g. Resend sandbox limitation).
 */
export interface SendEmailResult {
  ok: boolean;
  /** Human-readable reason for failure (safe to log + show in dev mode). */
  reason?: string;
  /** True if the failure is due to Resend's sandbox / unverified domain. */
  needsDomainVerification?: boolean;
}

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const result = await sendEmailWithDiagnostics(message);
  return result.ok;
}

export async function sendEmailWithDiagnostics(message: EmailMessage): Promise<SendEmailResult> {
  if (!env.isProduction) {
    // Development: Log email to console
    logger.info("📧 Email (dev mode — not sent)", {
      to: message.to,
      subject: message.subject,
      textPreview: message.text.substring(0, 200),
    });
    return { ok: true };
  }

  // Production: Use configured email provider
  if (!env.RESEND_API_KEY) {
    logger.error("No email provider configured (RESEND_API_KEY not set)");
    return { ok: false, reason: "Email service not configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Ahmed Elbaz Platform <${env.RESEND_FROM_EMAIL}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    // Bound the upstream payload before it enters the log stream — never
    // dump an unbounded provider response (PII/secret hygiene).
    logger.error("[Email/Resend] Error", { status: response.status, body: errBody.slice(0, 300) });

    // Detect Resend's "sandbox / unverified domain" 403 error so the caller
    // can tell the user the actual reason instead of a generic "email sent".
    // Example Resend 403 body:
    //   {"statusCode":403,"name":"validation_error",
    //    "message":"You can only send testing emails to your own email
    //    address (you@example.com). To send emails to other recipients,
    //    please verify a domain at resend.com/domains"}
    const isSandboxBlock =
      response.status === 403 &&
      (errBody.includes("testing emails") || errBody.includes("verify a domain"));

    // 🩺 ADMIN DIAGNOSTICS (2026-11-16: live probe captured `422`): include a
    // SHORT, sanitized slice of the provider's own error message so the
    // admin self-test shows the exact validation cause (e.g. "Invalid from
    // field"). Bounded + whitespace-flattened — never a raw dump, and it is
    // rendered to the ADMIN only.
    const bodySnippet = errBody.replace(/\s+/g, " ").trim().slice(0, 200);

    return {
      ok: false,
      reason: isSandboxBlock
        ? "Resend domain not verified — sandbox mode only allows sending to the account owner's email."
        : `Resend API error ${response.status}${bodySnippet ? `: ${bodySnippet}` : ""}`,
      needsDomainVerification: isSandboxBlock,
    };
  }

  return { ok: true };
}

/**
 * Generate a password reset token and send it to the user's email.
 * The token is stored in the database with an expiry time.
 */
export async function initiatePasswordReset(email: string, headers?: Headers): Promise<{
  success: boolean;
  message: string;
  /** Present only when the email couldn't actually be delivered (e.g. Resend
   *  sandbox mode). Frontend can show this as a warning to the user. */
  deliveryWarning?: string;
  /** Present only when email delivery failed. Contains the actual reset URL
   *  so the user can reset their password directly without email. This is
   *  a pragmatic fallback for when email isn't set up — the link is
   *  single-use and expires in 15 minutes. */
  recoveryLink?: string;
}> {
  const db = getDb();

  // Find user by email
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, username: users.username })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // ✅ SECURITY: Always return the same message whether email exists or not
  // This prevents email enumeration attacks
  const genericMessage = "If an account with this email exists, a reset link has been sent.";

  if (!user?.email) {
    // Don't reveal whether the email exists
    return { success: true, message: genericMessage };
  }

   // ✅ SECURITY: Clear any existing reset tokens before creating a new one
   // Ensures only the latest reset token is valid (prevents old tokens from being used)
   await db
     .update(users)
     .set({
       passwordResetToken: null,
       passwordResetExpiresAt: null,
       updatedAt: new Date(),
     })
     .where(eq(users.id, user.id));

   // Generate a secure reset token + a 6-digit confirmation code.
   // Both lead to the same completion path: the link carries the token, the
   // UI accepts the code — hash-only storage for either.
   const resetToken = crypto.randomBytes(RESET_TOKEN_LENGTH).toString("hex");
   const resetTokenExpiry = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);
   const otpCode = generateOtpCode();

   // Store the token hash (not the raw token) in the database
   // This way, even if the DB is compromised, tokens can't be used
   const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

   // ✅ FIXED: Use dedicated passwordResetToken column — don't overwrite avatar!
   await db
     .update(users)
     .set({
       passwordResetToken: tokenHash,
       passwordResetExpiresAt: resetTokenExpiry,
       passwordOtpCode: hashOtpCode(otpCode),
       passwordOtpAttempts: 0,
       updatedAt: new Date(),
     })
     .where(eq(users.id, user.id));

  // Build reset URL
  const resetUrl = `${getFrontendUrl(headers)}/reset-password?token=${resetToken}&uid=${user.id}`;

  // Send the reset email (Arabic-first RTL template: big 6-digit code + link)
  const name = user.name || user.username || "";
  const template = buildResetEmail(name, resetUrl, otpCode, RESET_TOKEN_EXPIRY_MINUTES);
  const sendResult = await sendEmailWithDiagnostics({
    to: user.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });

  if (!sendResult.ok) {
    // ✅ SECURITY FIX (pre-launch audit run-2, logs.reset-token): the recovery
    // log previously printed the LIVE reset URL — a working account-takeover
    // link readable by anyone with log access during a mail outage. Only a
    // short, non-functional reference is logged now: hash prefix + expiry.
    // Operator recovery: use the admin password-reset tool, or extend this
    // helper to re-send via a second channel.
    logger.error("[Email] Failed to send password reset email", { to: maskEmail(user.email), reason: sendResult.reason });
    // 🔒 SECURITY FIX (Task ID 3): NEVER surface the reset URL in the API response.
    // Previously this returned `recoveryLink: resetUrl` which allowed anyone who
    // knows a user's email to trigger a reset and immediately receive the live
    // reset token in the JSON response — a complete account-takeover primitive.
    // The reset link is now ONLY delivered via email.
    logger.warn(`[Email/Recovery] Password reset email FAILED — a reset token was minted and is valid for ${RESET_TOKEN_EXPIRY_MINUTES} minutes (token hash prefix logged for correlation only)`, { to: maskEmail(user.email), tokenHashPrefix: tokenHash.slice(0, 8) });
    return {
      success: true,
      message: genericMessage,
      deliveryWarning: sendResult.needsDomainVerification
        ? "Email delivery is currently limited (email domain not verified). Please contact support to reset your password."
        : "Password reset email could not be delivered. Please try again later or contact support.",
    };
  }

  return { success: true, message: genericMessage };
}

/**
 * 🩺 Admin-only message augmentation: appends the safe, curated provider
 * failure reason to the generic user-facing message. Regular users NEVER see
 * the provider reason (no operational intel leaks); the admin — who must be
 * able to fix delivery — does.
 */
export function augmentAdminEmailMessage(baseMessage: string, providerReason?: string): string {
  if (!providerReason) return baseMessage;
  return `${baseMessage} [provider: ${providerReason}]`;
}

/**
 * Verify a password reset token OR 6-digit code and update the user's password.
 * `tokenOrCode` is the 64-hex token from the email link, or the 6-digit code
 * typed into the UI. Both fail with the SAME generic message (no probing).
 */
export async function completePasswordReset(
  userId: number,
  tokenOrCode: string,
  newPassword: string,
): Promise<{ success: boolean; message: string }> {
  const db = getDb();

  // Find the user
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // ✅ FIXED: All failures return the same generic message to prevent enumeration
  const genericError = "This reset link is invalid or has expired";

  if (!user) {
    return { success: false, message: genericError };
  }

  // Check expiry (token and code share the same window)
  if (!user.passwordResetExpiresAt || Date.now() > user.passwordResetExpiresAt.getTime()) {
    return { success: false, message: genericError };
  }

  if (isOtpFormat(tokenOrCode)) {
    // ── 6-digit code path ──
    if (!user.passwordOtpCode) return { success: false, message: genericError };
    if (user.passwordOtpAttempts >= OTP_MAX_ATTEMPTS) {
      // Attempt budget spent — invalidate the code (the link stays valid).
      await db.update(users).set({ passwordOtpCode: null, passwordOtpAttempts: 0 }).where(eq(users.id, userId));
      return { success: false, message: genericError };
    }
    const incomingHash = hashOtpCode(tokenOrCode);
    const a = Buffer.from(incomingHash, "utf8");
    const b = Buffer.from(user.passwordOtpCode, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const exhausted = otpAttemptsExhaustedAfterFailure(user.passwordOtpAttempts);
      await db
        .update(users)
        .set({ passwordOtpAttempts: exhausted ? 0 : user.passwordOtpAttempts + 1, ...(exhausted ? { passwordOtpCode: null } : {}) })
        .where(eq(users.id, userId));
      return { success: false, message: genericError };
    }
  } else {
    // ── Link-token path ──
    // Verify token hash
    const tokenHash = crypto.createHash("sha256").update(tokenOrCode).digest("hex");
    // ✅ SECURITY FIX (pre-launch audit run-2, reset.timing-safe-compare): use
    // timingSafeEqual for the stored-hash comparison, matching verifyEmail's
    // hardened path. The hash is of a 256-bit random token so the practical
    // risk was nil, but consistency costs nothing.
    const a = Buffer.from(tokenHash, "utf8");
    const b = Buffer.from(user.passwordResetToken ?? "", "utf8");
    if (!user.passwordResetToken || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { success: false, message: genericError };
    }
  }

  // ✅ Hash the new password
  const { hashPassword } = await import("./password");
  const newHash = await hashPassword(newPassword);

  // Update password and clear the reset credentials (don't touch avatar!)
  await db
    .update(users)
    .set({
      passwordHash: newHash,
      tokenVersion: sql`${users.tokenVersion} + 1`, // Revoke all existing sessions
      passwordResetToken: null, // Clear reset token
      passwordResetExpiresAt: null,
      passwordOtpCode: null, // Clear reset code
      passwordOtpAttempts: 0,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  // ✅ SECURITY FIX (pre-launch audit run-2): evict the auth cache so the
  // tokenVersion bump is honored on the very next request, not up to 30s later.
  evictUserAuthCache(userId);

  return { success: true, message: "Password has been reset successfully. Please log in with your new password." };
}

/**
 * ✅ FIX: Support both initial verification AND email change verification.
 * When `newEmail` is provided, the verification email is sent to the new address
 * and the pending email is stored separately until confirmed.
 */
export async function initiateEmailVerification(userId: number, newEmail?: string, headers?: Headers): Promise<{
  success: boolean;
  message: string;
  /** True when the provider refused because the sending domain is not
   *  verified (Resend sandbox). Surfaced so the UI can tell the truth. */
  needsDomainVerification?: boolean;
  /** Safe, curated provider-failure reason (never a raw upstream body).
   *  Rendered ONLY to admins — regular users get the generic message. */
  providerReason?: string;
}> {
  const db = getDb();

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, username: users.username })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return { success: false, message: "User not found." };
  }

  const targetEmail = newEmail || user.email;

  if (!targetEmail) {
    return { success: false, message: "No email address associated with this account." };
  }

  const verificationToken = crypto.randomBytes(EMAIL_VERIFICATION_TOKEN_LENGTH).toString("hex");
  // ✅ FIX: Store SHA-256 hash of token in DB (never store raw tokens)
  const tokenHash = crypto.createHash("sha256").update(verificationToken).digest("hex");
  const tokenExpiry = new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MINUTES * 60 * 1000);
  const otpCode = generateOtpCode();

  // ✅ FIX: Store token hash + OTP hash + expiry in DB. Also store pending email if this is an email change.
  await db
    .update(users)
    .set({
      emailVerificationToken: tokenHash,
      emailVerificationExpiry: tokenExpiry,
      emailOtpCode: hashOtpCode(otpCode),
      emailOtpAttempts: 0,
      ...(newEmail ? { pendingEmail: newEmail } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const verificationUrl = `${getFrontendUrl(headers)}/verify-email?token=${verificationToken}&uid=${userId}`;

  const name = user.name || user.username || "";

  const template = buildVerificationEmail(name, verificationUrl, otpCode, EMAIL_VERIFICATION_EXPIRY_MINUTES, Boolean(newEmail));

  const sendResult = await sendEmailWithDiagnostics({
    to: targetEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });

  if (!sendResult.ok) {
    // ✅ SECURITY FIX (pre-launch audit run-2, logs.verify-token): same rule as
    // the reset link — never log the live verification URL. Hash prefix only.
    logger.error("[Email] Failed to send verification email", { to: maskEmail(targetEmail), reason: sendResult.reason });
    logger.warn(`[Email/Recovery] Verification email FAILED — a verification token was minted and is valid for ${EMAIL_VERIFICATION_EXPIRY_MINUTES} minutes (token hash prefix logged for correlation only)`, { to: maskEmail(targetEmail), userId, tokenHashPrefix: tokenHash.slice(0, 8) });
    return {
      success: false,
      message: "Could not send verification email. Please try again later.",
      // 🩺 OWNER DIAGNOSTIC (2026-11-16: "verification email never arrives"):
      // classify the provider failure so the UI can be truthful and the
      // ADMIN can see the exact cause (invalid API key vs unverified domain
      // vs provider outage) instead of a dead-end generic message.
      needsDomainVerification: sendResult.needsDomainVerification ?? false,
      providerReason: sendResult.reason ?? "unknown provider error",
    };
  }

  return { success: true, message: "Verification email sent. Please check your inbox." };
}

export async function completeEmailVerification(
  userId: number,
  tokenOrCode: string,
): Promise<{ success: boolean; message: string }> {
  const db = getDb();

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const genericError = "Invalid or expired verification link. Please request a new one.";

  if (!user) {
    return { success: false, message: genericError };
  }

  // ✅ FIX: Validate credential exists and not expired (token and code share the window)
  if (!user.emailVerificationToken || !user.emailVerificationExpiry) {
    return { success: false, message: genericError };
  }

  if (Date.now() > user.emailVerificationExpiry.getTime()) {
    // Clear expired credentials
    await db.update(users).set({ emailVerificationToken: null, emailVerificationExpiry: null, emailOtpCode: null, emailOtpAttempts: 0 }).where(eq(users.id, userId));
    return { success: false, message: "Verification link has expired. Please request a new one." };
  }

  let isValid = false;
  if (isOtpFormat(tokenOrCode)) {
    // ── 6-digit code path ──
    if (!user.emailOtpCode) return { success: false, message: genericError };
    if (user.emailOtpAttempts >= OTP_MAX_ATTEMPTS) {
      // Attempt budget spent — invalidate the code (the link stays valid).
      await db.update(users).set({ emailOtpCode: null, emailOtpAttempts: 0 }).where(eq(users.id, userId));
      return { success: false, message: genericError };
    }
    const incomingHash = hashOtpCode(tokenOrCode);
    try {
      isValid = crypto.timingSafeEqual(
        Buffer.from(incomingHash, "utf8"),
        Buffer.from(user.emailOtpCode, "utf8"),
      );
    } catch {
      return { success: false, message: genericError };
    }
    if (!isValid) {
      const exhausted = otpAttemptsExhaustedAfterFailure(user.emailOtpAttempts);
      await db
        .update(users)
        .set({ emailOtpAttempts: exhausted ? 0 : user.emailOtpAttempts + 1, ...(exhausted ? { emailOtpCode: null } : {}) })
        .where(eq(users.id, userId));
      return { success: false, message: genericError };
    }
  } else {
    // ── Link-token path ──
    // ✅ FIX: Timing-safe comparison using SHA-256 hash
    const incomingHash = crypto.createHash("sha256").update(tokenOrCode).digest("hex");
    const storedHash = user.emailVerificationToken;

    try {
      isValid = crypto.timingSafeEqual(
        Buffer.from(incomingHash, "hex"),
        Buffer.from(storedHash, "hex"),
      );
    } catch {
      return { success: false, message: genericError };
    }

    if (!isValid) {
      return { success: false, message: genericError };
    }
  }

  // ✅ Already verified? Return success (idempotent)
  if (user.emailVerifiedAt) {
    return { success: true, message: "Email already verified." };
  }

  // ✅ If there's a pending email change, apply it now
  const pendingEmail = user.pendingEmail || null;
  const updateData: Record<string, unknown> = {
    emailVerificationToken: null, // ✅ Single-use: clear token immediately
    emailVerificationExpiry: null,
    emailOtpCode: null, // ✅ Single-use: clear code immediately
    emailOtpAttempts: 0,
    emailVerifiedAt: new Date(),
    updatedAt: new Date(),
  };

  if (pendingEmail) {
    updateData.email = pendingEmail;
    updateData.pendingEmail = null;
  }

  await db.update(users).set(updateData).where(eq(users.id, userId));

  const message = pendingEmail
    ? "Email address updated and verified successfully."
    : "Email verified successfully. Your account is now fully secured.";

  return { success: true, message };
}
