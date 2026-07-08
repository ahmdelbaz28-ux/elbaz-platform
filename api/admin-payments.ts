/**
 * ADMIN PAYMENTS & ANALYTICS — Payment list, dashboard stats, and analytics
 *
 * Procedures: payments (paginated), stats (dashboard overview), analytics (30-day)
 */

import { z } from "zod";
import { desc, eq, sql, and, count } from "drizzle-orm";
import { adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users, payments, enrollments, courses, supportTickets, lessons } from "@db/schema";

export const adminPaymentsProcedures = {
  // Payments list with pagination
  payments: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20), status: z.enum(["pending", "completed", "failed", "refunded", "expired"]).optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;
      const conditions = [];
      if (input?.status) conditions.push(eq(payments.status, input.status));
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
      revenueByDay: recentPayments.map((p: any) => ({ date: p.date, amount: Number.parseFloat(p.amount) })),
    };
  }),
};
