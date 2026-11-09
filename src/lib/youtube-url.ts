/**
 * YouTube URL — pure parsing & builders, shared by SERVER and CLIENT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The platform plays lesson videos from the channel's YouTube playlist inside
 * its own player screen (no video files hosted on our server). This module is
 * the single source of truth for "is this value a YouTube video reference and
 * which video" — used by:
 *   - api/lib/video-protection.ts  (server: branch R2 presign vs YouTube pass-through)
 *   - src/pages/Admin.tsx          (client: live hint + playlist import)
 *   - src/components/YouTubeLessonPlayer.tsx (client: embed playback)
 *
 * Kept dependency-free (no Node APIs, no DOM) so tsx/Vite/vitest can all load it.
 */

/** YouTube video IDs are exactly 11 chars of [A-Za-z0-9_-]. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Hosts that can carry a video id in their path or query. */
const YT_HOST_RE = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

/**
 * Extract an 11-char YouTube video id from ANY common shape:
 *   https://www.youtube.com/watch?v=ID          (watch page)
 *   https://youtu.be/ID                         (share shortlink)
 *   https://www.youtube.com/shorts/ID           (Shorts)
 *   https://www.youtube.com/embed/ID            (embed path)
 *   https://www.youtube.com/live/ID             (live premiere replay)
 *   https://www.youtube.com/v/ID                (legacy /v/ player)
 *   https://www.youtube.com/oembed?url=...      (oEmbed endpoint)
 *   bare "dQw4w9WgXcQ"                          (raw id, as admins paste it)
 * Returns null for playlist-only links, R2 keys, and anything else.
 */
export function extractYouTubeId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  // Bare id (what an admin pastes after copying the ?v= value).
  if (VIDEO_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    // youtu.be links may be pasted without a scheme.
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  if (!YT_HOST_RE.test(url.hostname)) return null;

  // Query forms first: watch?v=, /embed?v=, oembed?url=<encoded watch link>.
  const v = url.searchParams.get("v");
  if (v && VIDEO_ID_RE.test(v)) return v;
  const oembedTarget = url.searchParams.get("url");
  if (oembedTarget && extractYouTubeId(oembedTarget)) {
    return extractYouTubeId(oembedTarget);
  }

  // Path forms: /shorts/ID, /embed/ID, /live/ID, /v/ID, youtu.be/ID.
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  if (url.hostname === "youtu.be") {
    const id = parts[0] ?? "";
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  const pathPrefixes = ["shorts", "embed", "live", "v"];
  const [head, tail] = parts;
  if (head && tail && pathPrefixes.includes(head) && VIDEO_ID_RE.test(tail)) {
    return tail;
  }

  // /watch/ID (rare legacy form) — pathname /watch/ID
  if (head === "watch" && tail && VIDEO_ID_RE.test(tail)) return tail;

  return null;
}

/** True when the value resolves to a playable YouTube video (not an R2 key). */
export function isYouTubeVideoRef(value: string | null | undefined): boolean {
  return extractYouTubeId(value) !== null;
}

/**
 * Build the privacy-enhanced embed URL for a video. `origin` is REQUIRED so
 * the widget API can scope its postMessage channel to our site (YouTube
 * rejects enablejsapi frames without a matching origin).
 * Params: rel=0 (same-channel suggestions only), playsinline (iOS), modest
 * branding, captions default on, no cookie tracking unless the user plays.
 */
export function buildYouTubeEmbedUrl(videoId: string, origin: string): string {
  if (!VIDEO_ID_RE.test(videoId)) {
    throw new Error(`Invalid YouTube video id: ${JSON.stringify(videoId)}`);
  }
  const params = new URLSearchParams({
    enablejsapi: "1",
    origin,
    rel: "0",
    playsinline: "1",
    modestbranding: "1",
    cc_load_policy: "1",
    hl: "ar",
  });
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

/** Human-facing watch URL (used by the admin import dialog to store a link). */
export function buildYouTubeWatchUrl(videoId: string, playlistId?: string): string {
  const params = new URLSearchParams({ v: videoId });
  if (playlistId) params.set("list", playlistId);
  return `https://www.youtube.com/watch?${params.toString()}`;
}

/** Thumbnail URL (no API key needed — public i.ytimg.com path).
 *  "maxres" (1280×720) is the crisp YouTube poster — used for the course
 *  cover so it reads as a real video frame; clients step down to hq/mq on
 *  404 via the fallback chain. */
export function buildYouTubeThumbnailUrl(videoId: string, quality: "maxres" | "mq" | "hq" = "mq"): string {
  if (!VIDEO_ID_RE.test(videoId)) {
    throw new Error(`Invalid YouTube video id: ${JSON.stringify(videoId)}`);
  }
  if (quality === "maxres") return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  return `https://i.ytimg.com/vi/${videoId}/${quality}default.jpg`;
}

/** Pull the playlist id out of a playlist URL (or accept a bare PL…/VL… id).
 *  Used to show the admin exactly which playlist the sync engine mirrors. */
export function extractPlaylistId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const m = /[?&]list=([\w-]+)/.exec(raw);
  if (m) return m[1];
  if (/^(PL|VL|UU|FL|LL|OL)[\w-]+$/.test(raw)) return raw;
  return null;
}

/** One step down the YouTube poster-quality chain (maxres→hq→mq→null).
 *  Lets <img> onError handlers retry a cheaper poster before giving up. */
export function youTubeThumbnailFallback(src: string | null | undefined): string | null {
  if (!src) return null;
  if (src.includes("maxresdefault.jpg")) return src.replace("maxresdefault.jpg", "hqdefault.jpg");
  if (src.includes("hqdefault.jpg")) return src.replace("hqdefault.jpg", "mqdefault.jpg");
  return null;
}
