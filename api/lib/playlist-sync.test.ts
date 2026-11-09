import { describe, expect, it, vi } from "vitest";

// The sync module imports the DB connection chain + the watcher pipeline,
// which validate env at import time. Planning tests are pure — mock the
// heavy dependencies away.
vi.mock("../queries/connection.js", () => ({ getDb: vi.fn() }));
vi.mock("./env.js", () => ({ env: { NODE_ENV: "test", isProduction: false } }));
vi.mock("./youtube-watcher.js", () => ({ fetchPlaylistVideosForImport: vi.fn(async () => ({ items: [], verified: true })) }));
vi.mock("./cache.js", () => ({ invalidateCourseDetailCache: vi.fn() }));

import { planPlaylistSync, type ExistingLesson } from "./playlist-sync.js";
import type { ParsedVideo } from "./notification-utils.js";

const V1: ParsedVideo = { videoId: "0l7WBjMF6uo", title: "كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف" };
const V2: ParsedVideo = { videoId: "avugPlx0sXw", title: "تحميل وتسطيب برنامج ETAP 2021 كامل | كورس ايتاب كامل بالعربي #01 | ETAP Course" };

function lesson(partial: Partial<ExistingLesson> & { id: number }): ExistingLesson {
  return {
    titleEn: "",
    titleAr: "",
    videoUrl: null,
    sortOrder: 0,
    ...partial,
  };
}

describe("planPlaylistSync", () => {
  it("inserts every playlist video (verbatim title, playlist order) when the course is empty", () => {
    const plan = planPlaylistSync([], [V1, V2]);
    expect(plan.inserts).toEqual([
      { videoId: V1.videoId, title: V1.title, sortOrder: 1, isFree: true },
      { videoId: V2.videoId, title: V2.title, sortOrder: 2, isFree: true },
    ]);
    expect(plan.updates).toEqual([]);
    expect(plan.removable).toEqual([]);
  });

  it("treats an existing lesson matching a playlist video as synced — no churn", () => {
    const existing = [lesson({ id: 7, titleEn: V1.title, titleAr: V1.title, videoUrl: "https://www.youtube.com/watch?v=0l7WBjMF6uo", sortOrder: 1 })];
    const plan = planPlaylistSync(existing, [V1]);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.removable).toEqual([]);
  });

  it("flags title drift — the verbatim YouTube name always wins", () => {
    const existing = [lesson({ id: 7, titleEn: "عنوان مبتكر", titleAr: V1.title, videoUrl: "https://youtu.be/0l7WBjMF6uo", sortOrder: 1 })];
    const plan = planPlaylistSync(existing, [V1]);
    expect(plan.updates).toEqual([{ id: 7, title: V1.title, videoId: V1.videoId, sortOrder: 1 }]);
    expect(plan.removable).toEqual([]);
  });

  it("flags order drift when the owner reorders the playlist", () => {
    const existing = [
      lesson({ id: 1, titleEn: V1.title, titleAr: V1.title, videoUrl: "https://youtu.be/0l7WBjMF6uo", sortOrder: 1 }),
      lesson({ id: 2, titleEn: V2.title, titleAr: V2.title, videoUrl: "https://youtu.be/avugPlx0sXw", sortOrder: 2 }),
    ];
    const plan = planPlaylistSync(existing, [V2, V1]); // owner swapped the order
    expect(plan.updates).toEqual([
      { id: 1, title: V1.title, videoId: V1.videoId, sortOrder: 2 },
      { id: 2, title: V2.title, videoId: V2.videoId, sortOrder: 1 },
    ]);
  });

  it("marks non-YouTube demo lessons as removable when the playlist has content", () => {
    const existing = [
      lesson({ id: 11, titleEn: "درس تجريبي", titleAr: "درس تجريبي", videoUrl: "etap/lesson-demo.mp4", sortOrder: 1 }),
      lesson({ id: 12, titleEn: "شرح R2", titleAr: "شرح R2", videoUrl: "https://cdn.example.com/x.m3u8", sortOrder: 2 }),
    ];
    const plan = planPlaylistSync(existing, [V1]);
    expect(plan.removable.map((r) => r.id)).toEqual([11, 12]);
    expect(plan.inserts).toEqual([{ videoId: V1.videoId, title: V1.title, sortOrder: 1, isFree: true }]);
  });

  it("marks lessons whose video left the playlist as removable", () => {
    const existing = [lesson({ id: 9, titleEn: "حلقة محذوفة", titleAr: "حلقة محذوفة", videoUrl: "https://youtu.be/Deleted12345".slice(0, 32), sortOrder: 1 })];
    const plan = planPlaylistSync(existing, [V1]);
    expect(plan.removable.map((r) => r.id)).toEqual([9]);
    expect(plan.inserts).toEqual([{ videoId: V1.videoId, title: V1.title, sortOrder: 1, isFree: true }]);
  });

  it("is conservative when the playlist came back empty (throttled) — nothing removable", () => {
    const existing = [lesson({ id: 11, titleEn: "درس", titleAr: "درس", videoUrl: "etap/x.mp4", sortOrder: 1 })];
    const plan = planPlaylistSync(existing, []);
    expect(plan.removable).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([]);
  });

  it("matches embed and nocookie url shapes, and respects the isFree option", () => {
    const existing = [
      lesson({ id: 1, titleEn: V1.title, titleAr: V1.title, videoUrl: "https://www.youtube-nocookie.com/embed/0l7WBjMF6uo?rel=0", sortOrder: 1 }),
    ];
    const plan = planPlaylistSync(existing, [V1, V2], { isFree: false });
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([{ videoId: V2.videoId, title: V2.title, sortOrder: 2, isFree: false }]);
  });

  it("dedupes a repeated playlist video (keeps first position) and duplicate lessons (first wins)", () => {
    const existing = [
      lesson({ id: 1, titleEn: V1.title, titleAr: V1.title, videoUrl: "https://youtu.be/0l7WBjMF6uo", sortOrder: 1 }),
      lesson({ id: 2, titleEn: V1.title, titleAr: V1.title, videoUrl: "https://youtu.be/0l7WBjMF6uo", sortOrder: 2 }),
    ];
    const plan = planPlaylistSync(existing, [V1, { ...V1 }]);
    // First lesson is synced; the duplicate has no playlist position → removable
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.removable.map((r) => r.id)).toEqual([2]);
  });
});
