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

import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

// ─── File Size Validation Constants ──────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB (Practical for high-quality engineering videos)

// Allowed content types for video/streaming uploads (lessons etc.)
const ALLOWED_CONTENT_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "application/json",
  "application/zip",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream", // Fallback for binary data
]);

// Allowed content types for reference file uploads (documents, spreadsheets, images, archives)
// Broader than video uploads — references can be ANY document type the admin wants to share.
export const REFERENCE_ALLOWED_CONTENT_TYPES = new Set([
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/rtf",
  // Spreadsheets
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.oasis.opendocument.spreadsheet", // .ods
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
  // Archives
  "application/zip",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "application/x-tar",
  "application/gzip",
  // Engineering / technical
  "application/dwg",
  "application/dxf",
  "application/acad",
  "application/x-autocad",
  // CAD / 3D
  "model/stl",
  "application/sla",
  // Other
  "application/json",
  "application/xml",
  "application/octet-stream", // Fallback for unknown binary types
]);

// Max file size for reference uploads (50 MB — documents are smaller than videos)
export const REFERENCE_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB


/**
 * Validate file size and content type before upload.
 * Throws an Error if validation fails.
 */
export function validateFileForUpload(
  sizeBytes: number,
  contentType: string,
  context = "upload",
): void {
  if (sizeBytes <= 0) {
    throw new Error(`Invalid file size for ${context}: ${sizeBytes} bytes`);
  }
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    const maxMB = Math.round(MAX_FILE_SIZE_BYTES / 1024 / 1024);
    throw new Error(
      `File too large for ${context}: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB exceeds ${maxMB}MB limit`
    );
  }
  if (contentType && !ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      `Unsupported file type for ${context}: "${contentType}". ` +
      `Allowed: ${Array.from(ALLOWED_CONTENT_TYPES).join(", ")}`
    );
  }
}

// ─── Singleton Client ────────────────────────────────────────────────────────

let r2Client: S3Client | null = null;

/**
 * Get or create the R2 S3 client instance.
 * Singleton pattern to avoid creating multiple connections.
 */
export function getR2Client(): S3Client {
  if (r2Client) return r2Client;

  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;

  const endpoint = env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (!accessKeyId || !secretAccessKey || !endpoint || !env.R2_BUCKET_NAME) {
    throw new Error(
      "R2 is not configured. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_ENDPOINT or R2_ACCOUNT_ID in your environment."
    );
  }

  r2Client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: false,
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
  const bucketName = env.R2_BUCKET_NAME;
  if (!bucketName) throw new Error("R2 bucket is not configured");

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ResponseContentType: "video/mp4",
    ResponseContentDisposition: `${disposition}; filename="video.mp4"`,
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
    const bucketName = env.R2_BUCKET_NAME;
    if (!bucketName) throw new Error("R2 bucket is not configured");
    const command = new HeadObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    });
    const response = await client.send(command);
    return {
      exists: true,
      sizeBytes: response.ContentLength,
      contentType: response.ContentType,
      lastModified: response.LastModified,
    };
  } catch (error: unknown) {
    const err = error as { $metadata?: { httpStatusCode?: number }; name?: string };
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
      return { exists: false };
    }
    // R2 not configured — return null silently
    return null;
  }
}

// ─── Presigned Upload URL ────────────────────────────────────────────────────

/**
 * Generate a presigned URL for uploading a file directly to R2 from the browser.
 * The browser PUTs the file to this URL — the file never touches our server.
 *
 * @param objectKey The S3 object key (e.g., "references/file-123.pdf")
 * @param contentType The MIME type of the file being uploaded
 * @param expiresIn URL expiry in seconds (default: 300 = 5 minutes)
 */
export async function generateR2UploadUrl(
  objectKey: string,
  contentType: string,
  expiresIn: number = 300,
): Promise<string> {
  const client = getR2Client();
  const bucketName = env.R2_BUCKET_NAME;
  if (!bucketName) throw new Error("R2 bucket is not configured");

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn });
}

// ─── Presigned Download URL ──────────────────────────────────────────────────

/**
 * Generate a presigned URL for downloading a file from R2.
 * Forces download (attachment disposition) with the original filename.
 */
export async function generateR2DownloadUrl(
  objectKey: string,
  fileName: string,
  contentType?: string,
  expiresIn: number = 3600,
): Promise<string> {
  const client = getR2Client();
  const bucketName = env.R2_BUCKET_NAME;
  if (!bucketName) throw new Error("R2 bucket is not configured");

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    ResponseContentType: contentType,
    ResponseContentDisposition: `attachment; filename="${fileName.replace(/[^\w\u0600-\u06FF.-]/g, "_")}"`,
  });

  return getSignedUrl(client, command, { expiresIn });
}

// ─── Delete Object ───────────────────────────────────────────────────────────

/**
 * Delete an object from R2.
 */
export async function deleteR2Object(objectKey: string): Promise<void> {
  try {
    const client = getR2Client();
    const bucketName = env.R2_BUCKET_NAME;
    if (!bucketName) throw new Error("R2 bucket is not configured");
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    });
    await client.send(command);
  } catch (error) {
    console.warn("[R2] Failed to delete object:", objectKey, error);
    throw error;
  }
}
