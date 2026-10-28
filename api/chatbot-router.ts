/**
 * Chatbot API Router
 *
 * Mounts the AI chatbot endpoints:
 *   POST /api/chatbot        — non-streaming response
 *   POST /api/chatbot/stream  — SSE streaming response
 */

import { Hono, type Context } from "hono";
import { getChatResponse, getStreamResponse, type ChatApiMessage, type ContentPart } from "./lib/chatbot.js";
import { getCourseCatalogText } from "./lib/course-catalog.js";
import { sanitizeReplyOutput } from "./lib/chatbot-prompts.js";
import { chatbotError, logSafeError, scrubCredentials, type ChatbotErrorCode } from "./lib/chatbot-errors.js";
import { getClientIpFromHono as getChatbotIp } from "./lib/client-ip";
import { getImageQuotaUsed, incrementImageQuota, DAILY_IMAGE_LIMIT } from "./lib/image-quota.js";
import { persistChatRound, getChatHistory, getLatestSummaryText } from "./lib/chat-history.js";
import { resolveOptionalUser } from "./context.js";
import { logger } from "./lib/logger.js";
// Removed checkRateLimit

const chatbotRouter = new Hono();

/** Unified additive error response: `error` (human text) + `code` + `hint`. */
function errorResponse(
  c: Context,
  code: ChatbotErrorCode,
  opts: { lang?: "ar" | "en"; chatId?: string; message?: string } = {},
): Response {
  const { envelope, http } = chatbotError(code, opts);
  return c.json(envelope, http as 400 | 401 | 413 | 429 | 500 | 503);
}

// ── Simple in-memory rate limiter for chatbot (no auth required) ──
const chatbotRequests = new Map<string, { count: number; resetAt: number }>();
const CHATBOT_RATE_LIMIT = 30; // requests per window per IP (client silent retries included)
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

type NormalizeFailure = { status: 400 | 413; en: string; ar: string; code: ChatbotErrorCode };

function normalizeChatInput(raw: unknown): { ok: true; data: NormalizedChatInput } | { ok: false; failure: NormalizeFailure } {
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
  return { ok: true, data: { messages, vision: imageCount > 0, imageCount, totalTextChars } };
}

/** Bilingual daily-quota notice — a polite apology that states the 5-images-per-day
 * allowance and invites the user to ask anything else (SonarCloud S3358 — no nested ternaries). */
function imageQuotaExceededResponse(used: number): { en: string; ar: string } {
  return {
    en: `I'm really sorry 🙏 only ${DAILY_IMAGE_LIMIT} images per day are available to preserve the analysis quota (you've used ${used}/${DAILY_IMAGE_LIMIT} today) — but I'm fully ready to answer any other inquiry, just type your question!`,
    ar: `أعتذر منك جداً 🙏 المتاح فقط ${DAILY_IMAGE_LIMIT} صور يومياً حفاظاً على كوتة تحليل الصور (استهلكت ${used}/${DAILY_IMAGE_LIMIT} اليوم) — لكنني جاهز تماماً للرد على أي استفسار آخر، اكتب سؤالك وأنا معك!`,
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
    return errorResponse(c, "UNAUTHORIZED");
  }
  try {
    const data = await getChatHistory(user.id);
    return c.json({ success: true, messages: data.messages, summary: data.summary });
  } catch (err) {
    logger.error("[Chatbot] history load failed", { error: logSafeError(err) });
    return errorResponse(c, "INTERNAL");
  }
});

// ── DELETE /api/chatbot/history — user cleared the chat (auth required) ──
chatbotRouter.delete("/history", async (c) => {
  const user = await resolveOptionalUser(c.req.raw);
  if (!user) {
    return errorResponse(c, "UNAUTHORIZED");
  }
  try {
    const { getDb } = await import("./queries/connection.js");
    const { chatMessages } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");
    await getDb().delete(chatMessages).where(eq(chatMessages.userId, user.id));
    return c.json({ success: true });
  } catch (err) {
    logger.error("[Chatbot] history clear failed", { error: logSafeError(err) });
    return errorResponse(c, "INTERNAL");
  }
});

