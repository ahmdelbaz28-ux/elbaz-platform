/**
 * Video protection — YouTube branch tests (hybrid playback conversion).
 *
 * The lesson videoUrl may now be a YouTube link from the channel's playlist.
 * getSecureVideoUrl MUST branch BEFORE any R2 presigning (presigning a
 * youtube.com URL used to throw → fail-closed 503 "Video temporarily
 * unavailable" — the exact regression the conversion had to prevent).
 *
 * These tests mock the R2 client so the R2 branch stays hermetic, and assert:
 *   1. YouTube refs (every supported shape) return kind="youtube" + the id
 *      + an https://www.youtube-nocookie.com/embed/... URL — with NO R2 call.
 *   2. R2 keys still take the legacy path (kind="r2", presigned).
 *   3. Empty videoUrl returns the inert default (kind="r2", youtubeId=null).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const presignMock = vi.hoisted(() => vi.fn(async ({ objectKey }: { objectKey: string }) => `https://presigned.r2.test/${objectKey}?sig=abc`));

vi.mock("./r2", () => ({
  generateR2PresignedUrl: presignMock,
  getR2ObjectMetadata: vi.fn(async () => ({ exists: false })),
}));

vi.mock("./env", () => ({
  env: { FRONTEND_URL: "https://ahmedelbaz.qzz.io", WATERMARK_SECRET: undefined },
}));

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getSecureVideoUrl } from "./video-protection";

const base = {
  userId: 7,
  lessonId: 42,
  username: "tester",
};

describe("getSecureVideoUrl — YouTube branch", () => {
  beforeEach(() => {
    presignMock.mockClear();
  });

  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("branches %s → kind=youtube without touching R2", async (videoUrl, expectedId) => {
    const result = await getSecureVideoUrl({ ...base, videoUrl });

    expect(result.kind).toBe("youtube");
    expect(result.youtubeId).toBe(expectedId);
    expect(result.hlsUrl).toBeNull();
    expect(result.videoUrl).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\//);
    expect(new URL(result.videoUrl).searchParams.get("origin")).toBeTruthy();
    // The critical contract: ZERO R2 activity for YouTube refs.
    expect(presignMock).not.toHaveBeenCalled();
  });

  it("keeps the legacy R2 path intact for object keys", async () => {
    const result = await getSecureVideoUrl({ ...base, videoUrl: "etap/lesson01.mp4" });

    expect(result.kind).toBe("r2");
    expect(result.youtubeId).toBeNull();
    expect(result.videoUrl).toBe("https://presigned.r2.test/etap/lesson01.mp4?sig=abc");
    expect(presignMock).toHaveBeenCalledTimes(1);
  });

  it("empty videoUrl returns the inert default", async () => {
    const result = await getSecureVideoUrl({ ...base, videoUrl: "" });

    expect(result.kind).toBe("r2");
    expect(result.youtubeId).toBeNull();
    expect(result.videoUrl).toBe("");
    expect(presignMock).not.toHaveBeenCalled();
  });
});
