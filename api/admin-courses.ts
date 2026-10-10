/**
 * ADMIN COURSES — Course & lesson management endpoints
 *
 * Procedures: listCourses, updateCourse, createCourse, deleteCourse,
 *             listLessons, createLesson, updateLesson, deleteLesson
 */

import { z } from "zod";
import { asc, desc, eq, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminQuery, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { courses, lessons, enrollments, payments, wishlists, reviews } from "@db/schema";

export const adminCoursesProcedures = {
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
          shortDescEn: courses.shortDescEn,
          shortDescAr: courses.shortDescAr,
          thumbnailUrl: courses.thumbnail,
          price: courses.price,
          isPremium: courses.isPremium,
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
      shortDescEn: z.string().max(500).optional(),
      shortDescAr: z.string().max(500).optional(),
      thumbnailUrl: z.string().max(1000).optional(),
      price: z.number().optional(),
      isFeatured: z.boolean().optional(),
      isPublished: z.boolean().optional(),
      isPremium: z.boolean().optional(),
      level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
      categoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, thumbnailUrl, price, ...updates } = input;
      const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (thumbnailUrl !== undefined) cleanUpdates.thumbnail = thumbnailUrl;
      if (price !== undefined) cleanUpdates.price = price.toFixed(2);
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(courses).set({ ...cleanUpdates, updatedAt: new Date() }).where(eq(courses.id, id));
      return { success: true };
    }),

  createCourse: adminMutation
    .input(z.object({
      slug: z.string().min(2).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
      categoryId: z.number().int().positive(),
      titleEn: z.string().min(2).max(500),
      titleAr: z.string().min(2).max(500),
      descriptionEn: z.string().max(10000).optional(),
      descriptionAr: z.string().max(10000).optional(),
      shortDescEn: z.string().max(500).optional(),
      shortDescAr: z.string().max(500).optional(),
      thumbnailUrl: z.string().max(1000).optional(),
      level: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
      isPremium: z.boolean().default(false),
      price: z.number().min(0).default(0),
      originalPrice: z.number().min(0).optional(),
      isPublished: z.boolean().default(false),
      isFeatured: z.boolean().default(false),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      // Enforce slug uniqueness with a friendly error (slug is a unique index)
      const [existing] = await db.select({ id: courses.id }).from(courses).where(eq(courses.slug, input.slug)).limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A course with this slug already exists" });
      }

      const [created] = await db.insert(courses).values({
        slug: input.slug,
        categoryId: input.categoryId,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        descriptionEn: input.descriptionEn ?? null,
        descriptionAr: input.descriptionAr ?? null,
        shortDescEn: input.shortDescEn ?? null,
        shortDescAr: input.shortDescAr ?? null,
        thumbnail: input.thumbnailUrl ?? null,
        level: input.level,
        isPremium: input.isPremium,
        price: input.price.toFixed(2),
        originalPrice: (input.originalPrice ?? input.price).toFixed(2),
        isPublished: input.isPublished,
        isFeatured: input.isFeatured,
        sortOrder: input.sortOrder,
      }).$returningId();

      return { success: true, id: created?.id };
    }),

  deleteCourse: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();

      const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, input.id)).limit(1);
      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      }

      // Clean course-scoped rows explicitly (payments is RESTRICT on courses).
      // lessonProgress / quizQuestions / userNotes cascade from lessons.
      const lessonIds = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.courseId, input.id));

      if (lessonIds.length > 0) {
        const ids = lessonIds.map((l) => l.id);
        const { inArray } = await import("drizzle-orm");
        const { lessonProgress, quizQuestions, userNotes } = await import("@db/schema");
        await db.delete(lessonProgress).where(inArray(lessonProgress.lessonId, ids));
        await db.delete(quizQuestions).where(inArray(quizQuestions.lessonId, ids));
        await db.delete(userNotes).where(inArray(userNotes.lessonId, ids));
      }

      await db.delete(payments).where(eq(payments.courseId, input.id));
      await db.delete(enrollments).where(eq(enrollments.courseId, input.id));
      await db.delete(wishlists).where(eq(wishlists.courseId, input.id));
      await db.delete(reviews).where(eq(reviews.courseId, input.id));
      await db.delete(lessons).where(eq(lessons.courseId, input.id));
      await db.delete(courses).where(eq(courses.id, input.id));

      return { success: true };
    }),

  // ─── Lesson management ───
  listLessons: adminQuery
    .input(z.object({ courseId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const items = await db.select().from(lessons)
        .where(eq(lessons.courseId, input.courseId))
        .orderBy(asc(lessons.sortOrder), asc(lessons.id));
      return { items };
    }),

  createLesson: adminMutation
    .input(z.object({
      courseId: z.number().int().positive(),
      titleEn: z.string().min(1).max(500),
      titleAr: z.string().min(1).max(500),
      descriptionEn: z.string().max(10000).optional(),
      descriptionAr: z.string().max(10000).optional(),
      videoUrl: z.string().max(500).optional(),
      durationMinutes: z.number().int().min(0).max(1440).default(30),
      isFree: z.boolean().default(false),
      isPublished: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, input.courseId)).limit(1);
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });

      // Append at the end of the course
      const [{ maxSort }] = await db.select({ maxSort: count() }).from(lessons).where(eq(lessons.courseId, input.courseId));

      const [created] = await db.insert(lessons).values({
        courseId: input.courseId,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        descriptionEn: input.descriptionEn ?? null,
        descriptionAr: input.descriptionAr ?? null,
        videoUrl: input.videoUrl?.trim() ? input.videoUrl.trim() : null,
        durationMinutes: input.durationMinutes,
        sortOrder: (maxSort ?? 0) + 1,
        isFree: input.isFree,
        isPublished: input.isPublished,
      }).$returningId();

      return { success: true, id: created?.id };
    }),

  updateLesson: adminMutation
    .input(z.object({
      id: z.number().int().positive(),
      titleEn: z.string().min(1).max(500).optional(),
      titleAr: z.string().min(1).max(500).optional(),
      descriptionEn: z.string().max(10000).optional(),
      descriptionAr: z.string().max(10000).optional(),
      videoUrl: z.string().max(500).nullable().optional(),
      durationMinutes: z.number().int().min(0).max(1440).optional(),
      sortOrder: z.number().int().min(0).optional(),
      isFree: z.boolean().optional(),
      isPublished: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, videoUrl, ...updates } = input;
      // Explicit type: videoUrl can legitimately be set to null (clears the lesson video).
      const cleanUpdates: Record<string, string | number | boolean | null> = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (videoUrl !== undefined) cleanUpdates.videoUrl = videoUrl && videoUrl.trim() ? videoUrl.trim() : null;
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(lessons).set(cleanUpdates).where(eq(lessons.id, id));
      return { success: true };
    }),

  deleteLesson: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { lessonProgress, quizQuestions, userNotes } = await import("@db/schema");
      await db.delete(lessonProgress).where(eq(lessonProgress.lessonId, input.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.lessonId, input.id));
      await db.delete(userNotes).where(eq(userNotes.lessonId, input.id));
      await db.delete(lessons).where(eq(lessons.id, input.id));
      return { success: true };
    }),
};
