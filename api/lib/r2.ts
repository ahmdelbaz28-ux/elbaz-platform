/**
 * Cloudflare R2 Storage Client
 *
 * R2 is S3-compatible. We use the AWS SDK v3 with a custom endpoint
 * pointing to the Cloudflare R2 API.
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
 */
export function getR2Client(): S3Client {
  if (r2Client) return r2Client;

  const accountId = env.r2AccountId;
  const accessKeyId = env.r2AccessKeyId;
  const secretAccessKey = env.r2SecretAccessKey;

  const endpoint = env.r2Endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      "R2 is not configured. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ENDPOINT in your environment."
    );
  }

  r2Client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // Required for R2
    forcePathStyle: false,
    // Disable checksum validation for R2 compatibility
    checksumValidation: false,
  });

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

  const command = new GetObjectCommand({
    Bucket: env.r2Bucket,
    Key: objectKey,
    ResponseContentType: "video/mp4",
    ResponseContentDisposition: `${disposition}; filename="video.mp4"`,
    // Cache-Control: no-store prevents browser caching of video chunks
    CacheControl: "no-store",
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
      Bucket: env.r2Bucket,
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
