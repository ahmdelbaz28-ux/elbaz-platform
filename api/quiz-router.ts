import { randomInt } from "node:crypto";
import { courses, enrollments, lessonProgress, lessons, quizQuestions } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { activeEnrollmentWhere } from "./lib/enrollment";
import { recalcEnrollmentProgress } from "./lib/progress";
import { scoreQuizSubmission } from "./lib/quiz-scoring";
import { checkRateLimit } from "./lib/rate-limiter";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";

// ✅ SECURITY FIX (audit run-1, fp api/quiz-router.ts:quiz.submit
// :duplicate-answer-score-inflation): the wire format previously accepted
// `[{questionId} × N]` duplicates and the route scored every element —
// N copies of one correct answer summed to totalPoints → persisted 100% on
// any quiz. The input contract now REJECTS duplicate questionIds outright,
// and scoring itself deduplicates (defense in depth, quiz-scoring.ts).
const answerSchema = z.object({
  questionId: z.number(),
  selectedOption: z.number(),
});
const submitSchema = z.object({
  lessonId: z.number(),
  answers: z.array(answerSchema).refine(
    (answers) => new Set(answers.map((a) => a.questionId)).size === answers.length,
    { message: "Duplicate question IDs are not allowed — submit each question exactly once" },
  ),
});

