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
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!env.isProduction) {
    // Development: Log email to console
    console.log(JSON.stringify({
      level: "info",
      timestamp: new Date().toISOString(),
      message: "📧 Email (dev mode — not sent)",
      to: message.to,
      subject: message.subject,
      textPreview: message.text.substring(0, 200),
    }));
    return true;
  }

  // Production: Use configured email provider
  if (env.RESEND_API_KEY) {
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
      console.error("[Email/Resend] Error " + response.status + ": " + errBody);
      return false;
    }
    return true;
  } else {
    console.error("No email provider configured (RESEND_API_KEY not set)");
    return false;
  }
}

/**
 * Generate a password reset token and send it to the user's email.
 * The token is stored in the database with an expiry time.
 */
export async function initiatePasswordReset(email: string, headers?: Headers): Promise<{
  success: boolean;
  message: string;
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

  if (!user || !user.email) {
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

   // Generate a secure reset token
   const resetToken = crypto.randomBytes(RESET_TOKEN_LENGTH).toString("hex");
   const resetTokenExpiry = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000);

   // Store the token hash (not the raw token) in the database
   // This way, even if the DB is compromised, tokens can't be used
   const tokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

   // ✅ FIXED: Use dedicated passwordResetToken column — don't overwrite avatar!
   await db
     .update(users)
     .set({
       passwordResetToken: tokenHash,
       passwordResetExpiresAt: resetTokenExpiry,
       updatedAt: new Date(),
     })
     .where(eq(users.id, user.id));

  // Build reset URL
  const resetUrl = `${getFrontendUrl(headers)}/reset-password?token=${resetToken}&uid=${user.id}`;

  // Send the reset email
  const name = (user.name || user.username).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const emailSent = await sendEmail({
    to: user.email,
    subject: "Password Reset — Ahmed Elbaz Electrical Engineering Platform",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #06b6d4;">Password Reset Request</h2>
        <p>Hello ${name},</p>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <a href="${resetUrl}" style="display: inline-block; background: #06b6d4; color: #0a0e17; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 16px 0;">
          Reset My Password
        </a>
        <p>This link expires in ${RESET_TOKEN_EXPIRY_MINUTES} minutes.</p>
        <p>If you didn't request this, you can safely ignore this email — your password will remain unchanged.</p>
        <hr style="border: none; border-top: 1px solid #1f2d44; margin: 24px 0;" />
        <p style="color: #64748b; font-size: 12px;">
          Ahmed Elbaz Electrical Engineering Platform<br />
          If the button doesn't work, copy this link: ${resetUrl}
        </p>
      </div>
    `,
    text: `Hello ${name},\n\nWe received a request to reset your password.\n\nReset link: ${resetUrl}\n\nThis link expires in ${RESET_TOKEN_EXPIRY_MINUTES} minutes.\n\nIf you didn't request this, ignore this email.`,
  });

  if (!emailSent) {
    console.error("[Email] Failed to send password reset email to:", user.email);
  }

  return { success: true, message: genericMessage };
}

/**
 * Verify a password reset token and update the user's password.
 */
