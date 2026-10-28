import { logger } from "./logger.js";
import { pruneOldNotifications, pushNotification } from "./notification-broadcast.js";
import { extractFromRss, parsePlaylistVideos, type ParsedVideo } from "./notification-utils.js";

// ─── Configuration ─────────────────────────────────────────────────────────────

/**
 * The creator's YouTube presence, hardcoded to the verified values and
 * overridable via env for future channel moves:
 *  - YOUTUBE_PLAYLIST_ID — the "كورس ETAP" playlist (the link the owner shares)
 *  - YOUTUBE_CHANNEL_URL — the channel home, used as the subscribe CTA
 */
const PLAYLIST_ID = process.env.YOUTUBE_PLAYLIST_ID || "PLeeb5_Qjhcgc";
const CHANNEL_URL =
  process.env.YOUTUBE_CHANNEL_URL || "https://www.youtube.com/channel/UClZy6YZ-dSKdOH6ThPOEn_g";

const PLAYLIST_URL = `https://www.youtube.com/playlist?list=${PLAYLIST_ID}&hl=ar`;
const PLAYLIST_RSS_URL = `https://www.youtube.com/feeds/videos.xml?playlist_id=${PLAYLIST_ID}`;

/** YouTube search indexes new videos within ~15 min; polling faster is waste. */
const WATCH_INTERVAL_MS = 15 * 60 * 1000;
/** First tick delay — let the server finish booting and DB init settle. */
const FIRST_TICK_DELAY_MS = 45 * 1000;
/** HTTP timeout for YouTube fetches. */
const FETCH_TIMEOUT_MS = 20 * 1000;
/** Max notifications per tick (a burst of N uploads never spams more than this). */
const MAX_PER_TICK = 3;
/** How many known video ids to keep in the state row. */
const STATE_MAX_IDS = 100;

const STATE_SECTION = "youtubeWatch";
const STATE_KEY = "state";

interface WatcherState {
  knownIds: string[];
  updatedAt: string;
}

// ─── Fetching ──────────────────────────────────────────────────────────────────

