/**
 * Video Content Protection Module
 *
 * Architecture:
 * 1. Videos stored on Cloudflare R2 (S3-compatible storage)
 * 2. Server generates R2 Presigned URLs (valid 30 minutes)
 * 3. Presigned URLs are cryptographically signed by R2 — no server verification needed
 * 4. Frontend renders video in a protected player (no download button, no right-click)
 * 5. Watermark overlay identifies the user if content is leaked
 */

import crypto from "node:crypto";
import { generateR2PresignedUrl } from "./r2";
import { env } from "./env";
import { logger } from "./logger.js";
import { buildYouTubeEmbedUrl, extractYouTubeId, isYouTubeVideoRef } from "../../src/lib/youtube-url";

// ─── Configuration ───────────────────────────────────────────────────────────
const VIDEO_URL_EXPIRY_SECONDS = 1800; // 30 minutes

// SECURITY: WATERMARK_SECRET is validated lazily when video functions are called.
// This prevents the entire server from crashing if the env var is missing.
// WATERMARK_SECRET is optional in env.ts, so missing it should not be fatal.
const WATERMARK_SECRET = env.WATERMARK_SECRET;
if (!WATERMARK_SECRET) {
  logger.warn("[SECURITY WARNING] WATERMARK_SECRET is not set. Video watermark/HMAC tokens will be disabled. Set this env var in production for full video protection.");
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface VideoAccessOptions {
  /** Raw videoUrl from database (R2 key, full URL, or any storage URL) */
  videoUrl: string;
  userId: number;
  lessonId: number;
  username: string;
}

interface VideoAccessResult {
  /** The presigned streaming URL or signed fallback URL */
  videoUrl: string;
  /** HLS master playlist URL (if HLS is available) */
  hlsUrl: string | null;
  /** ISO timestamp when this URL expires */
  expiresAt: string;
  /** Watermark token to identify leaker */
  watermarkToken: string;
  /** Source kind driving the frontend player branch: "youtube" renders the
   *  embedded YouTube player (playback streams from YouTube — nothing from
   *  our server); "r2" is the legacy self-hosted <video> path. */
  kind: "youtube" | "r2";
  /** 11-char YouTube video id when kind === "youtube", else null. */
  youtubeId: string | null;
}

// ─── Main Function ───────────────────────────────────────────────────────────

/**
 * Get a secure, time-limited video URL for a specific user and lesson.
 *
 * Strategy:
 * 1. If R2 is configured → generate R2 Presigned URL (most secure, R2 validates)
 * 2. If R2 is not configured → HMAC-signed URL fallback
 */
export async function getSecureVideoUrl(options: VideoAccessOptions): Promise<VideoAccessResult> {
  const { videoUrl, userId, lessonId, username } = options;
  const defaultResult = {
    videoUrl: "",
    hlsUrl: null as string | null,
    expiresAt: new Date(Date.now() + VIDEO_URL_EXPIRY_SECONDS * 1000).toISOString(),
    watermarkToken: generateWatermarkToken(userId, username, lessonId),
    kind: "r2" as const,
    youtubeId: null as string | null,
  };

  if (!videoUrl) return defaultResult;

  // ─── Strategy 0: YouTube playlist video — ZERO bytes from our server ───
  // The lesson stores a YouTube link (watch/shorts/youtu.be/embed or a bare
  // id). Playback is handed to the embedded YouTube player on the client:
  // no R2 presigning, no proxying, no storage cost. The returned videoUrl is
  // the canonical watch link (kept for display/fallback) while youtubeId
  // drives the embed. MUST branch BEFORE any R2 call — presigning a YouTube
  // URL used to throw and fail-closed with a misleading 503.

  if (isYouTubeVideoRef(videoUrl)) {
    const youtubeId = extractYouTubeId(videoUrl) ?? "";
    const origin = env.FRONTEND_URL;
    let embedUrl: string;
    try {
      embedUrl = buildYouTubeEmbedUrl(youtubeId, origin);
    } catch (err) {
      // extractYouTubeId is the guard, so this is unreachable in practice —
      // but never let a broken link fail the whole procedure: log and surface
      // the legacy error path.
      logger.error("[VideoProtection] YouTube embed build failed", {
        lessonId,
        videoUrl: videoUrl.slice(0, 200),
        error: err instanceof Error ? err.message : String(err),
      });
      const trpcError = new Error("Video temporarily unavailable — please retry in a moment.") as Error & { status?: number };
      trpcError.status = 503;
      throw trpcError;
    }
    return {
      videoUrl: embedUrl,
      hlsUrl: null,
      expiresAt: new Date(Date.now() + VIDEO_URL_EXPIRY_SECONDS * 1000).toISOString(),
      watermarkToken: generateWatermarkToken(userId, username, lessonId),
      kind: "youtube" as const,
      youtubeId,
    };
  }

  // Check if the videoUrl already points to an HLS manifest (.m3u8)
  const isHlsSource = videoUrl.endsWith(".m3u8");

  try {
    // ─── Strategy 1: R2 Presigned URL ───
    const objectKey = parseVideoKey(videoUrl);
    const presignedUrl = await generateR2PresignedUrl({
      objectKey,
      expiresIn: VIDEO_URL_EXPIRY_SECONDS,
    });

    // If HLS source, generate presigned URL for the m3u8 manifest
    if (isHlsSource) {
      return {
        videoUrl: presignedUrl,
        hlsUrl: presignedUrl,
        expiresAt: new Date(Date.now() + VIDEO_URL_EXPIRY_SECONDS * 1000).toISOString(),
        watermarkToken: generateWatermarkToken(userId, username, lessonId),
        kind: "r2" as const,
        youtubeId: null,
      };
    }

    // For MP4: also check if an HLS version exists alongside the MP4
    // Convention: video.mp4 → video.m3u8 (stored in same R2 folder)
    const hlsObjectKey = objectKey.replace(/\.mp4$/i, ".m3u8");
    let hlsUrl: string | null = null;
    try {
      const { getR2ObjectMetadata } = await import("./r2");
      const meta = await getR2ObjectMetadata(hlsObjectKey);
      if (meta?.exists) {
        hlsUrl = await generateR2PresignedUrl({
          objectKey: hlsObjectKey,
          expiresIn: VIDEO_URL_EXPIRY_SECONDS,
        });
      }
    } catch {
      // HLS version doesn't exist — that's fine, MP4 will be used
    }

    return {
      videoUrl: presignedUrl,
      hlsUrl,
      expiresAt: new Date(Date.now() + VIDEO_URL_EXPIRY_SECONDS * 1000).toISOString(),
      watermarkToken: generateWatermarkToken(userId, username, lessonId),
      kind: "r2" as const,
      youtubeId: null,
    };
  } catch (err) {
    // ✅ SECURITY FIX (post-audit): FAIL CLOSED. The previous fallback returned
    // the raw videoUrl wrapped in _expires/_sig parameters that NOTHING on the
    // network path verifies — a silent downgrade to an unprotected URL whenever
    // R2 presigning hiccuped. Never hand out an unguarded link: log the failure
    // and surface a clear temporary error to the client instead.
    logger.error("[VideoProtection] R2 presign failed — refusing unsigned fallback", {
      lessonId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    const trpcError = new Error("Video temporarily unavailable — please retry in a moment.") as Error & {
      status?: number;
    };
    trpcError.status = 503;
    throw trpcError;
  }
}

// ─── Watermark Token ─────────────────────────────────────────────────────────

function generateWatermarkToken(
  userId: number,
  username: string,
  lessonId: number,
): string {
  if (!WATERMARK_SECRET) {
    // No secret — return a simple non-cryptographic token
    return Buffer.from(`${userId}|${username}|${lessonId}|${Date.now()}`).toString("base64url");
  }
  const payload = `${userId}|${username}|${lessonId}|${Date.now()}`;
  const hmac = crypto
    .createHmac("sha256", WATERMARK_SECRET)
    .update(payload)
    .digest("hex")
    .substring(0, 16);

  return Buffer.from(`${payload}|${hmac}`).toString("base64url");
}

/**
 * Decode a watermark token to identify the leaker.
 * Returns null if token is invalid or tampered with.
 */
export function decodeWatermarkToken(
  token: string,
): { userId: number; username: string; lessonId: number; timestamp: number } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split("|");
    if (parts.length !== 5) return null;

    const [userIdStr, username, lessonIdStr, timestampStr, hmac] = parts;
    const payload = `${userIdStr}|${username}|${lessonIdStr}|${timestampStr}`;

    // If no WATERMARK_SECRET, accept the token without verification
    if (!WATERMARK_SECRET) {
      return {
        userId: Number.parseInt(userIdStr, 10),
        username,
        lessonId: Number.parseInt(lessonIdStr, 10),
        timestamp: Number.parseInt(timestampStr, 10),
      };
    }

    const expectedHmac = crypto
      .createHmac("sha256", WATERMARK_SECRET)
      .update(payload)
      .digest("hex")
      .substring(0, 16);

    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) {
      return null;
    }

    return {
      userId: Number.parseInt(userIdStr, 10),
      username,
      lessonId: Number.parseInt(lessonIdStr, 10),
      timestamp: Number.parseInt(timestampStr, 10),
    };
  } catch {
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseVideoKey(videoUrl: string): string {
  try {
    const url = new URL(videoUrl);
    return url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
  } catch {
    return videoUrl;
  }
}
