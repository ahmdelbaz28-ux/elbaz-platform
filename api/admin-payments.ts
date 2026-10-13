/**
 * ADMIN PAYMENTS & ANALYTICS — Payment list, dashboard stats, and analytics
 *
 * Procedures: payments (paginated), stats (dashboard overview), analytics (30-day)
 */

import { z } from "zod";
import { desc, eq, sql, and, count } from "drizzle-orm";
import { adminQuery } from "./middleware";
import { getDb, withTransaction } from "./queries/connection";
import { users, payments, enrollments, courses, supportTickets, lessons } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { invalidateCourseCache, invalidateStatsCache } from "./lib/cache";
import { guardManualPaymentAction } from "./lib/payments-core";
import { resolvePaymobRuntimeConfig } from "./lib/payments-config";
import { createIntention, summarizePaymobConfig } from "./lib/paymob";
import { logger } from "./lib/logger";

export const adminPaymentsProcedures = {
  /**
   * Paymob live self-test (admin dashboard → Payments → "Test gateway").
   *
   * 1. Resolves the runtime config and reports exactly what is missing.
   * 2. When complete, creates a REAL 1.00 EGP test intention against Paymob —
   *    proving credentials, integration IDs and connectivity in one call.
   * 3. Returns the hosted-checkout URL so the admin can optionally complete
   *    the sandbox payment with the official test card (5123 4567 8901 2346,
   *    01/39, CVV 123) and watch the webhook enroll nothing (SELFTEST ref is
   *    intentionally not a payment row) while still confirming the callback.
   */
  paymobSelfTest: adminQuery.mutation(async () => {
    const cfg = await resolvePaymobRuntimeConfig();
    const missing = summarizePaymobConfig(cfg);
    if (missing.length > 0) {
      return { ok: false, stage: "config" as const, missing, message: `Missing configuration: ${missing.join("; ")}` };
    }

    const reference = `SELFTEST-${nanoid(12)}`;
    try {
      const intention = await createIntention(cfg, {
        amount: 1, // 1.00 EGP — sandbox-safe probe
        itemName: "Paymob integration self-test",
        specialReference: reference,
        customer: {
          firstName: "Admin",
          lastName: "SelfTest",
          email: "selftest@ahmedelbaz.qzz.io",
          phone: "+201000000000",
        },
        // "other" selects every configured integration so the probe works
        // whether the admin filled the card ID, the wallet ID, or both.
        paymentMethod: "other",
        extras: { selfTest: true, reference },
      });
      return {
        ok: true,
        stage: "intention_created" as const,
        reference,
        intentionId: intention.intentionId,
        paymobOrderId: intention.paymobOrderId,
        checkoutUrl: intention.checkoutUrl,
        message: "Intention created — the gateway is reachable and the credentials work.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("[Paymob SelfTest] Intention creation failed", { message });
      return { ok: false, stage: "intention_creation" as const, missing: [], message };
    }
  }),

  // Payments list with pagination (optional status + provider filters)
  payments: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20), status: z.enum(["pending", "completed", "failed", "refunded", "expired"]).optional(), provider: z.string().max(50).optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;
      const conditions = [];
      if (input?.status) conditions.push(eq(payments.status, input.status));
      if (input?.provider) conditions.push(eq(payments.provider, input.provider));
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [[{ total }], items] = await Promise.all([
        db.select({ total: count() }).from(payments).where(whereClause),
        db.select().from(payments)
          .where(whereClause)
          .orderBy(desc(payments.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { items, total: total ?? 0 };
    }),

  // Dashboard stats (trpc.admin.stats.useQuery)
  stats: adminQuery.query(async () => {
    const db = getDb();
    const [userCount] = await db.select({ value: count() }).from(users);
    const [courseCount] = await db.select({ value: count() }).from(courses);
    const [enrollmentCount] = await db.select({ value: count() }).from(enrollments);
    const [ticketOpen] = await db
      .select({ value: count() })
      .from(supportTickets)
      .where(and(
        eq(supportTickets.status, "open"),
      ));
    const [revenueResult] = await db
      .select({ total: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL(12,2))), 0)` })
      .from(payments)
      .where(eq(payments.status, "completed"));

    return {
      totalUsers: userCount?.value ?? 0,
      totalCourses: courseCount?.value ?? 0,
      totalEnrollments: enrollmentCount?.value ?? 0,
      openTickets: ticketOpen?.value ?? 0,
      totalRevenue: Number.parseFloat(revenueResult?.total ?? "0"),
    };
  }),

  // 30-day analytics (trpc.admin.analytics.useQuery)
  analytics: adminQuery.query(async () => {
    const db = getDb();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [recentUsers] = await db.select({ value: count() }).from(users).where(sql`${users.createdAt} >= ${thirtyDaysAgo}`);
    const [recentEnrollments] = await db.select({ value: count() }).from(enrollments).where(sql`${enrollments.enrolledAt} >= ${thirtyDaysAgo}`);
    const [recentRevenue] = await db.select({ total: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL(12,2))), 0)` }).from(payments).where(and(eq(payments.status, "completed"), sql`${payments.createdAt} >= ${thirtyDaysAgo}`));
    const [totalLessons] = await db.select({ value: count() }).from(lessons);

    const recentPayments = await db.select({
      date: sql<string>`DATE(${payments.createdAt})`,
      amount: sql<string>`COALESCE(SUM(CAST(amount AS DECIMAL(12,2))), 0)`,
    }).from(payments).where(and(eq(payments.status, "completed"), sql`${payments.createdAt} >= ${thirtyDaysAgo}`)).groupBy(sql`DATE(${payments.createdAt})`).orderBy(sql`DATE(${payments.createdAt})`);

    return {
      newUsers30d: recentUsers?.value ?? 0,
      newEnrollments30d: recentEnrollments?.value ?? 0,
      revenue30d: Number.parseFloat(recentRevenue?.total ?? "0"),
      totalLessons: totalLessons?.value ?? 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      revenueByDay: recentPayments.map((p: any) => ({ date: p.date, amount: Number.parseFloat(p.amount) })),
    };
  }),

  /**
   * Approve a pending manual payment (Vodafone Cash / InstaPay / bank transfer
   * verified by the admin outside the platform).
   *
   * Grants the enrollment in the SAME transaction that completes the payment —
   * mirrors the Paymob webhook guarantee that payment completion always means
   * course access. Idempotent: approving an already-approved payment is a no-op
   * success instead of an error (dashboard double-clicks, retries).
   */
  approveManual: adminQuery
    .input(z.object({ paymentId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      return await withTransaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))
          .limit(1);

        if (!payment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
        }

        const guard = guardManualPaymentAction(payment, "approve");
        if (!guard.ok) {
          const message =
            guard.error === "NOT_MANUAL"
              ? "Only manual payments can be approved"
              : `Cannot approve a payment with status "${guard.status}"`;
          throw new TRPCError({ code: "PRECONDITION_FAILED", message });
        }
        if (guard.alreadyProcessed) {
          return { success: true, alreadyApproved: true };
        }

        await tx
          .update(payments)
          .set({ status: "completed", paidAt: new Date() })
          .where(eq(payments.id, input.paymentId));

        // Grant enrollment if missing (same idempotent pattern as the webhook)
        const existingEnrollment = await tx
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(and(eq(enrollments.userId, payment.userId), eq(enrollments.courseId, payment.courseId)))
          .limit(1);

        if (existingEnrollment.length === 0) {
          await tx.insert(enrollments).values({
            userId: payment.userId,
            courseId: payment.courseId,
            progress: "0.00",
            isCompleted: false,
          });
          await tx
            .update(courses)
            .set({ studentCount: sql`${courses.studentCount} + 1` })
            .where(eq(courses.id, payment.courseId));
        }

        await invalidateCourseCache();
        await invalidateStatsCache();

        return { success: true, alreadyApproved: false };
      });
    }),

  /**
   * Reject a pending manual payment (transfer not received / wrong amount).
   * Only pending manual payments can be rejected; already-completed ones must
   * go through a refund flow instead.
   */
  rejectManual: adminQuery
    .input(z.object({ paymentId: z.number().int().positive(), reason: z.string().max(500).optional() }))
    .mutation(async ({ input }) => {
      return await withTransaction(async (tx) => {
        const [payment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, input.paymentId))
          .limit(1);

        if (!payment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
        }

        const guard = guardManualPaymentAction(payment, "reject");
        if (!guard.ok) {
          const message =
            guard.error === "NOT_MANUAL"
              ? "Only manual payments can be rejected"
              : `Cannot reject a payment with status "${guard.status}"`;
          throw new TRPCError({ code: "PRECONDITION_FAILED", message });
        }

        await tx
          .update(payments)
          .set({
            status: "failed",
            metadata: { ...(payment.metadata as Record<string, unknown> | null ?? {}), rejectReason: input.reason ?? null },
          })
          .where(eq(payments.id, input.paymentId));

        return { success: true };
      });
    }),
};
