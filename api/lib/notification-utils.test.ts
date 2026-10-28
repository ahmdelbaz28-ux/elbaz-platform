import { describe, it, expect } from "vitest";
import {
  decodeJsonStringLiteral,
  parsePlaylistVideos,
  parseInnertubeBrowse,
  mergeVideoSources,
  extractFromRss,
  isAfterCursor,
  makeEventId,
} from "./notification-utils.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal but faithful slice of a real YouTube playlist page (initial data). */
const PLAYLIST_HTML = `
<html><body><script>
var ytInitialData = {"contents":[{"playlistVideoRenderer":{"videoId":"0l7WBjMF6uo","thumbnail":{"thumbnails":[]},"title":{"runs":[{"text":"الحلقة 1: مقدمة الكورس"}]},"shortBylineText":{"runs":[{"text":"AhmedEtap"}]}}},{"playlistVideoRenderer":{"videoId":"AbCdEfGhIjK","thumbnail":{"thumbnails":[]},"title":{"runs":[{"text":"الحلقة 2: ETAP \\u0026 Load Flow \\u0026 النظرية"}]},"shortBylineText":{"runs":[{"text":"AhmedEtap"}]}}},{"playlistVideoRenderer":{"videoId":"0l7WBjMF6uo","title":{"runs":[{"text":"duplicate"}]}}}]}
</script></body></html>`;

const PLAYLIST_HTML_BARE_IDS = `
<html><body>no renderers here just ids
"videoId":"ZzYyXwWvUuT" and "videoId":"QqWwEeRrTtY"
</body></html>`;

/** 2025+ layout: playlist items as lockupViewModel objects (verified live). */
const PLAYLIST_HTML_LOCKUP = `
<html><body><script>
var ytInitialData = {"contents":[{"itemSectionRenderer":{"contents":[{"lockupViewModel":{"contentImage":{"thumbnailViewModel":{"image":{"sources":[{"url":"https://i.ytimg.com/vi/0l7WBjMF6uo/hqdefault.jpg?sqp=AA\\u0026rs=B1","width":168,"height":94}]}}},"metadata":{"lockupMetadataViewModel":{"title":{"content":"كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف"},"metadata":{"contentMetadataViewModel":{}}}}}}]}]}
</script></body></html>`;

/** Minimal Atom feed as served by youtube.com/feeds/videos.xml. */
const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
 <title>كورس ETAP</title>
 <entry>
  <yt:videoId>0l7WBjMF6uo</yt:videoId>
  <title>الحلقة 1: مقدمة &amp; نظرة عامة</title>
  <published>2026-10-17T10:00:00+00:00</published>
 </entry>
 <entry>
  <yt:videoId>N3wV1dEoId1</yt:videoId>
  <title>الحلقة الجديدة</title>
  <published>2026-10-28T08:00:00+00:00</published>
 </entry>
