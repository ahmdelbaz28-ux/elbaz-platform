import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, count } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users, payments, enrollments, courses, supportTickets, ticketReplies, categories, lessons } from "@db/schema";
import type { SafeUser } from "./context";

export const adminRouter = createRouter({
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
      totalRevenue: parseFloat(revenueResult?.total ?? "0"),
    };
  }),

  // All support tickets for admin (trpc.admin.tickets.useQuery)
  tickets: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20), status: z.enum(["open", "in_progress", "resolved", "closed"]).optional() }).optional())
    .query(async ({ input }) => {
    const db = getDb();
    const page = input?.page ?? 1;
    const limit = input?.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (input?.status) conditions.push(eq(supportTickets.status, input.status));
    return db
      .select({
        id: supportTickets.id,
        userId: supportTickets.userId,
        subject: supportTickets.subject,
        message: supportTickets.message,
        category: supportTickets.category,
        status: supportTickets.status,
        priority: supportTickets.priority,
        createdAt: supportTickets.createdAt,
        updatedAt: supportTickets.updatedAt,
      })
      .from(supportTickets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(supportTickets.createdAt))
      .limit(limit)
      .offset(offset);
  }),

  // Update ticket status (trpc.admin.updateTicketStatus.useMutation)
  updateTicketStatus: adminQuery
    .input(z.object({ id: z.number(), status: z.enum(["open", "in_progress", "resolved", "closed"]) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // ✅ FIX: Verify ticket exists before updating status
      const [ticket] = await db
        .select({ id: supportTickets.id })
        .from(supportTickets)
        .where(eq(supportTickets.id, input.id))
        .limit(1);
      if (!ticket) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }
      await db
        .update(supportTickets)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(supportTickets.id, input.id));
      return { success: true };
    }),

  // Admin reply to ticket (trpc.admin.replyTicket.useMutation)
  replyTicket: adminQuery
    .input(z.object({ ticketId: z.number(), message: z.string().min(1).max(5000) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // ✅ FIX: Verify ticket exists before inserting reply
      const [ticket] = await db
        .select({ id: supportTickets.id })
        .from(supportTickets)
        .where(eq(supportTickets.id, input.ticketId))
        .limit(1);

      if (!ticket) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }

      await db.insert(ticketReplies).values({
        ticketId: input.ticketId,
        userId: ctx.user.id,
        message: input.message,
        isAdminReply: true,
      });
      // Update ticket status to in_progress if was open
      await db
        .update(supportTickets)
        .set({ status: "in_progress", updatedAt: new Date() })
        .where(eq(supportTickets.id, input.ticketId));
      return { success: true };
    }),

  // ═══════════════════ COURSE MANAGEMENT ═══════════════════

  listCourses: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;

      const [[{ total }], items] = await Promise.all([
        db.select({ total: count() }).from(courses),
        db.select({
          id: courses.id,
          slug: courses.slug,
          titleEn: courses.titleEn,
          titleAr: courses.titleAr,
          descriptionEn: courses.descriptionEn,
          descriptionAr: courses.descriptionAr,
          thumbnailUrl: courses.thumbnail,
          price: courses.price,
          isFeatured: courses.isFeatured,
          isPublished: courses.isPublished,
          level: courses.level,
          category: courses.categoryId,
          studentCount: courses.studentCount,
          createdAt: courses.createdAt,
          updatedAt: courses.updatedAt,
        })
          .from(courses)
          .orderBy(desc(courses.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { items, total: total ?? 0 };
    }),

  updateCourse: adminQuery
    .input(z.object({
      id: z.number().int().positive(),
      titleEn: z.string().max(500).optional(),
      titleAr: z.string().max(500).optional(),
      descriptionEn: z.string().optional(),
      descriptionAr: z.string().optional(),
      thumbnailUrl: z.string().max(1000).optional(),
      price: z.number().optional(),
      isFeatured: z.boolean().optional(),
      isPublished: z.boolean().optional(),
      level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
      categoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(courses).set({ ...cleanUpdates, updatedAt: new Date() }).where(eq(courses.id, id));
      return { success: true };
    }),

  // ═══════════════════ USER ROLE MANAGEMENT ═══════════════════

  updateUserRole: adminQuery
    .input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "admin"]) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
      if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      await db.update(users).set({ role: input.role, updatedAt: new Date() }).where(eq(users.id, input.userId));
      return { success: true };
    }),

  // ═══════════════════ ANALYTICS ═══════════════════

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
      revenue30d: parseFloat(recentRevenue?.total ?? "0"),
      totalLessons: totalLessons?.value ?? 0,
      revenueByDay: recentPayments.map((p: any) => ({ date: p.date, amount: parseFloat(p.amount) })),
    };
  }),
});
