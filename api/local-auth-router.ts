import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { users, enrollments, lessonProgress, payments, certificates, supportTickets } from "@db/schema";
import { createRouter, publicQuery, authedQuery, checkRateLimit, clearRateLimit, authRateLimit } from "./middleware";
import { getDb } from "./queries/connection";
import { hashPassword, verifyPassword } from "./lib/password";
import { createToken } from "./lib/jwt";
import { initiatePasswordReset, completePasswordReset, initiateEmailVerification, completeEmailVerification } from "./lib/email";
// ✅ SECURITY FIX: Import auth cookie helpers for httpOnly cookie auth
import { serializeAuthCookie, serializeAuthFlagCookie, clearAuthCookies } from "./lib/cookies";
import { logger } from "./lib/logger";
import { getClientIpFromHeaders } from "./lib/client-ip";

// ─── Dummy hash for constant-time login ───────────────────────────────────────
// To prevent username enumeration via response timing, when a login attempt
// targets a user that does not exist we still run bcrypt against a valid hash.
// We deliberately do NOT hard-code any real hash here (SonarCloud S8215):
// instead we generate a fresh hash for a random nonce on first use. The hash
// is process-local, never persisted, and unique per cold start, so it cannot
// be used to authenticate even if leaked.
let _dummyHashPromise: Promise<string> | null = null;
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
      logger.info("Verification email sent", { userId, email: safeEmail });
    } else {
      logger.warn("Verification email not sent", { userId, email: safeEmail, reason: result.message });
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

         const isMobile = ctx.req.headers.get("x-capacitor-platform") !== null;
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

        logger.info("Registration successful", { userId, username: input.username, email: safeEmail });
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
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid username or password",
        });
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

      // ✅ SECURITY FIX: Set JWT in httpOnly cookie instead of returning only in body
      const remember = input.remember !== false; // default true
      const authCookie = serializeAuthCookie(ctx.req.headers, token, remember);
      const flagCookie = serializeAuthFlagCookie(ctx.req.headers, remember);
      ctx.resHeaders.append("set-cookie", authCookie);
      ctx.resHeaders.append("set-cookie", flagCookie);

       // ✅ SECURITY FIX: Only return token in body for Capacitor/mobile apps
       const isMobile = ctx.req.headers.get("x-capacitor-platform") !== null;
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
