/**
 * COURSE WATCHING — Video playback and progress endpoints
 *
 * Procedures: lessonVideo, markWatched, heartbeat, getSavedPosition, myWatchTime
 * All are authedQuery (authentication required).
 */

import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { lessons, enrollments, lessonProgress } from "@db/schema";
import { recalcEnrollmentProgress, markLessonWatched } from "./lib/progress";
import { getSecureVideoUrl } from "./lib/video-protection";

export const courseWatchingProcedures = {
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
        return await getSecureVideoUrl({
          videoUrl: lesson.videoUrl || "",
          userId: ctx.user.id,
          lessonId: lesson.id,
          username: ctx.user.username,
        });
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

      return await getSecureVideoUrl({
        videoUrl: lesson.videoUrl || "",
        userId: ctx.user.id,
        lessonId: lesson.id,
        username: ctx.user.username,
      });
    }),

  markWatched: authedQuery
    .input(z.object({ lessonId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

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
            eq(enrollments.userId, ctx.user.id),
            eq(enrollments.courseId, lesson.courseId),
          ))
          .limit(1);

        if (!enrollment) {
          throw new TRPCError({ code: "FORBIDDEN", message: "You must be enrolled to mark lessons" });
        }
      }

      await markLessonWatched(ctx.user.id, input.lessonId);
      const progress = await recalcEnrollmentProgress(ctx.user.id, lesson.courseId);
      return { success: true, ...progress };
    }),

  heartbeat: authedQuery
    .input(z.object({
      lessonId: z.number().int().positive(),
      watchedSeconds: z.number().int().min(0).max(300),
      lastPosition: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

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
            eq(enrollments.userId, ctx.user.id),
            eq(enrollments.courseId, lesson.courseId),
          ))
          .limit(1);

        if (!enrollment) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Enrollment required" });
        }
      }

      await db.execute(
        sql`INSERT INTO lessonProgress (\`userId\`, \`lessonId\`, \`isCompleted\`, \`isQuizPassed\`, \`quizScore\`, \`watchedSeconds\`, \`lastPosition\`, \`lastHeartbeatAt\`)
         VALUES (${ctx.user.id}, ${input.lessonId}, false, false, 0, ${input.watchedSeconds}, ${input.lastPosition}, NOW())
         ON DUPLICATE KEY UPDATE
           \`watchedSeconds\` = \`watchedSeconds\` + ${input.watchedSeconds},
           \`lastPosition\` = ${input.lastPosition},
           \`lastHeartbeatAt\` = NOW()`
      );

      await db
        .update(enrollments)
        .set({ lastAccessedAt: new Date() })
        .where(and(eq(enrollments.userId, ctx.user.id), eq(enrollments.courseId, lesson.courseId)));

      return { success: true };
    }),

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
};
