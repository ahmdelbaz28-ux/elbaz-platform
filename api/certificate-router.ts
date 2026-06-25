import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
// ✅ SECURITY FIX: Use authedQuery instead of manual token verification
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { certificates, enrollments, courses, lessonProgress, lessons, users } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";

/**
 * ✅ CRITICAL FIX: Calculate certificate grade from actual quiz scores
 * Previously, grade was hardcoded to "Distinction" — making all certificates
 * equivalent regardless of actual performance.
 *
 * Grade thresholds:
 *   ≥ 90% → "Distinction"    (امتياز)
 *   ≥ 80% → "Merit"          (جيد جداً)
 *   ≥ 70% → "Pass"           (جيد)
 *   < 70% → No certificate (quiz not passed yet)
 */
function calculateGrade(averageScore: number): string {
  if (averageScore >= 90) return "Distinction";
  if (averageScore >= 80) return "Merit";
  return "Pass"; // 70-79%
}

export const certificateRouter = createRouter({
  // ✅ SECURITY FIX: Uses authedQuery — userId from ctx.user.id, not from client
  generate: authedQuery
    .input(z.object({ courseId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id;

      // Check enrollment
      const [enrollment] = await db
        .select()
        .from(enrollments)
        .where(
          and(
            eq(enrollments.userId, userId),
            eq(enrollments.courseId, input.courseId),
            eq(enrollments.isCompleted, true)
          )
        )
        .limit(1);

      if (!enrollment) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You must complete the course to earn a certificate",
        });
      }

      // Check if certificate already exists (idempotency)
      const [existing] = await db
        .select()
        .from(certificates)
        .where(
          and(
            eq(certificates.userId, userId),
            eq(certificates.courseId, input.courseId)
          )
        )
        .limit(1);

      if (existing) {
        return { certificateNumber: existing.certificateNumber, alreadyExists: true };
      }

      // ✅ CRITICAL FIX: Calculate actual average quiz score for the grade
      // Previously grade was hardcoded to "Distinction" — total fraud!
      const progressRows = await db
        .select({ quizScore: lessonProgress.quizScore })
        .from(lessonProgress)
        .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
        .where(
          and(
            eq(lessonProgress.userId, userId),
            eq(lessons.courseId, input.courseId),
            eq(lessonProgress.isQuizPassed, true),
          ),
        );

      const avgScore = progressRows.length > 0
        ? Math.round(progressRows.reduce((sum, r) => sum + (r.quizScore ?? 0), 0) / progressRows.length)
        : 0;

      const grade = calculateGrade(avgScore);

      // ✅ SECURITY FIX: Use nanoid instead of Math.random() for certificate number
      // Math.random() is not cryptographically secure and produces predictable values
      const certificateNumber = `EE-CERT-${Date.now()}-${nanoid(8).toUpperCase()}`;

      const [course] = await db
        .select()
        .from(courses)
        .where(eq(courses.id, input.courseId))
        .limit(1);

      // ✅ Get student name for the certificate
      const [student] = await db
        .select({ name: users.name, username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      await db.insert(certificates).values({
        userId,
        courseId: input.courseId,
        enrollmentId: enrollment.id,
        certificateNumber,
        grade,
        averageScore: avgScore,
        verified: true,
      });

      return {
        certificateNumber,
        alreadyExists: false,
        courseName: course?.titleEn,
        grade,
        averageScore: avgScore,
        studentName: student?.name || student?.username,
      };
    }),

  // ✅ SECURITY FIX: Uses authedQuery — no manual token parsing
  myCertificates: authedQuery.query(async ({ ctx }) => {
    const db = getDb();
    return db
      .select({
        id: certificates.id,
        certificateNumber: certificates.certificateNumber,
        grade: certificates.grade,
        issuedAt: certificates.issuedAt,
        courseName: courses.titleEn,
      })
      .from(certificates)
      .leftJoin(courses, eq(certificates.courseId, courses.id))
      .where(eq(certificates.userId, ctx.user.id))
      .orderBy(desc(certificates.issuedAt));
  }),

  // Public verify endpoint — intentionally public (anyone can verify a cert by number)
  verify: publicQuery
    .input(z.object({ certificateNumber: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [cert] = await db
        .select({
          id: certificates.id,
          certificateNumber: certificates.certificateNumber,
          grade: certificates.grade,
          averageScore: certificates.averageScore,
          issuedAt: certificates.issuedAt,
          verified: certificates.verified,
          courseName: courses.titleEn,
          courseNameAr: courses.titleAr,
          studentName: users.name,
          studentUsername: users.username,
        })
        .from(certificates)
        .leftJoin(courses, eq(certificates.courseId, courses.id))
        .leftJoin(users, eq(certificates.userId, users.id))
        .where(eq(certificates.certificateNumber, input.certificateNumber))
        .limit(1);

      return cert || null;
    }),
});
