/**
 * YouTube playlist IMPORT pipeline tests — the owner's exactness rule.
 *
 * "الموقع لازم يعرض بس الفيديوهات الموجودة فعلاً على اليوتيوب، وبعناوينها
 *  المكتوبة على اليوتيوب حرفياً — ممنوع أي عنوان مخالف."
 *
 * These tests pin the two hard guarantees of fetchPlaylistVideosForImport:
 *   1. Placeholder entries YouTube keeps inside playlists after a video is
 *      deleted/privated ("فيديو خاص", "[Private video]", …) NEVER reach the
 *      import dialog.
 *   2. Every listed video is re-checked against YouTube's own oEmbed endpoint:
 *      200 → the video exists RIGHT NOW and oEmbed's `title` (the live
 *      YouTube title) replaces any scraped title verbatim; 404/401 → dropped;
 *      network failure → honest `verified:false`, never a fake check.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./notification-broadcast.js", () => ({
  pushNotification: vi.fn(async () => null),
  pruneOldNotifications: vi.fn(async () => undefined),
}));

import { fetchOembedVerdict, fetchPlaylistVideosForImport, isUnavailableTitle } from "./youtube-watcher";

/** Real-looking 11-char ids (VIDEO_ID_RE: /^[\w-]{11}$/). */
const LIVE_ID = "dQw4w9WgXcQ";
const GONE_ID = "9bZkp7q19f0";
const LIVE_TITLE = "العنوان الرسمي بالظبط زي ما هو مكتوب على اليوتيوب";

type Route = { status: number; json?: unknown } | "fail";

