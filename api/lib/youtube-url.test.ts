import { describe, expect, it } from "vitest";
import {
  buildYouTubeEmbedUrl,
  buildYouTubeThumbnailUrl,
  buildYouTubeWatchUrl,
  extractPlaylistId,
  extractYouTubeId,
  isYouTubeVideoUrl,
} from "./youtube-url.js";

describe("extractYouTubeId", () => {
  it("extracts from every common URL shape", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=0l7WBjMF6uo")).toBe("0l7WBjMF6uo");
    expect(extractYouTubeId("https://youtube.com/watch?v=avugPlx0sXw&t=42s")).toBe("avugPlx0sXw");
    expect(extractYouTubeId("https://youtu.be/0l7WBjMF6uo")).toBe("0l7WBjMF6uo");
    expect(extractYouTubeId("https://www.youtube.com/embed/0l7WBjMF6uo")).toBe("0l7WBjMF6uo");
    expect(extractYouTubeId("https://www.youtube-nocookie.com/embed/avugPlx0sXw?rel=0")).toBe("avugPlx0sXw");
    expect(extractYouTubeId("https://www.youtube.com/shorts/0l7WBjMF6uo")).toBe("0l7WBjMF6uo");
    expect(extractYouTubeId("https://www.youtube.com/live/avugPlx0sXw")).toBe("avugPlx0sXw");
  });

  it("accepts a bare 11-char id and rejects garbage", () => {
    expect(extractYouTubeId("0l7WBjMF6uo")).toBe("0l7WBjMF6uo");
    expect(extractYouTubeId("  avugPlx0sXw ")).toBe("avugPlx0sXw");
    expect(extractYouTubeId("short")).toBeNull(); // wrong length
    expect(extractYouTubeId("this-id-is-way-too-long")).toBeNull(); // wrong length
    expect(extractYouTubeId("")).toBeNull();
    expect(extractYouTubeId(null)).toBeNull();
    expect(extractYouTubeId(undefined)).toBeNull();
  });

  it("does not confuse playlist ids with video ids", () => {
    // list= param alone is not a video
    expect(extractYouTubeId("https://www.youtube.com/playlist?list=PLeeb5_Qjhcgc123")).toBeNull();
  });
});

describe("isYouTubeVideoUrl", () => {
  it("recognizes youtube links and bare ids, rejects R2 keys and files", () => {
    expect(isYouTubeVideoUrl("https://www.youtube.com/watch?v=0l7WBjMF6uo")).toBe(true);
    expect(isYouTubeVideoUrl("https://youtu.be/avugPlx0sXw")).toBe(true);
    expect(isYouTubeVideoUrl("0l7WBjMF6uo")).toBe(true);
    expect(isYouTubeVideoUrl("etap/lesson01.mp4")).toBe(false);
    expect(isYouTubeVideoUrl("https://cdn.example.com/video.m3u8")).toBe(false);
    expect(isYouTubeVideoUrl(null)).toBe(false);
    expect(isYouTubeVideoUrl("")).toBe(false);
  });
});

describe("buildYouTubeWatchUrl / buildYouTubeEmbedUrl", () => {
  it("produces a canonical re-extractable watch url", () => {
    const url = buildYouTubeWatchUrl("0l7WBjMF6uo");
    expect(url).toBe("https://www.youtube.com/watch?v=0l7WBjMF6uo");
    expect(extractYouTubeId(url)).toBe("0l7WBjMF6uo");
  });

  it("produces a nocookie embed with tracking + mobile + arabic params", () => {
    const url = buildYouTubeEmbedUrl("0l7WBjMF6uo", "https://ahmedelbaz.qzz.io");
    expect(url).toContain("https://www.youtube-nocookie.com/embed/0l7WBjMF6uo?");
    expect(url).toContain("enablejsapi=1");
    expect(url).toContain("playsinline=1");
    expect(url).toContain("rel=0");
    expect(url).toContain("hl=ar");
    expect(url).toContain("origin=https%3A%2F%2Fahmedelbaz.qzz.io");
    expect(extractYouTubeId(url)).toBe("0l7WBjMF6uo");
  });

  it("omits origin when not provided", () => {
    expect(buildYouTubeEmbedUrl("0l7WBjMF6uo")).not.toContain("origin=");
  });
});

describe("buildYouTubeThumbnailUrl", () => {
  it("builds ytimg poster urls for all qualities", () => {
    expect(buildYouTubeThumbnailUrl("0l7WBjMF6uo")).toBe("https://i.ytimg.com/vi/0l7WBjMF6uo/maxresdefault.jpg");
    expect(buildYouTubeThumbnailUrl("avugPlx0sXw", "hq")).toBe("https://i.ytimg.com/vi/avugPlx0sXw/hqdefault.jpg");
    expect(buildYouTubeThumbnailUrl("avugPlx0sXw", "mq")).toBe("https://i.ytimg.com/vi/avugPlx0sXw/mqdefault.jpg");
  });
});

describe("extractPlaylistId", () => {
  it("parses playlist URLs, bare ids, and rejects video links without list", () => {
    expect(extractPlaylistId("https://www.youtube.com/playlist?list=PLeeb5_Qjhcgc")).toBe("PLeeb5_Qjhcgc");
    expect(extractPlaylistId("https://youtube.com/playlist?list=PLeeb5_Qjhcgc&hl=ar")).toBe("PLeeb5_Qjhcgc");
    expect(extractPlaylistId("https://www.youtube.com/watch?v=0l7WBjMF6uo&list=PLeeb5_Qjhcgc")).toBe("PLeeb5_Qjhcgc");
    expect(extractPlaylistId("PLeeb5_Qjhcgc")).toBe("PLeeb5_Qjhcgc");
    expect(extractPlaylistId("https://www.youtube.com/watch?v=0l7WBjMF6uo")).toBeNull();
    expect(extractPlaylistId(null)).toBeNull();
  });
});
