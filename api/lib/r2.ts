/**
 * Cloudflare R2 Storage Client
 *
 * R2 is S3-compatible. We use the AWS SDK v3 with a custom endpoint
 * pointing to the Cloudflare R2 API.
 *
 * Supports two auth modes:
 * Mode 1: S3 API Token (R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY) — preferred
 * Mode 2: Cloudflare API Token (CLOUDFLARE_API_TOKEN) — fallback for R2 presigned URLs
 *
 * Features:
 * - Presigned URLs for secure video streaming (30-minute expiry)
 * - Direct object upload support
 * - No egress fees (unlike AWS S3)
 */

import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

// ─── Singleton Client ────────────────────────────────────────────────────────

let r2Client: S3Client | null = null;

/**
 * Get or create the R2 S3 client instance.
 * Singleton pattern to avoid creating multiple connections.
 *
 * Auth priority:
 * 1. R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY (S3-compatible tokens — best for presigned URLs)
 * 2. CLOUDFLARE_API_TOKEN (account-level token — works for reads but NOT for presigned URL signing)
 */
export function getR2Client(): S3Client {
  if (r2Client) return r2Client;

  const accountId = env.r2AccountId;
  const accessKeyId = env.r2AccessKeyId;
  const secretAccessKey = env.r2SecretAccessKey;
  const cfApiToken = process.env.CLOUDFLARE_API_TOKEN || "";

  if (accountId && accessKeyId && secretAccessKey) {
    // Mode 1: S3 API Token (preferred — supports presigned URLs)
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: false,
      checksumValidation: false,
    });
  } else if (accountId && cfApiToken) {
    // Mode 2: Cloudflare API Token (fallback — no presigned URLs)
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: cfApiToken,
        secretAccessKey: cfApiToken,
      },
      forcePathStyle: false,
      checksumValidation: false,
    });
  } else {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY, or R2_ACCOUNT_ID + CLOUDFLARE_API_TOKEN."
    );
  }

  return r2Client;
}

// ─── Presigned URL Generation ────────────────────────────────────────────────

interface PresignedVideoOptions {
  /** The S3 object key (e.g., "videos/lesson-5.mp4") */
  objectKey: string;
  /** Expiry in seconds (default: 1800 = 30 minutes) */
  expiresIn?: number;
  /** Response content disposition (default: inline for streaming) */
  disposition?: "inline" | "attachment";
  /** Override content type (auto-detected from extension if not set) */
  contentType?: string;
}

/**
 * Generate a presigned URL for streaming a video from R2.
 *
 * The URL is cryptographically signed by Cloudflare R2 and will
 * expire after `expiresIn` seconds. After expiry, the URL is useless.
 *
 * R2 presigned URLs are extremely secure because:
 * - They are signed with HMAC-SHA256
 * - They include a timestamp
 * - R2 validates the signature on every request
 * - No server-side verification needed
 */
export async function generateR2PresignedUrl(options: PresignedVideoOptions): Promise<string> {
  const { objectKey, expiresIn = 1800, disposition = "inline" } = options;
  const client = getR2Client();

  // Auto-detect content type from file extension
  const ext = objectKey.split('.').pop()?.toLowerCase() || "";
  const contentTypes: Record<string, string> = {
    "mp4": "video/mp4",
    "m3u8": "application/vnd.apple.mpegurl",
    "ts": "video/mp2t",
    "webm": "video/webm",
  };
  const detectedContentType = contentType || contentTypes[ext] || "application/octet-stream";

  const command = new GetObjectCommand({
    Bucket: env.r2Bucket || "elbaz-videos",
    Key: objectKey,
    ResponseContentType: detectedContentType,
    ResponseContentDisposition: `${disposition}; filename="video${ext ? '.' + ext : '.mp4'}"`,
    // HLS manifests need short cache; segments can be cached longer; MP4 no cache for security
    CacheControl: ext === "m3u8" ? "public, max-age=300" : ext === "ts" ? "public, max-age=86400" : "no-store",
  });

  const signedUrl = await getSignedUrl(client, command, { expiresIn });
  return signedUrl;
}

// ─── Object Head (Metadata) ──────────────────────────────────────────────────

/**
 * Check if an object exists in R2 and get its metadata (size, type).
 */
export async function getR2ObjectMetadata(objectKey: string): Promise<{
  exists: boolean;
  sizeBytes?: number;
  contentType?: string;
  lastModified?: Date;
} | null> {
  try {
    const client = getR2Client();
    const command = new HeadObjectCommand({
      Bucket: env.r2Bucket || "elbaz-videos",
      Key: objectKey,
    });
    const response = await client.send(command);
    return {
      exists: true,
      sizeBytes: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
    };
  } catch (error: any) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
      return { exists: false };
    }
    // R2 not configured — return null silently
    return null;
  }
}
