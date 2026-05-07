import { z } from "zod";
import { eq, desc, count, sum, and, sql } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  users,
  payments,
  supportTickets,
  ticketReplies,
  enrollments,
  courses,
} from "@db/schema";

/**
 * ✅ Admin tRPC Router — FIXED
 *
 * MISMATCH ROOT CAUSE of "D.forEach is not a function" crash:
 * Frontend (Admin.tsx) calls:  stats, users, tickets, payments, updateTicketStatus, replyTicket
 * Old backend only had:        getAllUsers, getAllPayments (wrong names + 4 missing)
 *
 * Now all 6 procedures match what Admin.tsx expects.
 */
export const adminRouter = createRouter({
  // ─── Dashboard Stats ────────────────────────────────────────────
  stats: adminQuery.query(async () => {
    const db = getDb();

    const [userCount] = await db
      .select({ total: count() })
      .from(users);

    const [courseCount] = await db
      .select({ total: count() })
      .from(courses);

    const [enrollmentCount] = await db
      .select({ total: count() })
      .from(enrollments);

    const [revenueResult] = await db
      .select({ total: sum(payments.amount) })
      .from(payments)
      .where(eq(payments.status, "completed"));

    const [openTicketsResult] = await db
      .select({ total: count() })
      .from(supportTickets)
      .where(eq(supportTickets.status, "open"));

    return {
      totalUsers: userCount?.total || 0,
      totalCourses: courseCount?.total || 0,
      totalEnrollments: enrollmentCount?.total || 0,
      totalRevenue: Number(revenueResult?.total || 0),
      openTickets: openTicketsResult?.total || 0,
    };
  }),

  // ─── All Users ──────────────────────────────────────────────────
  users: adminQuery.query(async () => {
    const db = getDb();
    return db
      .select({
        id: users.id,
        username: users.username,
        name: users.name,
        email: users.email,
        avatar: users.avatar,
        role: users.role,
        preferredLanguage: users.preferredLanguage,
        createdAt: users.createdAt,
        lastSignInAt: users.lastSignInAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
  }),

  // ─── All Tickets ────────────────────────────────────────────────
  tickets: adminQuery.query(async () => {
    const db = getDb();
    const tickets = await db
      .select()
      .from(supportTickets)
      .orderBy(desc(supportTickets.createdAt));

    // Batch fetch all replies in a single query using IN clause
    if (tickets.length === 0) return [];

    const ticketIds = tickets.map((t) => t.id);
    const allReplies = await db
      .select()
      .from(ticketReplies)
      .where(sql`${ticketReplies.ticketId} IN (${sql.join(ticketIds.map(id => sql`${id}`), sql`, `)})`)
      .orderBy(ticketReplies.createdAt);

    // Group replies by ticketId
    const repliesMap = new Map<number, typeof allReplies>();
    for (const reply of allReplies) {
      const list = repliesMap.get(reply.ticketId) || [];
      list.push(reply);
      repliesMap.set(reply.ticketId, list);
    }

    return tickets.map((ticket) => ({
      ...ticket,
      replies: repliesMap.get(ticket.id) || [],
    }));
  }),

  // ─── All Payments ───────────────────────────────────────────────
  payments: adminQuery.query(async () => {
    const db = getDb();
    return db
      .select()
      .from(payments)
      .orderBy(desc(payments.createdAt));
  }),

  // ─── Update Ticket Status ───────────────────────────────────────
  updateTicketStatus: adminQuery
    .input(
      z.object({
        id: z.number().int().positive(),
        status: z.enum(["open", "in_progress", "resolved", "closed"]),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(supportTickets)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(supportTickets.id, input.id));
      return { success: true };
    }),

  // ─── Admin Reply to Ticket ──────────────────────────────────────
  replyTicket: adminQuery
    .input(
      z.object({
        ticketId: z.number().int().positive(),
        message: z.string().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // Verify ticket exists
      const [ticket] = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.id, input.ticketId))
        .limit(1);

      if (!ticket) {
        return { success: false, error: "Ticket not found" };
      }

      // Insert admin reply
      await db.insert(ticketReplies).values({
        ticketId: input.ticketId,
        userId: ctx.user.id,
        message: input.message,
        isAdminReply: true,
      });

      // Update ticket status to in_progress if it was open
      if (ticket.status === "open") {
        await db
          .update(supportTickets)
          .set({ status: "in_progress", updatedAt: new Date() })
          .where(eq(supportTickets.id, input.ticketId));
      }

      return { success: true };
    }),
});