// ── Non-streaming chat endpoint ──
chatbotRouter.post("/", async (c) => {
  try {
    const ip = getChatbotIp(c);
    if (!checkChatbotRateLimit(ip)) {
      return errorResponse(c, "RATE_LIMITED");
    }
    const body = await c.req.json<{ messages: unknown; language?: string; chatId?: string; mode?: "thinking" | "instant" }>();

    const normalized = normalizeChatInput(body.messages);
    if (!normalized.ok) {
      const isAr = resolveChatLanguage(body.language, []) === "ar";
      const f = normalized.failure;
      return errorResponse(c, f.code, { lang: isAr ? "ar" : "en", message: isAr ? f.ar : f.en });
    }
    const { messages, vision, imageCount, totalTextChars } = normalized.data;

    if (totalTextChars > MAX_TOTAL_CHARS) {
      return errorResponse(c, "TOO_LARGE", { message: "Conversation too long. Please start a new chat." });
    }

    // Vision quota — enforced BEFORE dispatch so no provider call is wasted.
    if (vision) {
      const used = await getImageQuotaUsed(ip);
      if (used + imageCount > DAILY_IMAGE_LIMIT) {
        const msg = imageQuotaExceededResponse(used);
        const lang = resolveChatLanguage(body.language, messages);
        return errorResponse(c, "QUOTA_EXCEEDED", { lang: lang === "en" ? "en" : "ar", chatId: body.chatId, message: lang === "ar" ? msg.ar : msg.en });
      }
    }

    // Real course catalog (SWR-cached 10 min, fail-open to "") — lets the bot
    // quote actual course names/levels/prices instead of hallucinating them.
    const catalog = await getCourseCatalogText();

    // ── Chat-history continuity (logged-in users only, fail-open) ──
    const chatUser = await resolveOptionalUser(c.req.raw);
    const historySummary = chatUser ? await getLatestSummaryText(chatUser.id).catch(() => null) : null;

    // Bounded persistence for the fallback path: when every provider is
    // momentarily saturated, wait and re-walk instead of failing fast (the
    // streaming endpoint — the primary path — persists far longer).
    const nonStreamPersistDeadline = Date.now()
      + (Number.isFinite(Number(process.env.CHATBOT_NONSTREAM_PERSIST_MS)) && Number(process.env.CHATBOT_NONSTREAM_PERSIST_MS) > 0
        ? Number(process.env.CHATBOT_NONSTREAM_PERSIST_MS)
        : 30_000);
    const chatRequest = {
      messages,
      language: resolveChatLanguage(body.language, messages),
      mode: body.mode,
      catalog,
      vision,
      historySummary: historySummary ?? undefined,
    };
    let result = await getChatResponse(chatRequest);
    let persistRound = 0;
    while (!result.success && Date.now() < nonStreamPersistDeadline) {
      persistRound += 1;
      await new Promise((r) => setTimeout(r, 4_000));
      // Persistence escalation: rounds ≥ 2 skip the dynamic router and go
      // straight to the legacy backbone (same contract as /stream).
      result = await getChatResponse({ ...chatRequest, preferLegacy: persistRound >= 1 });
    }

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

    // UPSTREAM_EXHAUSTED — the provider walk failed. Agent-Reach rule: the
    // upstream detail must never leak credentials, and the message must never
    // read like a login/permission problem.
    return errorResponse(c, "UPSTREAM_EXHAUSTED", {
      chatId: body.chatId,
      message: scrubCredentials(result.error || "Unknown error"),
    });
  } catch (err) {
    logger.error("[Chatbot] Error in /api/chatbot", { error: logSafeError(err) });
    return errorResponse(c, "INTERNAL");
  }
});

// ── Streaming chat endpoint (SSE) ──
// SSE-FIRST + NEVER-BUSY contract (owner requirement: the user must NEVER
// see a "network busy" error — the bot may keep "thinking" until a model
// answers, without the user ever sensing a failure):
//
//   1. The SSE Response (200 + headers) is returned IMMEDIATELY and the
//      model walk runs INSIDE the stream. No proxy (Cloudflare / HF Spaces)
//      can idle-kill a connection that is already emitting bytes, and the
//      client's typing indicator stays alive from the first millisecond.
//   2. While any walk is in flight, `: ping` keepalives (SSE comments —
//      ignored by every client parser) are emitted every 4s.
//   3. When a full walk fails, the walk is RETRIED in rounds (fresh
//      circuit-breaker state each round) until the mode's persistence
//      deadline — thinking 100s, instant 55s (env-overridable for tests).
//      Only deadline exhaustion emits a soft busy event, which the client
//      answers with its own silent retries — an error UI is a last resort
//      of a last resort.

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

