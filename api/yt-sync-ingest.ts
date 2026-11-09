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
 * Mounted at /api/yt-sync in boot.ts:
 *   POST /api/yt-sync/ingest  → applies the playlist sync, returns SyncSummary
 *   GET  /api/yt-sync/state   → current sync state (diagnostics, same gate)
 */

import { Hono } from "hono";
import { z } from "zod";
import crypto from "node:crypto";
import { logger } from "./lib/logger";
import { applyPlaylistSync, getSyncState, getSyncSettings } from "./lib/playlist-sync.js";

const ingestSchema = z.object({
  videos: z
    .array(
      z.object({
        videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
        title: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(100),
  source: z.string().max(40).optional(),
});

/** Unset/short secret → endpoint stays fully dormant (fail-closed). */
function ingestSecret(): string | null {
  const value = (process.env.SYNC_INGEST_SECRET ?? "").trim();
  return value.length >= 16 ? value : null;
}

/** Hex HMAC-SHA256 over the raw body. */
function computeSignature(secret: string, rawBody: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

function signatureMatches(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received.trim().toLowerCase(), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const ytSyncIngestRoute = new Hono();

ytSyncIngestRoute.post("/ingest", async (c) => {
  const secret = ingestSecret();
  if (!secret) {
    logger.warn("[YtSyncIngest] rejected — SYNC_INGEST_SECRET not configured");
    return c.json({ error: "ingest disabled" }, 503);
  }

  const raw = await c.req.text();
  if (raw.length > 16_000) {
    return c.json({ error: "payload too large" }, 413);
  }
  const received = c.req.header("x-sync-signature");
  if (!signatureMatches(computeSignature(secret, raw), received)) {
    logger.warn("[YtSyncIngest] rejected — bad signature", {
      hasHeader: Boolean(received),
      bodyLength: raw.length,
    });
    return c.json({ error: "invalid signature" }, 401);
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

  const videos = parsed.data.videos.map((v) => ({ videoId: v.videoId, title: v.title }));
  logger.info("[YtSyncIngest] payload accepted", {
    count: videos.length,
    source: parsed.data.source ?? "gh-relay",
  });

  const summary = await applyPlaylistSync(videos, { reason: `ingest:${parsed.data.source ?? "gh-relay"}` });
  return c.json({ ok: summary.ok, summary });
});

ytSyncIngestRoute.get("/state", (c) => {
  const secret = ingestSecret();
  if (!secret) return c.json({ error: "ingest disabled" }, 503);
  const received = c.req.header("x-sync-signature");
  // GET has no body — sign a constant probe string instead.
  if (!signatureMatches(computeSignature(secret, "state-probe"), received)) {
    return c.json({ error: "invalid signature" }, 401);
  }
  return c.json({ state: getSyncState(), settings: getSyncSettings() });
});
