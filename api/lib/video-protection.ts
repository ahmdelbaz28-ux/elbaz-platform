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

import crypto from "crypto";
import { generateR2PresignedUrl } from "./r2";
import { env } from "./env";

// ─── Configuration ───────────────────────────────────────────────────────────
const VIDEO_URL_EXPIRY_SECONDS = 1800; // 30 minutes
// ✅ SECURITY FIX: No default fallback — required() will throw in production if missing
const WATERMARK_SECRET = env.watermarkSecret;

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
  /** ISO timestamp when this URL expires */
  expiresAt: string;
  /** Watermark token to identify leaker */
  watermarkToken: string;
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

  if (!videoUrl) {
    return {
      videoUrl: "",
      expiresAt: new Date(Date.now() + VIDEO_URL_EXPIRY_SECONDS * 1000).toISOString(),
      watermarkToken: generateWatermarkToken(userId, username, lessonId),
    };
  }

  try {
    // ─── Strategy 1: R2 Presigned URL ───
    const objectKey = parseVideoKey(videoUrl);
    const presignedUrl = await generateR2PresignedUrl({
      objectKey,
      expiresIn: VIDEO_URL_EXPIRY_SECONDS,
    });

    return {
      videoUrl: presignedUrl,
      expiresAt: new Date(Date.now() + VIDEO_URL_EXPIRY_SECONDS * 1000).toISOString(),
      watermarkToken: generateWatermarkToken(userId, username, lessonId),
    };
  } catch {
    // ─── Strategy 2: HMAC-signed fallback ───
    const fallbackResult = generateHmacSignedUrl(videoUrl, userId, lessonId);
    return {
      videoUrl: fallbackResult.signedUrl,
      expiresAt: new Date(fallbackResult.expiresAt).toISOString(),
      watermarkToken: generateWatermarkToken(userId, username, lessonId),
    };
  }
}

// ─── HMAC Fallback ───────────────────────────────────────────────────────────

function generateHmacSignedUrl(
  videoUrl: string,
  userId: number,
  lessonId: number,
): { signedUrl: string; expiresAt: number } {
  const expiresAt = Date.now() + VIDEO_URL_EXPIRY_SECONDS * 1000;
  const nonce = crypto.randomBytes(8).toString("hex");

  const payload = `${userId}:${lessonId}:${expiresAt}:${nonce}`;
  const signature = crypto
    .createHmac("sha256", WATERMARK_SECRET)
    .update(payload)
    .digest("hex");

  const separator = videoUrl.includes("?") ? "&" : "?";
  const signedUrl = `${videoUrl}${separator}_expires=${expiresAt}&_uid=${userId}&_lid=${lessonId}&_nonce=${nonce}&_sig=${signature}`;

  return { signedUrl, expiresAt };
}

// ─── Watermark Token ─────────────────────────────────────────────────────────

function generateWatermarkToken(
  userId: number,
  username: string,
  lessonId: number,
): string {
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

    const expectedHmac = crypto
      .createHmac("sha256", WATERMARK_SECRET)
      .update(payload)
      .digest("hex")
      .substring(0, 16);

    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) {
      return null;
    }

    return {
      userId: parseInt(userIdStr),
      username,
      lessonId: parseInt(lessonIdStr),
      timestamp: parseInt(timestampStr),
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
