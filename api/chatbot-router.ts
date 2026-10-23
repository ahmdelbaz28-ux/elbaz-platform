/**
 * Chatbot API Router
 *
 * Mounts the AI chatbot endpoints:
 *   POST /api/chatbot        — non-streaming response
 *   POST /api/chatbot/stream  — SSE streaming response
 */

import { Hono } from "hono";
import { getChatResponse, getStreamResponse, type ChatApiMessage, type ContentPart } from "./lib/chatbot.js";
import { getCourseCatalogText } from "./lib/course-catalog.js";
import { sanitizeReplyOutput } from "./lib/chatbot-prompts.js";
import { getClientIpFromHono as getChatbotIp } from "./lib/client-ip";
import { getImageQuotaUsed, incrementImageQuota, DAILY_IMAGE_LIMIT } from "./lib/image-quota.js";
import { persistChatRound, getChatHistory, getLatestSummaryText } from "./lib/chat-history.js";
import { resolveOptionalUser } from "./context.js";
import { logger } from "./lib/logger.js";
// Removed checkRateLimit

const chatbotRouter = new Hono();

// ── Simple in-memory rate limiter for chatbot (no auth required) ──
const chatbotRequests = new Map<string, { count: number; resetAt: number }>();
const CHATBOT_RATE_LIMIT = 20; // requests per window per IP
const CHATBOT_WINDOW_MS = 60_000; // 1 minute window

function checkChatbotRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = chatbotRequests.get(ip);
  if (!entry || now > entry.resetAt) {
    chatbotRequests.set(ip, { count: 1, resetAt: now + CHATBOT_WINDOW_MS });
    return true;
  }
  if (entry.count >= CHATBOT_RATE_LIMIT) {
    return false;
  }
  entry.count++;
  return true;
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of chatbotRequests) {
    if (now > entry.resetAt) chatbotRequests.delete(key);
  }
}, 5 * 60_000).unref();

// ── Language mirror: reply in the language of the user's LAST message ──
// The UI language is irrelevant — an Arabic message must get an Arabic reply
// and an English (Latin) message an English one, regardless of site locale.
const ARABIC_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Plain text of a message — string content or the text parts of a parts array. */
function messageText(m: ChatApiMessage): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ");
}

function resolveChatLanguage(
  requested: string | undefined,
  messages: ChatApiMessage[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const text = messageText(m);
    if (!text || !text.trim()) continue;
    return ARABIC_CHAR_RE.test(text) ? "ar" : "en";
  }
  return requested;
}

// ── Multimodal input normalization (vision) ─────────────────────────────
// Security/size rules:
//   • Only data: URLs with an image mime are accepted (no remote URLs — the
//     server must never be tricked into fetching attacker-chosen resources).
//   • Per-image base64 cap + per-request image count cap keep the request
//     far below the shield's 1MB payload guard.
//   • ONLY the LAST user message may carry image parts — anything else is
//     flattened to plain text so text-only providers are never exposed to
//     image parts in history.
const IMAGE_DATAURL_RE = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/;
const MAX_IMAGE_PART_BASE64 = 450_000; // ~337KB binary per image
const MAX_IMAGES_PER_REQUEST = 2;

interface NormalizedChatInput {
  messages: ChatApiMessage[];
  /** Last user message carries image parts — must route to vision models. */
  vision: boolean;
  imageCount: number;
  totalTextChars: number;
}

type NormalizeFailure = { status: 400 | 413; en: string; ar: string };

function normalizeChatInput(raw: unknown): { ok: true; data: NormalizedChatInput } | { ok: false; failure: NormalizeFailure } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, failure: { status: 400, en: "Messages array is required", ar: "Messages array is required" } };
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
    for (const part of content as unknown[]) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: unknown; text?: unknown; image_url?: { url?: unknown } };
      if (p.type === "text" && typeof p.text === "string") {
        textParts.push(p.text);
      } else if (p.type === "image_url" && typeof p.image_url?.url === "string") {
        imageUrls.push(p.image_url.url);
      }
    }

    const isLastUser = i === lastUserIdx && imageUrls.length > 0;
    if (isLastUser) {
      if (imageUrls.length > MAX_IMAGES_PER_REQUEST) {
        return {
          ok: false,
          failure: {
            status: 400,
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
    return { ok: false, failure: { status: 400, en: "Messages array is required", ar: "Messages array is required" } };
  }
  return { ok: true, data: { messages, vision: imageCount > 0, imageCount, totalTextChars } };
}

/** Bilingual daily-quota error (SonarCloud S3358 — no nested ternaries). */
function imageQuotaExceededResponse(used: number): { en: string; ar: string } {
  return {
    en: `You've reached today's image limit (${used}/${DAILY_IMAGE_LIMIT}) — text chat still works, images reset tomorrow 🌅`,
    ar: `وصلت الحد اليومي لإرسال الصور (${used}/${DAILY_IMAGE_LIMIT}) — الشات النصي شغال عادي، والصور بترجع بكرة 🌅`,
  };
}

// ── Shared content caps (module scope — used by normalizeChatInput too) ──
// ✅ SECURITY FIX (audit run-1): cap per-message content (previously a
// single 1MB request could ship ~250k tokens to paid providers).
const MAX_MESSAGE_CHARS = 8_000;
const MAX_TOTAL_CHARS = 60_000;

// ── Chat-history persistence helpers (logged-in users only) ──
// The assistant reply is only persisted on SUCCESS so error banners and
// quota warnings never pollute the restored history.

/** Plain text + vision note for the last user message of a normalized round. */
function lastUserRoundText(messages: ChatApiMessage[], vision: boolean): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    const text = messageText(m).trim();
    if (!text && !vision) continue;
    const note = vision ? (text ? " [صورة مرفقة]" : "[صورة مرفقة]") : "";
    return (text + note).slice(0, MAX_MESSAGE_CHARS);
  }
  return "";
}

