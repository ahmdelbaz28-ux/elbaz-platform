import { z } from "zod";
import { eq, and, desc, asc, sql, like, or } from "drizzle-orm";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { courses, categories, lessons, enrollments, testimonials, users, lessonProgress } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { recalcEnrollmentProgress, markLessonWatched, getCourseProgressDetail } from "./lib/progress";
import { getSecureVideoUrl } from "./lib/video-protection";

export const courseRouter = createRouter({
  categories: publicQuery.query(async () => {
    const db = getDb();
    return db.select().from(categories).orderBy(asc(categories.sortOrder));
  }),

  list: publicQuery
    .input(
      z.object({
        categoryId: z.number().optional(),
        isPremium: z.boolean().optional(),
        level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
        search: z.string().max(100).optional(), // ✅ Fixed: search now actually works
        featured: z.boolean().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(12),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [eq(courses.isPublished, true)];

      if (input?.categoryId) conditions.push(eq(courses.categoryId, input.categoryId));
      if (input?.isPremium !== undefined) conditions.push(eq(courses.isPremium, input.isPremium));
      if (input?.level) conditions.push(eq(courses.level, input.level));
      if (input?.featured) conditions.push(eq(courses.isFeatured, true));

      // ✅ Full-text search — searches title and description in both languages
      // ✅ SECURITY FIX: Escape SQL LIKE wildcards to prevent pattern injection
      if (input?.search && input.search.trim().length > 0) {
        const rawSearch = input.search.trim();
        // Escape special LIKE characters: % → \%, _ → \_, \ → \\
        const escapedSearch = rawSearch.replace(/[%_\\]/g, (char) => `\\${char}`);
        const term = `%${escapedSearch}%`;
        conditions.push(
          or(
            like(courses.titleEn, term),
            like(courses.titleAr, term),
            like(courses.shortDescEn, term),
            like(courses.shortDescAr, term)
          )!
        );
      }

      const offset = ((input?.page ?? 1) - 1) * (input?.limit ?? 12);

      const result = await db
        .select({
          id: courses.id,
          slug: courses.slug,
          categoryId: courses.categoryId,
          titleEn: courses.titleEn,
          titleAr: courses.titleAr,
          shortDescEn: courses.shortDescEn,
          shortDescAr: courses.shortDescAr,
          thumbnail: courses.thumbnail,
          level: courses.level,
          isPremium: courses.isPremium,
          price: courses.price,
          originalPrice: courses.originalPrice,
          durationHours: courses.durationHours,
          rating: courses.rating,
          reviewCount: courses.reviewCount,
          studentCount: courses.studentCount,
          instructorName: courses.instructorName,
          isFeatured: courses.isFeatured,
          createdAt: courses.createdAt,
          categoryName: categories.nameEn,
          categoryNameAr: categories.nameAr,
        })
        .from(courses)
        .leftJoin(categories, eq(courses.categoryId, categories.id))
        .where(and(...conditions))
        .orderBy(desc(courses.isFeatured), desc(courses.createdAt))
        .limit(input?.limit ?? 12)
        .offset(offset);

      return result;
    }),

  bySlug: publicQuery
    .input(z.object({ slug: z.string().max(255) }))
    .query(async ({ input }) => {
      const db = getDb();
      const [course] = await db
        .select()
        .from(courses)
        .where(and(eq(courses.slug, input.slug), eq(courses.isPublished, true)))
        .limit(1);

      if (!course) return null;

      const [category] = await db
        .select()
        .from(categories)
        .where(eq(categories.id, course.categoryId))
        .limit(1);

      // ✅ Only return published lessons, ordered correctly
      const courseLessons = await db
        .select({
          id: lessons.id,
          courseId: lessons.courseId,
          titleEn: lessons.titleEn,
          titleAr: lessons.titleAr,
          descriptionEn: lessons.descriptionEn,
          descriptionAr: lessons.descriptionAr,
          durationMinutes: lessons.durationMinutes,
          sortOrder: lessons.sortOrder,
          isFree: lessons.isFree,
          // ✅ SECURITY: Never expose videoUrl in public listing — only for enrolled users
          // videoUrl is fetched separately via authenticated lessonVideo endpoint
        })
        .from(lessons)
        .where(and(eq(lessons.courseId, course.id), eq(lessons.isPublished, true)))
        .orderBy(asc(lessons.sortOrder));

      return { ...course, category, lessons: courseLessons };
    }),

  // ✅ SECURITY: Authenticated endpoint to get video URL — validates enrollment first
  lessonVideo: authedQuery
    .input(z.object({ lessonId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();

      const [lesson] = await db
        .select()
        .from(lessons)
        .where(eq(lessons.id, input.lessonId))
        .limit(1);

      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });

      // Free lessons — anyone authenticated can watch
      if (lesson.isFree) {
        // ✅ Generate secure presigned URL (R2) or HMAC fallback
        const result = await getSecureVideoUrl({
          videoUrl: lesson.videoUrl || "",
          userId: ctx.user.id,
          lessonId: lesson.id,
          username: ctx.user.username,
        });
        return result;
      }

      // Premium lessons — must be enrolled
      const [enrollment] = await db
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(and(
          eq(enrollments.userId, ctx.user.id),
          eq(enrollments.courseId, lesson.courseId)
        ))
        .limit(1);

      if (!enrollment) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You must be enrolled in this course to watch this lesson.",
        });
      }

      // ✅ Generate secure presigned URL (R2) or HMAC fallback
      // The URL expires in 30 minutes and is cryptographically signed
      const result = await getSecureVideoUrl({
        videoUrl: lesson.videoUrl || "",
        userId: ctx.user.id,
        lessonId: lesson.id,
        username: ctx.user.username,
      });

      return result;
    }),

  // ✅ SECURITY: User can only check their own enrollment
  enrollments: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select()
      .from(enrollments)
      .where(eq(enrollments.userId, ctx.user.id))
      .orderBy(desc(enrollments.createdAt));
  }),

  checkEnrollment: authedQuery
    .input(z.object({ courseId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [enrollment] = await db
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(and(
          eq(enrollments.userId, ctx.user.id),
          eq(enrollments.courseId, input.courseId)
        ))
        .limit(1);
      return !!enrollment;
    }),

  testimonials: publicQuery.query(async () => {
    const db = getDb();
    return db
      .select()
      .from(testimonials)
      .where(eq(testimonials.isPublished, true))
      .orderBy(desc(testimonials.createdAt));
  }),

  stats: publicQuery.query(async () => {
    const db = getDb();
    const [courseCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(courses)
      .where(eq(courses.isPublished, true));
    // ✅ FIXED: Count only regular users (exclude admins/bots)
    const [studentCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.role, "user"));
    const [lessonCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(lessons);

    // ✅ FIXED: Calculate actual satisfaction rate from course ratings
    const [ratingData] = await db
      .select({ avg: sql<string>`COALESCE(AVG(${courses.rating}), 0)` })
      .from(courses)
      .where(eq(courses.isPublished, true));
    const satisfactionRate = ratingData ? Math.round(parseFloat(ratingData.avg) * 20) : 0; // Convert 5-star to percentage

    return {
      totalCourses: courseCount.count || 0,
      totalStudents: studentCount.count || 0,
      totalLessons: lessonCount.count || 0,
      satisfactionRate,
    };
  }),

  // ✅ CRITICAL FIX: Mark lesson as watched (video completed)
  // This is for lessons where watching the video is sufficient (no quiz required)
  markWatched: authedQuery
    .input(z.object({ lessonId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // Verify lesson exists
      const [lesson] = await db
        .select({ courseId: lessons.courseId, isFree: lessons.isFree })
        .from(lessons)
        .where(eq(lessons.id, input.lessonId))
        .limit(1);

      if (!lesson) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      }

      // Verify enrollment for premium lessons
      if (!lesson.isFree) {
        const [enrollment] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(and(
            eq(enrollments.userId, ctx.user.id),
            eq(enrollments.courseId, lesson.courseId),
          ))
          .limit(1);

        if (!enrollment) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You must be enrolled to mark lessons" });
        }
      }

      await markLessonWatched(ctx.user.id, input.lessonId);

      // Return updated course progress
      const progress = await recalcEnrollmentProgress(ctx.user.id, lesson.courseId);
      return { success: true, ...progress };
    }),

  // ✅ CRITICAL FIX: Get detailed progress for a course enrollment
  courseProgress: authedQuery
    .input(z.object({ courseId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return getCourseProgressDetail(ctx.user.id, input.courseId);
    }),
});
