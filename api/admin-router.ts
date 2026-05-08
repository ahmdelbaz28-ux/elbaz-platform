import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and, count } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users, payments, enrollments, courses, supportTickets, ticketReplies } from "@db/schema";
import type { SafeUser } from "./context";

export const adminRouter = createRouter({
  // ✅ SECURITY FIX: Exclude passwordHash from getAllUsers response
  // Previously: db.select().from(users) returned ALL columns including passwordHash
  getAllUsers: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
    const db = getDb();
    const page = input?.page ?? 1;
    const limit = input?.limit ?? 20;
    const offset = (page - 1) * limit;
    const allUsers = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        avatar: users.avatar,
        role: users.role,
        preferredLanguage: users.preferredLanguage,
        tokenVersion: users.tokenVersion,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        lastSignInAt: users.lastSignInAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
    return allUsers as SafeUser[];
  }),

  // Alias used by Admin.tsx frontend (trpc.admin.users.useQuery)
  users: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
    const db = getDb();
    const page = input?.page ?? 1;
    const limit = input?.limit ?? 20;
    const offset = (page - 1) * limit;
    const allUsers = await db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        avatar: users.avatar,
        role: users.role,
        preferredLanguage: users.preferredLanguage,
        tokenVersion: users.tokenVersion,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        lastSignInAt: users.lastSignInAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
    return allUsers as SafeUser[];
  }),

  // Alias used by Admin.tsx frontend (trpc.admin.payments.useQuery)
  payments: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20), status: z.enum(["pending", "completed", "failed", "refunded", "expired"]).optional() }).optional())
    .query(async ({ input }) => {
    const db = getDb();
    const page = input?.page ?? 1;
    const limit = input?.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (input?.status) conditions.push(eq(payments.status, input.status));
    return db.select().from(payments)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(payments.createdAt))
      .limit(limit)
      .offset(offset);
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
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
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
});
