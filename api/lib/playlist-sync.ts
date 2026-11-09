/**
 * PLAYLIST SYNC — keeps the ETAP course a faithful mirror of the YouTube playlist.
 *
 * The owner uploads to YouTube; the platform must show EXACTLY those videos:
 *  1. Every playlist video becomes a published lesson, in playlist order.
 *  2. Titles are the verbatim YouTube titles — never invented, never edited.
 *  3. The course cover is the thumbnail of the FIRST video (credibility).
 *  4. Lessons that are not real playlist videos (old demo/test rows) are
 *     removable — one automatic purge on first sync, then only via the
 *     explicit "full sync" admin action.
 *  5. All of this also runs automatically: the YouTube watcher tick (every
 *     15 min) reuses its already-fetched playlist and applies the sync, so a
 *     video uploaded to YouTube appears on the site within minutes, in
 *     Arabic, under the exact same name.
 *
 * State & policy live in `siteSettings` (section "youtubeSync"):
 *   state    — { lastSyncAt, videosFound, added, updated, removed, coverUpdated, playlistTitle, prunedOnce, lastError }
 *   settings — { autoImport, autoImportFree, autoCover }
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection.js";
import { courses, lessons, siteSettings } from "@db/schema";
import { logger } from "./logger.js";
import { invalidateCourseDetailCache } from "./cache.js";
import {
  buildYouTubeThumbnailUrl,
  buildYouTubeWatchUrl,
  extractYouTubeId,
} from "./youtube-url.js";
import type { ParsedVideo } from "./notification-utils.js";

// ─── Configuration ─────────────────────────────────────────────────────────────

/** The single course the playlist mirrors (the platform has exactly one course). */
const TARGET_COURSE_SLUG = process.env.YOUTUBE_COURSE_SLUG || "etap-complete-course";

const SYNC_SECTION = "youtubeSync";
const STATE_KEY = "state";
const SETTINGS_KEY = "settings";

export interface PlaylistSyncState {
  lastSyncAt?: string;
  lastSuccessAt?: string;
  videosFound?: number;
  added?: number;
  updated?: number;
  removed?: number;
  coverUpdated?: boolean;
  playlistTitle?: string;
  prunedOnce?: boolean;
  lastError?: string | null;
}

export interface PlaylistSyncSettings {
  /** Watcher tick imports new playlist videos automatically (default ON). */
  autoImport: boolean;
  /** Imported videos are free previews for any signed-in user — they are
   *  public on YouTube anyway; the site adds tracking + certificates. */
  autoImportFree: boolean;
  /** Course cover follows the first playlist video's thumbnail (default ON). */
  autoCover: boolean;
}

const DEFAULT_SETTINGS: PlaylistSyncSettings = {
  autoImport: true,
  autoImportFree: true,
  autoCover: true,
};

// ─── Settings / state persistence ──────────────────────────────────────────────

export async function getSyncSettings(): Promise<PlaylistSyncSettings> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(and(eq(siteSettings.section, SYNC_SECTION), eq(siteSettings.key, SETTINGS_KEY)))
      .limit(1);
    if (!row?.value) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(row.value) as Partial<PlaylistSyncSettings>;
    return {
      autoImport: parsed.autoImport ?? DEFAULT_SETTINGS.autoImport,
      autoImportFree: parsed.autoImportFree ?? DEFAULT_SETTINGS.autoImportFree,
      autoCover: parsed.autoCover ?? DEFAULT_SETTINGS.autoCover,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSyncSettings(patch: Partial<PlaylistSyncSettings>): Promise<PlaylistSyncSettings> {
  const current = await getSyncSettings();
  const next: PlaylistSyncSettings = { ...current, ...patch };
  const db = getDb();
  const value = JSON.stringify(next);
  await db
    .insert(siteSettings)
    .values({ section: SYNC_SECTION, key: SETTINGS_KEY, value, type: "json", sortOrder: 1 })
    .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
  return next;
}

export async function getSyncState(): Promise<PlaylistSyncState | null> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(and(eq(siteSettings.section, SYNC_SECTION), eq(siteSettings.key, STATE_KEY)))
      .limit(1);
    return row?.value ? (JSON.parse(row.value) as PlaylistSyncState) : null;
  } catch {
    return null;
  }
}

