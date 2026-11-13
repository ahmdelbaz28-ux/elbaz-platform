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

// ── ✅ TOKEN OPTIMIZATION (v3.6.0) — SLIDING-WINDOW HISTORY TRIM ──
// The client ships its last 20 messages VERBATIM; assistant replies on this
// platform reach 8k chars each, so a 10-round conversation could carry
// ~30-60k chars (~8-15k prompt tokens) of mostly-stale assistant prose —
// re-billed on EVERY send and on EVERY cascade attempt. The trim keeps the
// IMMEDIATE context verbatim (the last 2 assistant turns + the current
// question) and clips OLDER turns to short excerpts; long-range continuity
// is already covered by the rolling summary (chat-history.ts).
// Quality contract: the last 2 assistant answers (the direct conversational
// thread) and every user question are NEVER clipped below their normal caps
// — older assistant text is context, not commitments.
export const TRIM_RECENT_ASSISTANT_FULL = 2;
export const TRIMMED_ASSISTANT_CHARS = 600;
export const TRIMMED_USER_CHARS = 800;
const ASSISTANT_CLIP_MARK = "… [رد سابق مختصر]";
const USER_CLIP_MARK = "… [رسالة سابقة مختصرة]";

/**
 * Clip OLD conversation turns to short excerpts, newest-first exemption:
 *   • the last 2 assistant messages stay full;
 *   • the LAST user message stays full (the current question);
 *   • older user messages clip to TRIMMED_USER_CHARS;
 *   • older assistant messages clip to TRIMMED_ASSISTANT_CHARS.
 * Pure, delta-free — operates on already-normalized messages; image parts
 * (last user message only) pass through untouched.
 */
export function trimHistoryForContext(messages: ChatApiMessage[]): ChatApiMessage[] {
  const lastAssistantIdx: number[] = [];
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") return i;
    }
    return -1;
  })();
  for (let i = messages.length - 1; i >= 0 && lastAssistantIdx.length < TRIM_RECENT_ASSISTANT_FULL; i--) {
    if (messages[i]?.role === "assistant") lastAssistantIdx.push(i);
  }
  const fullAssistant = new Set(lastAssistantIdx);

  const clipText = (text: string, cap: number, mark: string): string =>
    text.length > cap ? `${text.slice(0, cap).trimEnd()}${mark}` : text;

  return messages.map((m, i) => {
    if (typeof m.content !== "string") return m; // image parts: last user message only — never touched
    if (m.role === "assistant") {
      if (fullAssistant.has(i)) return m;
      return { ...m, content: clipText(m.content, TRIMMED_ASSISTANT_CHARS, ASSISTANT_CLIP_MARK) };
    }
    // user: only the LAST user message keeps full text
    if (i === lastUserIdx) return m;
    return { ...m, content: clipText(m.content, TRIMMED_USER_CHARS, USER_CLIP_MARK) };
  });
}

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
  let screenCapture = false;

  for (let i = 0; i < sliced.length; i++) {
    const m = sliced[i] as { role?: unknown; content?: unknown } | null;
    if (!m || typeof m !== "object") continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = m.content;

    if (typeof content === "string") {
      const clipped = content.slice(0, MAX_MESSAGE_CHARS);
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
      const parts: ContentPart[] = [
        ...(text ? [{ type: "text" as const, text }] : []),
        ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ];
      messages.push({ role, content: parts });
    } else {
      // History (or stray) image message — flatten to plain text.
      const text = textParts.join(" ").slice(0, MAX_MESSAGE_CHARS);
      const note = imageUrls.length > 0 ? `${text ? " " : ""}[صورة مرفقة]` : "";
      messages.push({ role, content: text + note });
    }
  }

  if (messages.length === 0) {
    return { ok: false, failure: { status: 400, code: "BAD_REQUEST", en: "Messages array is required", ar: "Messages array is required" } };
  }
  // ✅ TOKEN OPTIMIZATION (v3.6.0): clip OLD turns before the blank check —
  // clipping never changes emptiness (empty clip = empty) so the ROOT-CURE
  // blank-conversation guard below keeps its exact semantics.
  const trimmedMessages = trimHistoryForContext(messages);
  // ✅ ROOT-CURE (2026-11-13, blank conversation burned a provider call): a
  // request whose every message is empty text (and no images) used to pass
  // normalization and DISPATCH a real provider call with nothing to answer —
  // a wasted call + a confusing 503 for a client bug. The direct-API caller
  // now gets the clean 400 it always deserved. (A blank message WITH an
  // attached image stays valid — image-only questions are a product flow.)
  const conversationBlank = imageCount === 0 && messages.every((m) => {
    const t = typeof m.content === "string" ? m.content : "";
    return t.trim().length === 0;
  });
  if (conversationBlank) {
    return {
      ok: false,
      failure: {
        status: 400,
        code: "BAD_REQUEST",
        en: "Message text is empty — write your question and send it again",
        ar: "نص الرسالة فارغ — اكتب سؤالك وأعد الإرسال",
      },
    };
  }
  const totalTrimmedChars = trimmedMessages.reduce((sum, m) => {
    if (typeof m.content === "string") return sum + m.content.length;
    if (Array.isArray(m.content)) {
      return sum + m.content.reduce((s, p) => s + (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? ((p as { text: string }).text.length) : 0), 0);
    }
    return sum;
  }, 0);
  return { ok: true, data: { messages: trimmedMessages, vision: imageCount > 0, imageCount, totalTextChars: totalTrimmedChars, screenCapture } };
}
