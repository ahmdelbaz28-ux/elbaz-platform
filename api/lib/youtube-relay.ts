/**
 * YouTube data relay client — origin-side counterpart of the worker's /yt/*
 * routes (infra/security-audit/worker-v7-hardened.js).
 *
 * WHY: the HF Space's shared datacenter egress is throttled by YouTube
 * (429s / consent pages) — production incidents 2026-10-28 and 2026-11-05.
 * Cloudflare → YouTube egress is clean, so playlist listings and oEmbed
 * verdicts now ride the worker first; the watcher's direct sources stay
 * wired as the fallback, so an unconfigured/failed relay changes nothing.
 *
 * AUTH — derived token, zero new secrets. The worker gates /yt/* with
 *   hex(HMAC-SHA256(TG_RELAY_SECRET, "yt-relay-v1"))
 * and this client computes the same derivation from TELEGRAM_API_RELAY_SECRET
 * (the Space-side copy of that SAME secret — its provisioning on both sides
 * is proven by the live /tg transport relay since 2026-10-29). Deriving a
 * route key instead of reusing the raw secret means one leaked header value
 * never grants the other route.
 *
 * ORIGIN — explicit YOUTUBE_RELAY_URL wins; otherwise derived from
 * TELEGRAM_API_BASE (e.g. https://<worker>.workers.dev/tg → its origin),
 * but ONLY for *.workers.dev hosts so we never tunnel YouTube reads through
 * an arbitrary third-party host.
 */

import { createHmac } from "node:crypto";
import { logger } from "./logger.js";
import type { ParsedVideo } from "./notification-utils.js";

/** Domain-separated HMAC context — MUST match the worker's YT_RELAY_CONTEXT. */
export const YT_RELAY_CONTEXT = "yt-relay-v1";

const VIDEO_ID_RE = /^[\w-]{11}$/;
const RELAY_TIMEOUT_MS = 15 * 1000;

export type YoutubeOembedVerdict =
  | { status: "ok"; title: string }
  | { status: "gone" }
  | { status: "unknown" };

/** Worker origin for /yt/* calls, or null when the relay is not usable. */
export function youtubeRelayOrigin(): string | null {
  const explicit = (process.env.YOUTUBE_RELAY_URL ?? "").trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      if (url.protocol === "https:") return url.origin;
    } catch {
      // fall through to the TELEGRAM_API_BASE derivation
    }
  }
  const tgBase = (process.env.TELEGRAM_API_BASE ?? "").trim();
  if (!tgBase) return null;
  try {
    const url = new URL(tgBase);
    if (url.protocol === "https:" && url.hostname.endsWith(".workers.dev")) return url.origin;
  } catch {
    // unparseable base — relay stays off
  }
  return null;
}

/** hex(HMAC-SHA256(TELEGRAM_API_RELAY_SECRET, "yt-relay-v1")) — the worker's gate value. */
export function youtubeRelayToken(): string | null {
  const secret = (process.env.TELEGRAM_API_RELAY_SECRET ?? "").trim();
  if (secret.length < 16) return null;
  return createHmac("sha256", secret).update(YT_RELAY_CONTEXT).digest("hex");
}

async function relayGet(path: string): Promise<Response | null> {
  const origin = youtubeRelayOrigin();
  const token = youtubeRelayToken();
  if (!origin || !token) return null;
  try {
    return await fetch(`${origin}${path}`, {
      headers: { "X-Yt-Relay-Token": token },
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/**
 * Playlist listing via the worker (edge-cached 5 min there).
 * Returns sanitized {videoId, title} pairs with titles VERBATIM as YouTube
 * serves them, or null when the relay is unconfigured/failed (fail-open —
 * the caller's direct sources remain the fallback).
 */
export async function fetchRelayPlaylist(playlistId: string): Promise<ParsedVideo[] | null> {
  const res = await relayGet(`/yt/playlist?list=${encodeURIComponent(playlistId)}`);
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { ok?: unknown; items?: unknown };
    if (data?.ok !== true || !Array.isArray(data.items)) return null;
    const items: ParsedVideo[] = [];
    for (const raw of data.items) {
      const videoId = (raw as { videoId?: unknown })?.videoId;
      const title = (raw as { title?: unknown })?.title;
      if (typeof videoId === "string" && VIDEO_ID_RE.test(videoId)) {
        items.push({ videoId, title: typeof title === "string" ? title : "" });
      }
    }
    logger.info("[YouTubeRelay] playlist served via worker", {
      count: items.length,
      cache: res.headers.get("X-Yt-Cache") ?? "?",
    });
    return items;
  } catch {
    return null;
  }
}

/**
 * oEmbed verdict via the worker — same semantics as the watcher's direct
 * fetchOembedVerdict (the `title` IS the live YouTube title). Returns null
 * when the relay could not answer (unconfigured, 502-unknown, transport
 * failure) so the caller falls back to its direct check.
 */
export async function fetchRelayOembedVerdict(videoId: string): Promise<YoutubeOembedVerdict | null> {
  const res = await relayGet(`/yt/oembed?v=${encodeURIComponent(videoId)}`);
  if (!res || !res.ok) return null;
  try {
    const data = (await res.json()) as { ok?: unknown; exists?: unknown; title?: unknown };
    if (data?.ok !== true) return null;
    if (data.exists === true && typeof data.title === "string" && data.title.trim()) {
      return { status: "ok", title: data.title };
    }
    if (data.exists === false) return { status: "gone" };
    return null;
  } catch {
    return null;
  }
}
