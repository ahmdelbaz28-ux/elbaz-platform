import { z } from "zod";
import { eq, and, desc, asc, sql, like, or } from "drizzle-orm";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { courses, categories, lessons, enrollments, testimonials, users, lessonProgress } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { recalcEnrollmentProgress, markLessonWatched, getCourseProgressDetail } from "./lib/progress";
import { getSecureVideoUrl } from "./lib/video-protection";
import { getCache, CACHE_TTL, cacheKeys } from "./lib/cache";

export const courseRouter = createRouter({
  categories: publicQuery.query(async () => {
    // ✅ CACHE: Categories rarely change — cache for 30 minutes
    const cache = getCache();
    const cached = await cache.get(cacheKeys.categories());
    if (cached) return cached;

    const db = getDb();
    const result = await db.select().from(categories).orderBy(asc(categories.sortOrder));
    await cache.set(cacheKeys.categories(), result, CACHE_TTL.CATEGORIES);
    return result;
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
      // ✅ CACHE: Course list with filter params — cache for 5 minutes
      // Don't cache search queries (unique per search term)
      const isSearch = input?.search && input.search.trim().length > 0;
      const cacheKey = !isSearch ? cacheKeys.courseList(JSON.stringify(input || {})) : "";

      if (!isSearch) {
        const cache = getCache();
        const cached = await cache.get(cacheKey);
        if (cached) return cached;
      }

      const db = getDb();
      const conditions = [eq(courses.isPublished, true)];

      if (input?.categoryId) conditions.push(eq(courses.categoryId, input.categoryId));
      if (input?.isPremium !== undefined) conditions.push(eq(courses.isPremium, input.isPremium));
      if (input?.level) conditions.push(eq(courses.level, input.level));
      if (input?.featured) conditions.push(eq(courses.isFeatured, true));

      // Full-text search — searches title and description in both languages
      // SECURITY: Escape SQL LIKE wildcards to prevent pattern injection
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

      // Cache the result (only for non-search queries)
      if (!isSearch) {
        const cache = getCache();
        await cache.set(cacheKey, result, CACHE_TTL.COURSES);
      }

      return result;
    }),

  bySlug: publicQuery
    .input(z.object({ slug: z.string().max(255) }))
    .query(async ({ input }) => {
      // ✅ CACHE: Course detail by slug — cache for 5 minutes
      const cache = getCache();
      const cacheKey = cacheKeys.courseDetail(input.slug);
      const cached = await cache.get(cacheKey);
      if (cached) return cached;

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

      const result = { ...course, category, lessons: courseLessons };
      await cache.set(cacheKey, result, CACHE_TTL.COURSE_DETAIL);
      return result;
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
  // ✅ FIX: Added leftJoin to courses table so enrollment.course data is available
  // Dashboard.tsx needs: enrollment.course.slug, enrollment.course.titleAr, etc.
  enrollments: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select({
        id: enrollments.id,
        courseId: enrollments.courseId,
        progress: enrollments.progress,
        isCompleted: enrollments.isCompleted,
        completedAt: enrollments.completedAt,
        lastAccessedAt: enrollments.lastAccessedAt,
        createdAt: enrollments.createdAt,
        // Join course data — needed by Dashboard to display course name/slug
        course: {
          id: courses.id,
          slug: courses.slug,
          titleEn: courses.titleEn,
          titleAr: courses.titleAr,
          thumbnail: courses.thumbnail,
          durationHours: courses.durationHours,
          level: courses.level,
          isPremium: courses.isPremium,
          price: courses.price,
        },
      })
      .from(enrollments)
      .leftJoin(courses, eq(enrollments.courseId, courses.id))
      .where(eq(enrollments.userId, ctx.user.id))
      .orderBy(desc(enrollments.lastAccessedAt));
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
    // ✅ CACHE: Testimonials change infrequently — cache for 15 minutes
    const cache = getCache();
    const cached = await cache.get(cacheKeys.testimonials());
    if (cached) return cached;

    const db = getDb();
    const result = await db
      .select()
      .from(testimonials)
      .where(eq(testimonials.isPublished, true))
      .orderBy(desc(testimonials.createdAt));
    await cache.set(cacheKeys.testimonials(), result, CACHE_TTL.TESTIMONIALS);
    return result;
  }),

  stats: publicQuery.query(async () => {
    // ✅ CACHE: Homepage stats — cache for 10 minutes (expensive aggregation queries)
    const cache = getCache();
    const cached = await cache.get(cacheKeys.stats());
    if (cached) return cached;

    const db = getDb();
    const [courseCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(courses)
      .where(eq(courses.isPublished, true));
    // Count only regular users (exclude admins/bots)
    const [studentCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.role, "user"));
    const [lessonCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(lessons);

    // Calculate actual satisfaction rate from course ratings
    const [ratingData] = await db
      .select({ avg: sql<string>`COALESCE(AVG(${courses.rating}), 0)` })
      .from(courses)
      .where(eq(courses.isPublished, true));
    const satisfactionRate = ratingData ? Math.round(parseFloat(ratingData.avg) * 20) : 0;

    const result = {
      totalCourses: courseCount.count || 0,
      totalStudents: studentCount.count || 0,
      totalLessons: lessonCount.count || 0,
      satisfactionRate,
    };

    await cache.set(cacheKeys.stats(), result, CACHE_TTL.STATS);
    return result;
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

  // ═══════════════════════════════════════════════════════════
  // WATCH TIME TRACKING — Heartbeat System
  // ═══════════════════════════════════════════════════════════
  // Every 60 seconds while the video plays, the browser sends a
  // "heartbeat" with the current position and watched seconds.
  // This enables: resume playback, total watch time stats,
  // engagement analytics, and shared account detection.
  // ═══════════════════════════════════════════════════════════

  /**
   * Send a heartbeat — update watch time and current position.
   * Called automatically by useWatchTracker hook every 60 seconds.
   * Also called on pause/visibility change/page leave (final save).
   */
  heartbeat: authedQuery
    .input(z.object({
      lessonId: z.number().int().positive(),
      watchedSeconds: z.number().int().min(0).max(86400), // Max 24h per heartbeat
      lastPosition: z.number().int().min(0),              // Current playback position in seconds
    }))
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
          throw new TRPCError({ code: "FORBIDDEN", message: "Enrollment required" });
        }
      }

      // Upsert lesson progress with watch time data
      const existing = await db
        .select()
        .from(lessonProgress)
        .where(and(eq(lessonProgress.userId, ctx.user.id), eq(lessonProgress.lessonId, input.lessonId)))
        .limit(1);

      if (existing && existing.length > 0) {
        await db
          .update(lessonProgress)
          .set({
            watchedSeconds: (existing[0].watchedSeconds || 0) + input.watchedSeconds,
            lastPosition: input.lastPosition,
            lastHeartbeatAt: new Date(),
          })
          .where(eq(lessonProgress.id, existing[0].id));
      } else {
        await db.insert(lessonProgress).values({
          userId: ctx.user.id,
          lessonId: input.lessonId,
          isCompleted: false,
          isQuizPassed: false,
          quizScore: 0,
          watchedSeconds: input.watchedSeconds,
          lastPosition: input.lastPosition,
          lastHeartbeatAt: new Date(),
        });
      }

      // Update enrollment lastAccessedAt
      await db
        .update(enrollments)
        .set({ lastAccessedAt: new Date() })
        .where(and(eq(enrollments.userId, ctx.user.id), eq(enrollments.courseId, lesson.courseId)));

      return { success: true };
    }),

  /**
   * Get saved position for a lesson — enables "resume from where you stopped".
   * Called when the user opens a lesson.
   */
  getSavedPosition: authedQuery
    .input(z.object({ lessonId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [progress] = await db
        .select({
          lastPosition: lessonProgress.lastPosition,
          watchedSeconds: lessonProgress.watchedSeconds,
          isCompleted: lessonProgress.isCompleted,
        })
        .from(lessonProgress)
        .where(and(eq(lessonProgress.userId, ctx.user.id), eq(lessonProgress.lessonId, input.lessonId)))
        .limit(1);

      return progress || { lastPosition: 0, watchedSeconds: 0, isCompleted: false };
    }),

  /**
   * Get total watch time for the authenticated user across all courses.
   * Used in Dashboard to show total learning time.
   */
  myWatchTime: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [result] = await db
      .select({ totalSeconds: sql<number>`COALESCE(SUM(${lessonProgress.watchedSeconds}), 0)` })
      .from(lessonProgress)
      .where(eq(lessonProgress.userId, ctx.user.id));

    const totalSeconds = result?.totalSeconds || 0;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    return {
      totalSeconds,
      formatted: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
    };
  }),
});
