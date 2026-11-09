import { describe, expect, it, vi } from "vitest";

// The module reads env + R2 at import time; the YouTube branch returns before
// touching R2, so both are mocked away for these tests.
vi.mock("./env", () => ({ env: { NODE_ENV: "test", isProduction: false, FRONTEND_URL: "https://ahmedelbaz.qzz.io" } }));
vi.mock("./r2", () => ({ generateR2PresignedUrl: vi.fn() }));
vi.mock("./logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { getSecureVideoUrl } from "./video-protection.js";

describe("getSecureVideoUrl — YouTube branch", () => {
  it("returns an embedded nocookie URL with kind=youtube for a watch URL", async () => {
    const res = await getSecureVideoUrl({
      videoUrl: "https://www.youtube.com/watch?v=0l7WBjMF6uo",
      userId: 1,
      lessonId: 10,
      username: "student1",
    });
    expect(res.kind).toBe("youtube");
    expect(res.youtubeId).toBe("0l7WBjMF6uo");
    expect(res.videoUrl).toContain("https://www.youtube-nocookie.com/embed/0l7WBjMF6uo");
    expect(res.videoUrl).toContain("origin=https%3A%2F%2Fahmedelbaz.qzz.io");
    expect(res.hlsUrl).toBeNull();
    expect(res.youtubeWatchUrl).toBe("https://www.youtube.com/watch?v=0l7WBjMF6uo");
    expect(res.watermarkToken).toBeTruthy();
  });

  it("works for youtu.be / embed / bare-id shapes too", async () => {
    for (const url of ["https://youtu.be/avugPlx0sXw", "https://www.youtube.com/embed/avugPlx0sXw", "avugPlx0sXw"]) {
      const res = await getSecureVideoUrl({ videoUrl: url, userId: 2, lessonId: 11, username: "u" });
      expect(res.kind).toBe("youtube");
      expect(res.youtubeId).toBe("avugPlx0sXw");
    }
  });

  it("embeds keep hl=ar + rel=0 + playsinline (Arabic, credible, mobile-safe)", async () => {
    const res = await getSecureVideoUrl({
      videoUrl: "https://youtu.be/0l7WBjMF6uo",
      userId: 1,
      lessonId: 1,
      username: "u",
    });
    expect(res.videoUrl).toContain("hl=ar");
    expect(res.videoUrl).toContain("rel=0");
    expect(res.videoUrl).toContain("playsinline=1");
    expect(res.videoUrl).toContain("enablejsapi=1");
  });

  it("never presigns R2 for a YouTube lesson", async () => {
    const { generateR2PresignedUrl } = await import("./r2");
    await getSecureVideoUrl({ videoUrl: "https://youtu.be/0l7WBjMF6uo", userId: 1, lessonId: 1, username: "u" });
    expect(generateR2PresignedUrl).not.toHaveBeenCalled();
  });
});
