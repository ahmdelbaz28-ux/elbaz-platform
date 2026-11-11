import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { users, enrollments, lessonProgress, payments, certificates, supportTickets } from "@db/schema";
import { createRouter, publicQuery, authedQuery, checkRateLimit, clearRateLimit, authRateLimit } from "./middleware";
import { getDb } from "./queries/connection";
import { hashPassword, verifyPassword } from "./lib/password";
import { createToken } from "./lib/jwt";
import { initiatePasswordReset, completePasswordReset, initiateEmailVerification, completeEmailVerification } from "./lib/email";
// ✅ SECURITY FIX: Import auth cookie helpers for httpOnly cookie auth
import { serializeAuthCookie, serializeAuthFlagCookie, clearAuthCookies, AUTH_COOKIE_NAME } from "./lib/cookies";
import { parse as parseCookieHeader } from "cookie";
import { logger, maskEmail } from "./lib/logger";
import { getClientIpFromHeaders } from "./lib/client-ip";
// ✅ SECURITY FIX (pre-launch audit run-2): instant auth-cache eviction on
// every revocation site (logout / password change) — closes the 30s window.
import { evictUserAuthCache } from "./context.js";
// ✅ SECURITY FIX (audit run-1): enforce the enrolled second factor at login.
import { verifyTotp, hashToken } from "./twofa-router";
// Growth features: referral rewards + educational email drip.
import { applyReferral } from "./lib/referral";
import { maybeSendWelcomeEmail } from "./lib/email-drip";

// ─── Dummy hash for constant-time login ───────────────────────────────────────
// To prevent username enumeration via response timing, when a login attempt
// targets a user that does not exist we still run bcrypt against a valid hash.
// We deliberately do NOT hard-code any real hash here (SonarCloud S8215):
// instead we generate a fresh hash for a random nonce on first use. The hash
// is process-local, never persisted, and unique per cold start, so it cannot
// be used to authenticate even if leaked.
let _dummyHashPromise: Promise<string> | null = null;

/**
 * ✅ SECURITY FIX (audit run-1, native-client-detection-token-disclosure):
 * The JWT-in-body channel is reserved for genuine native shells. A web page
 * can trivially attach an `x-capacitor-platform` header, but it ALSO
 * automatically attaches the ambient HttpOnly auth cookie on same-origin
 * fetches — a real native shell never has one. Gate the body token on
 * header presence AND the absence of the auth cookie.
 */
export function isNativeTokenRequest(req: Request): boolean {
  if (!req.headers.get("x-capacitor-platform")) return false;
  const cookies = parseCookieHeader(req.headers.get("cookie") || "");
  if (cookies[AUTH_COOKIE_NAME]) return false; // web session present → never expose the JWT in the body
  return true;
}
function getDummyHash(): Promise<string> {
  if (!_dummyHashPromise) {
    const nonce = randomBytes(16).toString("hex");
    _dummyHashPromise = hashPassword(`dummy-${nonce}`).catch((err) => {
      logger.error("Failed to compute dummy bcrypt hash", { error: (err as Error).message });
      // Best-effort fallback: a clearly-invalid sentinel. verifyPassword will
      // throw, which we catch in the login flow, returning the same generic
      // "Invalid username or password" error the user would see anyway.
      return "$2a$12$invalidsentinel.invalidsentinel.invalidsentinel.invalidsentinel.invalidsentinel";
    });
  }
  return _dummyHashPromise;
}

// ─── Per-account login throttle (pre-launch audit run-2) ────────────────────
// The IP-keyed login bucket (10/15min) is defeated by a distributed or
// IP-rotating attacker who gets a fresh bucket per IP. This second, USERNAME-
// keyed bucket bounds failures per account regardless of source IP. The
// threshold is deliberately generous (20/15min) so it never locks out a real
// user, but makes online password stuffing uneconomical. The same message is
// returned for existing and non-existing usernames (both accumulate), so the
// throttle itself leaks no account existence. In-memory is fine: single-pod
// deployment, and a restart merely resets a soft throttle.
const ACCOUNT_LOGIN_WINDOW_MS = 15 * 60_000;
const ACCOUNT_LOGIN_MAX_FAILURES = 20;
const accountLoginFailures = new Map<string, { count: number; resetAt: number }>();

