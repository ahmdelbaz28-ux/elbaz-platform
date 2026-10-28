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
    return raw.replaceAll("\\u0026", "&").replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
}

export interface ParsedVideo {
  videoId: string;
  title: string;
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
  const push = (videoId: string, title: string) => {
    if (seen.has(videoId)) return;
    seen.add(videoId);
    out.push({ videoId, title });
  };

  // Layout A (legacy): each playlist item is a `playlistVideoRenderer` object
  // that starts with its videoId followed shortly by the localized title runs.
  const blocks = html.split('"playlistVideoRenderer"');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].slice(0, 4000);
    const idMatch = /"videoId":"([\w-]{11})"/.exec(block);
    if (!idMatch) continue;
    const titleMatch = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(block);
    push(idMatch[1], titleMatch ? decodeJsonStringLiteral(titleMatch[1]) : "");
  }
  if (out.length > 0) return out;

  // Layout B (2025+ "lockupViewModel"): the playlist items are lockup objects;
  // the videoId lives in the thumbnail URL (`/vi/{id}/`) and the title in
  // `lockupMetadataViewModel.title.content`.
  const lockups = html.split('{"lockupViewModel"');
  for (let i = 1; i < lockups.length; i++) {
    const block = lockups[i].slice(0, 10000);
    if (!block.includes("contentImage")) continue;
    const idMatch = /\/vi\/([\w-]{11})\//.exec(block);
    if (!idMatch) continue;
    const titleMatch =
      /"lockupMetadataViewModel":\{"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(block) ??
      /"title":\{"content":"((?:[^"\\]|\\.)*)"/.exec(block);
    push(idMatch[1], titleMatch ? decodeJsonStringLiteral(titleMatch[1]) : "");
  }
  if (out.length > 0) return out;

  // Fallback: loose scan for bare videoIds (layout variations / consent pages).
  const looseIds = html.match(/"videoId":"([\w-]{11})"/g) ?? [];
  for (const raw of looseIds) {
    const id = /"videoId":"([\w-]{11})"/.exec(raw)?.[1];
    if (!id) continue;
    push(id, "");
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
