import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, and, count } from "drizzle-orm";
import { createRouter, authQuery, authMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { userNotes } from "@db/schema";

// ─── Helper: build the values payload for a new note insertion ───
function buildNewNoteValues(userId: number, note: {
  courseId?: number;
  lessonId?: number;
  title?: string;
  content: string;
  tags?: string[];
  isPinned: boolean;
}) {
  return {
    userId,
    courseId: note.courseId || null,
    lessonId: note.lessonId || null,
    title: note.title || null,
    content: note.content,
    tags: note.tags ? JSON.stringify(note.tags) : null,
    isPinned: note.isPinned,
  };
}

// ─── Helper: build the updates payload for an existing note ───
function buildNoteUpdates(note: {
  courseId?: number;
  lessonId?: number;
  title?: string;
  content: string;
  tags?: string[];
  isPinned: boolean;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updates: any = {
    title: note.title || null,
    content: note.content,
    tags: note.tags ? JSON.stringify(note.tags) : null,
    isPinned: note.isPinned,
  };
  if (note.courseId !== undefined) updates.courseId = note.courseId;
  if (note.lessonId !== undefined) updates.lessonId = note.lessonId;
  return updates;
}

export const notesRouter = createRouter({
  list: authQuery
    .input(z.object({
      courseId: z.number().optional(),
      lessonId: z.number().optional(),
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 50;
      const offset = (page - 1) * limit;
      const conditions = [eq(userNotes.userId, ctx.user.id)];
      if (input?.courseId) conditions.push(eq(userNotes.courseId, input.courseId));
      if (input?.lessonId) conditions.push(eq(userNotes.lessonId, input.lessonId));

      const [[{ total }], items] = await Promise.all([
        db.select({ total: count() }).from(userNotes).where(and(...conditions)),
        db.select()
          .from(userNotes)
          .where(and(...conditions))
          .orderBy(desc(userNotes.isPinned), desc(userNotes.updatedAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { items, total: total ?? 0 };
    }),

  getById: authQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [note] = await db
        .select()
        .from(userNotes)
        .where(and(eq(userNotes.id, input.id), eq(userNotes.userId, ctx.user.id)))
        .limit(1);
      if (!note) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      return note;
    }),

  create: authMutation
    .input(z.object({
      courseId: z.number().optional(),
      lessonId: z.number().optional(),
      title: z.string().max(500).optional(),
      content: z.string().min(1).max(10000),
      tags: z.array(z.string()).optional(),
      isPinned: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [note] = await db.insert(userNotes).values({
        userId: ctx.user.id,
        courseId: input.courseId || null,
        lessonId: input.lessonId || null,
        title: input.title || null,
        content: input.content,
        tags: input.tags ? JSON.stringify(input.tags) : null,
        isPinned: input.isPinned,
      });
      return { success: true, id: Number(note.insertId) };
    }),

  update: authMutation
    .input(z.object({
      id: z.number(),
      title: z.string().max(500).optional(),
      content: z.string().min(1).max(10000).optional(),
      tags: z.array(z.string()).optional(),
      isPinned: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      const [existing] = await db
        .select({ userId: userNotes.userId })
        .from(userNotes)
        .where(and(eq(userNotes.id, id), eq(userNotes.userId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanUpdates: any = { ...updates };
      if (updates.tags) cleanUpdates.tags = JSON.stringify(updates.tags);
      delete cleanUpdates.id;

      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(userNotes).set(cleanUpdates).where(eq(userNotes.id, id));
      return { success: true };
    }),

  delete: authMutation
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [existing] = await db
        .select({ userId: userNotes.userId })
        .from(userNotes)
        .where(and(eq(userNotes.id, input.id), eq(userNotes.userId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      await db.delete(userNotes).where(eq(userNotes.id, input.id));
      return { success: true };
    }),

  sync: authMutation
    .input(z.object({
      notes: z.array(z.object({
        id: z.number().optional(),
        courseId: z.number().optional(),
        lessonId: z.number().optional(),
        title: z.string().max(500).optional(),
        content: z.string().min(1).max(10000),
        tags: z.array(z.string()).optional(),
        isPinned: z.boolean().default(false),
        updatedAt: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const results: { id: number; action: "created" | "updated" }[] = [];

      for (const note of input.notes) {
        if (!note.id) {
          // No id → always create
          const [newNote] = await db.insert(userNotes).values(buildNewNoteValues(ctx.user.id, note));
          results.push({ id: Number(newNote.insertId), action: "created" });
          continue;
        }

        const [existing] = await db
          .select({ userId: userNotes.userId })
          .from(userNotes)
          .where(and(eq(userNotes.id, note.id), eq(userNotes.userId, ctx.user.id)))
          .limit(1);

        if (existing) {
          await db.update(userNotes).set(buildNoteUpdates(note)).where(eq(userNotes.id, note.id));
          results.push({ id: note.id, action: "updated" });
        } else {
          // note.id was provided but no matching note for this user — create instead
          const [newNote] = await db.insert(userNotes).values(buildNewNoteValues(ctx.user.id, note));
          results.push({ id: Number(newNote.insertId), action: "created" });
        }
      }

      return { success: true, results };
    }),
});