const SSE_PING_INTERVAL_MS = 4_000;
/** Hard cap for the whole request (walk rounds + generation). */
const SSE_ENDPOINT_HARD_CAP_MS = 180_000;

/** How long the endpoint keeps re-walking before it admits failure. */
function streamPersistDeadlineMs(mode: "thinking" | "instant"): number {
  const override = Number(process.env.CHATBOT_STREAM_PERSIST_MS || 0);
  if (Number.isFinite(override) && override > 0) return override;
  return mode === "instant" ? 55_000 : 100_000;
}

function streamRoundGapMs(mode: "thinking" | "instant"): number {
  return mode === "instant" ? 2_000 : 3_000;
}

/** Soft busy copy — reads like a busy assistant, never like a failure. */
function softBusyText(language?: string): string {
  return language === "ar"
    ? "الخدمة تمر بضغط عالٍ في هذه اللحظات — أعد إرسال سؤالك بعد لحظة وسأجيبك فوراً ⚡"
    : "The service is under heavy load right now — please send your question again in a moment and I'll answer right away ⚡";
}

chatbotRouter.post("/stream", async (c) => {
  const ip = getChatbotIp(c);
  if (!checkChatbotRateLimit(ip)) {
    return errorResponse(c, "RATE_LIMITED");
  }
  const body = await c.req.json<{ messages: unknown; language?: string; chatId?: string; mode?: "thinking" | "instant" }>();

  const normalized = normalizeChatInput(body.messages);
  if (!normalized.ok) {
    const isAr = resolveChatLanguage(body.language, []) === "ar";
    const f = normalized.failure;
    return errorResponse(c, f.code, { lang: isAr ? "ar" : "en", chatId: body.chatId, message: isAr ? f.ar : f.en });
  }
  const { messages, vision, imageCount, totalTextChars } = normalized.data;

  if (totalTextChars > MAX_TOTAL_CHARS) {
    return errorResponse(c, "TOO_LARGE", { chatId: body.chatId, message: "Conversation too long. Please start a new chat." });
  }

  // Vision quota — enforced BEFORE dispatch so no provider call is wasted.
  if (vision) {
    const used = await getImageQuotaUsed(ip);
    if (used + imageCount > DAILY_IMAGE_LIMIT) {
      const msg = imageQuotaExceededResponse(used);
      const lang = resolveChatLanguage(body.language, messages);
      return errorResponse(c, "QUOTA_EXCEEDED", { lang: lang === "en" ? "en" : "ar", chatId: body.chatId, message: lang === "ar" ? msg.ar : msg.en });
    }
  }

  const startedAt = Date.now();
  const mode: "thinking" | "instant" = body.mode === "instant" ? "instant" : "thinking";
  const language = resolveChatLanguage(body.language, messages);

  // Real course catalog + chat-history continuity — prepared ONCE here so
  // every persistence round inside the stream reuses them (fail-open).
  const catalog = await getCourseCatalogText();
  const chatUser = await resolveOptionalUser(c.req.raw);
  const historySummary = chatUser ? await getLatestSummaryText(chatUser.id).catch(() => null) : null;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    logger.warn("[Chatbot] Stream hard cap (180s) — aborting");
    timeoutController.abort(new Error("endpoint hard cap"));
  }, SSE_ENDPOINT_HARD_CAP_MS);

  const encoder = new TextEncoder();
  // Persistence escalation: rounds ≥ 2 skip the dynamic router entirely and
  // reach the legacy backbone (Groq/NVIDIA) directly — a storming dynamic
  // pool must never re-burn every round's walk budget.
  const runWalk = (round: number) => getStreamResponse({
    messages,
    language,
    mode,
    catalog,
    vision,
    historySummary: historySummary ?? undefined,
    preferLegacy: round >= 2,
  });

  // Server-side accumulation of the assistant text — the normalized SSE
  // events ("data: {\"text\"}") are parsed so the full reply can be
  // persisted for logged-in users when the stream ends (success OR client
  // disconnect — the user saw whatever accumulated).
  let accumulatedReply = "";
  let sseCarry = "";
  const decoder = new TextDecoder();
  const forwardEncoder = new TextEncoder();
  /**
   * Parse one winner-stream chunk and return the CLIENT-facing bytes.
   * Text events are accumulated AND re-emitted; the winner's own
   * `data: [DONE]` terminator is SWALLOWED — the endpoint owns the only
   * [DONE] the client may ever see, emitted when the whole persistence is
   * finished. (Live-verified root cause: a dud winner that died silently
   * forwarded its internal [DONE] to the client, which read it as
   * "response finished, zero text" and abandoned the connection while the
   * zero-content re-walk was still working for it.)
   * Returns null when the chunk produced nothing client-facing.
   */
  const forwardFromStream = (chunk: Uint8Array): Uint8Array | null => {
    try {
      sseCarry += decoder.decode(chunk, { stream: true });
      const lines = sseCarry.split("\n");
      sseCarry = lines.pop() || ""; // incomplete line waits for the next chunk
      let out = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]") continue;
        try {
          const parsed = JSON.parse(trimmed.slice(6)) as { text?: string; error?: string };
          if (typeof parsed.text === "string") {
            accumulatedReply += parsed.text;
            out += `data: ${JSON.stringify({ text: parsed.text })}\n\n`;
          }
          // parsed.error events are NOT forwarded: the endpoint decides when
          // (and whether) to surface a soft-busy note after its own retries.
        } catch { /* malformed line — skip */ }
      }
      return out ? forwardEncoder.encode(out) : null;
    } catch { /* decode error — skip chunk */ return null; }
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

  type StreamResult = { stream: ReadableStream<Uint8Array>; model: string } | { error: string };

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: Uint8Array): boolean => {
        if (closed) return false;
        try { controller.enqueue(chunk); return true; } catch { closed = true; return false; }
      };
      const finalize = () => {
        clearInterval(ping);
        clearTimeout(timeoutId);
        if (!closed) {
          try { controller.close(); } catch { /* already closed */ }
          closed = true;
        }
      };
      const ping = setInterval(() => {
        safeEnqueue(encoder.encode(": ping\n\n"));
      }, SSE_PING_INTERVAL_MS);

      try {
        // ── Persistent walk — full cascade rounds until the deadline ──
        // A "round" = one getStreamResponse call + pumping its winner stream.
        // Rounds repeat while (a) no stream could be started at all, or
        // (b) a winner passed the liveness peek but delivered ZERO visible
        // content (a dud stream — live-verified on prod: a free-tier model
        // peeked alive then died silently). The user waits behind the calm
        // "thinking" indicator until real text flows or the mode deadline
        // expires — a silent empty reply must NEVER reach the client.
        // Vision requests carry a two-pass pipeline (image read ≤45s worst
        // case + reasoning walk ~22s) whose healthy path completes in
        // ~30-45s and whose worst HEALTHY case is ~70s. An 80s vision
        // deadline (a) covers every healthy path end-to-end and (b) turns
        // the client's silent retry loop around faster when the vision lane
        // is saturated — the user's total worst-case wait drops from
        // ~5min (3 × 100s rounds) to ~4min while healthy answers are
        // never cut mid-walk.
        const deadline = startedAt + (vision ? Math.min(streamPersistDeadlineMs(mode), 80_000) : streamPersistDeadlineMs(mode));
        let served = false;
        let rounds = 0;

        while (!timeoutController.signal.aborted && !served) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          rounds++;
          let timerId: ReturnType<typeof setTimeout> | null = null;
          let onAbort: (() => void) | null = null;
          let result: StreamResult | null = null;
          try {
            result = await Promise.race<StreamResult | null>([
              runWalk(rounds),
              new Promise<null>((resolve) => {
                timerId = setTimeout(() => resolve(null), remaining);
                onAbort = () => resolve(null);
                timeoutController.signal.addEventListener("abort", onAbort, { once: true });
              }),
            ]);
          } finally {
            // Clean up the losing branch of the race (timer + listener) so
            // persistence rounds never leak either.
            if (timerId) clearTimeout(timerId);
            if (onAbort) timeoutController.signal.removeEventListener("abort", onAbort);
          }

          if (!result || "error" in result) {
            result = null;
            if (timeoutController.signal.aborted || Date.now() >= deadline) break;
            logger.warn("[Chatbot] stream walk failed — persisting silently", { mode, round: rounds, elapsedMs: Date.now() - startedAt });
            await new Promise((r) => setTimeout(r, Math.min(streamRoundGapMs(mode), Math.max(0, deadline - Date.now()))));
            continue;
          }

          // ── Winner — model event first, then pump the content stream ──
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ model: result.model })}\n\n`));

          const reader = result.stream.getReader();
          try {
            while (true) {
              if (closed || timeoutController.signal.aborted) break;
              const { done, value } = await reader.read();
              if (done || closed) break;
              if (value) {
                // Re-emit ONLY text events; swallow the winner's internal
                // [DONE] so an early dud termination can never tell the
                // client "finished" while the persistence loop keeps working.
                const clientBytes = forwardFromStream(value);
                if (clientBytes && !safeEnqueue(clientBytes)) break;
              }
            }
          } catch (readErr) {
            logger.warn("[Chatbot] content stream read error", { error: readErr instanceof Error ? readErr.message : String(readErr) });
          } finally {
            try { await reader.cancel(); } catch { /* already dead */ }
          }

          flushAccumulator();
          const reply = accumulatedReply.trim();
          if (reply) {
            served = true;
            // Quota is only consumed by SUCCESSFUL image analysis — a dud
            // stream that delivered nothing must not burn the user's quota.
            if (vision) await incrementImageQuota(ip, imageCount);
            if (chatUser) persistRoundSafe(chatUser.id, messages, vision, reply, result.model, mode);
            break;
          }

          // ZERO-CONTENT winner — passed the liveness peek, delivered nothing.
          // Treated exactly like a failed walk: loop re-enters silently and
          // the next round serves the user (circuit breakers already armed
          // against the dud by the resilient-stream layer).
          logger.warn("[Chatbot] stream winner delivered zero content — re-walking silently", { mode, round: rounds, model: result.model, elapsedMs: Date.now() - startedAt });
          if (timeoutController.signal.aborted || Date.now() >= deadline) break;
          await new Promise((r) => setTimeout(r, Math.min(streamRoundGapMs(mode), Math.max(0, deadline - Date.now()))));
        }

        if (timeoutController.signal.aborted) {
          // Hard cap (or client disconnect — enqueue is a no-op then).
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: softBusyText(language) })}\n\n`));
          safeEnqueue(encoder.encode("data: [DONE]\n\n"));
          finalize();
          return;
        }

        if (!served) {
          // Every round failed within the deadline — one soft busy event.
          // The client retries silently; only a total blackout ever shows it.
          logger.error("[Chatbot] stream persistence exhausted", { mode, rounds, elapsedMs: Date.now() - startedAt });
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: softBusyText(language) })}\n\n`));
          safeEnqueue(encoder.encode("data: [DONE]\n\n"));
          finalize();
          return;
        }

        // Served — the winner's internal [DONE] was swallowed by the
        // forwarder, so the endpoint owns the single client-facing terminator.
        safeEnqueue(encoder.encode("data: [DONE]\n\n"));
        finalize();
      } catch (err) {
        logger.warn("[Chatbot] stream handler error", { error: err instanceof Error ? err.message : String(err) });
        safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: softBusyText(language) })}\n\n`));
        safeEnqueue(encoder.encode("data: [DONE]\n\n"));
        finalize();
      }
    },
    cancel() {
      // Client disconnect — abort the race + timers; dangling walk results
      // are cancelled in the start() body via the aborted branch.
      timeoutController.abort(new Error("client disconnected"));
    },
  });

  return new Response(sse, { status: 200, headers: SSE_HEADERS });
});

export { chatbotRouter };