function recordAccountLoginFailure(username: string): void {
  const key = username.trim().toLowerCase().slice(0, 120);
  if (!key) return;
  const now = Date.now();
  const entry = accountLoginFailures.get(key);
  if (!entry || now > entry.resetAt) {
    accountLoginFailures.set(key, { count: 1, resetAt: now + ACCOUNT_LOGIN_WINDOW_MS });
    return;
  }
  entry.count++;
}

function isAccountLoginThrottled(username: string): boolean {
  const key = username.trim().toLowerCase().slice(0, 120);
  if (!key) return false;
  const entry = accountLoginFailures.get(key);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    accountLoginFailures.delete(key);
    return false;
  }
  return entry.count >= ACCOUNT_LOGIN_MAX_FAILURES;
}

function clearAccountLoginFailures(username: string): void {
  const key = username.trim().toLowerCase().slice(0, 120);
  if (key) accountLoginFailures.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of accountLoginFailures) {
    if (now > entry.resetAt) accountLoginFailures.delete(key);
  }
}, 5 * 60_000).unref();

// ─── 2FA backup-code consumption (audit run-1) ───────────────────────────────
// Single-use redemption of an 8-hex backup code during login. Mirrors the
// hashing used by twofa-router (HMAC with an APP_SECRET-derived key) and
// removes the used code so it can never be replayed.
// ✅ AUDIT RUN-2 FIX (backup-code race): the removal is now a conditional
// UPDATE — the JSON_CONTAINS predicate makes concurrent redemptions of the
// same code mutually exclusive (the loser affects 0 rows and is rejected).
async function consumeTotpBackupCode(userId: number, stored: unknown, code: string): Promise<boolean> {
  if (!code) return false;
  const codes = Array.isArray(stored) ? (stored as string[]) : [];
  const tokenHash = hashToken(code);
  if (!codes.includes(tokenHash)) return false;
  const result = await getDb()
    .update(users)
    .set({
      totpBackupCodes: sql`JSON_REMOVE(${users.totpBackupCodes}, JSON_UNQUOTE(JSON_SEARCH(${users.totpBackupCodes}, 'one', ${tokenHash})))`,
    })
    .where(and(eq(users.id, userId), sql`JSON_CONTAINS(${users.totpBackupCodes}, ${JSON.stringify(tokenHash)})`));
  const affected = Array.isArray(result) ? (result[0]?.affectedRows ?? 0) : 0;
  return affected > 0;
}

// ─── Shared Response Types ─────────────────────────────────────────────────────

interface AuthUser {
  id: number;
  username: string;
  name: string | null;
  email?: string | null;
  role?: string;
  avatar?: string | null;
}

interface AuthResponse {
  user: AuthUser;
  token?: string;
}

// ─── Helper: convert a registration DB error into the appropriate TRPCError ───
function toRegistrationTRPCError(err: unknown): TRPCError {
  if (err instanceof TRPCError) return err;
  const errMsg = (err as Error).message || String(err);
  logger.error("[Auth] DB insert error during registration", { error: errMsg });
  if (errMsg.includes("Duplicate") || errMsg.includes("UNIQUE") || errMsg.includes("unique")) {
    return new TRPCError({
      code: "CONFLICT",
      message: "Username or email already exists. Please choose different credentials.",
    });
  }
  if (errMsg.includes("ER_TOO_MANY") || errMsg.includes("max_connections") || errMsg.includes("Pool")) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Server is busy. Please try again in a moment.",
    });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Registration failed due to a server error. Please try again.",
  });
}

// ─── Helper: verify email uniqueness, throws CONFLICT TRPCError on collision ───
async function assertEmailUnique(db: ReturnType<typeof getDb>, safeEmail: string): Promise<void> {
  try {
    const existingEmail = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, safeEmail))
      .limit(1);

    if (existingEmail.length > 0) {
      throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    logger.error("[Auth] DB error checking email uniqueness", { error: (err as Error).message });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not verify email. Please try again.",
    });
  }
}

// ─── Helper: send verification email (non-blocking; logs failures) ───
async function sendVerificationEmailIfEligible(userId: number, safeEmail: string, headers: Headers): Promise<void> {
  try {
    const result = await initiateEmailVerification(userId, safeEmail, headers);
    if (result.success) {
      logger.info("Verification email sent", { userId, email: maskEmail(safeEmail) });
    } else {
      logger.warn("Verification email not sent", { userId, email: maskEmail(safeEmail), reason: result.message });
    }
  } catch (emailErr) {
    logger.error("Failed to send verification email", { userId, error: (emailErr as Error).message });
  }
}

