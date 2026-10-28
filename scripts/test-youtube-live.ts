/**
 * LIVE smoke test — YouTube episode detection against the REAL playlist.
 * Pure fetch + parse (no DB, no env needed). Run: npx tsx scripts/test-youtube-live.ts
 */
import { parsePlaylistVideos, extractFromRss } from "../api/lib/notification-utils.js";

const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID || "PLeeb5_Qjhcgc";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function main() {
  // 1) Playlist page (primary source — works with unlisted videos)
  const pageRes = await fetch(`https://www.youtube.com/playlist?list=${PLAYLIST_ID}&hl=ar`, {
    headers: { "User-Agent": UA, "Accept-Language": "ar,en;q=0.8" },
    signal: AbortSignal.timeout(20000),
  });
  console.log("playlist page status:", pageRes.status);
  const html = await pageRes.text();
  console.log("playlist page bytes:", html.length);

  const fromPage = parsePlaylistVideos(html);
  console.log("parsed from page:", JSON.stringify(fromPage, null, 2));

  // 2) RSS fallback (expected empty for unlisted uploads — prove graceful)
  const rssRes = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST_ID}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(20000),
  });
  const xml = await rssRes.status === 200 ? await rssRes.text() : "";
  const fromRss = xml ? extractFromRss(xml) : [];
  console.log("rss status:", rssRes.status, "| entries:", fromRss.length);

  // 3) Title enrichment merge (same as watcher logic)
  const titleById = new Map(fromRss.map((v) => [v.videoId, v.title]));
  const merged = fromPage.map((v) => ({ ...v, title: v.title || titleById.get(v.videoId) || "" }));
  console.log("final merged list:", JSON.stringify(merged, null, 2));

  if (merged.length === 0) {
    console.error("FAIL: no videos detected");
    process.exit(1);
  }
  console.log("PASS: watcher would see", merged.length, "video(s) — new ones (not in state) get broadcast");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