export async function completePasswordReset(
  userId: number,
  token: string,
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

  // Check expiry
  if (!user.passwordResetExpiresAt || Date.now() > user.passwordResetExpiresAt.getTime()) {
    return { success: false, message: genericError };
  }

  // Verify token hash
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  if (!user.passwordResetToken || tokenHash !== user.passwordResetToken) {
    return { success: false, message: genericError };
  }

  // ✅ Hash the new password
  const { hashPassword } = await import("./password");
  const newHash = await hashPassword(newPassword);

  // Update password and clear the reset token (don't touch avatar!)
  await db
    .update(users)
    .set({
      passwordHash: newHash,
      tokenVersion: sql`${users.tokenVersion} + 1`, // Revoke all existing sessions
      passwordResetToken: null, // Clear reset token
      passwordResetExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

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

  // ✅ FIX: Store token hash + expiry in DB. Also store pending email if this is an email change.
  await db
    .update(users)
    .set({
      emailVerificationToken: tokenHash,
      emailVerificationExpiry: tokenExpiry,
      ...(newEmail ? { pendingEmail: newEmail } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  const verificationUrl = `${getFrontendUrl(headers)}/verify-email?token=${verificationToken}&uid=${userId}`;

  const name = (user.name || user.username).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const emailSubject = newEmail
    ? "Confirm Your New Email — Ahmed Elbaz Electrical Engineering Platform"
    : "Verify Your Email — Ahmed Elbaz Electrical Engineering Platform";

  const emailBody = newEmail
    ? `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #06b6d4;">Confirm Your New Email Address</h2>
        <p>Hello ${name},</p>
        <p>You requested to change your email address. Please confirm by clicking the button below:</p>
        <a href="${verificationUrl}" style="display: inline-block; background: #06b6d4; color: #0a0e17; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 16px 0;">
          Confirm New Email
        </a>
        <p>This link expires in ${EMAIL_VERIFICATION_EXPIRY_MINUTES} minutes.</p>
        <p>If you didn't request this change, your account is still safe — just ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #1f2d44; margin: 24px 0;" />
        <p style="color: #64748b; font-size: 12px;">
          Ahmed Elbaz Electrical Engineering Platform<br />
          If the button doesn't work, copy this link: ${verificationUrl}
        </p>
      </div>`
    : `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #06b6d4;">Verify Your Email Address</h2>
        <p>Hello ${name},</p>
        <p>Thank you for registering on the Ahmed Elbaz Electrical Engineering Platform. Please verify your email address by clicking the button below:</p>
        <a href="${verificationUrl}" style="display: inline-block; background: #06b6d4; color: #0a0e17; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; margin: 16px 0;">
          Verify My Email
        </a>
        <p>This link expires in ${EMAIL_VERIFICATION_EXPIRY_MINUTES} minutes.</p>
        <p>If you didn't create an account, you can safely ignore this email.</p>
        <hr style="border: none; border-top: 1px solid #1f2d44; margin: 24px 0;" />
        <p style="color: #64748b; font-size: 12px;">
          Ahmed Elbaz Electrical Engineering Platform<br />
          If the button doesn't work, copy this link: ${verificationUrl}
        </p>
      </div>`;

  const textBody = newEmail
    ? `Hello ${name},\n\nPlease confirm your new email address by clicking the link below:\n\n${verificationUrl}\n\nThis link expires in ${EMAIL_VERIFICATION_EXPIRY_MINUTES} minutes.\n\nIf you didn't request this change, ignore this email.`
    : `Hello ${name},\n\nPlease verify your email address by clicking the link below:\n\n${verificationUrl}\n\nThis link expires in ${EMAIL_VERIFICATION_EXPIRY_MINUTES} minutes.\n\nIf you didn't create an account, ignore this email.`;

  const emailSent = await sendEmail({
    to: targetEmail,
    subject: emailSubject,
    html: emailBody,
    text: textBody,
  });

  if (!emailSent) {
    console.error("[Email] Failed to send verification email to:", targetEmail);
    return { success: false, message: "Could not send verification email. Please try again later." };
  }

  return { success: true, message: "Verification email sent. Please check your inbox." };
}

export async function completeEmailVerification(
  userId: number,
  token: string,
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

  // ✅ FIX: Validate token exists and not expired
  if (!user.emailVerificationToken || !user.emailVerificationExpiry) {
    return { success: false, message: genericError };
  }

  if (Date.now() > user.emailVerificationExpiry.getTime()) {
    // Clear expired token
    await db.update(users).set({ emailVerificationToken: null, emailVerificationExpiry: null }).where(eq(users.id, userId));
    return { success: false, message: "Verification link has expired. Please request a new one." };
  }

  // ✅ FIX: Timing-safe comparison using SHA-256 hash
  const incomingHash = crypto.createHash("sha256").update(token).digest("hex");
  const storedHash = user.emailVerificationToken;

  let isValid = false;
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

  // ✅ Already verified? Return success (idempotent)
  if (user.emailVerifiedAt) {
    return { success: true, message: "Email already verified." };
  }

  // ✅ If there's a pending email change, apply it now
  const pendingEmail = user.pendingEmail || null;
  const updateData: Record<string, unknown> = {
    emailVerificationToken: null, // ✅ Single-use: clear token immediately
    emailVerificationExpiry: null,
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