export const quizRouter = createRouter({
  // ✅ SECURITY FIX: byLesson now uses authedQuery to prevent answer leaking
  // Quiz questions contain correctOptionIndex — must NOT be public!
  byLesson: authedQuery
    .input(z.object({ lessonId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();

      // Verify the user has access to this lesson's course
      // ✅ SECURITY FIX (audit run-2, api/quiz-router.ts:byLesson+submit:missing-lesson-publish-gate):
      // the lesson lookup must enforce the same publish gate every sibling
      // lesson-content surface enforces (course-watching.ts:58/:140/:178,
      // course-browse.ts:219/:272) — draft lessons resolve only for admins.
      // Draft ids fall through to the existing NOT_FOUND below.
      // ✅ SECURITY FIX (audit run-1, fp api/quiz-router.ts:byLesson+submit
      // :missing-course-level-publish-gate): the COURSE-level publish gate
      // now travels with the same lookup — a withdrawn (unpublished) course
      // must stop serving its quizzes (questions + answer attempts) even
      // when its lessons stay published. Same predicate as course-watching.
      const [lesson] = await db
        .select({ courseId: lessons.courseId, isFree: lessons.isFree, courseIsPublished: courses.isPublished })
        .from(lessons)
        .innerJoin(courses, eq(lessons.courseId, courses.id))
        .where(and(
          eq(lessons.id, input.lessonId),
          eq(lessons.isPublished, true),
          eq(courses.isPublished, true),
        ))
        .limit(1);

      if (!lesson) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      }

      // Free lessons: anyone authenticated can access quizzes
      if (!lesson.isFree) {
        const [enrollment] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(activeEnrollmentWhere(ctx.user.id, lesson.courseId))
          .limit(1);

        if (!enrollment) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You must be enrolled to access quizzes" });
        }
      }

      // ✅ SECURITY FIX: Strip correctOptionIndex from response!
      // The client should NEVER see the correct answers before submitting
      const questions = await db
        .select({
          id: quizQuestions.id,
          lessonId: quizQuestions.lessonId,
          questionEn: quizQuestions.questionEn,
          questionAr: quizQuestions.questionAr,
          optionsEn: quizQuestions.optionsEn,
          optionsAr: quizQuestions.optionsAr,
          points: quizQuestions.points,
          // correctOptionIndex is INTENTIONALLY excluded
        })
        .from(quizQuestions)
        .where(eq(quizQuestions.lessonId, input.lessonId))
        .orderBy(quizQuestions.id);

      // ✅ ANTI-CHEAT: Randomize question order so students can't share answer sequences
      // Use Fisher-Yates shuffle seeded from a CSPRNG — the question order is
      // security-relevant (anti-cheat) so we must NOT use Math.random()
      // (SonarCloud S2245). Node's crypto.randomInt() gives unbiased integers.
      const shuffled = [...questions];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = randomInt(0, i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      return shuffled;
    }),

  // ✅ SECURITY FIX: submit now uses authedQuery — userId comes from ctx, NOT from client
  submit: authedQuery
    .input(submitSchema)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id; // ✅ Cannot be forged

      // ✅ ANTI-CHEAT: Rate limit quiz submissions (max 3 per 10 minutes per lesson)
      // Prevents brute-forcing by repeated submission
      // PERF: recentAttempts, lesson lookup and questions are all keyed by
      // input.lessonId/userId and mutually independent — run them in parallel
      // (the enrollment check below correctly waits for `lesson`).
      const [recentAttempts, lessonRows, questions] = await Promise.all([
        db
          .select({ id: lessonProgress.id, quizScore: lessonProgress.quizScore })
          .from(lessonProgress)
          .where(
            and(
              eq(lessonProgress.userId, userId),
              eq(lessonProgress.lessonId, input.lessonId),
            ),
          )
          .limit(1),
        db
          .select({ courseId: lessons.courseId, isFree: lessons.isFree, courseIsPublished: courses.isPublished })
          .from(lessons)
          // ✅ SECURITY FIX (audit run-2): same publish gate as byLesson —
          // draft lessons are indistinguishable from nonexistent ones.
          // ✅ SECURITY FIX (audit run-1): course-level publish gate joins the
          // same lookup — withdrawn courses stop accepting quiz submissions.
          .innerJoin(courses, eq(lessons.courseId, courses.id))
          .where(and(
            eq(lessons.id, input.lessonId),
            eq(lessons.isPublished, true),
            eq(courses.isPublished, true),
          ))
          .limit(1),
        db
          .select()
          .from(quizQuestions)
          .where(eq(quizQuestions.lessonId, input.lessonId)),
      ]);
      const [lesson] = lessonRows;

      // If already passed, don't allow retake (prevent grade inflation)
      if (recentAttempts.length > 0 && (recentAttempts[0].quizScore ?? 0) >= 70) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You have already passed this quiz. Retake is not allowed.",
        });
      }

      if (!lesson) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      }

      if (!lesson.isFree) {
        const [enrollment] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(activeEnrollmentWhere(userId, lesson.courseId))
          .limit(1);

        if (!enrollment) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You must be enrolled to submit quizzes" });
        }
      }

      // ✅ SECURITY FIX (audit run-1): actually implement the documented
      // anti-cheat quota — max 3 submissions per 10 minutes per user per
      // lesson (previously only a comment; combined with per-answer feedback
      // this allowed deterministic answer-key extraction).
      try {
        await checkRateLimit(`quiz:${userId}:${input.lessonId}`, "quizAttempt");
      } catch (err) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many quiz attempts. Please wait before trying again.",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cause: { retryAfterMs: (err as any)?.cause?.retryAfterMs },
        });
      }

      // PERF: `questions` was already fetched in the parallel batch above.

      // ✅ ANTI-CHEAT: Validate that all submitted question IDs belong to this lesson
      const validQuestionIds = new Set(questions.map((q) => q.id));
      const invalidAnswers = input.answers.filter((a) => !validQuestionIds.has(a.questionId));
      if (invalidAnswers.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid question IDs submitted" });
      }

      // ✅ ANTI-CHEAT: Prevent submitting answers for questions not in this lesson's quiz
      if (input.answers.length > questions.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Too many answers submitted" });
      }

      // ✅ SECURITY FIX (audit run-1, duplicate-answer-score-inflation): the
      // scoring now lives in the pure, deduplicating, 100%-clamped helper
      // (quiz-scoring.ts) — see the layer notes there. The zod refine above
      // already rejects duplicates; the helper is the second layer.
      // Anti answer-key contract preserved: correct answers revealed only for
      // responses the student got right.
      const { score, totalPoints, percentage, passed, results } = scoreQuizSubmission(questions, input.answers);

      // Update lesson progress — atomic upsert to prevent race conditions
      await db.insert(lessonProgress).values({
        userId,
        courseId: lesson.courseId,
        lessonId: input.lessonId,
        isCompleted: passed,
        isQuizPassed: passed,
        quizScore: percentage,
        ...(passed ? { completedAt: new Date() } : {}),
      }).onDuplicateKeyUpdate({
        set: {
          isCompleted: passed,
          isQuizPassed: passed,
          quizScore: percentage,
          ...(passed ? { completedAt: new Date() } : {}),
        },
      });

      // ✅ CRITICAL FIX: Recalculate enrollment progress after quiz submission
      // This auto-marks enrollment as "completed" when all lessons are done
      const enrollmentUpdate = await recalcEnrollmentProgress(userId, lesson.courseId);

      return {
        score,
        totalPoints,
        percentage,
        passed,
        results,
        // ✅ NEW: Return enrollment progress so frontend can update UI
        courseProgress: enrollmentUpdate.progress,
        courseCompleted: enrollmentUpdate.isCompleted,
      };
    }),

  // ✅ SECURITY FIX: getProgress uses authedQuery — userId from ctx only
  getProgress: authedQuery
    .input(
      z.object({ lessonId: z.number() })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const [progress] = await db
        .select()
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.userId, ctx.user.id),
            eq(lessonProgress.lessonId, input.lessonId)
          )
        )
        .limit(1);
      return progress || null;
    }),
});
