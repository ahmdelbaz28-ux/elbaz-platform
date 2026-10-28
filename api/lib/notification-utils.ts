import { randomBytes } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// notification-utils — PURE helpers for the notification domain.
// Zero side effects, zero I/O, no env/DB imports: safe to use from tests and
// from any runtime (server, watcher, edge).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sortable unique event id: `{timestamp-millis}-{rand}`.
 * Lexicographic order == chronological order, so clients can cursor-poll
 * with a plain string comparison (same format as the legacy cache events).
 */
export function makeEventId(): string {
  return `${Date.now()}-${randomBytes(4).toString("hex")}`;
}

/** Broadcasts/targeted rows are filtered against this cursor client-side. */
export function isAfterCursor(eventId: string, cursor?: string): boolean {
  if (!cursor) return true;
  return eventId > cursor;
}

/**
 * Decode the escaped JSON string literals YouTube embeds in its HTML
 * (e.g. `\\u0026` → `&`) without ever eval-ing attacker-controlled input.
 */
export function decodeJsonStringLiteral(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    // Best-effort manual unescape for the escapes YouTube actually emits.
    return raw
      .replaceAll(String.raw`\u0026`, "&")
      .replaceAll(String.raw`\"`, '"')
      .replaceAll(String.raw`\\`, "\\");
  }
}

export interface ParsedVideo {
  videoId: string;
  title: string;
}

/** Shared "add once" collector — dedupes by videoId across all layouts. */
function collect(out: ParsedVideo[], seen: Set<string>, videoId: string | undefined, title: string): void {
  if (!videoId || seen.has(videoId)) return;
  seen.add(videoId);
  out.push({ videoId, title });
}

/** Layout A (legacy): each playlist item is a `playlistVideoRenderer` object
 *  that starts with its videoId followed shortly by the localized title runs. */
function collectRendererLayout(html: string, out: ParsedVideo[], seen: Set<string>): void {
  const blocks = html.split('"playlistVideoRenderer"');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].slice(0, 4000);
    const idMatch = /"videoId":"([\w-]{11})"/.exec(block);
    if (!idMatch) continue;
    const titleMatch = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(block);
    collect(out, seen, idMatch[1], titleMatch ? decodeJsonStringLiteral(titleMatch[1]) : "");
  }
}

/** Layout B (2025+ "lockupViewModel"): the playlist items are lockup objects;
 *  the videoId lives in the thumbnail URL (`/vi/{id}/`) and the title in
 *  `lockupMetadataViewModel.title.content`. */
function collectLockupLayout(html: string, out: ParsedVideo[], seen: Set<string>): void {
  const lockups = html.split('{"lockupViewModel"');
  for (let i = 1; i < lockups.length; i++) {
    const block = lockups[i].slice(0, 10000);
    if (!block.includes("contentImage")) continue;
    const idMatch = /\/vi\/([\w-]{11})\//.exec(block);
    if (!idMatch) continue;
    const titleMatch =
      /"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(block) ??
      /"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(block);
    collect(out, seen, idMatch[1], titleMatch ? decodeJsonStringLiteral(titleMatch[1]) : "");
  }
}

/** Fallback: loose scan for bare videoIds (layout variations / consent pages). */
function collectLooseIds(html: string, out: ParsedVideo[], seen: Set<string>): void {
  const looseIds = html.match(/"videoId":"([\w-]{11})"/g) ?? [];
  for (const raw of looseIds) {
    collect(out, seen, /"videoId":"([\w-]{11})"/.exec(raw)?.[1], "");
  }
}

/**
 * Extract (videoId, title) pairs from a YouTube playlist page HTML.
 *
 * WHY scraping and not the RSS feed? This channel keeps its uploads UNLISTED
 * (verified live: `feeds/videos.xml?playlist_id=...` returns metadata only,
 * zero <entry> elements) — the playlist page HTML still lists every video.
 *
 * Pure function — unit-tested in notification-utils.test.ts.
 */
export function parsePlaylistVideos(html: string): ParsedVideo[] {
  const out: ParsedVideo[] = [];
  const seen = new Set<string>();

  collectRendererLayout(html, out, seen);
  if (out.length > 0) return out;

  collectLockupLayout(html, out, seen);
  if (out.length > 0) return out;

  collectLooseIds(html, out, seen);
  return out;
}

// ─── InnerTube (youtubei JSON API) ─────────────────────────────────────────────

const VIDEO_ID_RE = /^[\w-]{11}$/;

/** Pull the Arabic-first title out of a lockup/playlist renderer node. */
function titleFromNode(node: Record<string, unknown>): string {
  const title = node["title"];
  if (typeof title === "string") return title;
  if (title && typeof title === "object") {
    const t = title as Record<string, unknown>;
    if (typeof t["content"] === "string") return t["content"];
    if (Array.isArray(t["runs"])) {
      return (t["runs"] as unknown[])
        .map((run) => (run && typeof run === "object" ? String((run as Record<string, unknown>)["text"] ?? "") : ""))
        .join("");
    }
  }
  // lockupViewModel nests the title one level deeper
  const metadata = node["metadata"];
  if (metadata && typeof metadata === "object") {
    const lockupMeta = (metadata as Record<string, unknown>)["lockupMetadataViewModel"];
    if (lockupMeta && typeof lockupMeta === "object") {
      return titleFromNode(lockupMeta as Record<string, unknown>);
    }
  }
  return "";
}

