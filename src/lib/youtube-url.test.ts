import { describe, expect, it } from "vitest";
import {
  buildYouTubeEmbedUrl,
  buildYouTubeThumbnailUrl,
  buildYouTubeWatchUrl,
  extractYouTubeId,
  isYouTubeVideoRef,
} from "./youtube-url";

describe("extractYouTubeId", () => {
  const ID = "dQw4w9WgXcQ";

  it("accepts a bare 11-char id", () => {
    expect(extractYouTubeId(ID)).toBe(ID);
  });

  it("accepts watch?v= URLs", () => {
    expect(extractYouTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://youtube.com/watch?v=${ID}&t=90s`)).toBe(ID);
    expect(extractYouTubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("accepts youtu.be shortlinks (with and without scheme)", () => {
    expect(extractYouTubeId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://youtu.be/${ID}?si=xyz`)).toBe(ID);
    expect(extractYouTubeId(`youtu.be/${ID}`)).toBe(ID);
  });

  it("accepts shorts / embed / live / legacy v paths", () => {
    expect(extractYouTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://www.youtube.com/v/${ID}`)).toBe(ID);
    expect(extractYouTubeId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID);
  });

  it("accepts the oEmbed endpoint whose url param carries a watch link", () => {
    const target = encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`);
    expect(extractYouTubeId(`https://www.youtube.com/oembed?url=${target}`)).toBe(ID);
  });

  it("accepts padded/uppercased surrounding whitespace", () => {
    expect(extractYouTubeId(`  ${ID}  `)).toBe(ID);
  });

  it("rejects playlist-only links without a video", () => {
    expect(extractYouTubeId("https://www.youtube.com/playlist?list=PLabc123")).toBeNull();
  });

  it("rejects R2 object keys and arbitrary URLs", () => {
    expect(extractYouTubeId("etap/lesson01.mp4")).toBeNull();
    expect(extractYouTubeId("https://acct.r2.cloudflarestorage.com/etap/lesson01.mp4?X-Amz-Signature=x")).toBeNull();
    expect(extractYouTubeId("https://vimeo.com/123456789")).toBeNull();
  });

  it("rejects malformed ids (too short, bad charset, empty)", () => {
    expect(extractYouTubeId("short")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch?v=toolongid12345")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch?v=has!special!")).toBeNull();
    expect(extractYouTubeId("")).toBeNull();
    expect(extractYouTubeId(null)).toBeNull();
    expect(extractYouTubeId(undefined)).toBeNull();
  });
});

describe("isYouTubeVideoRef", () => {
  it("is the boolean mirror of extractYouTubeId", () => {
    expect(isYouTubeVideoRef("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeVideoRef("etap/lesson01.mp4")).toBe(false);
    expect(isYouTubeVideoRef("")).toBe(false);
  });
});

describe("buildYouTubeEmbedUrl", () => {
  it("uses youtube-nocookie with jsapi, origin and safe params", () => {
    const url = new URL(buildYouTubeEmbedUrl("dQw4w9WgXcQ", "https://ahmedelbaz.qzz.io"));
    expect(url.origin).toBe("https://www.youtube-nocookie.com");
    expect(url.pathname).toBe("/embed/dQw4w9WgXcQ");
    expect(url.searchParams.get("enablejsapi")).toBe("1");
    expect(url.searchParams.get("origin")).toBe("https://ahmedelbaz.qzz.io");
    expect(url.searchParams.get("rel")).toBe("0");
    expect(url.searchParams.get("playsinline")).toBe("1");
    expect(url.searchParams.get("modestbranding")).toBe("1");
    expect(url.searchParams.get("hl")).toBe("ar");
  });

  it("throws on an invalid id instead of building a broken frame", () => {
    expect(() => buildYouTubeEmbedUrl("not-an-id", "https://ahmedelbaz.qzz.io")).toThrow();
    expect(() => buildYouTubeEmbedUrl("../../etc", "https://ahmedelbaz.qzz.io")).toThrow();
  });
});

describe("buildYouTubeWatchUrl", () => {
  it("builds the watch URL, with playlist when given", () => {
    expect(buildYouTubeWatchUrl("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const withList = new URL(buildYouTubeWatchUrl("dQw4w9WgXcQ", "PLeeb5_Qjhcgc"));
    expect(withList.searchParams.get("v")).toBe("dQw4w9WgXcQ");
    expect(withList.searchParams.get("list")).toBe("PLeeb5_Qjhcgc");
  });
});

describe("buildYouTubeThumbnailUrl", () => {
  it("builds the public i.ytimg.com thumbnail and rejects bad ids", () => {
    expect(buildYouTubeThumbnailUrl("dQw4w9WgXcQ")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
    expect(buildYouTubeThumbnailUrl("dQw4w9WgXcQ", "hq")).toBe("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    expect(() => buildYouTubeThumbnailUrl("bad")).toThrow();
  });
});