async function writeState(state: PlaylistSyncState): Promise<void> {
  const db = getDb();
  const value = JSON.stringify(state);
  await db
    .insert(siteSettings)
    .values({ section: SYNC_SECTION, key: STATE_KEY, value, type: "json", sortOrder: 0 })
    .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
}

// ─── Planning (pure, unit-tested) ──────────────────────────────────────────────

export interface ExistingLesson {
  id: number;
  titleEn: string;
  titleAr: string;
  videoUrl: string | null;
  sortOrder: number;
}

export interface PlaylistPlan {
  /** Playlist videos with no matching lesson — will be created. */
  inserts: { videoId: string; title: string; sortOrder: number; isFree: boolean }[];
  /** Existing lessons matched to a playlist video whose title or order drifted. */
  updates: { id: number; title: string; videoId: string; sortOrder: number }[];
  /** Lesson ids that are NOT real playlist videos (demo/test rows) — removable. */
  removable: { id: number; titleEn: string }[];
}

/**
 * Match existing course lessons to playlist videos by the YouTube id inside
 * `videoUrl` (any URL shape — watch/youtu.be/embed). Pure function so the
 * matching rules are unit-testable without a database.
 */
export function planPlaylistSync(
  existing: ExistingLesson[],
  videos: ParsedVideo[],
  options: { isFree: boolean } = { isFree: true },
): PlaylistPlan {
  const plan: PlaylistPlan = { inserts: [], updates: [], removable: [] };

  // Playlist order map: videoId → 1-based position.
  const orderOf = new Map<string, number>();
  const titleOf = new Map<string, string>();
  videos.forEach((v, idx) => {
    if (!orderOf.has(v.videoId)) {
      orderOf.set(v.videoId, idx + 1);
      titleOf.set(v.videoId, v.title);
    }
  });

  // First existing lesson per video id (dedupes accidental duplicates).
  const existingByVideoId = new Map<string, ExistingLesson>();
  for (const lesson of existing) {
    const videoId = extractYouTubeId(lesson.videoUrl);
    if (videoId && !existingByVideoId.has(videoId)) existingByVideoId.set(videoId, lesson);
  }

  // ── Lesson → playlist matching (updates + removable) ──
  const claimed = new Set<string>();
  for (const lesson of existing) {
    const videoId = extractYouTubeId(lesson.videoUrl);
    const order = videoId ? orderOf.get(videoId) : undefined;
    if (!videoId || order === undefined || claimed.has(videoId)) {
      // Not a YouTube lesson (R2 key / manual URL), a video that left the
      // playlist, or a duplicate of an earlier lesson — removable when the
      // playlist actually has content.
      if (videos.length > 0) plan.removable.push({ id: lesson.id, titleEn: lesson.titleEn });
      continue;
    }
    claimed.add(videoId);
    const title = titleOf.get(videoId) ?? "";
    const titleDrift = lesson.titleEn !== title || lesson.titleAr !== title;
    const orderDrift = lesson.sortOrder !== order;
    if (titleDrift || orderDrift) {
      plan.updates.push({ id: lesson.id, title, videoId, sortOrder: order });
    }
  }

  // ── Playlist → lesson matching (inserts in playlist order) ──
  videos.forEach((video, idx) => {
    if (existingByVideoId.has(video.videoId)) return;
    plan.inserts.push({
      videoId: video.videoId,
      title: video.title,
      sortOrder: idx + 1,
      isFree: options.isFree,
    });
  });

  return plan;
}

// ─── Apply ─────────────────────────────────────────────────────────────────────