/** Browser-like UA — YouTube serves the full initial data to it. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "ar,en;q=0.8",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      logger.warn("[YouTubeWatch] fetch failed", { url: url.split("?")[0], status: res.status });
      return null;
    }
    return await res.text();
  } catch (err) {
    logger.warn("[YouTubeWatch] fetch error", {
      url: url.split("?")[0],
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── State persistence (siteSettings key/value — survives restarts) ───────────

async function readState(): Promise<WatcherState | null> {
  try {
    const { getDb } = await import("../queries/connection.js");
    const { siteSettings } = await import("@db/schema");
    const { and, eq } = await import("drizzle-orm");
    const db = getDb();
    const [row] = await db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(and(eq(siteSettings.section, STATE_SECTION), eq(siteSettings.key, STATE_KEY)))
      .limit(1);
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as WatcherState;
    if (!Array.isArray(parsed.knownIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeState(state: WatcherState): Promise<void> {
  try {
    const { getDb } = await import("../queries/connection.js");
    const { siteSettings } = await import("@db/schema");
    const db = getDb();
    const value = JSON.stringify(state);
    await db
      .insert(siteSettings)
      .values({ section: STATE_SECTION, key: STATE_KEY, value, type: "json", sortOrder: 0 })
      .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
  } catch (err) {
    logger.warn("[YouTubeWatch] writeState failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

// ─── Detection ─────────────────────────────────────────────────────────────────

/** Build the watch URL for a video (opens inside the course playlist). */
function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}&list=${PLAYLIST_ID}`;
}

/**
 * One detection pass. Returns the episodes that were announced this tick.
 *
 * Semantics:
 *  - First run (no stored state): silently record what exists today — the
 *    watcher never floods users with the entire back-catalog on deploy day.
 *  - Subsequent runs: any videoId that appears in the feed but is not in the
 *    known set is a NEW episode → broadcast one notification per video
 *    (capped at MAX_PER_TICK) with the user-centered subscribe nudge.
 */
export async function checkForNewEpisodes(): Promise<{ announced: ParsedVideo[] }> {
  // Primary source: playlist page HTML (works with UNLISTED videos — the RSS
  // feed of this playlist is verified empty because its videos are unlisted).
  const html = await fetchText(PLAYLIST_URL);
  let videos: ParsedVideo[] = html ? parsePlaylistVideos(html) : [];

  // Fallback / merge: the Atom feed (preferred titles when videos are public).
  if (videos.length === 0) {
    const rss = await fetchText(PLAYLIST_RSS_URL);
    if (rss) videos = extractFromRss(rss);
  } else {
    const rss = await fetchText(PLAYLIST_RSS_URL);
    if (rss) {
      const rssVideos = extractFromRss(rss);
      const titleById = new Map(rssVideos.map((v) => [v.videoId, v.title]));
      videos = videos.map((v) => ({ ...v, title: v.title || titleById.get(v.videoId) || "" }));
    }
  }

  if (videos.length === 0) {
    logger.warn("[YouTubeWatch] no videos parsed this tick — keeping previous state");
    return { announced: [] };
  }

  const prevState = await readState();
  const nowIso = new Date().toISOString();

  // ── First run: silent initialization ──
  if (!prevState) {
    await writeState({
      knownIds: videos.slice(0, STATE_MAX_IDS).map((v) => v.videoId),
      updatedAt: nowIso,
    });
    logger.info("[YouTubeWatch] first run — state initialized silently", { known: Math.min(videos.length, STATE_MAX_IDS) });
    return { announced: [] };
  }

  // ── Diff against the known set ──
  const known = new Set(prevState.knownIds);
  const fresh = videos.filter((v) => !known.has(v.videoId)).slice(0, MAX_PER_TICK);

  const announced: ParsedVideo[] = [];
  if (fresh.length > 0) {
    // pushNotification never throws (best-effort, returns null on failure), so
    // the capped set of new-episode notifications can be persisted in parallel.
    const results = await Promise.allSettled(fresh.map((video) => pushNotification({
      type: "youtube",
      title: "🎬 حلقة جديدة على قناة اليوتيوب",
      message:
        `«${video.title || "حلقة جديدة"}» نزلت الآن على قناة AhmedEtap — كورس ETAP كامل بالعربي. ` +
        `شوفها الأول وخليك دايمًا متقدم: فعّل الجرس 🔔 على القناة عشان يوصلك كل شرح جديد أول بأول وانت في الأولين.`,
      url: watchUrl(video.videoId),
      channelUrl: CHANNEL_URL,
      data: { videoId: video.videoId, playlistId: PLAYLIST_ID },
    })));
    results.forEach((r, idx) => {
      if (r.status === "fulfilled" && r.value) {
        announced.push(fresh[idx]);
        logger.info("[YouTubeWatch] new episode announced", { videoId: fresh[idx].videoId, title: fresh[idx].title });
      }
    });
  }

  // ── Persist the merged known set (bounded) ──
  const merged = [...videos.map((v) => v.videoId), ...prevState.knownIds];
  await writeState({
    knownIds: Array.from(new Set(merged)).slice(0, STATE_MAX_IDS),
    updatedAt: nowIso,
  });

  return { announced };
}

// ─── Scheduler ─────────────────────────────────────────────────────────────────

let started = false;

/**
 * Start the background watcher. Fire-and-forget safe: every tick is wrapped,
 * a failed tick never kills the interval, and the timer is unref'd so it
 * never keeps the process alive during shutdown.
 *
 * Every ~8th tick also prunes notifications older than 30 days.
 */
export function startYoutubeWatcher(): void {
  if (started) return;
  if (process.env.YOUTUBE_WATCHER === "off") {
    logger.info("[YouTubeWatch] disabled via YOUTUBE_WATCHER=off");
    return;
  }
  started = true;

  let ticks = 0;
  const tick = async () => {
    ticks++;
    try {
      await checkForNewEpisodes();
      if (ticks % 8 === 0) await pruneOldNotifications();
    } catch (err) {
      logger.warn("[YouTubeWatch] tick failed", { error: err instanceof Error ? err.message : String(err) });
    }
  };

  const timer = setTimeout(() => {
    void tick();
    const interval = setInterval(() => void tick(), WATCH_INTERVAL_MS);
    interval.unref?.();
  }, FIRST_TICK_DELAY_MS);
  timer.unref?.();

  logger.info("[YouTubeWatch] started", { intervalMin: WATCH_INTERVAL_MS / 60000, playlist: PLAYLIST_ID });
}
