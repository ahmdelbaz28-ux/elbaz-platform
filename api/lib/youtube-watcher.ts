import { logger } from "./logger.js";
import { pruneOldNotifications, pushNotification } from "./notification-broadcast.js";
import {
  extractFromRss,
  mergeVideoSources,
  parseInnertubeBrowse,
  parsePlaylistVideos,
  type ParsedVideo,
} from "./notification-utils.js";
import {
  fetchRelayOembedVerdict,
  fetchRelayPlaylist,
  type YoutubeOembedVerdict,
} from "./youtube-relay.js";

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
/**
 * InnerTube browse endpoint — the JSON API the YouTube site itself uses.
 * Served from the same host but a different code path than the HTML page:
 * when YouTube throttles datacenter IPs (429 / consent pages) the HTML source
 * goes dark while this one keeps answering. Verified live: 72 KB vs 915 KB.
 */
const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false";
/** One quick in-tick retry after a throttled/failed primary source. */
const SOURCE_RETRY_DELAY_MS = 5 * 1000;

/** Parallel oEmbed existence checks during admin import (bounded — be polite). */
const OEMBED_CONCURRENCY = 8;
/** YouTube search indexes new videos within ~15 min; polling faster is waste. */
const WATCH_INTERVAL_MS = 15 * 60 * 1000;
/** First tick delay — let the server finish booting and DB init settle. */
const FIRST_TICK_DELAY_MS = 45 * 1000;
/** HTTP timeout for YouTube fetches. */
const FETCH_TIMEOUT_MS = 20 * 1000;
/** Max notifications per tick (a burst of N uploads never spams more than this). */
const MAX_PER_TICK = 3;
/** How many known video ids to keep in the state row. */
// ✅ ROOT-CURE (2026-11-13): 100 ids meant a playlist beyond 100 videos was
// never remembered past position 100 — every tick re-announced the same
// "new episode" 3 times every 15 min forever. 500 covers every real course
// playlist; the state row stays a few KB.
const STATE_MAX_IDS = 500;

const STATE_SECTION = "youtubeWatch";
const STATE_KEY = "state";

