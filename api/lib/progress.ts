/**
 * Course Progress & Completion Engine
 *
 * 🔴 CRITICAL FIX: Previously, enrollment.isCompleted was NEVER set to true,
 * making certificates impossible to obtain. This module:
 *
 * 1. Recalculates enrollment progress after every lesson/quiz completion
 * 2. Auto-marks enrollment as "completed" when all lessons are done
 * 3. Provides helper functions for progress queries
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { enrollments, lessons, lessonProgress } from "@db/schema";

/**
 * Recalculate and update the enrollment progress for a user + course.
 * Should be called AFTER any lesson progress change (quiz pass, video watched).
 *
 * Progress = (completed lessons / total published lessons) * 100
 * isCompleted = true when ALL published lessons have been completed
 */
export async function recalcEnrollmentProgress(
  userId: number,
  courseId: number,
): Promise<{
  progress: number;
  isCompleted: boolean;
  completedLessons: number;
  totalLessons: number;
}> {
  const db = getDb();

  // PERF: all three reads are keyed by (userId, courseId) and mutually
  // independent — run them in parallel instead of three stacked round-trips.
  // This runs after EVERY lesson watch / quiz submit, so it is the hottest
  // waterfall in the system.
  const [totalRowRows, completedRows, previousRows] = await Promise.all([
    // 1. Get total published lessons in the course
    db
      .select({ count: sql<number>`count(*)` })
      .from(lessons)
      .where(and(eq(lessons.courseId, courseId), eq(lessons.isPublished, true))),
    // 2. Get completed lesson IDs for this user in this course
    // A lesson is "completed" if the user has lessonProgress with isQuizPassed = true OR isCompleted = true
    db
      .select({ lessonId: lessonProgress.lessonId })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessons.courseId, courseId),
          sql`(${lessonProgress.isCompleted} = 1 OR ${lessonProgress.isQuizPassed} = 1)`,
        ),
      ),
    // 3. Current enrollment completion state (for the one-shot congrats trigger)
    db
      .select({ isCompleted: enrollments.isCompleted })
      .from(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)))
      .limit(1),
  ]);

  const totalRow = totalRowRows[0];
  const totalLessons = totalRow?.count || 0;

  if (totalLessons === 0) {
    return { progress: 0, isCompleted: false, completedLessons: 0, totalLessons: 0 };
  }

  const completedLessons = completedRows.length;
  const progress = Math.round((completedLessons / totalLessons) * 100);
  const isCompleted = completedLessons >= totalLessons;
  const previous = previousRows[0];

  // Update the enrollment record

  await db
    .update(enrollments)
    .set({
      progress: String(progress),
      isCompleted,
      ...(isCompleted ? { completedAt: new Date() } : {}),
      lastAccessedAt: new Date(),
    })
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)),
    );

  // 🎓 Educational drip: fire the completion congratulation exactly once —
  // only on the false→true transition. Fire-and-forget: an email failure
  // must never fail the watch/quiz request that triggered completion.
  if (isCompleted && !previous?.isCompleted) {
    void import("./email-drip.js")
      .then(({ maybeSendCompletionCongrats }) => maybeSendCompletionCongrats(userId, courseId))
      .catch(() => undefined);
  }

  return { progress, isCompleted, completedLessons, totalLessons };
}

/**
 * Mark a lesson as "watched" (video completed) — separate from quiz pass.
 * This is for lessons where watching the video is sufficient (no quiz required).
 *
 * ✅ FIX: Uses atomic UPSERT (INSERT ... ON DUPLICATE KEY UPDATE) to prevent
 * race condition when multiple heartbeats/markWatched calls arrive simultaneously.
 */
export async function markLessonWatched(
  userId: number,
  lessonId: number,
): Promise<void> {
  const db = getDb();

  // 🐛 FIX (E2E purchase→certificate journey): the INSERT omitted `courseId`
  // — NOT NULL with no default in db/init-schema.sql — so EVERY call failed
  // with "Field 'courseId' doesn't have a default value" (500) and video
  // lessons could never be marked complete on a fresh schema.
  const [lesson] = await db
    .select({ courseId: lessons.courseId })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  if (!lesson) return; // unknown lesson — nothing to mark

  // Atomic UPSERT: insert if not exists, update isCompleted if exists
  await db.execute(
    sql`INSERT INTO lessonProgress (\`userId\`, \`lessonId\`, \`courseId\`, \`isCompleted\`, \`isQuizPassed\`, \`quizScore\`, \`watchedSeconds\`, \`lastPosition\`, \`completedAt\`, \`lastHeartbeatAt\`)
     VALUES (${userId}, ${lessonId}, ${lesson.courseId}, true, false, 0, 0, 0, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       \`isCompleted\` = true,
       \`completedAt\` = IF(\`isCompleted\` = 0, NOW(), \`completedAt\`)`
  );

  // Recalculate enrollment progress
  await recalcEnrollmentProgress(userId, lesson.courseId);
}

/**
 * Get detailed progress for a user's enrollment in a course.
 * Returns which lessons are completed and overall progress.
 */
export async function getCourseProgressDetail(
  userId: number,
  courseId: number,
): Promise<{
  progress: number;
  isCompleted: boolean;
  completedLessonIds: number[];
  totalLessons: number;
}> {
  const db = getDb();

  // PERF: the two reads are independent — parallelize.
  const [completedRows, totalRowRows] = await Promise.all([
    db
      .select({ lessonId: lessonProgress.lessonId })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
      .where(
        and(
          eq(lessonProgress.userId, userId),
          eq(lessons.courseId, courseId),
          sql`(${lessonProgress.isCompleted} = 1 OR ${lessonProgress.isQuizPassed} = 1)`,
        ),
      ),
    db
      .select({ count: sql<number>`count(*)` })
      .from(lessons)
      .where(and(eq(lessons.courseId, courseId), eq(lessons.isPublished, true))),
  ]);

  const totalRow = totalRowRows[0];
  const totalLessons = totalRow?.count || 0;
  const completedLessonIds = completedRows.map((r) => r.lessonId);
  const progress = totalLessons > 0 ? Math.round((completedLessonIds.length / totalLessons) * 100) : 0;

  return {
    progress,
    isCompleted: completedLessonIds.length >= totalLessons && totalLessons > 0,
    completedLessonIds,
    totalLessons,
  };
}