export interface SyncSummary {
  ok: boolean;
  courseSlug: string;
  videosFound: number;
  added: number;
  updated: number;
  removed: number;
  coverUpdated: boolean;
  prunedOnce?: boolean;
  message?: string;
}

async function findTargetCourse() {
  const db = getDb();
  const [course] = await db
    .select({ id: courses.id, slug: courses.slug, titleAr: courses.titleAr, thumbnail: courses.thumbnail })
    .from(courses)
    .where(eq(courses.slug, TARGET_COURSE_SLUG))
    .limit(1);
  return course ?? null;
}

/** Delete lessons together with their progress/quizzes/notes (same contract as admin deleteLesson). */
async function deleteLessonsCascade(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const { lessonProgress, quizQuestions, userNotes } = await import("@db/schema");
  await db.delete(lessonProgress).where(inArray(lessonProgress.lessonId, ids));
  await db.delete(quizQuestions).where(inArray(quizQuestions.lessonId, ids));
  await db.delete(userNotes).where(inArray(userNotes.lessonId, ids));
  await db.delete(lessons).where(inArray(lessons.id, ids));
}

/**
 * Apply one playlist sync. Never throws — a failed sync is logged, recorded in
 * the state row, and surfaced to the dashboard via youtubeSyncStatus.
 */
export async function applyPlaylistSync(
  videos: ParsedVideo[],
  options: { replace?: boolean; reason?: string } = {},
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    ok: false,
    courseSlug: TARGET_COURSE_SLUG,
    videosFound: videos.length,
    added: 0,
    updated: 0,
    removed: 0,
    coverUpdated: false,
  };

  try {
    const course = await findTargetCourse();
    if (!course) {
      summary.message = "target course not found";
      logger.warn("[PlaylistSync] target course missing", { slug: TARGET_COURSE_SLUG });
      return summary;
    }

    const settings = await getSyncSettings();
    const prevState = await getSyncState();
    const db = getDb();

    if (videos.length === 0) {
      // Every source was throttled — keep the course as-is, record the blind tick.
      summary.message = "playlist unavailable (throttled?) — nothing changed";
      await writeState({
        ...prevState,
        lastSyncAt: new Date().toISOString(),
        lastError: "playlist fetch returned zero videos",
      });
      return summary;
    }

    const existing = await db
      .select({
        id: lessons.id,
        titleEn: lessons.titleEn,
        titleAr: lessons.titleAr,
        videoUrl: lessons.videoUrl,
        sortOrder: lessons.sortOrder,
      })
      .from(lessons)
      .where(eq(lessons.courseId, course.id))
      .orderBy(asc(lessons.sortOrder), asc(lessons.id));

    // "Only real videos" purge runs ONCE automatically (deploy upgrade), then
    // only on explicit admin request — auto ticks never delete afterwards.
    const replace = options.replace === true || !prevState?.prunedOnce;

    const plan = planPlaylistSync(existing, videos, { isFree: settings.autoImportFree });

    // ── 1. Insert missing videos (verbatim titles) ──
    for (const item of plan.inserts) {
      await db.insert(lessons).values({
        courseId: course.id,
        titleEn: item.title.slice(0, 500),
        titleAr: item.title.slice(0, 500),
        descriptionEn: null,
        descriptionAr: `حلقة من كورس ETAP على قناة AhmedEtap — المشاهدة داخل المنصة مع تتبع التقدم. العنوان كما هو على يوتيوب.`,
        videoUrl: buildYouTubeWatchUrl(item.videoId),
        durationMinutes: null,
        sortOrder: item.sortOrder,
        isFree: item.isFree,
        isPublished: true,
      }).$returningId();
      summary.added++;
      logger.info("[PlaylistSync] lesson inserted", { videoId: item.videoId, title: item.title });
    }

    // ── 2. Re-title / re-order drifted lessons ──
    for (const upd of plan.updates) {
      await db
        .update(lessons)
        .set({ titleEn: upd.title.slice(0, 500), titleAr: upd.title.slice(0, 500), sortOrder: upd.sortOrder })
        .where(eq(lessons.id, upd.id));
      summary.updated++;
    }

    // ── 3. Remove non-real lessons (fake/demo rows) ──
    const removableIds = replace ? plan.removable.map((r) => r.id) : [];
    if (removableIds.length > 0) {
      await deleteLessonsCascade(removableIds);
      summary.removed = removableIds.length;
      logger.warn("[PlaylistSync] non-playlist lessons removed", {
        count: removableIds.length,
        titles: plan.removable.map((r) => r.titleEn).slice(0, 10),
      });
    }

    // ── 4. Cover = first video's thumbnail (credibility) ──
    if (settings.autoCover && videos.length > 0) {
      const firstVideo = videos[0]!;
      const cover = buildYouTubeThumbnailUrl(firstVideo.videoId, "maxres");
      if (course.thumbnail !== cover) {
        await db.update(courses).set({ thumbnail: cover, updatedAt: new Date() }).where(eq(courses.id, course.id));
        summary.coverUpdated = true;
        logger.info("[PlaylistSync] course cover updated from first video", {
          courseId: course.id,
          videoId: firstVideo.videoId,
        });
      }
    }

    // ── 5. Persist state + invalidate the public course cache ──
    const nowIso = new Date().toISOString();
    await writeState({
      lastSyncAt: nowIso,
      lastSuccessAt: nowIso,
      videosFound: videos.length,
      added: summary.added,
      updated: summary.updated,
      removed: summary.removed,
      coverUpdated: summary.coverUpdated,
      prunedOnce: prevState?.prunedOnce || replace,
      lastError: null,
    });
    await invalidateCourseDetailCache(course.slug);
    summary.ok = true;
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[PlaylistSync] sync failed", { error: message, reason: options.reason });
    try {
      const prevState = await getSyncState();
      await writeState({ ...prevState, lastSyncAt: new Date().toISOString(), lastError: message.slice(0, 200) });
    } catch {
      // state write is best-effort
    }
    summary.message = message;
    return summary;
  }
}

