/**
 * COURSE WATCHING — Video playback and progress endpoints
 *
 * Procedures: lessonVideo, markWatched, heartbeat, getSavedPosition, myWatchTime
 * All are authedQuery (authentication required).
 */

import { z } from "zod";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedQuery, publicMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { lessons, enrollments, lessonProgress, courses } from "@db/schema";
import { recalcEnrollmentProgress, markLessonWatched } from "./lib/progress";
import { getSecureVideoUrl } from "./lib/video-protection";
import { activeEnrollmentWhere } from "./lib/enrollment";
import { getSubscribeGateConfig } from "./lib/subscribe-gate-config";
import { issueSubscribeTicket, verifySubscribeTicket } from "./lib/subscribe-ticket";

/**
 * Owner contract (2026): subscribing to the YouTube channel is a HARD
 * prerequisite for opening ANY lesson video. The client shows the
 * SubscribeGate; THIS check makes it real at the API boundary — no valid
 * signed unlock ticket ⇒ no playback data, even for hand-crafted requests.
 * The error message carries the SUBSCRIBE_REQUIRED marker the client uses
 * to re-lock the gate (expired/rotated/forged ticket ⇒ gate re-appears).
 */
function assertSubscribeUnlock(
  ticket: string | undefined,
  opts: { userId?: number } = {},
): void {
  if (!verifySubscribeTicket(ticket, opts)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "SUBSCRIBE_REQUIRED: subscribe to the YouTube channel first — lesson videos stay locked until the subscribe flow is done.",
    });
  }
}

