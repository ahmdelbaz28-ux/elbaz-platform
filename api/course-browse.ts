/**
 * COURSE BROWSING — Public read-only endpoints
 *
 * Procedures: categories, list, bySlug, testimonials, stats
 * All are publicQuery (no authentication required).
 */

import { z } from "zod";
import { eq, and, desc, asc, sql, like, or } from "drizzle-orm";
import { publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { courses, categories, lessons, testimonials } from "@db/schema";
import { getCache, CACHE_TTL, cacheKeys } from "./lib/cache";

// ─── Types ───────────────────────────────────────────────────────────

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
  price: string;
  originalPrice: string | null;
  durationHours: number;
  rating: string;
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

// ─── Procedures ─────────────────────────────────────────────────────

export const courseBrowseProcedures = {
  categories: publicQuery.query(async () => {
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
        search: z.string().max(100).optional(),
        featured: z.boolean().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(50).default(12),
      }).optional()
    )
    .query(async ({ input }) => {
      const isSearch = input?.search && input.search.trim().length > 0;
      const cacheKey = isSearch ? "" : cacheKeys.courseList(JSON.stringify(input || {}));

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

      if (input?.search && input.search.trim().length > 0) {
        const rawSearch = input.search.trim();
        const escapedSearch = rawSearch.replaceAll(/[%_\\]/g, (char) => `\\${char}`);
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
        })
        .from(lessons)
        .where(and(eq(lessons.courseId, course.id), eq(lessons.isPublished, true)))
        .orderBy(asc(lessons.sortOrder));

      const result = { ...course, category, lessons: courseLessons };
      await cache.set(cacheKey, result, CACHE_TTL.COURSE_DETAIL);
      return result;
    }),

  testimonials: publicQuery.query(async () => {
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
    if (cached && (cached.totalCourses > 0 || cached.totalStudents > 0 || cached.totalLessons > 0)) {
      return cached;
    }

    const db = getDb();
    const [rawRows] = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM courses WHERE isPublished = 1) AS totalCourses,
        (SELECT COUNT(*) FROM users WHERE role = 'user') AS totalStudents,
        (SELECT COUNT(*) FROM lessons) AS totalLessons,
        COALESCE((SELECT AVG(rating) FROM courses WHERE isPublished = 1), 0) AS avgRating
    `) as unknown as [Array<{ totalCourses: number; totalStudents: number; totalLessons: number; avgRating: string }>, unknown];
    const row = rawRows[0];

    const totalCourses = Number(row?.totalCourses ?? 0) || 0;
    const totalStudents = Number(row?.totalStudents ?? 0) || 0;
    const totalLessons = Number(row?.totalLessons ?? 0) || 0;
    const satisfactionRate = row?.avgRating ? Math.round(Number.parseFloat(row.avgRating) * 20) : 0;

    const result = { totalCourses, totalStudents, totalLessons, satisfactionRate };
    await cache.set(cacheKeys.stats(), result, CACHE_TTL.STATS);
    return result;
  }),
};