/**
 * Watcher-tick entry point: applies the auto sync only when the policy
 * allows it (autoImport ON). Uses the SAME videos the tick already fetched —
 * no second YouTube download.
 */
export async function runAutoPlaylistSync(videos: ParsedVideo[]): Promise<SyncSummary | null> {
  const settings = await getSyncSettings();
  if (!settings.autoImport) return null;
  return applyPlaylistSync(videos, { reason: "watcher-tick" });
}

// ─── Dashboard introspection ───────────────────────────────────────────────────

export interface DashboardSyncInfo {
  courseSlug: string;
  courseFound: boolean;
  courseTitle: string | null;
  cover: string | null;
  lessonCount: number;
  youtubeLessonCount: number;
  state: PlaylistSyncState | null;
  settings: PlaylistSyncSettings;
}

export async function getDashboardSyncInfo(): Promise<DashboardSyncInfo> {
  const db = getDb();
  const course = await findTargetCourse();
  const [settings, state] = await Promise.all([getSyncSettings(), getSyncState()]);
  const base: DashboardSyncInfo = {
    courseSlug: TARGET_COURSE_SLUG,
    courseFound: !!course,
    courseTitle: course?.titleAr ?? null,
    cover: course?.thumbnail ?? null,
    lessonCount: 0,
    youtubeLessonCount: 0,
    state,
    settings,
  };
  if (!course) return base;
  const rows = await db
    .select({ videoUrl: lessons.videoUrl })
    .from(lessons)
    .where(eq(lessons.courseId, course.id));
  base.lessonCount = rows.length;
  base.youtubeLessonCount = rows.filter((r) => extractYouTubeId(r.videoUrl)).length;
  return base;
}

// re-export for the watcher (it already imports ParsedVideo from notification-utils)
export type { ParsedVideo };
