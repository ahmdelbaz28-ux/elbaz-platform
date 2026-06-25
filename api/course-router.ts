import { z } from "zod";
import { eq, and, desc, asc, sql, like, or } from "drizzle-orm";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { courses, categories, lessons, enrollments, testimonials, lessonProgress } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { recalcEnrollmentProgress, markLessonWatched, getCourseProgressDetail } from "./lib/progress";
import { getSecureVideoUrl } from "./lib/video-protection";
import { getCache, CACHE_TTL, cacheKeys } from "./lib/cache";

// ─── Response Types ────────────────────────────────────────────────────────────

type Category = typeof categories.$inferSelect;
type Testimonial = typeof testimonials.$inferSelect;

type CourseListItem = {
  id: number;
  slug: string;
  titleEn: string;
  titleAr: string;
  shortDescEn: string | null;
  shortDescAr: string | null;
  thumbnail: string | null;
  level: string;
  isPremium: boolean;
  price: string; // decimal in DB, returned as string
  originalPrice: string | null;
  durationHours: number;
  rating: string; // decimal in DB
  reviewCount: number;
  studentCount: number;
  instructorName: string;
  isFeatured: boolean;
  createdAt: Date;
  categoryName?: string | null;
  categoryNameAr?: string | null;
};

type CourseListResponse = {
  items: CourseListItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
};

type StatsResponse = {
  totalCourses: number;
  totalStudents: number;
  totalLessons: number;
  satisfactionRate: number;
};

// ───────────────────────────────────────────────────────────────────────────────

export const courseRouter = createRouter({
  categories: publicQuery.query(async () => {
    // ✅ CACHE: Categories rarely change — cache for 30 minutes
    const cache = getCache();
    const cached = await cache.get<Category[]>(cacheKeys.categories());
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
        const cached = await cache.get<CourseListResponse>(cacheKey);
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

      // ✅ CRITICAL FIX: Get total count for pagination
      // Without this, the frontend cannot know the total number of pages
      const [countResult] = await db
        .select({ total: sql<number>`count(*)` })
        .from(courses)
        .where(and(...conditions));
      const totalCount = countResult?.total ?? 0;

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
        await cache.set(cacheKey, { items: result, pagination: { page: input?.page ?? 1, limit: input?.limit ?? 12, totalCount, totalPages: Math.ceil(totalCount / (input?.limit ?? 12)) } }, CACHE_TTL.COURSES);
      }

      return {
        items: result,
        pagination: {
          page: input?.page ?? 1,
          limit: input?.limit ?? 12,
          totalCount,
          totalPages: Math.ceil(totalCount / (input?.limit ?? 12)),
        },
      };
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
        enrolledAt: enrollments.enrolledAt,
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
        .select({
          id: enrollments.id,
          isCompleted: enrollments.isCompleted,
          progress: enrollments.progress,
        })
        .from(enrollments)
        .where(and(
          eq(enrollments.userId, ctx.user.id),
          eq(enrollments.courseId, input.courseId)
        ))
        .limit(1);
      return {
        enrolled: !!enrollment,
        isCompleted: enrollment?.isCompleted ?? false,
        progress: enrollment?.progress ?? 0,
      };
    }),

   testimonials: publicQuery.query(async () => {
     // ✅ CACHE: Testimonials change infrequently — cache for 15 minutes
     const cache = getCache();
     const cached = await cache.get<Testimonial[]>(cacheKeys.testimonials());
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
     const cache = getCache();
     const cached = await cache.get<StatsResponse>(cacheKeys.stats());
     if (cached) return cached;

    const db = getDb();
    const rows = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM courses WHERE isPublished = 1) AS totalCourses,
        (SELECT COUNT(*) FROM users WHERE role = 'user') AS totalStudents,
        (SELECT COUNT(*) FROM lessons) AS totalLessons,
        COALESCE((SELECT AVG(rating) FROM courses WHERE isPublished = 1), 0) AS avgRating
    `) as unknown as Array<{ totalCourses: number; totalStudents: number; totalLessons: number; avgRating: string }>;
    const row = rows[0];

    const totalCourses = Number(row?.totalCourses ?? 0) || 0;
    const totalStudents = Number(row?.totalStudents ?? 0) || 0;
    const totalLessons = Number(row?.totalLessons ?? 0) || 0;
    const satisfactionRate = row?.avgRating ? Math.round(parseFloat(row.avgRating) * 20) : 0;

    const result = { totalCourses, totalStudents, totalLessons, satisfactionRate };

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
      watchedSeconds: z.number().int().min(0).max(300), // Max 5 minutes per heartbeat (matches client cap)
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

      // SECURITY FIX: Use atomic UPSERT to prevent race condition
      // Previously used SELECT + INSERT/UPDATE which could lose watch time
      // if two heartbeats arrived simultaneously (e.g., tab + background)
      await db.execute(
        sql`INSERT INTO lessonProgress (\`userId\`, \`lessonId\`, \`isCompleted\`, \`isQuizPassed\`, \`quizScore\`, \`watchedSeconds\`, \`lastPosition\`, \`lastHeartbeatAt\`)
         VALUES (${ctx.user.id}, ${input.lessonId}, false, false, 0, ${input.watchedSeconds}, ${input.lastPosition}, NOW())
         ON DUPLICATE KEY UPDATE
           \`watchedSeconds\` = \`watchedSeconds\` + ${input.watchedSeconds},
           \`lastPosition\` = ${input.lastPosition},
           \`lastHeartbeatAt\` = NOW()`
      );

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
