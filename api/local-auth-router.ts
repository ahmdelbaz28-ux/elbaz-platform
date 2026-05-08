import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { users, enrollments, lessonProgress, payments, certificates, supportTickets } from "@db/schema";
import { createRouter, publicQuery, authedQuery, checkRateLimit, clearRateLimit } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { hashPassword, verifyPassword } from "./lib/password";
import { createToken, verifyToken } from "./lib/jwt";
import { initiatePasswordReset, completePasswordReset } from "./lib/email";
// ✅ SECURITY FIX: Import auth cookie helpers for httpOnly cookie auth
import { serializeAuthCookie, clearAuthCookie, AUTH_COOKIE_NAME } from "./lib/cookies";
import { parse } from "cookie";

export const localAuthRouter = createRouter({
  register: publicQuery
    .input(
      z.object({
        username: z.string()
          .min(3, "Username must be at least 3 characters")
          .max(30, "Username too long")
          .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
        password: z.string()
          .min(8, "Password must be at least 8 characters")
          .max(100)
          .regex(
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
            "Password must contain at least one uppercase letter, one lowercase letter, and one number"
          ),
        name: z.string().min(1).max(255).optional(),
        email: z.string().email("Invalid email format").optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // ✅ SECURITY FIX: Use rightmost IP from x-forwarded-for to prevent spoofing
      // Attackers can set x-forwarded-for to anything — the rightmost value
      // is set by the trusted reverse proxy (or use x-real-ip if available)
      const forwarded = ctx.req.headers.get("x-forwarded-for");
      const realIp = ctx.req.headers.get("x-real-ip");
      const ip = realIp || (forwarded ? forwarded.split(",").pop()?.trim() : "unknown");
      await checkRateLimit(ip, "register");

      const db = getDb();
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, input.username))
        .limit(1);

      if (existing.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });
      }

      // ✅ SECURITY FIX: Check email uniqueness if provided
      if (input.email) {
        const existingEmail = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, input.email))
          .limit(1);

        if (existingEmail.length > 0) {
          throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
        }
      }

      // ✅ bcrypt rounds=12 already in hashPassword
      const passwordHash = await hashPassword(input.password);
      const [user] = await db.insert(users).values({
        username: input.username,
        passwordHash,
        name: input.name || input.username,
        email: input.email || null,
      });

      const userId = Number(user.insertId);
      const token = await createToken({ userId, username: input.username, role: "user", tokenVersion: 0 });
      await clearRateLimit(ip, "register");

      // ✅ SECURITY FIX: Set JWT in httpOnly cookie instead of returning only in body
      const authCookie = serializeAuthCookie(ctx.req.headers, token);
      ctx.resHeaders.append("set-cookie", authCookie);

      // ✅ SECURITY: Do NOT return token in JSON body — it's in the HttpOnly cookie
      return {
        user: { id: userId, username: input.username, name: input.name || input.username },
      };
    }),

  login: publicQuery
    .input(
      z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // ✅ SECURITY FIX: Use rightmost IP from x-forwarded-for to prevent spoofing
      const forwarded = ctx.req.headers.get("x-forwarded-for");
      const realIp = ctx.req.headers.get("x-real-ip");
      const ip = realIp || (forwarded ? forwarded.split(",").pop()?.trim() : "unknown");
      await checkRateLimit(ip, "login");

      const db = getDb();
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, input.username))
        .limit(1);

      // ✅ Always run verifyPassword even if user not found (timing attack prevention)
      const dummyHash = "$2a$12$dummy.hash.to.prevent.timing.attacks.xxxxxxxxxxxxxxxxx";
      const valid = user
        ? await verifyPassword(input.password, user.passwordHash)
        : await verifyPassword(input.password, dummyHash).then(() => false);

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
      const forwarded2 = ctx.req.headers.get("x-forwarded-for");
      const realIp2 = ctx.req.headers.get("x-real-ip");
      const loginIp = realIp2 || (forwarded2 ? forwarded2.split(",").pop()?.trim() : "unknown");
      await clearRateLimit(loginIp, "login");

      // ✅ SECURITY FIX: Set JWT in httpOnly cookie instead of returning only in body
      const authCookie = serializeAuthCookie(ctx.req.headers, token);
      ctx.resHeaders.append("set-cookie", authCookie);

      // ✅ SECURITY: Do NOT return token in JSON body — it's in the HttpOnly cookie
      return {
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
        },
      };
    }),

  me: authedQuery.query(async ({ ctx }) => {
    // ✅ Uses authedQuery — user is guaranteed to exist in ctx
    return {
      id: ctx.user.id,
      username: ctx.user.username,
      name: ctx.user.name,
      email: ctx.user.email,
      role: ctx.user.role,
      avatar: ctx.user.avatar,
      preferredLanguage: ctx.user.preferredLanguage,
    };
  }),

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

      // ✅ SECURITY: Check email uniqueness before updating to prevent duplicates
      if (input.email) {
        const existingEmail = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, input.email))
          .limit(1);

        if (existingEmail.length > 0 && existingEmail[0].id !== ctx.user.id) {
          throw new TRPCError({ code: "CONFLICT", message: "Email already in use by another account" });
        }
      }

      await db
        .update(users)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.email !== undefined && { email: input.email }),
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

      const valid = await verifyPassword(input.currentPassword, user.passwordHash);
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
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      // ✅ FIXED: Use dedicated rate limit for forgotPassword (not shared with register)
      const forwarded = ctx.req.headers.get("x-forwarded-for");
      const realIp = ctx.req.headers.get("x-real-ip");
      const ip = realIp || (forwarded ? forwarded.split(",").pop()?.trim() : "unknown");
      await checkRateLimit(ip, "forgotPassword");

      const result = await initiatePasswordReset(input.email);
      return result;
    }),

  // Step 2: Complete password reset (verify token + set new password)
  resetPassword: publicQuery
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
      const forwarded = ctx.req.headers.get("x-forwarded-for");
      const realIp = ctx.req.headers.get("x-real-ip");
      const ip = realIp || (forwarded ? forwarded.split(",").pop()?.trim() : "unknown");
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

  // ✅ SECURITY FIX: Logout mutation — clears httpOnly auth cookie
  logout: authedQuery.mutation(async ({ ctx }) => {
    const clearedCookie = clearAuthCookie(ctx.req.headers);
    ctx.resHeaders.append("set-cookie", clearedCookie);
    return { success: true };
  }),
});
