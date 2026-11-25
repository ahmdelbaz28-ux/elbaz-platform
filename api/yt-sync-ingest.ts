/**
 * YT-SYNC INGEST — server-to-server YouTube playlist ingestion endpoint.
 *
 * WHY: the HF Space's shared datacenter egress is throttled by YouTube
 * (incidents 2026-10-28 / 2026-11-05) while GitHub Actions runners reach
 * YouTube cleanly. A scheduled Actions workflow fetches the channel playlist
 * and pushes the (videoId, title) pairs HERE, verbatim, every 15 minutes.
 * The payload feeds the EXISTING applyPlaylistSync engine — verbatim titles,
 * first-video cover, fake-lesson purge (prunedOnce) — so no new sync logic
 * exists and no policy can drift between the two paths.
 *
 * AUTH: HMAC-SHA256 over the RAW request body with SYNC_INGEST_SECRET
 * (header `x-sync-signature: hex(...)`), timing-safe compared. Fail-closed:
 * the endpoint refuses everything while the secret is unset/short, so it can
 * never become an open write endpoint.
 *
 * ✅ REPLAY HARDENING (2026-11-13): the bare body-HMAC had no freshness — a
 * captured payload could be replayed weeks later, re-inserting videos that
 * had since LEFT the playlist as published lessons. Relays now also send
 * `x-sync-ts` (epoch ms) and sign `body + "." + ts`; timestamps outside a
 * 10-minute window are refused.
 *
 * ✅ SECURITY FIX (audit run-2, fp yt-sync-ingest.legacy-body-only-hmac
 * .unbounded-replay-lane — STEP 2): the legacy body-only fallback lane is now
 * REMOVED. The phased transition (STEP 1: dual-accept + deprecation logging;
 * relay migration shipped in the same commit) is complete — every relay in
 * .github/workflows/yt-playlist-relay.yml → scripts/yt_playlist_relay.py
 * signs `body + "." + ts` and sends `x-sync-ts`. A request WITHOUT the
 * timestamp header is hard-401'd: captured body-only requests are dead on
 * arrival, and the deprecation warning is gone from the log surface.
 *
 * MOUNTED at /api/yt-sync in boot.ts:
 *   POST /api/yt-sync/ingest  → applies the playlist sync, returns SyncSummary
 *   GET  /api/yt-sync/state   → current sync state (diagnostics, same gate)
 */

import { Hono } from "hono";
import { z } from "zod";
import { logger } from "./lib/logger";
import {
  applyPlaylistSync,
  getSyncSettings,
  getSyncState,
  isPlaceholderTitle,
} from "./lib/playlist-sync.js";
import { authenticateIngest, computeSignature, signatureMatches } from "./lib/yt-sync-auth.js";

// ✅ ROOT-CURE (2026-11-13): the old caps (100 videos / 16 KB) rejected legal
// payloads — 100 Arabic titles escape to ~2 bytes/char and long course titles
// blew past 16 KB, so a large playlist could NEVER sync (silent 400/413
// forever). 300 videos / 64 KB keep the endpoint a hard abuse brake while
// fitting every real playlist with headroom.
const MAX_VIDEOS = 300;
const MAX_BODY_CHARS = 64_000;
// Anti-replay window + signature helpers now live in lib/yt-sync-auth.ts
// (extracted for unit-testing the STEP 2 replay contract).

const ingestSchema = z.object({
  videos: z
    .array(
      z.object({
        videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
        // trim(): a whitespace-only title would otherwise "re-title" a real
        // lesson to blanks via the titleDrift path in applyPlaylistSync.
        title: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(MAX_VIDEOS),
  source: z.string().max(40).optional(),
});

/** Unset/short secret → endpoint stays fully dormant (fail-closed). */
function ingestSecret(): string | null {
  const value = (process.env.SYNC_INGEST_SECRET ?? "").trim();
  return value.length >= 16 ? value : null;
}

// computeSignature / signatureMatches / authenticateIngest live in
// lib/yt-sync-auth.ts (STEP 2 replay contract — unit-tested there).

export const ytSyncIngestRoute = new Hono();

ytSyncIngestRoute.post("/ingest", async (c) => {
  const secret = ingestSecret();
  if (!secret) {
    logger.warn("[YtSyncIngest] rejected — SYNC_INGEST_SECRET not configured");
    return c.json({ error: "ingest disabled" }, 503);
  }

  const raw = await c.req.text();
  if (raw.length > MAX_BODY_CHARS) {
    return c.json({ error: "payload too large" }, 413);
  }
  const auth = authenticateIngest(secret, raw, c);
  if (!auth.ok) {
    logger.warn("[YtSyncIngest] rejected — bad signature", {
      hasHeader: Boolean(c.req.header("x-sync-signature")),
      replayProtected: auth.replayProtected,
      bodyLength: raw.length,
    });
    return c.json({ error: "invalid signature" }, auth.status ?? 401);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = ingestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return c.json({ error: "invalid payload", issues: parsed.error.issues.slice(0, 5) }, 400);
  }

  // ✅ ROOT-CURE (2026-11-13, dead videos published as lessons): the relay's
  // placeholder filter was English-only while it FETCHES with hl=ar, so
  // YouTube's ARABIC placeholders ("فيديو خاص" / "فيديو محذوف" / "الفيديو
  // غير متاح") sailed through and became PUBLISHED free lessons announced
  // to every user — with an embed that fails at playback. The server now
  // filters placeholders itself (defense in depth) on EVERY feeder.
  const videos = parsed.data.videos
    .map((v) => ({ videoId: v.videoId, title: v.title }))
    .filter((v) => {
      if (isPlaceholderTitle(v.title)) {
        logger.warn("[YtSyncIngest] dropped placeholder/unavailable video", { videoId: v.videoId });
        return false;
      }
      return true;
    });

  if (videos.length === 0) {
    // Everything was a placeholder — hand the EMPTY list to the engine: its
    // blind-tick guard records/preserves state correctly (never an error).
    logger.warn("[YtSyncIngest] payload contained only placeholders — nothing to sync");
    const summary = await applyPlaylistSync([], { reason: `ingest:${parsed.data.source ?? "gh-relay"}:placeholders-only` });
    return c.json({ ok: summary.ok, summary });
  }

  logger.info("[YtSyncIngest] payload accepted", {
    count: videos.length,
    source: parsed.data.source ?? "gh-relay",
    replayProtected: auth.replayProtected,
  });

  const summary = await applyPlaylistSync(videos, { reason: `ingest:${parsed.data.source ?? "gh-relay"}` });
  return c.json({ ok: summary.ok, summary });
});

ytSyncIngestRoute.get("/state", async (c) => {
  const secret = ingestSecret();
  if (!secret) return c.json({ error: "ingest disabled" }, 503);
  const received = c.req.header("x-sync-signature");
  // GET has no body — sign a constant probe string instead.
  if (!signatureMatches(computeSignature(secret, "state-probe"), received)) {
    return c.json({ error: "invalid signature" }, 401);
  }
  // ✅ FIX (2026-11-13): getSyncState is async — the un-awaited promise used
  // to serialize as "{}", so the diagnostics probe never showed real state.
  const [state, settings] = await Promise.all([getSyncState(), getSyncSettings()]);
  return c.json({ state, settings });
});
