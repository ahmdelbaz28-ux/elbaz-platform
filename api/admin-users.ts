/**
 * ADMIN USERS — User management endpoints
 *
 * Procedures: users (paginated list), updateUserRole,
 *             pendingApprovals / approveUser / rejectUser / resendApprovalEmail
 *             (the ADMIN APPROVAL GATE queue, owner directive 2026-11-24)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq, count, and, sql } from "drizzle-orm";
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

      if (input.role === "user" && user.role === "admin") {
        // ✅ SECURITY FIX (audit run-1, fp admin-users.updateUserRole
        // .last-admin-guard.race-to-zero-admins): the old guard was a separate
        // SELECT-then-act — two concurrent demotes both read "admins = 2" and
        // BOTH demoted, leaving zero administrators, and ADMIN_RECOVERY cannot
        // restore the role (it has nobody to promote). The guard now travels
        // WITH the write: one conditional UPDATE that only fires while more
        // than one admin remains. MySQL forbids selecting the target table in
        // a subquery (ERROR 1093) — the derived table materializes it.
        // Concurrent demotes serialize on the row lock: the winner affects 1
        // row, the loser 0 rows → clean BAD_REQUEST, never zero admins.
        const [updateResult] = await db
          .update(users)
          .set({ role: input.role, tokenVersion: user.tokenVersion + 1, updatedAt: new Date() })
          .where(
            and(
              eq(users.id, input.userId),
              eq(users.role, "admin"),
              sql`(SELECT adminCount FROM (SELECT COUNT(*) AS adminCount FROM users WHERE role = 'admin') AS adminGuard) > 1`,
            ),
          );
        const affected = Number((updateResult as unknown as { affectedRows?: number }).affectedRows ?? 0);
        if (affected === 0) {
          // Zero rows: either a concurrent demote already removed this admin
          // (intent satisfied — success) or this IS the last admin (guard).
          const [fresh] = await db
            .select({ role: users.role })
            .from(users)
            .where(eq(users.id, input.userId))
            .limit(1);
          if (fresh && fresh.role !== "admin") {
            evictUserAuthCache(user.id);
            return { success: true };
          }
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "لا يمكن إزالة صلاحية المشرف الأخير — يجب أن يبقى مشرف واحد على الأقل",
          });
        }
        // ✅ INSTANT EFFECT: tokenVersion bump (in the same SET) kills ALL of
        // the target's existing sessions immediately, and the auth cache is
        // evicted so even the 30s user-cache window cannot serve the old role.
        evictUserAuthCache(user.id);
        return { success: true };
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

  // ✅ ROOT FIX (owner report 2026-11-24, "راجع المشكلة من جذورها"): the v17
  // migration grandfathered every PRE-GATE account as 'approved' — the owner
  // signed in with his old @AHMEDBAZ account and the gate never stopped him.
  // The owner's authority must reach those accounts too: re-open puts ANY
  // non-admin account back into the pending queue (gate panel + alert email
  // with signed action links) and KILLS its live session (tokenVersion bump
  // + cache eviction — pending means no access, not just "no NEW sessions").
  reopenApproval: adminMutation
    .input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [target] = await db
        .select({
          username: users.username,
          name: users.name,
          email: users.email,
          role: users.role,
          approvalStatus: users.approvalStatus,
          tokenVersion: users.tokenVersion,
        })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      // The authority can never be re-gated out of its own platform.
      if (target.role === "admin") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لا يمكن إعادة فتح مراجعة حسابات المشرفين" });
      }
      if (target.approvalStatus === "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "هذا الحساب بانتظار المراجعة بالفعل" });
      }

      await db
        .update(users)
        .set({
          approvalStatus: "pending",
          approvalDecidedAt: null,
          approvalDecidedByUserId: null,
          // Same semantics as reject: an account whose access the owner is
          // re-deciding must not keep the session it holds right now.
          tokenVersion: target.tokenVersion + 1,
        })
        .where(eq(users.id, input.userId));
      evictUserAuthCache(input.userId);
      logger.info("[Admin] approval re-opened — account re-gated to pending, live session revoked", {
        userId: input.userId,
        username: target.username,
        by: ctx.user.id,
      });

      // Owner alert (best-effort): in-app stream + the approval email with
      // fresh signed action links — the owner decides from inbox or dashboard.
      void notifyAdminsOfRegistration({
        userId: input.userId,
        username: target.username,
        name: target.name,
        email: target.email,
        frontendUrl: env.FRONTEND_URL,
      }).catch((notifyErr) => {
        logger.warn("[Admin] reopen alert failed (best-effort)", {
          userId: input.userId,
          error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        });
      });
      return { success: true, status: "pending" as const };
    }),
};
