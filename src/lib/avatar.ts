/**
 * AVATAR CLIENT PIPELINE (owner request 2026-11-26)
 *
 * The user's dashboard avatar box (initials fallback) becomes an uploadable
 * profile photo. Everything here is deliberately CLIENT-SIDE: the browser
 * decodes the picked file, cover-crops it to a square and re-encodes it as a
 * compact JPEG data URL BEFORE it ever reaches the server — the HF Space disk
 * is ephemeral, so the photo is persisted in users.avatar (MEDIUMTEXT, see
 * migration v20) and must arrive already small (~15-40KB typical).
 *
 * Pure helpers (type/size/data-URL validation) are exported separately and
 * unit-tested in avatar.test.ts; the canvas pipeline itself needs a real
 * browser and is exercised in production only.
 */

/** Hard guard before decode: reject absurd files without even reading them. */
export const AVATAR_MAX_INPUT_BYTES = 8 * 1024 * 1024; // 8MB raw pick

/** Rendered square edge — the avatar shows at 96px; 256px covers 2x DPR. */
export const AVATAR_OUTPUT_SIZE = 256;

/** Canvas re-encode target. JPEG q0.82 at 256px ≈ 15-40KB — fits MEDIUMTEXT with a huge margin. */
export const AVATAR_OUTPUT_QUALITY = 0.82;

/** Server contract mirror (local-auth-router.updateAvatar). */
export const AVATAR_DATA_URL_MAX_CHARS = 400_000;

/** MIME types the server accepts (SVG is banned — script-bearing markup). */
export const AVATAR_ACCEPTED_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

/** Bilingual error messages surfaced by the Profile page toasts. */
export type AvatarErrorCode =
  | "unsupported-type"
  | "too-large"
  | "decode-failed"
  | "unknown";

const AVATAR_ERROR_MESSAGES: Record<AvatarErrorCode, { en: string; ar: string }> = {
  "unsupported-type": {
    en: "Unsupported image — please pick a PNG, JPG or WEBP file",
    ar: "صورة غير مدعومة — اختر صورة بصيغة PNG أو JPG أو WEBP",
  },
  "too-large": {
    en: "Image too large — the compressed result exceeds the limit, try a smaller picture",
    ar: "الصورة كبيرة جداً — النتيجة بعد الضغط تجاوزت الحد، جرّب صورة أصغر",
  },
  "decode-failed": {
    en: "Couldn't read this image — it may be corrupted or in an unsupported format",
    ar: "تعذر قراءة الصورة — قد تكون تالفة أو بصيغة غير مدعومة",
  },
  unknown: {
    en: "Something went wrong while processing the image",
    ar: "حدث خطأ أثناء معالجة الصورة",
  },
};

export function avatarErrorMessage(code: AvatarErrorCode, lang: "en" | "ar"): string {
  return AVATAR_ERROR_MESSAGES[code][lang];
}

/** Pure check: file type + size gate before any decode work. */
export function isValidAvatarFile(file: { type: string; size: number }): AvatarErrorCode | null {
  if (!AVATAR_ACCEPTED_MIMES.has(file.type.toLowerCase())) return "unsupported-type";
  if (file.size > AVATAR_MAX_INPUT_BYTES) return "too-large";
  return null;
}

/**
 * Pure check mirroring the server contract — used as a last-line guard before
 * the mutation fires, so an oversized canvas output fails fast client-side.
 */
export function isAcceptableAvatarDataUrl(dataUrl: string): boolean {
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)
    && dataUrl.length <= AVATAR_DATA_URL_MAX_CHARS;
}

/**
 * Decode → center-crop (cover) → square resize → JPEG data URL.
 * Throws an AvatarError carrying a typed code so the caller can toast the
 * exact bilingual reason.
 */
export class AvatarError extends Error {
  readonly code: AvatarErrorCode;
  constructor(code: AvatarErrorCode) {
    super(`avatar:${code}`);
    this.code = code;
    this.name = "AvatarError";
  }
}

export async function fileToAvatarDataUrl(file: File): Promise<string> {
  const pre = isValidAvatarFile(file);
  if (pre) throw new AvatarError(pre);

  // createImageBitmap handles orientation metadata on all evergreen browsers;
  // fall back to the <img> decode path when bitmap creation is unavailable.
  let source: ImageBitmap | HTMLImageElement;
  let width: number;
  let height: number;
  try {
    const bitmap = await createImageBitmap(file);
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } catch {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => resolve(img);
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new AvatarError("decode-failed"));
      };
      img.src = url;
    });
    width = source.naturalWidth;
    height = source.naturalHeight;
  }

  if (!width || !height) throw new AvatarError("decode-failed");

  // Center cover-crop to a square — portraits/landscapes both fill the box
  // without distortion, matching what the avatar component displays.
  const side = Math.min(width, height);
  const sx = (width - side) / 2;
  const sy = (height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_SIZE;
  canvas.height = AVATAR_OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarError("unknown");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source as CanvasImageSource, sx, sy, side, side, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
  if ("close" in source && typeof source.close === "function") source.close();

  const dataUrl = canvas.toDataURL("image/jpeg", AVATAR_OUTPUT_QUALITY);
  if (!isAcceptableAvatarDataUrl(dataUrl)) throw new AvatarError("too-large");
  return dataUrl;
}
