/**
 * Comments Router — lesson discussion comments with likes
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql, and } from "drizzle-orm";
import { createRouter, publicQuery, authMutation, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { lessonComments, commentLikes, users, lessons, courses, enrollments } from "@db/schema";
import { activeEnrollmentWhere } from "./lib/enrollment.js";

export const commentsRouter = createRouter({
  list: publicQuery
    .input(z.object({
      lessonId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const comments = await db
        .select({
          id: lessonComments.id,
          lessonId: lessonComments.lessonId,
          userId: lessonComments.userId,
          content: lessonComments.content,
          parentCommentId: lessonComments.parentCommentId,
          isPinned: lessonComments.isPinned,
          likeCount: lessonComments.likeCount,
          createdAt: lessonComments.createdAt,
          updatedAt: lessonComments.updatedAt,
          username: users.username,
          name: users.name,
          avatar: users.avatar,
          role: users.role,
        })
        .from(lessonComments)
        .innerJoin(users, eq(lessonComments.userId, users.id))
        .where(and(
          eq(lessonComments.lessonId, input.lessonId),
          eq(lessonComments.isHidden, false),
        ))
        .orderBy(desc(lessonComments.isPinned), desc(lessonComments.createdAt))
        .limit(input.limit);

      // If user is logged in, fetch their liked comment IDs
      let likedCommentIds: number[] = [];
      if (ctx.user) {
        const likes = await db
          .select({ commentId: commentLikes.commentId })
          .from(commentLikes)
          .where(eq(commentLikes.userId, ctx.user.id));
        likedCommentIds = likes.map((l) => l.commentId);
      }

      return { items: comments, likedCommentIds };
    }),

  create: authMutation
    .input(z.object({
      lessonId: z.number().int().positive(),
      content: z.string().min(1).max(2000),
      parentCommentId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      // ✅ SECURITY FIX (audit run-1, stored-content.create.missing-entitlement):
      // comments are publicly readable by lessonId — bind them to content the
      // author can actually access: published lesson, and (free OR active
      // enrollment), mirroring quiz/course-watching.
      const [lesson] = await db
        .select({ id: lessons.id, courseId: lessons.courseId, isPublished: lessons.isPublished })
        .from(lessons)
        .where(eq(lessons.id, input.lessonId))
        .limit(1);
      if (!lesson || !lesson.isPublished) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      }
      const [course] = await db
        .select({ isPublished: courses.isPublished, isPremium: courses.isPremium })
        .from(courses)
        .where(eq(courses.id, lesson.courseId))
        .limit(1);
      if (!course || !course.isPublished) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      }
      if (course.isPremium) {
        const [enrollment] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(activeEnrollmentWhere(ctx.user.id, lesson.courseId))
          .limit(1);
        if (!enrollment) {
          throw new TRPCError({ code: "FORBIDDEN", message: "يجب التسجيل في الدورة قبل التعليق" });
        }
      }
      const [result] = await db.insert(lessonComments).values({
        lessonId: input.lessonId,
        userId: ctx.user.id,
        content: input.content.trim(),
        parentCommentId: input.parentCommentId ?? null,
      });
      return { success: true, id: Number(result.insertId) };
    }),

  delete: authMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      // User can delete their own comment; admin can delete any
      const [comment] = await db
        .select()
        .from(lessonComments)
        .where(eq(lessonComments.id, input.id))
        .limit(1);

      if (!comment) throw new Error("Comment not found");
      if (comment.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new Error("Not authorized to delete this comment");
      }

      await db.delete(lessonComments).where(eq(lessonComments.id, input.id));
      return { success: true };
    }),

  toggleLike: authMutation
    .input(z.object({ commentId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const [existing] = await db
        .select()
        .from(commentLikes)
        .where(and(
          eq(commentLikes.commentId, input.commentId),
          eq(commentLikes.userId, ctx.user.id),
        ))
        .limit(1);

      if (existing) {
        await db.delete(commentLikes).where(eq(commentLikes.id, existing.id));
        await db.update(lessonComments)
          .set({ likeCount: sql`${lessonComments.likeCount} - 1` })
          .where(eq(lessonComments.id, input.commentId));
        return { success: true, liked: false };
      }

      await db.insert(commentLikes).values({
        commentId: input.commentId,
        userId: ctx.user.id,
      });
      await db.update(lessonComments)
        .set({ likeCount: sql`${lessonComments.likeCount} + 1` })
        .where(eq(lessonComments.id, input.commentId));
      return { success: true, liked: true };
    }),

  pin: adminMutation
    .input(z.object({ id: z.number().int().positive(), isPinned: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(lessonComments)
        .set({ isPinned: input.isPinned })
        .where(eq(lessonComments.id, input.id));
      return { success: true };
    }),

  hide: adminMutation
    .input(z.object({ id: z.number().int().positive(), isHidden: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(lessonComments)
        .set({ isHidden: input.isHidden })
        .where(eq(lessonComments.id, input.id));
      return { success: true };
    }),
});
