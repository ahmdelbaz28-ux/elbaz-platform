/**
 * YouTube URL helpers — server side, pure functions.
 *
 * Single source of truth for turning any YouTube link shape into the data the
 * platform needs: the 11-char video id, the nocookie embed URL (CSP-friendly,
 * privacy-enhanced mode) and the canonical watch URL stored in `lessons.videoUrl`.
 *
 * Mirrors `src/lib/youtube-url.ts` on the client (kept separate because the two
 * package roots have disjoint tsconfig paths — the logic is identical and both
 * sides are unit-tested).
 */

const VIDEO_ID_RE = /^[\w-]{11}$/;

/** All shapes a YouTube link can take on the platform (admin paste, RSS, playlist import). */
const ID_PATTERNS: RegExp[] = [
  /^[A-Za-z0-9_-]{11}$/, // bare id
  /[?&]v=([A-Za-z0-9_-]{11})/, // youtube.com/watch?v=ID
  /youtu\.be\/([A-Za-z0-9_-]{11})/, // youtu.be/ID
  /\/embed\/([A-Za-z0-9_-]{11})/, // youtube.com/embed/ID (incl. nocookie)
  /\/shorts\/([A-Za-z0-9_-]{11})/, // youtube.com/shorts/ID
  /\/live\/([A-Za-z0-9_-]{11})/, // youtube.com/live/ID
];

/** Extract the 11-char video id from any YouTube URL shape (or a bare id). Returns null otherwise. */
export function extractYouTubeId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  for (const re of ID_PATTERNS) {
    const m = re.exec(value);
    if (m) return m[1] ?? (re.source.startsWith("^") ? value : null);
  }
  return null;
}

/** Is this lesson videoUrl a YouTube video (vs an R2 key / direct file / HLS)? */
export function isYouTubeVideoUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  if (VIDEO_ID_RE.test(v)) return true;
  return v.includes("youtube.com") || v.includes("youtu.be") || v.includes("youtube-nocookie.com");
}

/**
 * The canonical URL stored in the DB for an imported video.
 * Stable (never changes shape), CSP-safe, and re-extractable by extractYouTubeId.
 */
export function buildYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Privacy-enhanced embed URL used inside the site player.
 * - nocookie domain: no tracking cookies until the user hits play
 * - rel=0: related videos restricted to the same channel (credibility)
 * - playsinline: no fullscreen hijack on mobile
 * - hl=ar: Arabic player UI
 * - enablejsapi: playback tracking (heartbeat/markWatched) via postMessage
 */
export function buildYouTubeEmbedUrl(videoId: string, origin?: string | null): string {
  const params = new URLSearchParams({
    rel: "0",
    playsinline: "1",
    hl: "ar",
    enablejsapi: "1",
  });
  if (origin) params.set("origin", origin);
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

/**
 * Course-cover thumbnail URL. `maxresdefault` (1280×720) is the crisp YouTube
 * poster; clients fall back to `hqdefault` on 404 via onError.
 */
export function buildYouTubeThumbnailUrl(videoId: string, quality: "maxres" | "hq" | "mq" = "maxres"): string {
  const file = quality === "maxres" ? "maxresdefault" : quality === "hq" ? "hqdefault" : "mqdefault";
  return `https://i.ytimg.com/vi/${videoId}/${file}.jpg`;
}

/** Pull the playlist id out of a playlist URL (or accept a bare PL…/VL… id). */
export function extractPlaylistId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  const m = /[?&]list=([\w-]+)/.exec(value);
  if (m) return m[1];
  if (/^(PL|VL|UU|FL|LL|OL)[\w-]+$/.test(value)) return value;
  return null;
}
