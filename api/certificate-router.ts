import { certificates, courses, enrollments, lessonProgress, lessons, quizQuestions, users } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { activeEnrollmentWhere } from "./lib/enrollment";
// ✅ SECURITY FIX: Use authedQuery instead of manual token verification
import { authedQuery, createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";

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

      // Check enrollment — ✅ SECURITY FIX (audit run-1): require an ACTIVE,
      // unexpired enrollment (refunded students previously kept certificate
      // access because the gate tested row existence only).
      // PERF: enrollment and the idempotency check are independent — run both
      // in parallel (phase 1: access gates).
      const [enrollmentRows, existingRows] = await Promise.all([
        db
          .select()
          .from(enrollments)
          .where(
            and(
              activeEnrollmentWhere(userId, input.courseId),
              eq(enrollments.isCompleted, true)
            )
          )
          .limit(1),
        db
          .select()
          .from(certificates)
          .where(
            and(
              eq(certificates.userId, userId),
              eq(certificates.courseId, input.courseId)
            )
          )
          .limit(1),
      ]);
      const [enrollment] = enrollmentRows;

      if (!enrollment) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You must complete the course to earn a certificate",
        });
      }

      const [existing] = existingRows;
      if (existing) {
        return { certificateNumber: existing.certificateNumber, alreadyExists: true };
      }

      // ✅ CRITICAL FIX: Calculate actual average quiz score for the grade
      // Previously grade was hardcoded to "Distinction" — total fraud!
      // PERF: these four reads are mutually independent — run them in parallel
      // (phase 2: grade + certificate payload).
      // ✅ SECURITY FIX (audit run-1, fp certificate-router.grade-gate
      // .passed-only-denominator): the denominator was "progress rows WHERE
      // isQuizPassed = true" — the gate `avg >= 70` could never fail once ANY
      // quiz passed (N passed at 100 / N passed = 100), so one passed quiz
      // minted a public "Distinction" certificate regardless of the other
      // quizzes. The average now runs over EVERY published quiz lesson of the
      // course — missing/failed attempts count as 0 — so the gate is a real
      // ≥70 across the whole assessment.
      const [quizLessonRows, progressAllRows, courseRows, studentRows] = await Promise.all([
        db
          .select({ lessonId: lessons.id })
          .from(quizQuestions)
          .innerJoin(lessons, eq(quizQuestions.lessonId, lessons.id))
          .where(
            and(
              eq(lessons.courseId, input.courseId),
              // Same publish predicate as the progress engine's total side —
              // draft/withdrawn lessons must never enter the denominator.
              eq(lessons.isPublished, true),
            ),
          ),
        db
          .select({ lessonId: lessonProgress.lessonId, quizScore: lessonProgress.quizScore })
          .from(lessonProgress)
          .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
          .where(
            and(
              eq(lessonProgress.userId, userId),
              eq(lessons.courseId, input.courseId),
              eq(lessons.isPublished, true),
            ),
          ),
        db
          .select()
          .from(courses)
          .where(eq(courses.id, input.courseId))
          .limit(1),
        db
          .select({ name: users.name, username: users.username })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1),
      ]);
      const [course] = courseRows;
      const [student] = studentRows;

      const quizLessonIds = [...new Set(quizLessonRows.map((r) => r.lessonId))];
      const scoreByLesson = new Map(progressAllRows.map((r) => [r.lessonId, r.quizScore ?? 0]));
      const avgScore = quizLessonIds.length > 0
        ? Math.round(
            quizLessonIds.reduce((sum, lessonId) => sum + (scoreByLesson.get(lessonId) ?? 0), 0)
            / quizLessonIds.length,
          )
        : 0;

      // ✅ SECURITY FIX (audit run-1): enforce the documented contract
      // "< 70% → No certificate (quiz not passed yet)" for courses that have
      // quizzes. Previously calculateGrade(0) returned "Pass", so a student
      // who claimed completion via the API without passing anything could
      // mint a publicly verifiable certificate with grade Pass / score 0.
      const courseHasQuizzes = quizLessonIds.length > 0;
      if (courseHasQuizzes && avgScore < 70) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Assessment score below the certification threshold — pass the course quizzes first",
        });
      }

      const grade = calculateGrade(avgScore);

      // ✅ SECURITY FIX: Use nanoid instead of Math.random() for certificate number
      // Math.random() is not cryptographically secure and produces predictable values
      const certificateNumber = `EE-CERT-${Date.now()}-${nanoid(8).toUpperCase()}`;

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
