/**
 * Chatbot API Router
 *
 * Mounts the AI chatbot endpoints:
 *   POST /api/chatbot        — non-streaming response
 *   POST /api/chatbot/stream  — SSE streaming response
 */

import { Hono } from "hono";
import { getChatResponse, getStreamResponse } from "./lib/chatbot.js";
import { describeImage } from "./lib/chatbot-vision.js";
import { getClientIpFromHono as getChatbotIp } from "./lib/client-ip";
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

function resolveChatLanguage(
  requested: string | undefined,
  messages: { role: string; content: string }[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    if (!m.content || !m.content.trim()) continue;
    return ARABIC_CHAR_RE.test(m.content) ? "ar" : "en";
  }
  return requested;
}

// ── IMAGE ATTACHMENT: validation + vision-first integration ──
// Product policy: a vision model READS the image first (factual extraction),
// then the normal reasoning-first cascade answers from that description.
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/;
const MAX_IMAGE_CHARS = 5_000_000; // ~3.7MB binary after base64

type ChatMessage = { role: string; content: string };

/** Return the image data URL if valid, else null (never throws, never blocks). */
function sanitizeImage(image: unknown): string | null {
  if (typeof image !== "string" || image.length === 0) return null;
  if (image.length > MAX_IMAGE_CHARS) {
    logger.warn("[Chatbot] image rejected: too large", { chars: image.length });
    return null;
  }
  if (!IMAGE_DATA_URL_RE.test(image)) {
    logger.warn("[Chatbot] image rejected: not a valid base64 image data URL");
    return null;
  }
  return image;
}

/**
 * Vision-first pass: read the image, then inject its factual description
 * into the LAST user message so the reasoning cascade "sees" the image
 * through text. Fail-open: if vision fails entirely, an explicit note is
 * injected so the model NEVER pretends to have seen the image.
 * Returns the vision model label (for diagnostics) when the read succeeded.
 */
async function applyVisionPass(
  messages: ChatMessage[],
  imageDataUrl: string,
  language?: string,
): Promise<string | undefined> {
  let lastUser: ChatMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUser = messages[i]; break; }
  }
  if (!lastUser) return undefined;

  const userText = lastUser.content.trim();
  try {
    const vision = await describeImage(imageDataUrl, userText, language);
    if (vision.ok && vision.description) {
      const header = language === "ar"
        ? "صورة مرفقة من المستخدم — تحليل الصورة الآلي (اقرأه بدقة وعامِل على أساسه فقط):"
        : "Image attached by the user — automated image analysis (read it carefully and rely ONLY on it):";
      const augmented = `[${header}\n${vision.description}\n]\n\n${userText}`.trim();
      lastUser.content = augmented;
      return vision.visionModel;
    }
    // Vision failed — the model must NEVER pretend it saw the image.
    const note = language === "ar"
      ? "[ملاحظة داخلية: تعذّر قراءة الصورة المرفقة تقنياً. لا تدّعِ أبداً أنك رأيت الصورة ولا تخمّن محتواها. اعتذر بلطف للمستخدم عن تعذّر قراءة الصورة واطلب منه إعادة إرسالها أو وصف سؤاله نصياً، ثم أجب عن أي نص مكتوب إن وُجد.]"
      : "[Internal note: the attached image could not be read. NEVER claim you saw the image or guess its content. Politely apologize that the image could not be read and ask the user to re-send it or describe the question in text, then answer any written text if present.]";
    lastUser.content = `${note}\n\n${userText}`.trim();
    return undefined;
  } catch (visionErr) {
    // Belt-and-braces: describeImage never throws, but a surprise here must
    // still not take the whole chat request down.
    logger.warn("[Chatbot] vision pass threw — continuing text-only", { error: String(visionErr) });
    return undefined;
  }
}

// ── Non-streaming chat endpoint ──
chatbotRouter.post("/", async (c) => {
  try {
    const ip = getChatbotIp(c);
    if (!checkChatbotRateLimit(ip)) {
      return c.json({ success: false, error: "Rate limit exceeded. Please try again later." }, 429);
    }
    const body = await c.req.json<{ messages: { role: string; content: string }[]; language?: string; chatId?: string; mode?: "thinking" | "instant"; image?: string }>();

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ success: false, error: "Messages array is required" }, 400);
    }

    // Limit message count to prevent abuse
    // ✅ SECURITY FIX (audit run-1): cap per-message content (previously a
    // single 1MB request could ship ~250k tokens to paid providers).
    const MAX_MESSAGE_CHARS = 8_000;
    const MAX_TOTAL_CHARS = 60_000;
    const messages = body.messages
      .slice(-50)
      .map((m) => ({ role: String(m?.role ?? "user"), content: String(m?.content ?? "").slice(0, MAX_MESSAGE_CHARS) }));
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      return c.json({ success: false, error: "Conversation too long. Please start a new chat." }, 413);
    }

    // VISION-FIRST: a vision model reads any attached image before the
    // reasoning cascade runs (product policy — never answer blind).
    const image = sanitizeImage(body.image);
    const visionModel = image
      ? await applyVisionPass(messages, image, resolveChatLanguage(body.language, messages))
      : undefined;

    const result = await getChatResponse({
      messages,
      language: resolveChatLanguage(body.language, messages),
      mode: body.mode,
    });

    if (result.success) {
      return c.json({
        success: true,
        reply: result.reply,
        model: result.model,
        visionModel,
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (pipeErr: any) {
    logger.warn("[Chatbot] Stream pipe error", { error: pipeErr.message });
    clearTimeout(state.timeoutId);
    closeControllerIfOpen(state);
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
    const body = await c.req.json<{ messages: { role: string; content: string }[]; language?: string; chatId?: string; mode?: "thinking" | "instant"; image?: string }>();

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      clearTimeout(timeoutId);
      return c.json({ success: false, error: "Messages array is required" }, 400);
    }

    // ✅ SECURITY FIX (audit run-1): per-message + total content caps (stream path).
    const MAX_MESSAGE_CHARS = 8_000;
    const MAX_TOTAL_CHARS = 60_000;
    const messages = body.messages
      .slice(-50)
      .map((m) => ({ role: String(m?.role ?? "user"), content: String(m?.content ?? "").slice(0, MAX_MESSAGE_CHARS) }));
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars > MAX_TOTAL_CHARS) {
      clearTimeout(timeoutId);
      return c.json({ success: false, error: "Conversation too long. Please start a new chat." }, 413);
    }

    // VISION-FIRST (stream path — same policy as the non-streaming endpoint).
    const image = sanitizeImage(body.image);
    if (image) {
      await applyVisionPass(messages, image, resolveChatLanguage(body.language, messages));
    }

    // Create promise that rejects on timeout
    const streamPromise = getStreamResponse({
      messages,
      language: resolveChatLanguage(body.language, messages),
      mode: body.mode,
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

    // Pipe the actual content stream in background (non-blocking).
    // .catch: belt-and-braces — the piper handles its own errors internally,
    // but an unhandled rejection here would crash the Node process (S9383).
    pipeStreamToController(result.stream, state).catch(() => {
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