function persistRoundSafe(userId: number, messages: ChatApiMessage[], vision: boolean, reply: string, model?: string, mode?: string): void {
  const userText = lastUserRoundText(messages, vision);
  const assistantText = reply.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!userText || !assistantText) return;
  void persistChatRound(userId, { userText, assistantText, model, vision, mode }).catch(() => {
    // persistChatRound already fails open internally — belt and braces.
  });
}

// ── GET /api/chatbot/history — last 50 rounds + rolling summary (auth required) ──
chatbotRouter.get("/history", async (c) => {
  const user = await resolveOptionalUser(c.req.raw);
  if (!user) {
    return c.json({ success: false, error: "UNAUTHORIZED" }, 401);
  }
  try {
    const data = await getChatHistory(user.id);
    return c.json({ success: true, messages: data.messages, summary: data.summary });
  } catch (err) {
    logger.error("[Chatbot] history load failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ success: false, error: "History temporarily unavailable" }, 500);
  }
});

// ── DELETE /api/chatbot/history — user cleared the chat (auth required) ──
chatbotRouter.delete("/history", async (c) => {
  const user = await resolveOptionalUser(c.req.raw);
  if (!user) {
    return c.json({ success: false, error: "UNAUTHORIZED" }, 401);
  }
  try {
    const { getDb } = await import("./queries/connection.js");
    const { chatMessages } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");
    await getDb().delete(chatMessages).where(eq(chatMessages.userId, user.id));
    return c.json({ success: true });
  } catch (err) {
    logger.error("[Chatbot] history clear failed", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ success: false, error: "Could not clear history" }, 500);
  }
});