function makeFetchRouter(routes: Array<[needle: string, route: Route]>): typeof fetch {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    for (const [needle, route] of routes) {
      if (!url.includes(needle)) continue;
      if (route === "fail") throw new Error("network down");
      return new Response(route.json !== undefined ? JSON.stringify(route.json) : "no body", {
        status: route.status,
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** InnerTube payload listing three entries: one live, one gone, one placeholder. */
function innertubePayload(): unknown {
  return {
    contents: [{
      playlistVideoRenderer: { videoId: LIVE_ID, title: { runs: [{ text: "عنوان مقصوص من الـ HTML" }] } },
    }, {
      playlistVideoRenderer: { videoId: GONE_ID, title: { runs: [{ text: "شرح قديم اتحذف" }] } },
    }, {
      playlistVideoRenderer: { videoId: "jNQXAC9IVRw", title: { runs: [{ text: "فيديو خاص" }] } },
    }],
  };
}

describe("isUnavailableTitle — YouTube's placeholder names for dead entries", () => {
  it.each([
    ["[Private video]"],
    ["Private video"],
    ["[Deleted video]"],
    ["Deleted video"],
    ["Video unavailable"],
    ["فيديو خاص"],
    ["فيديو محذوف"],
    ["الفيديو غير متاح"],
    ["  PRIVATE   VIDEO  "],
  ])("flags %j as unavailable", (title) => {
    expect(isUnavailableTitle(title)).toBe(true);
  });

  it.each([
    ["شرح تسريبات الكهرباء — الحلقة 3"],
    ["ETAP full course intro"],
    [""],
  ])("keeps %j as a real candidate", (title) => {
    expect(isUnavailableTitle(title)).toBe(false);
  });
});

describe("fetchOembedVerdict — existence + authoritative title in one call", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("200 with a title → ok + the live YouTube title", async () => {
    vi.stubGlobal("fetch", makeFetchRouter([
      ["oembed", { status: 200, json: { title: LIVE_TITLE, author_name: "AhmedEtap" } }],
    ]));
    await expect(fetchOembedVerdict(LIVE_ID)).resolves.toEqual({ status: "ok", title: LIVE_TITLE });
  });

  it("404/401/400 → definitively gone (dropped, but check DID succeed)", async () => {
    vi.stubGlobal("fetch", makeFetchRouter([["oembed", { status: 404 }]]));
    await expect(fetchOembedVerdict(GONE_ID)).resolves.toEqual({ status: "gone" });
    vi.stubGlobal("fetch", makeFetchRouter([["oembed", { status: 401 }]]));
    await expect(fetchOembedVerdict(GONE_ID)).resolves.toEqual({ status: "gone" });
  });

  it("5xx / network failure → unknown (never fakes a verdict)", async () => {
    vi.stubGlobal("fetch", makeFetchRouter([["oembed", { status: 503 }]]));
    await expect(fetchOembedVerdict(LIVE_ID)).resolves.toEqual({ status: "unknown" });
    vi.stubGlobal("fetch", makeFetchRouter([["oembed", "fail"]]));
    await expect(fetchOembedVerdict(LIVE_ID)).resolves.toEqual({ status: "unknown" });
  });

  it("200 with an empty title → unknown, not ok", async () => {
    vi.stubGlobal("fetch", makeFetchRouter([["oembed", { status: 200, json: { title: "  " } }]]));
    await expect(fetchOembedVerdict(LIVE_ID)).resolves.toEqual({ status: "unknown" });
  });
});

describe("fetchPlaylistVideosForImport — the site playlist mirrors YouTube exactly", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps only videos that EXIST on YouTube, titled VERBATIM from oEmbed", async () => {
    vi.stubGlobal("fetch", makeFetchRouter([
      ["youtubei/v1/browse", { status: 200, json: innertubePayload() }],
      ["/playlist?", { status: 500 }],
      ["feeds/videos.xml", { status: 500 }],
      [`v%3D${GONE_ID}`, { status: 404 }],
      [`v%3D${LIVE_ID}`, { status: 200, json: { title: LIVE_TITLE } }],
    ]));

    const { items, verified } = await fetchPlaylistVideosForImport();

    // The placeholder ("فيديو خاص") is dropped before oEmbed, the deleted video
    // (404) is dropped by it — only the live video survives, with YouTube's
    // own title replacing the scraped one.
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      videoId: LIVE_ID,
      title: LIVE_TITLE,
      watchUrl: `https://www.youtube.com/watch?v=${LIVE_ID}&list=PLeeb5_Qjhcgc`,
      thumbnailUrl: expect.stringContaining(LIVE_ID),
    });
    expect(verified).toBe(true);
  });

  it("orders results by playlist order and keeps every live video", async () => {
    vi.stubGlobal("fetch", makeFetchRouter([
      ["youtubei/v1/browse", { status: 200, json: innertubePayload() }],
      ["/playlist?", { status: 500 }],
      ["feeds/videos.xml", { status: 500 }],
      [`v%3D${GONE_ID}`, { status: 404 }],
      [`v%3D${LIVE_ID}`, { status: 200, json: { title: LIVE_TITLE } }],
    ]));

    const { items } = await fetchPlaylistVideosForImport();
    expect(items.map((v) => v.videoId)).toEqual([LIVE_ID]);
  });

  it("oEmbed fully unreachable → degraded scraped list, honestly flagged unverified", async () => {
    vi.stubGlobal("fetch", makeFetchRouter([
      ["youtubei/v1/browse", { status: 200, json: innertubePayload() }],
      ["/playlist?", { status: 500 }],
      ["feeds/videos.xml", { status: 500 }],
      ["oembed", { status: 500 }],
    ]));

    const { items, verified } = await fetchPlaylistVideosForImport();

    // Placeholder still excluded; survivors pass through with scraped titles
    // and verified=false so the dialog says "not 100% confirmed".
    expect(items.map((v) => v.videoId)).toEqual([LIVE_ID, GONE_ID]);
    expect(items[0].title).toBe("عنوان مقصوص من الـ HTML");
    expect(verified).toBe(false);
  });

  it("all sources empty → empty list (never invents a video)", async () => {
    vi.stubGlobal("fetch", makeFetchRouter([
      ["youtubei/v1/browse", { status: 500 }],
      ["/playlist?", "fail"],
      ["feeds/videos.xml", "fail"],
    ]));
    await expect(fetchPlaylistVideosForImport()).resolves.toEqual({ items: [], verified: false });
  });
});
