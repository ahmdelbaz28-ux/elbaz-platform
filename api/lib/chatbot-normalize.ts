/**
 * CHATBOT INPUT NORMALIZATION — pure, dependency-free module.
 *
 * Extracted from api/chatbot-router.ts (unit-testable without the router's
 * heavy import graph: no Hono, no DB, no provider code — types only).
 *
 * Security/size rules:
 *   • Only data: URLs with an image mime are accepted (no remote URLs — the
 *     server must never be tricked into fetching attacker-chosen resources).
 *   • Per-image base64 cap + per-request image count cap keep the request
 *     far below the shield's 1MB payload guard.
 *   • ONLY the LAST user message may carry image parts — anything else is
 *     flattened to plain text so text-only providers are never exposed to
 *     image parts in history.
 *   • LIVE SCREEN flag: an image part tagged `source: "screen_capture"` in
 *     the LAST user message marks the frame as a live capture of the user's
 *     real screen (`screenCapture: true`) — the caller arms the screen-
 *     teacher prompt. Any other/unknown tag value is ignored (never trusted).
 */

import type { ChatApiMessage, ContentPart } from "./chatbot.js";
import type { ChatbotErrorCode } from "./chatbot-errors.js";

export const IMAGE_DATAURL_RE = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/;
export const MAX_IMAGE_PART_BASE64 = 450_000; // ~337KB binary per image
export const MAX_IMAGES_PER_REQUEST = 2;

// ── Shared content caps (module scope — consumed by the router too) ──
// ✅ SECURITY FIX (audit run-1): cap per-message content (previously a
// single 1MB request could ship ~250k tokens to paid providers).
export const MAX_MESSAGE_CHARS = 8_000;
export const MAX_TOTAL_CHARS = 60_000;

export interface NormalizedChatInput {
  messages: ChatApiMessage[];
  /** Last user message carries image parts — must route to vision models. */
  vision: boolean;
  imageCount: number;
  totalTextChars: number;
  /** Last user message image parts are tagged `source: "screen_capture"` —
   *  a LIVE frame of the user's actual screen → arms the screen-teacher
   *  prompt (grounded step-by-step guidance, zero guessing). */
  screenCapture: boolean;
}

export type NormalizeFailure = { status: 400 | 413; en: string; ar: string; code: ChatbotErrorCode };

export function normalizeChatInput(raw: unknown): { ok: true; data: NormalizedChatInput } | { ok: false; failure: NormalizeFailure } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, failure: { status: 400, code: "BAD_REQUEST", en: "Messages array is required", ar: "Messages array is required" } };
  }
  const sliced = raw.slice(-50);

  // Locate the last user message — the only one allowed to carry images.
  let lastUserIdx = -1;
  for (let i = sliced.length - 1; i >= 0; i--) {
    const m = sliced[i] as { role?: unknown } | null;
    if (m && m.role === "user") { lastUserIdx = i; break; }
  }

  const messages: ChatApiMessage[] = [];
  let imageCount = 0;
  let totalTextChars = 0;
  let screenCapture = false;

  for (let i = 0; i < sliced.length; i++) {
    const m = sliced[i] as { role?: unknown; content?: unknown } | null;
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = m.content;

    if (typeof content === "string") {
      const clipped = content.slice(0, MAX_MESSAGE_CHARS);
      totalTextChars += clipped.length;
      messages.push({ role, content: clipped });
      continue;
    }

    if (!Array.isArray(content)) {
      messages.push({ role, content: "" });
      continue;
    }

    // Parts array — split text vs image parts.
    const textParts: string[] = [];
    const imageUrls: string[] = [];
    let lastImageScreenTagged = false;
    for (const part of content as unknown[]) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: unknown; text?: unknown; image_url?: { url?: unknown }; source?: unknown };
      if (p.type === "text" && typeof p.text === "string") {
        textParts.push(p.text);
      } else if (p.type === "image_url" && typeof p.image_url?.url === "string") {
        imageUrls.push(p.image_url.url);
        // The client tags LIVE screen frames with `source: "screen_capture"`.
        // Unknown/absent tags are simply ignored — the flag is honored only
        // for the last user message below (never for flattened history).
        if (p.source === "screen_capture") lastImageScreenTagged = true;
      }
    }

    const isLastUser = i === lastUserIdx && imageUrls.length > 0;
    if (isLastUser) {
      if (lastImageScreenTagged) screenCapture = true;
      if (imageUrls.length > MAX_IMAGES_PER_REQUEST) {
        return {
          ok: false,
          failure: {
            status: 400,
            code: "BAD_INPUT",
            en: `Too many images — max ${MAX_IMAGES_PER_REQUEST} per message`,
            ar: `صور كثيرة — الحد الأقصى ${MAX_IMAGES_PER_REQUEST} صورة لكل رسالة`,
          },
        };
      }
      for (const url of imageUrls) {
        if (!IMAGE_DATAURL_RE.test(url) || url.length > MAX_IMAGE_PART_BASE64) {
          return {
            ok: false,
            failure: {
              status: 413,
              code: "TOO_LARGE",
              en: "Attached image is too large or in an unsupported format — try a smaller image",
              ar: "الصورة المرفقة كبيرة جداً أو بصيغة غير مدعومة — جرب صورة أصغر",
            },
          };
        }
      }
      imageCount = imageUrls.length;
      const text = textParts.join(" ").slice(0, MAX_MESSAGE_CHARS);
      totalTextChars += text.length;
      const parts: ContentPart[] = [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ];
      messages.push({ role, content: parts });
    } else {
      // History (or stray) image message — flatten to plain text.
      const text = textParts.join(" ").slice(0, MAX_MESSAGE_CHARS);
      const note = imageUrls.length > 0 ? `${text ? " " : ""}[صورة مرفقة]` : "";
      totalTextChars += text.length + note.length;
      messages.push({ role, content: text + note });
    }
  }

  if (messages.length === 0) {
    return { ok: false, failure: { status: 400, code: "BAD_REQUEST", en: "Messages array is required", ar: "Messages array is required" } };
  }
  return { ok: true, data: { messages, vision: imageCount > 0, imageCount, totalTextChars, screenCapture } };
}
