/**
 * COURSE ENROLLMENT — Enrollment-related endpoints
 *
 * Procedures: enrollments, checkEnrollment, courseProgress
 * All are authedQuery (authentication required).
 */

import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { courses, enrollments } from "@db/schema";
import { getCourseProgressDetail } from "./lib/progress";

export const courseEnrollmentProcedures = {
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

  courseProgress: authedQuery
    .input(z.object({ courseId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      return getCourseProgressDetail(ctx.user.id, input.courseId);
    }),
};