// ───────────────────────────────────────────────────────────────────────────────

export const localAuthRouter = createRouter({
   register: publicQuery
     .use(authRateLimit('register'))
     .input(
       z.object({
         username: z.string()
           .min(3, "Username must be at least 3 characters")
           .max(30, "Username too long")
           .regex(/^[a-zA-Z0-9_\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+$/, "Username can only contain letters, numbers, and underscores (Arabic supported)"),
         password: z.string()
           .min(8, "Password must be at least 8 characters")
           .max(100)
           .regex(
             /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
             "Password must contain at least one uppercase letter, one lowercase letter, and one number"
           ),
         name: z.string().min(1).max(255).optional(),
         email: z.string().email("Invalid email format").optional().or(z.literal("")),
         /** Referral code from /register?ref=CODE — grants both parties coupons. */
         refCode: z.string().max(24).optional(),
       })
     )
     .mutation(async ({ ctx, input }): Promise<AuthResponse> => {
      const ip = getClientIpFromHeaders(ctx.req.headers);

      try {
        await checkRateLimit(ip, "register");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (rlErr: any) {
        const retrySec = Math.ceil((rlErr?.cause?.retryAfterMs ?? 60000) / 1000);
        logger.warn("Rate limited register attempt", { ip, retryAfterSec: retrySec });
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many registration attempts. Please wait ${retrySec} seconds before trying again.`,
          cause: { retryAfterMs: rlErr?.cause?.retryAfterMs },
        });
      }

      const db = getDb();
      const safeEmail = input.email && input.email.trim() !== "" ? input.email.trim() : null;

      try {
        const existing = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.username, input.username))
          .limit(1);

        if (existing.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });
        }

        if (safeEmail) {
          await assertEmailUnique(db, safeEmail);
        }

        const passwordHash = await hashPassword(input.password);

        let userId: number;
        try {
          const insertResult = await db.insert(users).values({
            username: input.username,
            passwordHash,
            name: input.name || input.username,
            email: safeEmail,
          });
          const resultArr = Array.isArray(insertResult) ? insertResult : [insertResult];
          userId = Number(resultArr[0]?.insertId);
          if (!userId || userId === 0 || !Number.isFinite(userId)) {
            logger.error("[Auth] Insert succeeded but insertId is invalid", { result: resultArr[0] });
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Registration failed. User was created but session could not be started. Please try logging in.",
            });
          }
        } catch (err) {
          throw toRegistrationTRPCError(err);
        }

        const token = await createToken({ userId, username: input.username, role: "user", tokenVersion: 0 });
        // clearRateLimit() is a synchronous void function; do not `await` it
        // (SonarCloud S4123: awaiting a non-Promise is a code smell).
        clearRateLimit(ip, "register");

        const authCookie = serializeAuthCookie(ctx.req.headers, token);
        const flagCookie = serializeAuthFlagCookie(ctx.req.headers);
        ctx.resHeaders.append("set-cookie", authCookie);
        ctx.resHeaders.append("set-cookie", flagCookie);

         const isMobile = isNativeTokenRequest(ctx.req);
         const responseData: AuthResponse = {
           user: { id: userId, username: input.username, name: input.name || input.username },
         };
         if (isMobile) {
           responseData.token = token;
         }

        // ── Send email verification if user registered with an email ────────
        // This is non-blocking — if email sending fails, registration still
        // succeeds. The user can request a new verification link from their
        // profile page. We just log the failure for the operator.
        if (safeEmail) {
          await sendVerificationEmailIfEligible(userId, safeEmail, ctx.req.headers);
        }

        // ── Referral attribution + reward coupons ───────────────────────────
        // MUST NOT block registration: any referral failure only costs the
        // reward, never the account.
        if (input.refCode && input.refCode.trim()) {
          try {
            await applyReferral(input.refCode, userId);
          } catch (refErr) {
            logger.warn("[Auth] referral attribution failed (registration continues)", {
              userId,
              error: refErr instanceof Error ? refErr.message : String(refErr),
            });
          }
        }

        // ── Educational drip: welcome email ─────────────────────────────────
        // Fire-and-forget; only users WITH an email address receive it.
        if (safeEmail) {
          void maybeSendWelcomeEmail(userId, input.username, safeEmail, input.name || input.username);
        }

        logger.info("Registration successful", { userId, username: input.username, email: maskEmail(safeEmail) });
        return responseData;
      } catch (err) {

        if (err instanceof TRPCError) throw err;
        logger.error("[Auth] Unexpected registration error", { error: err instanceof Error ? err.message : String(err) });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred during registration. Please try again.",
        });
      }
    }),

  login: publicQuery
    .use(authRateLimit('login'))
    .input(
      z.object({
        username: z.string().min(1),
        password: z.string().min(1),
        // "Remember me" flag — when true (default), the auth cookie gets a
        // 30-day maxAge. When false, no maxAge is set so the cookie becomes
        // a session cookie that's deleted when the browser closes.
        remember: z.boolean().optional().default(true),
        // ✅ SECURITY FIX (audit run-1): second factor for users with 2FA enabled.
        // Accepts both the 6-digit TOTP and the 8-hex backup codes the system issues.
        totpCode: z.string().min(6).max(8).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ip = getClientIpFromHeaders(ctx.req.headers);

      try {
        await checkRateLimit(ip, "login");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (rlErr: any) {
        const retrySec = Math.ceil((rlErr?.cause?.retryAfterMs ?? 60000) / 1000);
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `Too many login attempts. Please wait ${retrySec} seconds before trying again.`,
          cause: { retryAfterMs: rlErr?.cause?.retryAfterMs },
        });
      }

      const db = getDb();

      // ✅ SECURITY FIX (pre-launch audit run-2): per-account throttle — see
      // recordAccountLoginFailure above. Runs BEFORE the lookup so a throttled
      // account burns zero DB/bcrypt work.
      if (isAccountLoginThrottled(input.username)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Too many failed attempts. Please try again later.",
        });
      }

      let user: (typeof users.$inferSelect) | undefined;
      try {
        const results = await db
          .select()
          .from(users)
          .where(eq(users.username, input.username))
          .limit(1);
        user = results[0];
      } catch (err) {
        logger.error("[Auth] DB error during login lookup", { error: (err as Error).message });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not verify credentials. Please try again.",
        });
      }

      // ✅ SECURITY FIX: To equalise response timing and prevent username
      // enumeration, we run bcrypt against a *real* hash even when the user
      // does not exist. The hash is generated lazily for a random nonce at
      // first use (see getDummyHash above) so that no real password hash is
      // ever disclosed in source code (SonarCloud S8215).
      const dummyHash = await getDummyHash();
      let valid = false;
      try {
        valid = user
          ? await verifyPassword(input.password, user.passwordHash ?? "")
          : await verifyPassword(input.password, dummyHash).then(() => false);
      } catch (err) {
        logger.error("[Auth] Password verification error", { error: (err as Error).message });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not verify password. Please try again.",
        });
      }

      if (!user || !valid) {
        recordAccountLoginFailure(input.username);
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username or password",
        });
      }

      // ✅ SECURITY FIX (audit run-1): ENFORCE THE ENROLLED SECOND FACTOR.
      // Previously login issued the session JWT without ever reading
      // users.totpEnabled — password alone granted a full 7-day session even
      // for accounts that completed 2FA enrollment. The same generic
      // "Invalid username or password" is returned when a code is missing or
      // wrong so this endpoint does not become a 2FA-state oracle.
      if (user.totpEnabled) {
        const code = input.totpCode?.replaceAll(/\s/g, "") ?? "";
        const totpOk = code.length > 0 && !!user.totpSecret && verifyTotp(user.totpSecret, code);
        const backupOk = totpOk ? false : await consumeTotpBackupCode(user.id, user.totpBackupCodes, code);
        if (!totpOk && !backupOk) {
          recordAccountLoginFailure(input.username);
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid username or password",
          });
        }
      }

      // ✅ SECURITY: Increment tokenVersion on every login (Single Device Policy)
      // This forces a "Single Session" rule: when a user logs in on a new device,
      // all previous sessions are immediately invalidated. This is critical for 
      // LMS business models to prevent account sharing.
      const newTokenVersion = user.tokenVersion + 1;

      await db
        .update(users)
        .set({ 
          lastSignInAt: new Date(),
          tokenVersion: newTokenVersion 
        })
        .where(eq(users.id, user.id));

      const token = await createToken({
        userId: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: newTokenVersion,
      });

      // ✅ Clear rate limit on success
      const loginIp = getClientIpFromHeaders(ctx.req.headers);
      // clearRateLimit() is synchronous; no `await` needed (SonarCloud S4123).
      clearRateLimit(loginIp, "login");
      clearAccountLoginFailures(input.username);

      // ✅ SECURITY FIX: Set JWT in httpOnly cookie instead of returning only in body
      const remember = input.remember !== false; // default true
      const authCookie = serializeAuthCookie(ctx.req.headers, token, remember);
      const flagCookie = serializeAuthFlagCookie(ctx.req.headers, remember);
      ctx.resHeaders.append("set-cookie", authCookie);
      ctx.resHeaders.append("set-cookie", flagCookie);

       // ✅ SECURITY FIX: Only return token in body for Capacitor/mobile apps
       const isMobile = isNativeTokenRequest(ctx.req);
       const loginData: AuthResponse = {
         user: {
           id: user.id,
           username: user.username,
           name: user.name,
           email: user.email,
           role: user.role,
           avatar: user.avatar,
         },
       };
       if (isMobile) {
         loginData.token = token;
       }

      return loginData;
    }),

   me: authedQuery.query(({ ctx }) => ctx.user),

  updateProfile: authedQuery
    .input(
      z.object({
        name: z.string().min(1).max(255).optional(),
        email: z.string().email().optional(),
        preferredLanguage: z.enum(["en", "ar"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // ✅ SECURITY FIX: Email change requires verification — prevents account hijacking
      // Instead of changing the email directly, we store a pending email and send a
      // verification link. The email is only updated after the user clicks the link.
      if (input.email) {
        const existingEmail = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, input.email))
          .limit(1);

        if (existingEmail.length > 0 && existingEmail[0].id !== ctx.user.id) {
          throw new TRPCError({ code: "CONFLICT", message: "Email already in use by another account" });
        }

        if (input.email.toLowerCase() !== (ctx.user.email || "").toLowerCase()) {
          // Send verification email to the NEW address
          await initiateEmailVerification(ctx.user.id, input.email, ctx.req.headers);
          return { success: true, emailVerificationRequired: true, message: "A verification link has been sent to your new email address. Please click it to confirm the change." };
        }
      }

      await db
        .update(users)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.preferredLanguage !== undefined && { preferredLanguage: input.preferredLanguage }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.user.id));

      return { success: true };
    }),

  changePassword: authedQuery
    .input(
      z.object({
        currentPassword: z.string().min(1),
        newPassword: z.string()
          .min(8, "Password must be at least 8 characters")
          .max(100)
          .regex(
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
            "Password must contain at least one uppercase letter, one lowercase letter, and one number"
          ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [user] = await db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1);

      const valid = await verifyPassword(input.currentPassword, user.passwordHash ?? "");
      if (!valid) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Current password is incorrect" });
      }

      const newHash = await hashPassword(input.newPassword);
      // ✅ SECURITY FIX: Increment tokenVersion on password change — invalidates all existing tokens
      await db
        .update(users)
        .set({
          passwordHash: newHash,
          tokenVersion: sql`${users.tokenVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.user.id));
      // ✅ SECURITY FIX (pre-launch audit run-2): drop the 30s cache window.
      evictUserAuthCache(ctx.user.id);

      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════
  // ✅ CRITICAL FIX: Password Reset Flow
  // Previously, users who forgot their password were permanently locked out!
  // ═══════════════════════════════════════════════════════════

  // Step 1: Request password reset (sends email with reset link)
  forgotPassword: publicQuery
    .use(authRateLimit('forgotPassword'))
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      // ✅ FIXED: Use dedicated rate limit for forgotPassword (not shared with register)
      const ip = getClientIpFromHeaders(ctx.req.headers);
      await checkRateLimit(ip, "forgotPassword");

      const result = await initiatePasswordReset(input.email, ctx.req.headers);
      return result;
    }),

  // Step 2: Complete password reset (verify token + set new password)
  resetPassword: publicQuery
    .use(authRateLimit('resetPassword'))
    .input(z.object({
      userId: z.number().int().positive(),
      token: z.string().min(1),
      newPassword: z.string()
          .min(8, "Password must be at least 8 characters")
          .max(100)
          .regex(
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
            "Password must contain at least one uppercase letter, one lowercase letter, and one number"
          ),
    }))
    .mutation(async ({ ctx, input }) => {
      // ✅ FIXED: Add rate limiting to resetPassword to prevent brute-force
      const ip = getClientIpFromHeaders(ctx.req.headers);
      await checkRateLimit(ip, "resetPassword");

      const result = await completePasswordReset(
        input.userId,
        input.token,
        input.newPassword,
      );

      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }

      return result;
    }),


  // GDPR Data Export — allows users to download all their personal data
  exportUserData: authedQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    const userId = ctx.user.id;

    // Collect all user-related data from every table
    const [userData] = await db
      .select({ id: users.id, username: users.username, name: users.name, email: users.email, role: users.role, preferredLanguage: users.preferredLanguage, createdAt: users.createdAt, lastSignInAt: users.lastSignInAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const userEnrollments = await db.select().from(enrollments).where(eq(enrollments.userId, userId));
    const userProgress = await db.select().from(lessonProgress).where(eq(lessonProgress.userId, userId));
    const userPayments = await db.select({ id: payments.id, courseId: payments.courseId, amount: payments.amount, currency: payments.currency, paymentMethod: payments.paymentMethod, status: payments.status, createdAt: payments.createdAt, paidAt: payments.paidAt }).from(payments).where(eq(payments.userId, userId));
    const userCertificates = await db.select().from(certificates).where(eq(certificates.userId, userId));
    const userTickets = await db.select({ id: supportTickets.id, subject: supportTickets.subject, category: supportTickets.category, status: supportTickets.status, createdAt: supportTickets.createdAt }).from(supportTickets).where(eq(supportTickets.userId, userId));

    return {
      exportedAt: new Date().toISOString(),
      user: userData,
      enrollments: userEnrollments,
      lessonProgress: userProgress,
      payments: userPayments,
      certificates: userCertificates,
      supportTickets: userTickets,
    };
  }),

  // ✅ SECURITY FIX: Logout mutation — clears httpOnly auth cookie properly
  // Uses clearAuthCookies() which returns an array so each Set-Cookie is sent separately (RFC 7230)
  logout: authedQuery.mutation(async ({ ctx }) => {
    // ✅ SECURITY FIX (audit run-1): server-side invalidation. Clearing the
    // cookie alone left the JWT fully valid until its 7-day expiry (and
    // self-renewing) — logout must mutate the state the auth boundary checks.
    await getDb()
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, ctx.user.id));
    // ✅ SECURITY FIX (pre-launch audit run-2): drop the 30s cache window.
    evictUserAuthCache(ctx.user.id);
    const clearedCookies = clearAuthCookies(ctx.req.headers);
    for (const c of clearedCookies) {
      ctx.resHeaders.append("set-cookie", c);
    }
    return { success: true };
  }),

  // ═══════════════════════════════════════════════════════════════════════
  // ✅ Email Verification Flow
  // Backend functions existed in email.ts but were dead code — no endpoints
  // ═══════════════════════════════════════════════════════════════════════

  // Step 1: Authenticated user requests a verification email
  sendVerificationEmail: authedQuery.mutation(async ({ ctx }) => {
    const ip = getClientIpFromHeaders(ctx.req.headers);
    await checkRateLimit(ip, "sendVerification");

    const result = await initiateEmailVerification(ctx.user.id, undefined, ctx.req.headers);
    return result;
  }),

  // Step 2: Anyone with a valid token completes verification (e.g. from email link)
  // ✅ FIX: Added rate limiting to prevent brute-force attacks
  verifyEmail: publicQuery
    .use(authRateLimit('verifyEmail'))
    .input(z.object({
      userId: z.number().int().positive(),
      token: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      // ✅ SECURITY FIX: Rate limit to prevent brute-force token guessing
      const ip = getClientIpFromHeaders(ctx.req.headers);
      await checkRateLimit(ip, "verifyEmail");

      const result = await completeEmailVerification(input.userId, input.token);

      if (!result.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }

      return result;
    }),
});
