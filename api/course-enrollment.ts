/**
 * COURSE ENROLLMENT — Enrollment-related endpoints
 *
 * Procedures: enrollments, checkEnrollment, courseProgress
 * All are authedQuery (authentication required).
 */

import { z } from "zod";
import { and, eq, desc, sql } from "drizzle-orm";
import { authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { courses, enrollments } from "@db/schema";
import { getCourseProgressDetail } from "./lib/progress";
import { activeEnrollmentWhere } from "./lib/enrollment";

export const courseEnrollmentProcedures = {
  enrollments: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    // ✅ FIX (pre-launch audit): the student dashboard previously listed EVERY
    // enrollment row — including refunded/cancelled ones the access gate
    // denies, producing "My Courses" cards that 403 on click. Keep completed
    // enrollments visible (certificate history) but hide refunded/cancelled.
    return await db
      .select({
        id: enrollments.id,
        courseId: enrollments.courseId,
        progress: enrollments.progress,
        isCompleted: enrollments.isCompleted,
        completedAt: enrollments.completedAt,
        lastAccessedAt: enrollments.lastAccessedAt,
        enrolledAt: enrollments.enrolledAt,
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
      .where(and(
        eq(enrollments.userId, ctx.user.id),
        sql`${enrollments.status} <> 'refunded' AND ${enrollments.status} <> 'cancelled'`,
      ))
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
        .where(activeEnrollmentWhere(ctx.user.id, input.courseId))
        .limit(1);
      return {
        enrolled: !!enrollment,
        isCompleted: enrollment?.isCompleted ?? false,
        progress: enrollment?.progress ?? 0,
      };
    }),

  courseProgress: authedQuery
    .input(z.object({ courseId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return getCourseProgressDetail(ctx.user.id, input.courseId);
    }),
};
