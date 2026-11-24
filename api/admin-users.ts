/**
 * ADMIN USERS — User management endpoints
 *
 * Procedures: users (paginated list), updateUserRole,
 *             pendingApprovals / approveUser / rejectUser / resendApprovalEmail
 *             (the ADMIN APPROVAL GATE queue, owner directive 2026-11-24)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq, count } from "drizzle-orm";
import { adminQuery, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import type { SafeUser } from "./context";
import { evictUserAuthCache } from "./context";
import { decideApproval, notifyAdminsOfRegistration, adminAlertEmail } from "./lib/approval";
import { maybeSendWelcomeEmail } from "./lib/email-drip";
import { env } from "./lib/env";
import { logger, maskEmail } from "./lib/logger";

export const adminUsersProcedures = {
  // Users list — used by Admin.tsx frontend (trpc.admin.users.useQuery)
  users: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;

      const [[{ total }], allUsers] = await Promise.all([
        db.select({ total: count() }).from(users),
        db.select({
          id: users.id,
          username: users.username,
          name: users.name,
          email: users.email,
          avatar: users.avatar,
          role: users.role,
          preferredLanguage: users.preferredLanguage,
          // ✅ SECURITY FIX (audit run-2): SafeUser is now a curated Pick<> that
          // includes emailVerifiedAt — the admin list select must carry it for
          // the `as SafeUser[]` cast to hold.
          emailVerifiedAt: users.emailVerifiedAt,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
          lastSignInAt: users.lastSignInAt,
        })
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { items: allUsers as SafeUser[], total: total ?? 0 };
    }),

  updateUserRole: adminMutation
    .input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "admin"]) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [user] = await db
        .select({ id: users.id, role: users.role, tokenVersion: users.tokenVersion })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      if (user.role === input.role) return { success: true }; // no-op

      // ✅ LAST-ADMIN GUARD (dashboard audit 2026-11-15): never allow removing
      // the final administrator — the platform would become unmanageable.
      if (user.role === "admin" && input.role === "user") {
        const [{ admins }] = await db
          .select({ admins: count() })
          .from(users)
          .where(eq(users.role, "admin"));
        if ((admins ?? 0) <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "لا يمكن إزالة صلاحية المشرف الأخير — يجب أن يبقى مشرف واحد على الأقل",
          });
        }
      }

      // ✅ INSTANT EFFECT (dashboard audit 2026-11-15): bump tokenVersion so a
      // role change kills ALL of the target's existing sessions immediately
      // (a demoted admin is locked out on their very next request instead of
      // riding a stale session for up to the token lifetime), and evict the
      // auth cache so even the 30s user-cache window cannot serve the old role.
      await db
        .update(users)
        .set({ role: input.role, tokenVersion: user.tokenVersion + 1, updatedAt: new Date() })
        .where(eq(users.id, input.userId));
      evictUserAuthCache(user.id);
      return { success: true };
    }),

  // ─── ADMIN APPROVAL GATE (owner directive, 2026-11-24) ────────────────────
  // The owner's authority over who may enter the platform: a live queue of
  // pending registrations + approve/reject actions. Reject also revokes any
  // live session (tokenVersion bump inside decideApproval) — "ألغاء دخول أي
  // حد في أي وقت" works even for accounts that are logged in right now.

  pendingApprovals: adminQuery
    .query(async () => {
      const db = getDb();
      const [rows, [{ pending }]] = await Promise.all([
        db
          .select({
            id: users.id,
            username: users.username,
            name: users.name,
            email: users.email,
            role: users.role,
            preferredLanguage: users.preferredLanguage,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.approvalStatus, "pending"))
          .orderBy(asc(users.createdAt))
          .limit(200),
        db.select({ pending: count() }).from(users).where(eq(users.approvalStatus, "pending")),
      ]);
      return { items: rows, total: pending ?? 0 };
    }),

  approveUser: adminMutation
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      // Snapshot the email BEFORE the decision — approveUser also kicks off
      // the welcome drip (deferred from registration while the account was
      // locked out).
      const db = getDb();
      const [target] = await db
        .select({ username: users.username, name: users.name, email: users.email, role: users.role, approvalStatus: users.approvalStatus })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });

      const result = await decideApproval({
        userId: input.userId,
        action: "approve",
        adminUserId: ctx.user.id,
        source: "dashboard",
      });
      if (!result.ok) {
        if (result.reason === "not_found") throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الحساب ليس في انتظار الموافقة" });
      }

      // Deferred welcome drip (best-effort) — the account is now usable.
      if (target.email) {
        void maybeSendWelcomeEmail(input.userId, target.username, target.email, target.name || target.username);
      }
      return { success: true, status: result.status };
    }),

  rejectUser: adminMutation
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const result = await decideApproval({
        userId: input.userId,
        action: "reject",
        adminUserId: ctx.user.id,
        source: "dashboard",
      });
      if (!result.ok) {
        if (result.reason === "not_found") throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن رفض هذا الحساب في حالته الحالية (حسابات المشرفين محمية)" });
      }
      return { success: true, status: result.status };
    }),

  resendApprovalEmail: adminMutation
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const to = adminAlertEmail();
      if (!to) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لم يُضبط بريد التنبيه (ADMIN_ALERT_EMAIL) على الخادم" });
      }
      const db = getDb();
      const [target] = await db
        .select({ username: users.username, name: users.name, email: users.email, approvalStatus: users.approvalStatus })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      if (target.approvalStatus !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الحساب ليس في انتظار الموافقة" });
      }
      const base = env.FRONTEND_URL;
      await notifyAdminsOfRegistration({
        userId: input.userId,
        username: target.username,
        name: target.name,
        email: target.email,
        frontendUrl: base,
      });
      logger.info("[Admin] approval email re-sent", { userId: input.userId, to: maskEmail(to) });
      return { success: true };
    }),
};