function pushVideo(out: ParsedVideo[], seen: Set<string>, videoId: unknown, title: string): void {
  if (typeof videoId !== "string" || !VIDEO_ID_RE.test(videoId) || seen.has(videoId)) return;
  seen.add(videoId);
  out.push({ videoId, title });
}

/**
 * Extract (videoId, title) pairs from a YouTube InnerTube browse response
 * (`POST /youtubei/v1/browse` with `browseId: "VL" + playlistId`).
 *
 * WHY a second source at all? YouTube throttles datacenter IPs with 429s and
 * consent pages — the watcher went blind for hours when the playlist HTML was
 * the only source (production incident 2026-10-28: 11 consecutive ticks
 * failed silently, a newly published episode was never announced). The
 * InnerTube JSON endpoint is served from the same host but is a different
 * code path that keeps working when the HTML page is degraded, and it is
 * ~12x smaller than the HTML page.
 *
 * Recognized entry shapes (layered fallback mirrors parsePlaylistVideos):
 *   1. lockupViewModel (2025+): `contentId` + nested metadata title.
 *   2. playlistVideoRenderer (legacy): `videoId` + `title.runs[]`.
 *   3. Loose scan of bare `videoId` fields (future layout variations).
 *
 * Pure function — unit-tested in notification-utils.test.ts.
 */
export function parseInnertubeBrowse(payload: unknown): ParsedVideo[] {
  if (!payload || typeof payload !== "object") return [];
  const out: ParsedVideo[] = [];
  const seen = new Set<string>();

  // Layered walk — one pass collects recognized renderers; bare videoIds are
  // only used when neither renderer shape matched (same contract as the HTML parser).
  const loose: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    const lockup = obj["lockupViewModel"];
    if (lockup && typeof lockup === "object") {
      const lv = lockup as Record<string, unknown>;
      let videoId = lv["contentId"];
      // Robustness: when contentId is absent the videoId still lives in the
      // thumbnail URL (same trick as the HTML lockup parser).
      if (typeof videoId !== "string" || !VIDEO_ID_RE.test(videoId)) {
        const thumbUrl = /\/vi\/([\w-]{11})\//.exec(JSON.stringify(lv["contentImage"] ?? ""))?.[1];
        videoId = thumbUrl;
      }
      pushVideo(out, seen, videoId, titleFromNode(lv));
    }
    const renderer = obj["playlistVideoRenderer"];
    if (renderer && typeof renderer === "object") {
      const pr = renderer as Record<string, unknown>;
      pushVideo(out, seen, pr["videoId"], titleFromNode(pr));
    }
    if (typeof obj["videoId"] === "string" && VIDEO_ID_RE.test(obj["videoId"] as string)) {
      loose.push(obj["videoId"] as string);
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(payload);

  if (out.length > 0) return out;
  for (const videoId of loose) pushVideo(out, seen, videoId, "");
  return out;
}

/**
 * Union of several parsed sources — order of the FIRST list that contains a
 * videoId wins, and the first non-empty title wins. Zero-length sources are
 * skipped entirely so a degraded source can never erase a healthy one.
 */
export function mergeVideoSources(...sources: ParsedVideo[][]): ParsedVideo[] {
  const out: ParsedVideo[] = [];
  const indexById = new Map<string, number>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const video of source) {
      if (!video?.videoId) continue;
      const existingIdx = indexById.get(video.videoId);
      if (existingIdx === undefined) {
        indexById.set(video.videoId, out.length);
        out.push({ videoId: video.videoId, title: video.title });
      } else if (!out[existingIdx].title && video.title) {
        out[existingIdx] = { ...out[existingIdx], title: video.title };
      }
    }
  }
  return out;
}

/**
 * Extract videos from the playlist/channel Atom RSS feed (works whenever the
 * videos are public — kept as the fallback source and for title enrichment).
 * Pure function — unit-tested in notification-utils.test.ts.
 */
export function extractFromRss(xml: string): ParsedVideo[] {
  const out: ParsedVideo[] = [];
  const seen = new Set<string>();
  const entries = xml.split("<entry>").slice(1);
  for (const entry of entries) {
    const idMatch = /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(entry);
    if (!idMatch || seen.has(idMatch[1])) continue;
    const titleMatch = /<title>([^<]*)<\/title>/.exec(entry);
    seen.add(idMatch[1]);
    out.push({
      videoId: idMatch[1],
      title: titleMatch
        ? titleMatch[1]
            .replaceAll("&amp;", "&")
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">")
            .replaceAll("&quot;", '"')
            .replaceAll("&#39;", "'")
        : "",
    });
  }
  return out;
}