export const courseWatchingProcedures = {
  lessonVideo: authedQuery
    .input(z.object({
      lessonId: z.number().int().positive(),
      // Signed unlock proof from course.completeSubscribeUnlock — required
      // whenever the subscribe gate is enabled (server-side enforcement).
      subTicket: z.string().max(2048).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = getDb();

      // ✅ SECURITY FIX (audit run-2, api/course-watching.ts:lessonVideo:missing-course-publish-gate):
      // the lesson-level gate alone was not enough — admin.updateCourse
      // unpublish touches ONLY the courses row, so lessons of a withdrawn
      // course kept playing on the raw-id path (sibling previewVideo enforces
      // BOTH levels, course-browse.ts:272). Two-level gate via innerJoin.
      // Projection carries every consumed field below (isFree :72, videoUrl
      // :74/:98, id :76/:100, courseId :87) — a bare select() with the join
      // would return nested {lessons,courses} rows and break destructuring.
      const [lesson] = await db
        .select({
          id: lessons.id,
          courseId: lessons.courseId,
          isFree: lessons.isFree,
          videoUrl: lessons.videoUrl,
        })
        .from(lessons)
        .innerJoin(courses, eq(lessons.courseId, courses.id))
        .where(
          and(
            eq(lessons.id, input.lessonId),
            eq(lessons.isPublished, true),
            eq(courses.isPublished, true),
          ),
        )
        .limit(1);

      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });

      // ── Subscribe-to-the-channel gate (HARD, server-side) ──
      // Checked BEFORE the free/enrolled branches: it applies to EVERY
      // lesson video, free preview or paid curriculum alike.
      const gate = await getSubscribeGateConfig();
      if (gate.enabled) {
        assertSubscribeUnlock(input.subTicket, { userId: ctx.user.id });
      }

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
      // ✅ SECURITY FIX (audit run-1): require an ACTIVE, unexpired enrollment
      // (previously row existence only — refunded/expired students kept access).
      const [enrollment] = await db
        .select({ id: enrollments.id })
        .from(enrollments)
        .where(activeEnrollmentWhere(ctx.user.id, lesson.courseId))
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

  // ─── Subscribe-gate unlock — the server-anchored confirm step ───
  // Called when the viewer presses «اشتركت — افتح الفيديوهات» on the
  // SubscribeGate. Issues a signed ticket (account- or device-bound) that
  // lessonVideo/previewVideo verify. Fail-closed by design: the client only
  // unlocks on a SUCCESSFUL issue — no ticket, no playback, ever.
  completeSubscribeUnlock: publicMutation
    .input(z.object({
      // The device subject (d<uuid>) built by the client lib — REQUIRED for
      // anonymous viewers so their ticket is bound to this device; ignored
      // for authenticated viewers (account-bound subject wins).
      deviceId: z.string().regex(/^d[0-9a-zA-Z-]{6,64}$/).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user && !input.deviceId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "SUBSCRIBE_REQUIRED: deviceId is required to unlock for this device.",
        });
      }
      const gate = await getSubscribeGateConfig();
      const subject = ctx.user ? `u${ctx.user.id}` : (input.deviceId as string);
      const ticket = issueSubscribeTicket(subject, gate.days);
      return { ticket, days: gate.days };
    }),

  markWatched: authedQuery
    .input(z.object({ lessonId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      // ✅ SECURITY FIX (audit run-2): two-level publish gate (lesson + course)
      // — withdrawn-course lessons must not keep accumulating progress
      // (courseId/isFree projection covers every consumed field below).
      const [lesson] = await db
        .select({ courseId: lessons.courseId, isFree: lessons.isFree })
        .from(lessons)
        .innerJoin(courses, eq(lessons.courseId, courses.id))
        .where(
          and(
            eq(lessons.id, input.lessonId),
            eq(lessons.isPublished, true),
            eq(courses.isPublished, true),
          ),
        )
        .limit(1);

      if (!lesson) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      }

      if (!lesson.isFree) {
        const [enrollment] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(activeEnrollmentWhere(ctx.user.id, lesson.courseId))
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

      // ✅ SECURITY FIX (audit run-2): two-level publish gate (lesson + course)
      // — withdrawn-course lessons must not keep accumulating progress
      // (courseId/isFree projection covers every consumed field below).
      const [lesson] = await db
        .select({ courseId: lessons.courseId, isFree: lessons.isFree })
        .from(lessons)
        .innerJoin(courses, eq(lessons.courseId, courses.id))
        .where(
          and(
            eq(lessons.id, input.lessonId),
            eq(lessons.isPublished, true),
            eq(courses.isPublished, true),
          ),
        )
        .limit(1);

      if (!lesson) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });
      }

      if (!lesson.isFree) {
        const [enrollment] = await db
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(activeEnrollmentWhere(ctx.user.id, lesson.courseId))
          .limit(1);

        if (!enrollment) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Enrollment required" });
        }
      }

      // 🐛 FIX (E2E purchase→certificate journey): the INSERT omitted
      // `courseId` — NOT NULL with no default — so every heartbeat failed
      // with 500 ("Field 'courseId' doesn't have a default value") on a
      // fresh schema and watch-time tracking was silently broken.
      // PERF: the two writes hit different tables with disjoint keys —
      // run them in parallel (fires every ~15s per playing video).
      await Promise.all([
        db.execute(
          sql`INSERT INTO lessonProgress (\`userId\`, \`lessonId\`, \`courseId\`, \`isCompleted\`, \`isQuizPassed\`, \`quizScore\`, \`watchedSeconds\`, \`lastPosition\`, \`lastHeartbeatAt\`)
           VALUES (${ctx.user.id}, ${input.lessonId}, ${lesson.courseId}, false, false, 0, ${input.watchedSeconds}, ${input.lastPosition}, NOW())
           ON DUPLICATE KEY UPDATE
             \`watchedSeconds\` = \`watchedSeconds\` + ${input.watchedSeconds},
             \`lastPosition\` = ${input.lastPosition},
             \`lastHeartbeatAt\` = NOW()`
        ),
        db
          .update(enrollments)
          .set({ lastAccessedAt: new Date() })
          .where(and(eq(enrollments.userId, ctx.user.id), eq(enrollments.courseId, lesson.courseId))),
      ]);

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