interface WatcherState {
  knownIds: string[];
  updatedAt: string;
  /** Last tick that parsed at least one video (health signal, inspectable in DB). */
  lastSuccessAt?: string;
  /** Consecutive all-sources-failed ticks — a large silent number means YouTube is blocking us. */
  consecutiveFailures?: number;
  /** Bounded reason string for the most recent failed tick. */
  lastError?: string | null;
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

/** Persist ONLY the failure health fields, preserving the knownIds verbatim —
 *  a blind stretch (YouTube throttling) must never look like a reset playlist. */
async function writeFailureState(prev: WatcherState | null, reason: string): Promise<void> {
  if (!prev) return; // nothing to preserve yet — stay silent on cold start
  try {
    const { getDb } = await import("../queries/connection.js");
    const { siteSettings } = await import("@db/schema");
    const db = getDb();
    const state: WatcherState = {
      knownIds: prev.knownIds,
      updatedAt: new Date().toISOString(),
      lastSuccessAt: prev.lastSuccessAt,
      consecutiveFailures: (prev.consecutiveFailures ?? 0) + 1,
      lastError: reason.slice(0, 200),
    };
    await db
      .insert(siteSettings)
      .values({ section: STATE_SECTION, key: STATE_KEY, value: JSON.stringify(state), type: "json", sortOrder: 0 })
      .onDuplicateKeyUpdate({ set: { value: JSON.stringify(state), updatedAt: new Date() } });
  } catch {
    // best-effort — health bookkeeping must never throw
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

// ─── Source: InnerTube browse (primary) ────────────────────────────────────────

/** Fetch + parse the InnerTube browse response. Returns [] on any failure. */
async function fetchInnertubePlaylist(): Promise<ParsedVideo[]> {
  try {
    const res = await fetch(INNERTUBE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": BROWSER_UA,
        "Accept-Language": "ar,en;q=0.8",
      },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: "2.20241001.00.00", hl: "ar", gl: "EG" } },
        browseId: `VL${PLAYLIST_ID}`,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      logger.warn("[YouTubeWatch] innertube fetch failed", { status: res.status });
      return [];
    }
    return parseInnertubeBrowse(await res.json());
  } catch (err) {
    logger.warn("[YouTubeWatch] innertube fetch error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * One robust multi-source fetch. The Cloudflare Worker relay (/yt/*, clean
 * egress where the datacenter IP is throttled) runs concurrently with
 * InnerTube, then the desktop playlist HTML, then the Atom feed — all merged
 * by union so ANY healthy source carries the tick, and the first non-empty
 * title wins (the relay leads the order, so its titles win ties). A single
 * degraded source can no longer blind us; an unconfigured relay is a no-op.
 */
async function fetchAllSources(): Promise<ParsedVideo[]> {
  // Concurrent, not serial — the admin import dialog is user-facing and must
  // not eat an extra round-trip to Cloudflare.
  const [relay, innertube] = await Promise.all([
    fetchRelayPlaylist(PLAYLIST_ID),
    fetchInnertubePlaylist(),
  ]);

  const html = await fetchText(PLAYLIST_URL);
  const fromHtml = html ? parsePlaylistVideos(html) : [];

  const rss = await fetchText(PLAYLIST_RSS_URL);
  const fromRss = rss ? extractFromRss(rss) : [];

  const merged = mergeVideoSources(relay ?? [], innertube, fromHtml, fromRss);
  if (merged.length > 0) return merged;

  // Every source came back empty — most likely a transient throttle wave.
  // One calm retry of the two cheap sources before declaring the tick blind.
  logger.warn("[YouTubeWatch] all sources empty — retrying once after delay", {
    retryDelayMs: SOURCE_RETRY_DELAY_MS,
  });
  await new Promise((resolve) => setTimeout(resolve, SOURCE_RETRY_DELAY_MS));
  const innertubeRetry = await fetchInnertubePlaylist();
  const htmlRetry = await fetchText(PLAYLIST_URL);
  return mergeVideoSources(innertubeRetry, htmlRetry ? parsePlaylistVideos(htmlRetry) : []);
}

// ─── Playlist import (admin dialog) ──────────────────────────────

/**
 * Titles YouTube itself puts on playlist entries that no longer exist as
 * watchable videos (deleted, private). These entries still carry a videoId
 * in InnerTube/HTML responses, so without this filter the site could list
 * videos that do not actually play. Covers the EN + AR phrasings YouTube
 * serves us (hl=ar requests); bracket/case/whitespace-proof.
 */
const UNAVAILABLE_TITLES = new Set([
  "private video",
  "deleted video",
  "video unavailable",
  "فيديو خاص",
  "فيديو محذوف",
  "الفيديو غير متاح",
  "هذا الفيديو غير متاح",
]);

/** True when the scraped title is one of YouTube's placeholder names for an
 *  unavailable entry. Empty titles are NOT placeholders — oEmbed names them. */
export function isUnavailableTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase().replace(/[[\]()]/g, "").replace(/\s+/g, " ");
  return UNAVAILABLE_TITLES.has(normalized);
}

/** YouTube's official oEmbed endpoint — metadata, not the player page, so it
 *  keeps answering where the HTML scrape gets throttled. */
const OEMBED_URL = "https://www.youtube.com/oembed?format=json&hl=ar&url=";

type OembedVerdict = YoutubeOembedVerdict;

/**
 * Ask YouTube about ONE video. This is the existence check AND the
 * authoritative title in a single call:
 *  - 200  → the video actually exists right now, and `title` IS the live
 *           YouTube title (the site may never invent or paraphrase one).
 *  - 400/401/404 → definitively not usable (mistyped id / private / deleted).
 *  - anything else (5xx, 429, timeout) → unknown — we could not check.
 */
export async function fetchOembedVerdict(videoId: string): Promise<OembedVerdict> {
  // Worker relay first — its Cloudflare egress answers where the datacenter
  // IP is throttled. null (unconfigured / unknown / transport failure) falls
  // through to the direct call unchanged.
  const viaRelay = await fetchRelayOembedVerdict(videoId);
  if (viaRelay) return viaRelay;
  try {
    const res = await fetch(`${OEMBED_URL}${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, {
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "ar,en;q=0.8" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { title?: unknown };
      if (typeof data.title === "string" && data.title.trim()) {
        return { status: "ok", title: data.title };
      }
      return { status: "unknown" };
    }
    if (res.status === 400 || res.status === 401 || res.status === 404) return { status: "gone" };
    return { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}

/** Fixed-size promise pool that preserves input order. */
async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Detection ─────────────────────────────────────────────────────────────────

/** Build the watch URL for a video (opens inside the course playlist). */
function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}&list=${PLAYLIST_ID}`;
}

/** The playlist id the watcher follows (exposed for the admin import dialog). */
export function getPlaylistId(): string {
  return PLAYLIST_ID;
}

/** The channel home used as the subscribe CTA (exposed for the sync announcer). */
export function getChannelUrl(): string {
  return CHANNEL_URL;
}

export interface PlaylistImportItem {
  videoId: string;
  title: string;
  watchUrl: string;
  thumbnailUrl: string;
}

/**
 * Fetch the channel playlist for the ADMIN LESSON-IMPORT dialog.
 * Reuses the watcher's robust multi-source pipeline (InnerTube → HTML → RSS,
 * merged by union) so the dialog shows every video even when one source is
 * throttled. Read-only: it never touches watcher state or notifications.
 *
 * OWNER RULE — the site playlist must mirror YouTube exactly: only videos
 * that really exist there, only with their exact YouTube titles. Two hard
 * guarantees enforce it:
 *  1. Placeholder entries YouTube keeps for dead videos ("Private video" /
 *     "فيديو خاص" / …) are dropped before anything is shown.
 *  2. Every survivor is re-checked against YouTube's own oEmbed endpoint,
 *     which answers ONLY for videos that exist right now — and whose `title`
 *     field IS the live YouTube title, replacing any scraped one verbatim.
 *
 * `verified=false` means at least one candidate could not be checked
 * (throttling/network) — the honest flag the dialog surfaces; if oEmbed is
 * fully unreachable the scraped, placeholder-free list degrades through with
 * the flag set, never silently.
 */
export async function fetchPlaylistVideosForImport(): Promise<{ items: PlaylistImportItem[]; verified: boolean }> {
  const { buildYouTubeThumbnailUrl } = await import("../../src/lib/youtube-url");
  const candidates = (await fetchAllSources()).filter((v) => v.videoId && !isUnavailableTitle(v.title));
  if (candidates.length === 0) return { items: [], verified: false };

  const toImportItem = (videoId: string, title: string): PlaylistImportItem => ({
    videoId,
    title,
    watchUrl: watchUrl(videoId),
    thumbnailUrl: buildYouTubeThumbnailUrl(videoId),
  });

  const verdicts = await mapWithConcurrency(candidates, OEMBED_CONCURRENCY, (v) => fetchOembedVerdict(v.videoId));

  const kept: PlaylistImportItem[] = [];
  let gone = 0;
  let unknown = 0;
  candidates.forEach((v, i) => {
    const verdict = verdicts[i];
    if (verdict.status === "ok") kept.push(toImportItem(v.videoId, verdict.title));
    else if (verdict.status === "gone") gone++;
    else unknown++;
  });

  if (kept.length > 0) {
    logger.info("[YouTubeWatch] import list verified against YouTube", {
      candidates: candidates.length, kept: kept.length, droppedUnavailable: gone, unchecked: unknown,
    });
    return { items: kept, verified: unknown === 0 };
  }

  // oEmbed fully unreachable (datacenter throttle wave) — degrade to the
  // scraped list (still placeholder-free) and say so, never fake a check.
  logger.warn("[YouTubeWatch] oembed unreachable — serving scraped playlist unverified", {
    candidates: candidates.length,
  });
  return { items: candidates.filter((v) => v.title).map((v) => toImportItem(v.videoId, v.title)), verified: false };
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
export async function checkForNewEpisodes(): Promise<{ announced: ParsedVideo[]; blind: boolean }> {
  // Multi-source detection: InnerTube JSON + playlist HTML + Atom feed merged
  // by union (see fetchAllSources) — YouTube throttling one source no longer
  // blinds the watcher (production incident 2026-10-28).
  const videos = await fetchAllSources();

  if (videos.length === 0) {
    const prevState = await readState();
    await writeFailureState(prevState, "all sources empty (fetch throttled or layout change)");
    logger.warn("[YouTubeWatch] no videos parsed this tick — keeping previous state", {
      consecutiveFailures: (prevState?.consecutiveFailures ?? 0) + 1,
    });
    return { announced: [], blind: true };
  }

  const prevState = await readState();
  const nowIso = new Date().toISOString();

  // ── First run: silent initialization ──
  if (!prevState) {
    await writeState({
      knownIds: videos.slice(0, STATE_MAX_IDS).map((v) => v.videoId),
      updatedAt: nowIso,
      lastSuccessAt: nowIso,
      consecutiveFailures: 0,
      lastError: null,
    });
    logger.info("[YouTubeWatch] first run — state initialized silently", { known: Math.min(videos.length, STATE_MAX_IDS) });
    return { announced: [], blind: false };
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

  // ── Persist the merged known set (bounded) + success health ──
  const merged = [...videos.map((v) => v.videoId), ...prevState.knownIds];
  await writeState({
    knownIds: Array.from(new Set(merged)).slice(0, STATE_MAX_IDS),
    updatedAt: nowIso,
    lastSuccessAt: nowIso,
    consecutiveFailures: 0,
    lastError: null,
  });

  return { announced, blind: false };
}

// ─── Scheduler ─────────────────────────────────────────────────────────────────

let started = false;

// ── ✅ EGRESS CIRCUIT BREAKER (root-cure of the doomed-fetch treadmill) ──
// The HF Space's shared egress is fully blocked for www.youtube.com AND the
// Cloudflare relay (production logs 2026-11-12: every InnerTube / HTML / RSS
// / relay attempt died with "fetch failed", 667+ consecutive failures).
// The deterministic mirror is the INGEST feed (GitHub Actions cron + worker
// cron → /api/yt-sync/ingest), which reaches YouTube from clean networks and
// pushes the playlist TO us every 15 min. Polling from here can therefore
// only burn ~12 doomed requests per tick — after two consecutive fully-blind
// ticks this breaker parks direct polling for 30 min (in-memory; a restart
// merely re-probes once). The admin import dialog is NOT gated — it is an
// explicit on-demand action.
const BLIND_TICKS_BEFORE_BACKOFF = 2;
const BACKOFF_MS = 30 * 60_000;
let blindTicks = 0;
let backoffUntil = 0;

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
      if (Date.now() < backoffUntil) {
        // Egress parked — skip the doomed fetches, keep the maintenance jobs.
        if (ticks % 8 === 0) await pruneOldNotifications();
        return;
      }

      let tickBlind = false;
      try {
        const result = await checkForNewEpisodes();
        tickBlind = result.blind;
      } catch (err) {
        tickBlind = true;
        logger.warn("[YouTubeWatch] tick failed", { error: err instanceof Error ? err.message : String(err) });
      }

      // 🔄 AUTO-SYNC: the course mirrors the playlist — a video uploaded to
      // YouTube becomes a published lesson on the site within one tick (15
      // min), under its exact oEmbed-verified title, and the course cover
      // follows the first video. Policy-gated (autoImport setting),
      // never-throw: a failed sync never breaks the notification watcher.
      try {
        // Dynamic import: playlist-sync imports fetchPlaylistVideosForImport
        // from THIS module — a static cycle here would be fragile under ESM.
        const { runAutoPlaylistSync } = await import("./playlist-sync.js");
        const sync = await runAutoPlaylistSync();
        if (sync && (sync.added || sync.updated || sync.removed || sync.coverUpdated)) {
          logger.info("[YouTubeWatch] course playlist auto-synced", {
            added: sync.added,
            updated: sync.updated,
            removed: sync.removed,
            coverUpdated: sync.coverUpdated,
          });
        }
        // A blind notification tick AND a zero-video sync round = the whole
        // egress is dark this tick.
        const syncBlind = !!sync && !sync.ok && sync.videosFound === 0;
        if (tickBlind && (sync === null || syncBlind)) {
          blindTicks += 1;
        } else if (!tickBlind) {
          blindTicks = 0;
        }
      } catch (syncErr) {
        logger.warn("[YouTubeWatch] playlist auto-sync failed", {
          error: syncErr instanceof Error ? syncErr.message : String(syncErr),
        });
      }

      if (blindTicks >= BLIND_TICKS_BEFORE_BACKOFF) {
        backoffUntil = Date.now() + BACKOFF_MS;
        blindTicks = 0;
        logger.warn("[YouTubeWatch] egress circuit breaker OPEN — direct YouTube polling parked for 30 min", {
          reason: "consecutive fully-blind ticks (all sources unreachable)",
          note: "the ingest feeders (GitHub Actions + worker cron) remain the deterministic mirror path",
        });
      }

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
