import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
// ✅ SECURITY FIX: Use authedQuery instead of manual token verification
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { supportTickets, ticketReplies } from "@db/schema";
import { TRPCError } from "@trpc/server";

export const supportRouter = createRouter({
  // ✅ SECURITY FIX: Uses authedQuery — userId from ctx.user.id, cannot be forged
  create: authedQuery
    .input(
      z.object({
        subject: z.string().min(1).max(255),
        message: z.string().min(1).max(5000),
        category: z.enum(["technical", "billing", "content", "general"]).default("general"),
        priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [ticket] = await db.insert(supportTickets).values({
        userId: ctx.user.id,
        subject: input.subject,
        message: input.message,
        category: input.category,
        priority: input.priority,
      });

      return { success: true, ticketId: Number(ticket.insertId) };
    }),

  // ✅ SECURITY FIX: Uses authedQuery — automatic auth + userId scoping
  list: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select()
      .from(supportTickets)
      .where(eq(supportTickets.userId, ctx.user.id))
      .orderBy(desc(supportTickets.createdAt));
  }),

  // ✅ SECURITY FIX: Uses authedQuery — ticket ownership verified via userId
  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [ticket] = await db
        .select()
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.id), eq(supportTickets.userId, ctx.user.id)))
        .limit(1);

      if (!ticket) return null;

      const replies = await db
        .select()
        .from(ticketReplies)
        .where(eq(ticketReplies.ticketId, ticket.id))
        .orderBy(ticketReplies.createdAt);

      return { ...ticket, replies };
    }),

  // ✅ SECURITY FIX: Uses authedQuery — userId from ctx
  reply: authedQuery
    .input(
      z.object({
        ticketId: z.number(),
        message: z.string().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // Verify ticket belongs to this user
      const [ticket] = await db
        .select()
        .from(supportTickets)
        .where(and(eq(supportTickets.id, input.ticketId), eq(supportTickets.userId, ctx.user.id)))
        .limit(1);

      if (!ticket) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      }

      await db.insert(ticketReplies).values({
        ticketId: input.ticketId,
        userId: ctx.user.id,
        message: input.message,
        isAdminReply: false,
      });

      // Update ticket status — set to "open" if was closed/resolved
      await db
        .update(supportTickets)
        .set({ status: "open", updatedAt: new Date() })
        .where(eq(supportTickets.id, input.ticketId));

      return { success: true };
    }),
});