</feed>`;

// ─── decodeJsonStringLiteral ───────────────────────────────────────────────────

describe("decodeJsonStringLiteral", () => {
  it("decodes unicode escapes and escaped quotes", () => {
    expect(decodeJsonStringLiteral("ETAP \\u0026 Load Flow")).toBe("ETAP & Load Flow");
    expect(decodeJsonStringLiteral('say \\"hi\\"')).toBe('say "hi"');
  });

  it("falls back to manual replacement on malformed input", () => {
    expect(decodeJsonStringLiteral("a\\u0026b")).toBe("a&b");
  });
});

// ─── parsePlaylistVideos ───────────────────────────────────────────────────────

describe("parsePlaylistVideos", () => {
  it("extracts videoId+title pairs in order from playlistVideoRenderer blocks", () => {
    const videos = parsePlaylistVideos(PLAYLIST_HTML);
    expect(videos.length).toBeGreaterThanOrEqual(2);
    expect(videos[0]).toEqual({ videoId: "0l7WBjMF6uo", title: "الحلقة 1: مقدمة الكورس" });
    expect(videos[1]).toEqual({
      videoId: "AbCdEfGhIjK",
      title: "الحلقة 2: ETAP & Load Flow & النظرية",
    });
  });

  it("deduplicates repeated videoIds (same video in multiple blocks)", () => {
    const videos = parsePlaylistVideos(PLAYLIST_HTML);
    const ids = videos.map((v) => v.videoId);
    expect(ids.filter((id) => id === "0l7WBjMF6uo")).toHaveLength(1);
  });

  it("falls back to loose videoId scan when no renderers exist", () => {
    const videos = parsePlaylistVideos(PLAYLIST_HTML_BARE_IDS);
    expect(videos.map((v) => v.videoId)).toEqual(["ZzYyXwWvUuT", "QqWwEeRrTtY"]);
  });

  it("supports the 2025+ lockupViewModel layout (videoId from /vi/, title.content)", () => {
    const videos = parsePlaylistVideos(PLAYLIST_HTML_LOCKUP);
    expect(videos).toEqual([
      { videoId: "0l7WBjMF6uo", title: "كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف" },
    ]);
  });

  it("returns [] for empty/garbage HTML", () => {
    expect(parsePlaylistVideos("")).toEqual([]);
    expect(parsePlaylistVideos("<html>nothing</html>")).toEqual([]);
  });
});

// ─── extractFromRss ────────────────────────────────────────────────────────────

describe("extractFromRss", () => {
  it("extracts entries with decoded titles", () => {
    const videos = extractFromRss(RSS_XML);
    expect(videos).toEqual([
      { videoId: "0l7WBjMF6uo", title: "الحلقة 1: مقدمة & نظرة عامة" },
      { videoId: "N3wV1dEoId1", title: "الحلقة الجديدة" },
    ]);
  });

  it("returns [] for feeds without entries", () => {
    expect(extractFromRss('<feed><title>empty</title></feed>')).toEqual([]);
  });
});

// ─── parseInnertubeBrowse ──────────────────────────────────────────────────────

/** Faithful slice of the live youtubei/v1/browse response for a playlist
 *  (verified 2026-10-28): lockupViewModel entries + unrelated videoId noise. */
const INNERTUBE_LOCKUP = {
  responseContext: { visitorData: "x" },
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [{
        tabRenderer: {
          content: {
            sectionListRenderer: {
              contents: [{
                itemSectionRenderer: {
                  contents: [{
                    playlistVideoListRenderer: {
                      contents: [
                        {
                          lockupViewModel: {
                            contentImage: { thumbnailViewModel: { image: { sources: [{ url: "https://i.ytimg.com/vi/0l7WBjMF6uo/hq.jpg" }] } } },
                            metadata: { lockupMetadataViewModel: { title: { content: "كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف" } } },
                          },
                        },
                        {
                          lockupViewModel: {
                            contentId: "N3wV1dEoId1",
                            contentImage: {},
                            metadata: { lockupMetadataViewModel: { title: { content: "الحلقة الجديدة" } } },
                          },
                        },
                        { videoId: "n01s3N0Is3N", videoType: "VIDEO" }, // noise: unrelated bare id
                      ],
                    },
                  }],
                },
              }],
            },
          },
        },
      }],
    },
  },
};

/** Legacy renderer shape inside a browse response. */
const INNERTUBE_LEGACY = {
  contents: [{
    playlistVideoListRenderer: {
      contents: [
        { playlistVideoRenderer: { videoId: "0l7WBjMF6uo", title: { runs: [{ text: "الحلقة 1: مقدمة الكورس" }] } } },
        { playlistVideoRenderer: { videoId: "AbCdEfGhIjK", title: { runs: [{ text: "الحلقة 2", }, { text: " — ETAP" }] } } },
      ],
    },
  }],
};

describe("parseInnertubeBrowse", () => {
  it("extracts lockupViewModel entries (contentId + nested title) in order, ignoring bare videoId noise", () => {
    const videos = parseInnertubeBrowse(INNERTUBE_LOCKUP);
    expect(videos).toEqual([
      { videoId: "0l7WBjMF6uo", title: "كورس ETAP المجاني | تعلم ETAP من الصفر وحتى الاحتراف" },
      { videoId: "N3wV1dEoId1", title: "الحلقة الجديدة" },
    ]);
  });

  it("supports the legacy playlistVideoRenderer shape (videoId + title.runs)", () => {
    expect(parseInnertubeBrowse(INNERTUBE_LEGACY)).toEqual([
      { videoId: "0l7WBjMF6uo", title: "الحلقة 1: مقدمة الكورس" },
      { videoId: "AbCdEfGhIjK", title: "الحلقة 2 — ETAP" },
    ]);
  });

  it("falls back to a loose videoId scan when no recognized renderer exists", () => {
    const loose = { a: { videoId: "ZzYyXwWvUuT" }, b: [{ videoId: "QqWwEeRrTtY" }] };
    expect(parseInnertubeBrowse(loose)).toEqual([
      { videoId: "ZzYyXwWvUuT", title: "" },
      { videoId: "QqWwEeRrTtY", title: "" },
    ]);
  });

  it("rejects malformed videoIds and non-object payloads", () => {
    expect(parseInnertubeBrowse({ x: { lockupViewModel: { contentId: "too-short" } } })).toEqual([]);
    expect(parseInnertubeBrowse(null)).toEqual([]);
    expect(parseInnertubeBrowse("html-string")).toEqual([]);
  });
});

// ─── mergeVideoSources ─────────────────────────────────────────────────────────

describe("mergeVideoSources", () => {
  it("unions sources in first-seen order; first non-empty title wins", () => {
    const a = [{ videoId: "0l7WBjMF6uo", title: "" }];
    const b = [
      { videoId: "0l7WBjMF6uo", title: "العنوان من المصدر الثاني" },
      { videoId: "N3wV1dEoId1", title: "حلقة جديدة" },
    ];
    expect(mergeVideoSources(a, b)).toEqual([
      { videoId: "0l7WBjMF6uo", title: "العنوان من المصدر الثاني" },
      { videoId: "N3wV1dEoId1", title: "حلقة جديدة" },
    ]);
  });

  it("keeps the first title even when a later source has a different one", () => {
    const a = [{ videoId: "0l7WBjMF6uo", title: "الأصلي" }];
    const b = [{ videoId: "0l7WBjMF6uo", title: "بديل" }];
    expect(mergeVideoSources(a, b)).toEqual([{ videoId: "0l7WBjMF6uo", title: "الأصلي" }]);
  });

  it("skips empty sources — a degraded source can never erase a healthy one", () => {
    expect(mergeVideoSources([], [{ videoId: "0l7WBjMF6uo", title: "x" }], [])).toEqual([
      { videoId: "0l7WBjMF6uo", title: "x" },
    ]);
    expect(mergeVideoSources()).toEqual([]);
  });
});

// ─── cursor semantics ──────────────────────────────────────────────────────────

describe("isAfterCursor", () => {
  it("keeps everything when there is no cursor", () => {
    expect(isAfterCursor("123-abc")).toBe(true);
    expect(isAfterCursor("123-abc", undefined)).toBe(true);
  });

  it("only keeps events strictly newer than the cursor", () => {
    expect(isAfterCursor("2000-xyz", "1000-abc")).toBe(true);
    expect(isAfterCursor("1000-abc", "1000-abc")).toBe(false);
    expect(isAfterCursor("0500-old", "1000-abc")).toBe(false);
  });
});

// ─── event id format ───────────────────────────────────────────────────────────

describe("makeEventId", () => {
  it("produces sortable {timestamp}-{hex} ids", () => {
    const a = makeEventId();
    expect(a).toMatch(/^\d+-[0-9a-f]{8}$/);
  });

  it("sorts chronologically across different timestamps", () => {
    const earlier = `1750000000000-${"a".repeat(8)}`;
    const later = `1750000000001-${"0".repeat(8)}`;
    expect(later > earlier).toBe(true);
  });

  it("generates unique ids within the same millisecond burst", () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeEventId()));
    expect(ids.size).toBe(50);
  });
});
