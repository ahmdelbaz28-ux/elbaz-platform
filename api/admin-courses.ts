/**
 * ADMIN COURSES — Course & lesson management endpoints
 *
 * Procedures: listCourses, updateCourse, createCourse, deleteCourse,
 *             listLessons, createLesson, updateLesson, deleteLesson
 */

import { z } from "zod";
import { asc, desc, eq, count, max } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminQuery, adminMutation } from "./middleware";
import { getDb } from "./queries/connection";
import { courses, lessons, enrollments, payments, wishlists, reviews, siteSettings } from "@db/schema";
import { pushNotification } from "./lib/notification-broadcast.js";
import { fetchOembedVerdict, fetchPlaylistVideosForImport, getPlaylistId } from "./lib/youtube-watcher.js";
import {
  applyPlaylistSync,
  getDashboardSyncInfo,
  saveSyncSettings,
} from "./lib/playlist-sync.js";

export const adminCoursesProcedures = {
  listCourses: adminQuery
    .input(z.object({ page: z.number().int().min(1).default(1), limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page ?? 1;
      const limit = input?.limit ?? 20;
      const offset = (page - 1) * limit;

      const [[{ total }], items] = await Promise.all([
        db.select({ total: count() }).from(courses),
        db.select({
          id: courses.id,
          slug: courses.slug,
          titleEn: courses.titleEn,
          titleAr: courses.titleAr,
          descriptionEn: courses.descriptionEn,
          descriptionAr: courses.descriptionAr,
          shortDescEn: courses.shortDescEn,
          shortDescAr: courses.shortDescAr,
          thumbnailUrl: courses.thumbnail,
          price: courses.price,
          isPremium: courses.isPremium,
          isFeatured: courses.isFeatured,
          isPublished: courses.isPublished,
          level: courses.level,
          category: courses.categoryId,
          studentCount: courses.studentCount,
          createdAt: courses.createdAt,
          updatedAt: courses.updatedAt,
        })
          .from(courses)
          .orderBy(desc(courses.createdAt))
          .limit(limit)
          .offset(offset),
      ]);

      return { items, total: total ?? 0 };
    }),

  updateCourse: adminQuery
    .input(z.object({
      id: z.number().int().positive(),
      titleEn: z.string().max(500).optional(),
      titleAr: z.string().max(500).optional(),
      descriptionEn: z.string().optional(),
      descriptionAr: z.string().optional(),
      shortDescEn: z.string().max(500).optional(),
      shortDescAr: z.string().max(500).optional(),
      thumbnailUrl: z.string().max(1000).optional(),
      price: z.number().optional(),
      isFeatured: z.boolean().optional(),
      isPublished: z.boolean().optional(),
      isPremium: z.boolean().optional(),
      level: z.enum(["beginner", "intermediate", "advanced"]).optional(),
      categoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, thumbnailUrl, price, ...updates } = input;
      const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (thumbnailUrl !== undefined) cleanUpdates.thumbnail = thumbnailUrl;
      if (price !== undefined) cleanUpdates.price = price.toFixed(2);
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(courses).set({ ...cleanUpdates, updatedAt: new Date() }).where(eq(courses.id, id));
      return { success: true };
    }),

  createCourse: adminMutation
    .input(z.object({
      slug: z.string().min(2).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case"),
      categoryId: z.number().int().positive(),
      titleEn: z.string().min(2).max(500),
      titleAr: z.string().min(2).max(500),
      descriptionEn: z.string().max(10000).optional(),
      descriptionAr: z.string().max(10000).optional(),
      shortDescEn: z.string().max(500).optional(),
      shortDescAr: z.string().max(500).optional(),
      thumbnailUrl: z.string().max(1000).optional(),
      level: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
      isPremium: z.boolean().default(false),
      price: z.number().min(0).default(0),
      originalPrice: z.number().min(0).optional(),
      isPublished: z.boolean().default(false),
      isFeatured: z.boolean().default(false),
      sortOrder: z.number().int().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      // Enforce slug uniqueness with a friendly error (slug is a unique index)
      const [existing] = await db.select({ id: courses.id }).from(courses).where(eq(courses.slug, input.slug)).limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "A course with this slug already exists" });
      }

      const [created] = await db.insert(courses).values({
        slug: input.slug,
        categoryId: input.categoryId,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        descriptionEn: input.descriptionEn ?? null,
        descriptionAr: input.descriptionAr ?? null,
        shortDescEn: input.shortDescEn ?? null,
        shortDescAr: input.shortDescAr ?? null,
        thumbnail: input.thumbnailUrl ?? null,
        level: input.level,
        isPremium: input.isPremium,
        price: input.price.toFixed(2),
        originalPrice: (input.originalPrice ?? input.price).toFixed(2),
        isPublished: input.isPublished,
        isFeatured: input.isFeatured,
        sortOrder: input.sortOrder,
      }).$returningId();

      return { success: true, id: created?.id };
    }),

  deleteCourse: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();

      const [course] = await db.select({ id: courses.id }).from(courses).where(eq(courses.id, input.id)).limit(1);
      if (!course) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });
      }

      // Clean course-scoped rows explicitly (payments is RESTRICT on courses).
      // lessonProgress / quizQuestions / userNotes cascade from lessons.
      const lessonIds = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.courseId, input.id));

      if (lessonIds.length > 0) {
        const ids = lessonIds.map((l) => l.id);
        const { inArray } = await import("drizzle-orm");
        const { lessonProgress, quizQuestions, userNotes } = await import("@db/schema");
        await db.delete(lessonProgress).where(inArray(lessonProgress.lessonId, ids));
        await db.delete(quizQuestions).where(inArray(quizQuestions.lessonId, ids));
        await db.delete(userNotes).where(inArray(userNotes.lessonId, ids));
      }

      await db.delete(payments).where(eq(payments.courseId, input.id));
      await db.delete(enrollments).where(eq(enrollments.courseId, input.id));
      await db.delete(wishlists).where(eq(wishlists.courseId, input.id));
      await db.delete(reviews).where(eq(reviews.courseId, input.id));
      await db.delete(lessons).where(eq(lessons.courseId, input.id));
      await db.delete(courses).where(eq(courses.id, input.id));

      return { success: true };
    }),

  // ─── Lesson management ───
  listLessons: adminQuery
    .input(z.object({ courseId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = getDb();
      const items = await db.select().from(lessons)
        .where(eq(lessons.courseId, input.courseId))
        .orderBy(asc(lessons.sortOrder), asc(lessons.id));
      return { items };
    }),

  createLesson: adminMutation
    .input(z.object({
      courseId: z.number().int().positive(),
      titleEn: z.string().min(1).max(500),
      titleAr: z.string().min(1).max(500),
      descriptionEn: z.string().max(10000).optional(),
      descriptionAr: z.string().max(10000).optional(),
      videoUrl: z.string().max(500).optional(),
      durationMinutes: z.number().int().min(0).max(1440).default(30),
      isFree: z.boolean().default(false),
      isPublished: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      const [course] = await db.select({ id: courses.id, slug: courses.slug, titleAr: courses.titleAr, titleEn: courses.titleEn }).from(courses).where(eq(courses.id, input.courseId)).limit(1);
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });

      // Append at the end of the course. MAX(sortOrder), NOT count() — count
      // drifts after deletions (3 lessons, delete #2 → count=2 but max=3) and
      // produced duplicate sort orders that shuffled the lesson order.
      const [{ maxSort }] = await db.select({ maxSort: max(lessons.sortOrder) }).from(lessons).where(eq(lessons.courseId, input.courseId));

      const [created] = await db.insert(lessons).values({
        courseId: input.courseId,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        descriptionEn: input.descriptionEn ?? null,
        descriptionAr: input.descriptionAr ?? null,
        videoUrl: input.videoUrl?.trim() ? input.videoUrl.trim() : null,
        // 0 fallback — the legacy production table rejects a NULL duration.
        durationMinutes: input.durationMinutes ?? 0,
        sortOrder: (maxSort ?? 0) + 1,
        isFree: input.isFree,
        isPublished: input.isPublished,
      }).$returningId();

      // 🔔 Broadcast: a new (published) episode was added — notify every
      // registered user. Fire-and-forget: notification failures never break
      // lesson creation (pushNotification already swallows its own errors).
      if (input.isPublished) {
        const courseTitle = course.titleAr || course.titleEn || "الكورس";
        void pushNotification({
          type: "lesson",
          title: "📚 حلقة جديدة على المنصة",
          message:
            `تمت إضافة حلقة جديدة «${input.titleAr || input.titleEn}» إلى كورس «${courseTitle}». ` +
            `افتح الكورس دلوقتي وكمل مشوارك — ولو الشرح عاجبك، اشترك في قناة اليوتيوب وفعّل الجرس 🔔 عليها عشان ميفوتك أي حلقة جديدة.`,
          url: course.slug ? `/courses/${course.slug}` : "/courses",
        });
      }

      return { success: true, id: created?.id };
    }),

  updateLesson: adminMutation
    .input(z.object({
      id: z.number().int().positive(),
      titleEn: z.string().min(1).max(500).optional(),
      titleAr: z.string().min(1).max(500).optional(),
      descriptionEn: z.string().max(10000).optional(),
      descriptionAr: z.string().max(10000).optional(),
      videoUrl: z.string().max(500).nullable().optional(),
      durationMinutes: z.number().int().min(0).max(1440).optional(),
      sortOrder: z.number().int().min(0).optional(),
      isFree: z.boolean().optional(),
      isPublished: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, videoUrl, ...updates } = input;
      // Explicit type: videoUrl can legitimately be set to null (clears the lesson video).
      const cleanUpdates: Record<string, string | number | boolean | null> = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (videoUrl !== undefined) cleanUpdates.videoUrl = videoUrl && videoUrl.trim() ? videoUrl.trim() : null;
      if (Object.keys(cleanUpdates).length === 0) return { success: true };
      await db.update(lessons).set(cleanUpdates).where(eq(lessons.id, id));
      return { success: true };
    }),

  deleteLesson: adminMutation
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const { lessonProgress, quizQuestions, userNotes } = await import("@db/schema");
      await db.delete(lessonProgress).where(eq(lessonProgress.lessonId, input.id));
      await db.delete(quizQuestions).where(eq(quizQuestions.lessonId, input.id));
      await db.delete(userNotes).where(eq(userNotes.lessonId, input.id));
      await db.delete(lessons).where(eq(lessons.id, input.id));
      return { success: true };
    }),

  // ─── Lesson ordering (full playlist control) ───
  // Swap a lesson with its neighbour in the course order. The rows are
  // renormalized to 1..N first, so historical duplicate/collapsed sortOrder
  // values (the old count()-based append bug) heal on the first move.
  moveLesson: adminMutation
    .input(z.object({
      id: z.number().int().positive(),
      direction: z.enum(["up", "down"]),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [lesson] = await db
        .select({ id: lessons.id, courseId: lessons.courseId })
        .from(lessons)
        .where(eq(lessons.id, input.id))
        .limit(1);
      if (!lesson) throw new TRPCError({ code: "NOT_FOUND", message: "Lesson not found" });

      const siblings = await db
        .select({ id: lessons.id, sortOrder: lessons.sortOrder })
        .from(lessons)
        .where(eq(lessons.courseId, lesson.courseId))
        .orderBy(asc(lessons.sortOrder), asc(lessons.id));

      const idx = siblings.findIndex((s) => s.id === input.id);
      const swapIdx = input.direction === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= siblings.length) {
        return { success: true, moved: false };
      }

      const normalized = siblings.map((s, i) => ({ id: s.id, sortOrder: i + 1 }));
      const a = normalized[idx];
      const b = normalized[swapIdx];
      const before = new Map(siblings.map((s) => [s.id, s.sortOrder]));
      for (const row of normalized) {
        const target = row.id === a.id ? b.sortOrder : row.id === b.id ? a.sortOrder : row.sortOrder;
        if (target !== before.get(row.id)) {
          await db.update(lessons).set({ sortOrder: target }).where(eq(lessons.id, row.id));
        }
      }
      return { success: true, moved: true };
    }),

  // ─── Bulk playlist import (one click = whole playlist as lessons) ───
  // OWNER RULE kept intact: lessons are created ONLY from videos that really
  // exist on YouTube, and ONLY with YouTube's exact titles (verbatim, both
  // language fields — the title is one string on YouTube, not translated).
  // Videos already linked to a lesson of this course (matched by videoId)
  // are skipped, so re-running is always safe/idempotent.
  importPlaylistVideos: adminMutation
    .input(z.object({ courseId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [course] = await db
        .select({ id: courses.id, slug: courses.slug, titleAr: courses.titleAr, titleEn: courses.titleEn })
        .from(courses)
        .where(eq(courses.id, input.courseId))
        .limit(1);
      if (!course) throw new TRPCError({ code: "NOT_FOUND", message: "Course not found" });

      const { items, verified } = await fetchPlaylistVideosForImport();

      const existing = await db
        .select({ videoUrl: lessons.videoUrl })
        .from(lessons)
        .where(eq(lessons.courseId, input.courseId));
      const { extractYouTubeId } = await import("../src/lib/youtube-url");
      const linkedIds = new Set(
        existing
          .map((row) => extractYouTubeId(row.videoUrl ?? ""))
          .filter((id): id is string => !!id),
      );

      const fresh = items.filter((item) => !linkedIds.has(item.videoId));
      if (fresh.length === 0) {
        return { created: 0, skipped: items.length, total: items.length, verified, titles: [] };
      }

      const [{ maxSort }] = await db
        .select({ maxSort: max(lessons.sortOrder) })
        .from(lessons)
        .where(eq(lessons.courseId, input.courseId));
      let sortOrder = (maxSort ?? 0);

      await db.insert(lessons).values(
        fresh.map((item) => {
          sortOrder += 1;
          return {
            courseId: input.courseId,
            titleEn: item.title,
            titleAr: item.title, // verbatim YouTube title in both fields — never invented
            videoUrl: item.watchUrl,
            // 0, NEVER null — the legacy production table rejects NULL here
            // ("Column 'durationMinutes' cannot be null", 2026-11-10 incident).
            durationMinutes: 0,
            sortOrder,
            isFree: false,
            isPublished: true,
          };
        }),
      );

      // ONE summary broadcast for the batch (per-lesson pushes would spam).
      const courseTitle = course.titleAr || course.titleEn || "الكورس";
      void pushNotification({
        type: "lesson",
        title: "📚 حلقات جديدة على المنصة",
        message: `تمت إضافة ${fresh.length} ${fresh.length === 1 ? "حلقة" : "حلقات"} جديدة إلى كورس «${courseTitle}». افتح الكورس وكمل مشوارك — واشترك في قناة اليوتيوب وفعّل الجرس 🔔 عشان ميفوتك أي حلقة جديدة.`,
        url: course.slug ? `/courses/${course.slug}` : "/courses",
      });

      return {
        created: fresh.length,
        skipped: items.length - fresh.length,
        total: items.length,
        verified,
        titles: fresh.map((item) => ({ videoId: item.videoId, title: item.title })),
      };
    }),

  // ─── YouTube playlist import (lesson videos stream from the playlist) ───
  // The creator uploads lessons to the channel's YouTube playlist; the site
  // embeds them instead of hosting video files. This admin-only query lists
  // the playlist for the one-click "import into lesson" dialog. Playlist
  // fetches are throttled-prone (the watcher polls the same sources every
  // 15 min), so a failure surfaces as an honest empty result + error flag
  // instead of a hanging dialog.
  youtubePlaylistVideos: adminQuery
    .query(async () => {
      try {
        const { items, verified } = await fetchPlaylistVideosForImport();
        return { playlistId: getPlaylistId(), items, verified, error: null as string | null };
      } catch (err) {
        return {
          playlistId: getPlaylistId(),
          items: [],
          verified: false,
          error: err instanceof Error ? err.message : "Playlist fetch failed",
        };
      }
    }),

  // The authoritative YouTube title for any pasted link — the backend of the
  // "use the official YouTube title" button in the lesson form. OWNER RULE:
  // lesson titles for YouTube videos are NEVER hand-invented; this returns
  // the live oEmbed title (exact, as written on YouTube) or null when the
  // link isn't YouTube / the video is gone — the UI surfaces that honestly.
  youtubeVideoTitle: adminQuery
    .input(z.object({ url: z.string().min(1).max(1000) }))
    .mutation(async ({ input }) => {
      try {
        const { extractYouTubeId } = await import("../src/lib/youtube-url");
        const videoId = extractYouTubeId(input.url);
        if (!videoId) return { videoId: null, title: null };
        const verdict = await fetchOembedVerdict(videoId);
        return { videoId, title: verdict.status === "ok" ? verdict.title : null };
      } catch {
        return { videoId: null, title: null };
      }
    }),

  // ─── Playlist AUTO-SYNC (course mirrors the channel playlist) ──────────────
  // Complements the manual import above: the watcher tick (15 min) applies the
  // same oEmbed-verified import automatically, re-titles drifted lessons, and
  // (once + on demand) purges lessons that are not real playlist videos.
  // These procedures are the dashboard's control surface for that engine.

  /** Status panel data: sync state + policy toggles + course/lesson counters. */
  youtubeSyncStatus: adminQuery.query(async () => {
    const db = getDb();
    const info = await getDashboardSyncInfo();
    // The playlist the owner linked to the site (contact settings) — shown so
    // the admin can verify the sync is pointed at the right playlist.
    const contactRows = await db
      .select({ key: siteSettings.key, value: siteSettings.value })
      .from(siteSettings)
      .where(eq(siteSettings.section, "contact"));
    const playlistUrl = contactRows.find((r) => r.key === "youtubeUrl")?.value ?? null;
    return { ...info, playlistUrl, playlistId: getPlaylistId() };
  }),

  /**
   * Manual sync. `replace: true` = FULL sync — also removes any lesson of the
   * course that is not a real playlist video (the "only real videos" cleanup).
   * Uses the oEmbed-verified import pipeline: placeholders dropped, exact
   * YouTube titles, nothing invented.
   */
  syncPlaylistNow: adminMutation
    .input(z.object({ replace: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const { items } = await fetchPlaylistVideosForImport();
      const videos = items.map((i) => ({ videoId: i.videoId, title: i.title }));
      return applyPlaylistSync(videos, { replace: input.replace, reason: "admin-manual" });
    }),

  /** Policy toggles for the sync engine (auto-import / free previews / cover). */
  updateYoutubeSyncSettings: adminMutation
    .input(z.object({
      autoImport: z.boolean().optional(),
      autoImportFree: z.boolean().optional(),
      autoCover: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const settings = await saveSyncSettings(input);
      return { success: true, settings };
    }),
};
