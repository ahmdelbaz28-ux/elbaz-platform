/**
 * YouTube URL helpers — client side, pure functions.
 *
 * Mirrors `api/lib/youtube-url.ts` (the two package roots have disjoint
 * tsconfig paths — logic identical, both unit-tested).
 */

const VIDEO_ID_RE = /^[\w-]{11}$/;

const ID_PATTERNS: RegExp[] = [
  /^[A-Za-z0-9_-]{11}$/, // bare id
  /[?&]v=([A-Za-z0-9_-]{11})/, // youtube.com/watch?v=ID
  /youtu\.be\/([A-Za-z0-9_-]{11})/, // youtu.be/ID
  /\/embed\/([A-Za-z0-9_-]{11})/, // youtube.com/embed/ID (incl. nocookie)
  /\/shorts\/([A-Za-z0-9_-]{11})/, // youtube.com/shorts/ID
  /\/live\/([A-Za-z0-9_-]{11})/, // youtube.com/live/ID
];

/** Extract the 11-char video id from any YouTube URL shape (or a bare id). */
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

/** Poster thumbnail for cards/lists — maxres is crisp, hq always exists. */
export function buildYouTubeThumbnailUrl(videoId: string, quality: "maxres" | "hq" | "mq" = "mq"): string {
  const file = quality === "maxres" ? "maxresdefault" : quality === "hq" ? "hqdefault" : "mqdefault";
  return `https://i.ytimg.com/vi/${videoId}/${file}.jpg`;
}

/** Small chain used by <img> onError: maxres → hq → give up. */
export function youTubeThumbnailFallback(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.includes("maxresdefault.jpg")) return src.replace("maxresdefault.jpg", "hqdefault.jpg");
  if (src.includes("hqdefault.jpg")) return src.replace("hqdefault.jpg", "mqdefault.jpg");
  return null;
}
