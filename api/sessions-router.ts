import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, and, count } from "drizzle-orm";
import { createRouter, authQuery, authMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { userSessions } from "@db/schema";

export const sessionsRouter = createRouter({
  list: authQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.userId, ctx.user.id), eq(userSessions.isRevoked, false)))
      .orderBy(desc(userSessions.lastActiveAt));
  }),

  register: authMutation
    .input(z.object({
      deviceFingerprint: z.string().optional(),
      deviceName: z.string().optional(),
      browser: z.string().optional(),
      os: z.string().optional(),
      ipAddress: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      if (input.deviceFingerprint) {
        const [existing] = await db
          .select({ id: userSessions.id })
          .from(userSessions)
          .where(and(
            eq(userSessions.userId, ctx.user.id),
            eq(userSessions.deviceFingerprint, input.deviceFingerprint),
            eq(userSessions.isRevoked, false),
          ))
          .limit(1);

        if (existing) {
          await db
            .update(userSessions)
            .set({ lastActiveAt: new Date() })
            .where(eq(userSessions.id, existing.id));
          return { success: true, id: existing.id };
        }
      }

      const [session] = await db.insert(userSessions).values({
        userId: ctx.user.id,
        deviceFingerprint: input.deviceFingerprint || null,
        deviceName: input.deviceName || null,
        browser: input.browser || null,
        os: input.os || null,
        ipAddress: input.ipAddress || null,
      });

      return { success: true, id: Number(session.insertId) };
    }),

  revoke: authMutation
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [session] = await db
        .select({ userId: userSessions.userId })
        .from(userSessions)
        .where(and(eq(userSessions.id, input.sessionId), eq(userSessions.userId, ctx.user.id)))
        .limit(1);

      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });

      await db
        .update(userSessions)
        .set({ isRevoked: true })
        .where(eq(userSessions.id, input.sessionId));

      return { success: true };
    }),

  revokeAll: authMutation.mutation(async ({ ctx }) => {
    const db = getDb();
    await db
      .update(userSessions)
      .set({ isRevoked: true })
      .where(eq(userSessions.userId, ctx.user.id));
    return { success: true };
  }),

  touch: authMutation
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .update(userSessions)
        .set({ lastActiveAt: new Date() })
        .where(and(eq(userSessions.id, input.sessionId), eq(userSessions.userId, ctx.user.id)));
      return { success: true };
    }),
});