// ── Non-streaming chat endpoint ──
chatbotRouter.post("/", async (c) => {
  try {
    const ip = getChatbotIp(c);
    if (!checkChatbotRateLimit(ip)) {
      return c.json({ success: false, error: "Rate limit exceeded. Please try again later." }, 429);
    }
    const body = await c.req.json<{ messages: unknown; language?: string; chatId?: string; mode?: "thinking" | "instant" }>();

    const normalized = normalizeChatInput(body.messages);
    if (!normalized.ok) {
      const isAr = resolveChatLanguage(body.language, []) === "ar";
      const f = normalized.failure;
      return c.json({ success: false, error: isAr ? f.ar : f.en }, f.status);
    }
    const { messages, vision, imageCount, totalTextChars } = normalized.data;

    if (totalTextChars > MAX_TOTAL_CHARS) {
      return c.json({ success: false, error: "Conversation too long. Please start a new chat." }, 413);
    }

    // Vision quota — enforced BEFORE dispatch so no provider call is wasted.
    if (vision) {
      const used = await getImageQuotaUsed(ip);
      if (used + imageCount > DAILY_IMAGE_LIMIT) {
        const msg = imageQuotaExceededResponse(used);
        const lang = resolveChatLanguage(body.language, messages);
        return c.json({ success: false, error: lang === "ar" ? msg.ar : msg.en }, 429);
      }
    }

    // Real course catalog (SWR-cached 10 min, fail-open to "") — lets the bot
    // quote actual course names/levels/prices instead of hallucinating them.
    const catalog = await getCourseCatalogText();

    // ── Chat-history continuity (logged-in users only, fail-open) ──
    const chatUser = await resolveOptionalUser(c.req.raw);
    const historySummary = chatUser ? await getLatestSummaryText(chatUser.id).catch(() => null) : null;

    const result = await getChatResponse({
      messages,
      language: resolveChatLanguage(body.language, messages),
      mode: body.mode,
      catalog,
      vision,
      historySummary: historySummary ?? undefined,
    });

    if (result.success) {
      // Quota is only consumed by SUCCESSFUL image analysis.
      if (vision) await incrementImageQuota(ip, imageCount);
      // Persist the round for logged-in users (fails open internally).
      if (chatUser) persistRoundSafe(chatUser.id, messages, vision, result.reply ?? "", result.model, body.mode);
      return c.json({
        success: true,
        reply: sanitizeReplyOutput(result.reply ?? ""),
        model: result.model,
        chatId: body.chatId,
      });
    }

    return c.json({
      success: false,
      error: result.error || "Unknown error",
      chatId: body.chatId,
    }, 503);
  } catch (err) {
    logger.error("[Chatbot] Error in /api/chatbot", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

// ── Streaming chat endpoint (SSE) ──
interface StreamPipeState {
  controllerRef: ReadableStreamDefaultController | null;
  isStreamClosed: boolean;
  timeoutController: AbortController;
  timeoutId: ReturnType<typeof setTimeout>;
}

function closeControllerIfOpen(state: StreamPipeState): void {
  if (state.isStreamClosed) return;
  try {
    state.controllerRef?.close();
  } catch {// Intentionally ignored: best-effort cleanup, the error has already
    // been logged upstream and re-throwing would mask the original cause.
  }
  state.isStreamClosed = true;
}

async function pipeStreamToController( // NOSONAR — complex function, refactoring would risk breaking critical behavior
  stream: ReadableStream<Uint8Array>,
  state: StreamPipeState,
  onChunk?: (chunk: Uint8Array) => void,
  onDone?: () => void,
): Promise<void> {
  try {
    const reader = stream.getReader();
    while (true) {
      if (state.timeoutController.signal.aborted || state.isStreamClosed) break;
      try {
        const { done, value } = await reader.read();
        if (done || state.isStreamClosed) break;
        if (value && !state.isStreamClosed) {
          try {
            onChunk?.(value);
            state.controllerRef?.enqueue(value);
          } catch {
            state.isStreamClosed = true;
            break;
          }
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (readErr: any) {
        if (readErr.name === "AbortError") break;
        logger.warn("[Chatbot] Stream read error", { error: readErr.message });
        break;
      }
    }
    clearTimeout(state.timeoutId);
    closeControllerIfOpen(state);
    onDone?.();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (pipeErr: any) {
    logger.warn("[Chatbot] Stream pipe error", { error: pipeErr.message });
    clearTimeout(state.timeoutId);
    closeControllerIfOpen(state);
    onDone?.();
  }
}

/**
 * Build the combined SSE ReadableStream: emits the model-name event first,
 * then is pumped by pipeStreamToController in the background. Extracted from
 * the /stream handler to keep cognitive complexity manageable.
 */
function createCombinedStream(modelEvent: Uint8Array, state: StreamPipeState): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      state.controllerRef = controller;
      // Send model name first so client can show "Thinking with [model]..."
      try {
        controller.enqueue(modelEvent);
      } catch {
        state.isStreamClosed = true;
      }
    },
    cancel() {
      // Handle client disconnect
      state.isStreamClosed = true;
      clearTimeout(state.timeoutId);
      try { state.timeoutController.abort(); } catch {
        // Intentionally ignored: best-effort cleanup, the error has already
        // been logged upstream and re-throwing would mask the original cause.
      }
    },
  });
}

chatbotRouter.post("/stream", async (c) => {
  // Cascade may reach NVIDIA MiniMax-M3 (reasoning model) — needs 60-120s
  // 180s timeout: 2 minutes for reasoning models
  const timeoutMs = 180_000; // 3 minutes - give reasoning models time to think
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    logger.warn("[Chatbot] Stream timeout (180s) - aborting request");
    timeoutController.abort();
  }, timeoutMs);

  try {
    const ip = getChatbotIp(c);
    if (!checkChatbotRateLimit(ip)) {
      clearTimeout(timeoutId);
      return c.json({ success: false, error: "Rate limit exceeded. Please try again later." }, 429);
    }
    const body = await c.req.json<{ messages: unknown; language?: string; chatId?: string; mode?: "thinking" | "instant" }>();

    const normalized = normalizeChatInput(body.messages);
    if (!normalized.ok) {
      clearTimeout(timeoutId);
      const isAr = resolveChatLanguage(body.language, []) === "ar";
      const f = normalized.failure;
      return c.json({ success: false, error: isAr ? f.ar : f.en, chatId: body.chatId }, f.status);
    }
    const { messages, vision, imageCount, totalTextChars } = normalized.data;

    if (totalTextChars > MAX_TOTAL_CHARS) {
      clearTimeout(timeoutId);
      return c.json({ success: false, error: "Conversation too long. Please start a new chat.", chatId: body.chatId }, 413);
    }

    // Vision quota — enforced BEFORE dispatch so no provider call is wasted.
    if (vision) {
      const used = await getImageQuotaUsed(ip);
      if (used + imageCount > DAILY_IMAGE_LIMIT) {
        clearTimeout(timeoutId);
        const msg = imageQuotaExceededResponse(used);
        const lang = resolveChatLanguage(body.language, messages);
        return c.json({ success: false, error: lang === "ar" ? msg.ar : msg.en, chatId: body.chatId }, 429);
      }
    }

    // Real course catalog (same as non-streaming path) — fetched once here so
    // the streamed system prompt carries the live course data.
    const catalog = await getCourseCatalogText();

    // ── Chat-history continuity (logged-in users only, fail-open) ──
    const chatUser = await resolveOptionalUser(c.req.raw);
    const historySummary = chatUser ? await getLatestSummaryText(chatUser.id).catch(() => null) : null;

    // Create promise that rejects on timeout
    const streamPromise = getStreamResponse({
      messages,
      language: resolveChatLanguage(body.language, messages),
      mode: body.mode,
      catalog,
      vision,
      historySummary: historySummary ?? undefined,
    });

    // Race between stream response and timeout
    type StreamResult = { stream: ReadableStream<Uint8Array>; model: string } | { error: string };
    let result: StreamResult;
    try {
      result = await Promise.race<StreamResult>([
        streamPromise,
        new Promise<never>((_, reject) => {
          timeoutController.signal.addEventListener("abort", () => {
            reject(new Error("AI response timeout (180s)"));
          });
        }),
      ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (raceErr: any) {
      clearTimeout(timeoutId);
      logger.warn("[Chatbot] Stream race failed", { error: raceErr.message });
      return c.json({ success: false, error: "Request timeout. The assistant is thinking, please try again.", chatId: body.chatId }, 504);
    }

    if ("error" in result) {
      clearTimeout(timeoutId);
      return c.json({ success: false, error: result.error, chatId: body.chatId }, 503);
    }

    // Quota is only consumed by SUCCESSFUL image analysis (a provider was
    // actually reached and accepted the request).
    if (vision) {
      await incrementImageQuota(ip, imageCount);
    }

    // Send model name as first SSE event, then pipe the actual stream
    const encoder = new TextEncoder();
    const modelEvent = encoder.encode(`data: ${JSON.stringify({ model: result.model })}\n\n`);

    // Create a combined stream: model event FIRST, then actual content stream
    const state: StreamPipeState = {
      controllerRef: null,
      isStreamClosed: false,
      timeoutController,
      timeoutId,
    };

    const combinedStream = createCombinedStream(modelEvent, state);

    // Server-side accumulation of the assistant text — the normalized SSE
    // events ("data: {\"text\"}") are parsed so the full reply can be
    // persisted for logged-in users when the stream ends (success OR client
    // disconnect — the user saw whatever accumulated).
    let accumulatedReply = "";
    let sseCarry = "";
    const accumulateFromStream = (chunk: Uint8Array) => {
      try {
        sseCarry += new TextDecoder().decode(chunk, { stream: true });
        const lines = sseCarry.split("\n");
        sseCarry = lines.pop() || ""; // incomplete line waits for the next chunk
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]") continue;
          try {
            const parsed = JSON.parse(trimmed.slice(6)) as { text?: string };
            if (typeof parsed.text === "string") accumulatedReply += parsed.text;
          } catch { /* malformed line — skip */ }
        }
      } catch { /* decode error — skip chunk */ }
    };
    const flushAccumulator = () => {
      const rest = sseCarry.trim();
      sseCarry = "";
      if (rest.startsWith("data: ") && rest !== "data: [DONE]") {
        try {
          const parsed = JSON.parse(rest.slice(6)) as { text?: string };
          if (typeof parsed.text === "string") accumulatedReply += parsed.text;
        } catch { /* incomplete trailing event — drop */ }
      }
    };

    // Pipe the actual content stream in background (non-blocking).
    // .catch: belt-and-braces — the piper handles its own errors internally,
    // but an unhandled rejection here would crash the Node process (S9383).
    void pipeStreamToController(result.stream, state, accumulateFromStream, () => {
      flushAccumulator();
      const reply = accumulatedReply.trim();
      if (chatUser && reply) {
        persistRoundSafe(chatUser.id, messages, vision, reply, result.model, body.mode);
      }
    }).catch(() => {
      // Intentionally ignored: stream piper already finalizes `state` on error.
    });

    return new Response(combinedStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error("[Chatbot] Error in /api/chatbot/stream", { error: err instanceof Error ? err.message : String(err) });
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

export { chatbotRouter };
