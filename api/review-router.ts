import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, and, count } from "drizzle-orm";
import { createRouter, authQuery, authMutation, adminQuery, adminMutation, publicMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { reviews, courses, users } from "@db/schema";

export const reviewRouter = createRouter({
  listByCourse: publicMutation
    .input(z.object({ courseId: z.number(), page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const db = getDb();
      const page = input.page;
      const limit = input.limit;
      const offset = (page - 1) * limit;

      const [[{ total }], items] = await Promise.all([
        db.select({ total: count() }).from(reviews).where(and(eq(reviews.courseId, input.courseId), eq(reviews.isPublished, true))),
        db.select({
          id: reviews.id,
          userId: reviews.userId,
          courseId: reviews.courseId,
          rating: reviews.rating,
          comment: reviews.comment,
          createdAt: reviews.createdAt,
          updatedAt: reviews.updatedAt,
          userName: users.name,
          userUsername: users.username,
        })
          .from(reviews)
          .leftJoin(users, eq(reviews.userId, users.id))
          .where(and(eq(reviews.courseId, input.courseId), eq(reviews.isPublished, true)))
          .orderBy(desc(reviews.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { items, total: total ?? 0 };
    }),

  myReview: authQuery
    .input(z.object({ courseId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [review] = await db
        .select()
        .from(reviews)
        .where(and(eq(reviews.courseId, input.courseId), eq(reviews.userId, ctx.user.id)))
        .limit(1);
      return review || null;
    }),

  create: authMutation
    .input(z.object({
      courseId: z.number(),
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, input.courseId)).limit(1);
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });

      const [existing] = await db
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(eq(reviews.courseId, input.courseId), eq(reviews.userId, ctx.user.id)))
        .limit(1);

      if (existing) {
        await db
          .update(reviews)
          .set({ rating: input.rating, comment: input.comment || null, updatedAt: new Date() })
          .where(eq(reviews.id, existing.id));
        return { success: true, action: "updated" };
      }

      await db.insert(reviews).values({
        userId: ctx.user.id,
        courseId: input.courseId,
        rating: input.rating,
        comment: input.comment || null,
      });

      return { success: true, action: "created" };
    }),

  delete: authMutation
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [review] = await db
        .select({ userId: reviews.userId })
        .from(reviews)
        .where(eq(reviews.id, input.id))
        .limit(1);

      if (!review) throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
      if (review.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your review" });
      }

      await db.delete(reviews).where(eq(reviews.id, input.id));
      return { success: true };
    }),

  courseAverage: publicMutation
    .input(z.object({ courseId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const result = await db
        .select({
          avg: reviews.rating,
          total: count(),
        })
        .from(reviews)
        .where(and(eq(reviews.courseId, input.courseId), eq(reviews.isPublished, true)));

      if (result.length === 0) return { average: 0, total: 0 };
      const sum = result.reduce((acc, r) => acc + r.avg, 0);
      return { average: sum / result.length, total: result.length };
    }),

  // 🔒 SECURITY FIX (Task ID 6): Changed authQuery → adminQuery.
  // Previously any logged-in user could list all reviews across all courses
  // (information disclosure of user names + review content + moderation status).
  adminList: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20), courseId: z.number().optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const page = input.page;
      const limit = input.limit;
      const offset = (page - 1) * limit;
      const conditions = [eq(reviews.isPublished, true)];
      if (input.courseId) conditions.push(eq(reviews.courseId, input.courseId));

      const [[{ total }], items] = await Promise.all([
        db.select({ total: count() }).from(reviews).where(and(...conditions)),
        db.select({
          id: reviews.id,
          userId: reviews.userId,
          courseId: reviews.courseId,
          rating: reviews.rating,
          comment: reviews.comment,
          isPublished: reviews.isPublished,
          createdAt: reviews.createdAt,
          userName: users.name,
          userUsername: users.username,
          courseTitle: courses.titleEn,
        })
          .from(reviews)
          .leftJoin(users, eq(reviews.userId, users.id))
          .leftJoin(courses, eq(reviews.courseId, courses.id))
          .where(and(...conditions))
          .orderBy(desc(reviews.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { items, total: total ?? 0 };
    }),

  // 🔒 SECURITY FIX (Task ID 6): Changed authMutation → adminMutation.
  // Previously any logged-in user could hide/show ANY review (PR/defacement).
  adminTogglePublish: adminMutation
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [review] = await db.select({ isPublished: reviews.isPublished }).from(reviews).where(eq(reviews.id, input.id)).limit(1);
      if (!review) throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
      await db.update(reviews).set({ isPublished: !review.isPublished }).where(eq(reviews.id, input.id));
      return { success: true };
    }),
});
