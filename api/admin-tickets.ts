/**
 * ADMIN TICKETS — Support ticket management endpoints
 *
 * Procedures: tickets (paginated list), updateTicketStatus, replyTicket
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, and } from "drizzle-orm";
import { adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { supportTickets, ticketReplies } from "@db/schema";

export const adminTicketsProcedures = {
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
      await db
        .update(supportTickets)
        .set({ status: "in_progress", updatedAt: new Date() })
        .where(eq(supportTickets.id, input.ticketId));
      return { success: true };
    }),
};
