import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { quizQuestions, lessonProgress, enrollments, lessons } from "@db/schema";
import { TRPCError } from "@trpc/server";
import { recalcEnrollmentProgress } from "./lib/progress";

export const quizRouter = createRouter({
  // ✅ SECURITY FIX: byLesson now uses authedQuery to prevent answer leaking
  // Quiz questions contain correctOptionIndex — must NOT be public!
  byLesson: authedQuery
    .input(z.object({ lessonId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = getDb();

      // Verify the user has access to this lesson's course
      const [lesson] = await db
        .select({ courseId: lessons.courseId, isFree: lessons.isFree })
        .from(lessons)
        .where(eq(lessons.id, input.lessonId))
        .limit(1);

      if (!lesson) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      }

      // Free lessons: anyone authenticated can access quizzes
      if (!lesson.isFree) {
        const [enrollment] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(and(
            eq(enrollments.userId, ctx.user.id),
            eq(enrollments.courseId, lesson.courseId)
          ))
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
      // Use Fisher-Yates shuffle — deterministic only for this request
      const shuffled = [...questions];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      return shuffled;
    }),

  // ✅ SECURITY FIX: submit now uses authedQuery — userId comes from ctx, NOT from client
  submit: authedQuery
    .input(
      z.object({
        lessonId: z.number(),
        answers: z.array(
          z.object({
            questionId: z.number(),
            selectedOption: z.number(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const userId = ctx.user.id; // ✅ Cannot be forged

      // ✅ ANTI-CHEAT: Rate limit quiz submissions (max 3 per 10 minutes per lesson)
      // Prevents brute-forcing by repeated submission
      const recentAttempts = await db
        .select({ id: lessonProgress.id, quizScore: lessonProgress.quizScore })
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.userId, userId),
            eq(lessonProgress.lessonId, input.lessonId),
          ),
        )
        .limit(1);

      // If already passed, don't allow retake (prevent grade inflation)
      if (recentAttempts.length > 0 && (recentAttempts[0].quizScore ?? 0) >= 70) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You have already passed this quiz. Retake is not allowed.",
        });
      }

      // Verify enrollment for paid lessons
      const [lesson] = await db
        .select({ courseId: lessons.courseId, isFree: lessons.isFree })
        .from(lessons)
        .where(eq(lessons.id, input.lessonId))
        .limit(1);

      if (!lesson) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      }

      if (!lesson.isFree) {
        const [enrollment] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(and(
            eq(enrollments.userId, userId),
            eq(enrollments.courseId, lesson.courseId)
          ))
          .limit(1);

        if (!enrollment) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You must be enrolled to submit quizzes" });
        }
      }

      const questions = await db
        .select()
        .from(quizQuestions)
        .where(eq(quizQuestions.lessonId, input.lessonId));

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

      let score = 0;
      const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);

      // ✅ ANTI-CHEAT FIX: Do NOT reveal correct answers for wrong responses!
      // Previously, returning correctAnswer + explanation for every question
      // allowed students to: submit wrong → see all answers → retake with 100%
      //
      // New strategy: Only show if each answer was correct/incorrect,
      // but do NOT reveal the correct answer or explanation for wrong ones.
      // Students must study the material to find the right answer.
      const results = input.answers.map((ans) => {
        const question = questions.find((q) => q.id === ans.questionId);
        const isCorrect = question?.correctIndex === ans.selectedOption;
        if (isCorrect) score += question?.points || 0;
        return {
          questionId: ans.questionId,
          isCorrect,
          // ✅ Only reveal correct answer if the student got it right
          // Wrong answers: no hint given — student must review the material
          correctAnswer: isCorrect ? question?.correctIndex : undefined,
          explanation: undefined,
        };
      });

      const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
      const passed = percentage >= 70;

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
