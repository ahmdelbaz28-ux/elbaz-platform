/**
 * LIVE smoke test — YouTube episode detection against the REAL playlist.
 * Pure fetch + parse (no DB, no env needed). Run: npx tsx scripts/test-youtube-live.ts
 *
 * Exercises ALL watcher sources the way production now does:
 *   1. InnerTube browse JSON (primary)
 *   2. Playlist page HTML
 *   3. Atom RSS fallback
 * then merges them exactly like the watcher.
 */
import {
  parsePlaylistVideos,
  parseInnertubeBrowse,
  mergeVideoSources,
  extractFromRss,
} from "../api/lib/notification-utils.js";

const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID || "PLeeb5_Qjhcgc";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "ar,en;q=0.8" },
      signal: AbortSignal.timeout(20000),
      ...init,
    });
    if (!res.ok) {
      console.log(`  fetch ${url.split("?")[0]} -> ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.log(`  fetch ${url.split("?")[0]} error:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function main() {
  // 1) InnerTube browse (primary source)
  const itRaw = await fetchText("https://www.youtube.com/youtubei/v1/browse?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, "Accept-Language": "ar,en;q=0.8" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20241001.00.00", hl: "ar", gl: "EG" } },
      browseId: `VL${PLAYLIST_ID}`,
    }),
  });
  let fromInnertube: ReturnType<typeof parseInnertubeBrowse> = [];
  if (itRaw) {
    try {
      fromInnertube = parseInnertubeBrowse(JSON.parse(itRaw));
      console.log("innertube: bytes =", itRaw.length, "| videos =", fromInnertube.length);
    } catch (e) {
      console.log("innertube: JSON parse failed", e);
    }
  }

  // 2) Playlist page (secondary source — works with unlisted videos when not throttled)
  const pageRaw = await fetchText(`https://www.youtube.com/playlist?list=${PLAYLIST_ID}&hl=ar`);
  const fromPage = pageRaw ? parsePlaylistVideos(pageRaw) : [];
  console.log("playlist page:", pageRaw ? `bytes = ${pageRaw.length}` : "fetch failed", "| videos =", fromPage.length);

  // 3) RSS fallback (expected empty for unlisted uploads — prove graceful)
  const rssRaw = await fetchText(`https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST_ID}`);
  const fromRss = rssRaw ? extractFromRss(rssRaw) : [];
  console.log("rss entries:", fromRss.length);

  // 4) Merge exactly like the watcher
  const merged = mergeVideoSources(fromInnertube, fromPage, fromRss);
  console.log("\nfinal merged list:", JSON.stringify(merged, null, 2));

  if (merged.length === 0) {
    console.error("FAIL: no videos detected from ANY source — watcher would be blind");
    process.exit(1);
  }
  console.log("PASS: watcher would see", merged.length, "video(s) — new ones (not in state) get broadcast");
}

try {
  await main();
} catch (e) {
  console.error("FAIL:", e);
  process.exit(1);
}
