/**
 * Chatbot API Router
 *
 * Mounts the AI chatbot endpoints:
 *   POST /api/chatbot        — non-streaming response
 *   POST /api/chatbot/stream  — SSE streaming response
 */

import crypto from "node:crypto";
import { type Context, Hono } from "hono";
import { chatbotFeedbackRoute } from "./chatbot-feedback-route.js";
import { resolveOptionalUser } from "./context.js";
import { clearChatHistory, getChatHistory, getLatestSummaryText, persistChatRound } from "./lib/chat-history.js";
import { type ChatApiMessage, type ContentPart, getChatResponse, getStreamResponse } from "./lib/chatbot.js";
import { getUserByokConfig } from "./lib/chatbot-byok.js";
import { enforceCablesCitations, hasCablesIntent } from "./lib/chatbot-cables.js";
import { type ChatbotErrorCode, chatbotError, logSafeError, scrubCredentials } from "./lib/chatbot-errors.js";
import { courseIntentFromMessages } from "./lib/chatbot-intent.js";
// ✅ Extracted (2026-11): input normalization lives in api/lib/chatbot-normalize.js —
// pure + unit-testable without the router's import graph (no Hono, no DB).
import { ARABIC_CHAR_RE, MAX_MESSAGE_CHARS, MAX_TOTAL_CHARS, normalizeChatInput } from "./lib/chatbot-normalize.js";
import { containsPromptLeak, promptLeakRefusal } from "./lib/chatbot-prompts.js";
import { enforceRefsCitations } from "./lib/chatbot-refs.js";
// ✅ v1.1.2: deterministic citation compliance — the stream terminator seam
// appends the pinned problem's citation when the model omitted it.
import { enforcePinnedCitation } from "./lib/chatbot-saadat.js";
import { parseScreenContext } from "./lib/chatbot-screen.js";
import { extractRoutingSignal } from "./lib/chatbot-skillnet.js";
import { getClientIpFromHono as getChatbotIp } from "./lib/client-ip";
import { getCourseCatalogLiteText, getCourseCatalogText } from "./lib/course-catalog.js";
import { finalizeReply, opaqueModelKey } from "./lib/finalize-reply.js";
import {
  DAILY_IMAGE_LIMIT,
  DAILY_SCREEN_FRAME_LIMIT,
  refundImageQuota,
  tryConsumeImageQuota,
  visionQuotaLane,
} from "./lib/image-quota.js";
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
// ✅ SECURITY FIX (pre-launch audit run-2, chatbot.map-bounds): spoofable
// x-forwarded-for values used to grow this map without bound (time-only
// cleanup). Same MAX_SIZE pattern as the shield's rateLimitMap.
const CHATBOT_MAP_MAX_SIZE = 5000;

function checkChatbotRateLimit(key: string, ratePerMinute = CHATBOT_RATE_LIMIT): boolean {
  const now = Date.now();
  if (chatbotRequests.size >= CHATBOT_MAP_MAX_SIZE) cleanupChatbotMap(now);
  const entry = chatbotRequests.get(key);
  if (!entry || now > entry.resetAt) {
    chatbotRequests.set(key, { count: 1, resetAt: now + CHATBOT_WINDOW_MS });
    return true;
  }
  if (entry.count >= ratePerMinute) {
    return false;
  }
  entry.count++;
  return true;
}

function cleanupChatbotMap(now: number): void {
  for (const [key, entry] of chatbotRequests) {
    if (now > entry.resetAt) chatbotRequests.delete(key);
  }
}

// Periodic cleanup
setInterval(() => {
  cleanupChatbotMap(Date.now());
}, 5 * 60_000).unref();

// ── Daily message quota (pre-launch audit run-2, chatbot.daily-quota) ──
// Before this, the ONLY brake on the unauthenticated-by-design chat API was
// 30 req/min/IP — a single scripted IP could burn the shared free-tier
// provider allowance (and, if a paid key is ever configured, real money)
// in minutes, degrading the bot for everyone. Two UTC-day buckets now gate
// every chat request BEFORE dispatch:
//   • per-IP  60/day — the abuse brake (covers anonymous direct-API callers)
//   • per-user 200/day — generous headroom for real, logged-in students
// In-memory is deliberate (single HF pod; a restart merely resets a soft
// daily cap — the provider breakers remain the hard line).
const CHATBOT_DAILY_IP_LIMIT = 60;
const CHATBOT_DAILY_USER_LIMIT = 200;
// ✅ ROOT-CURE (2026-11-13, Telegram bot starved by the IP quota): the
// Telegram worker (scripts/telegram-worker-job.ts on GitHub Actions) calls
// this PUBLIC endpoint unauthenticated, so every Telegram DM user shared the
// runner's single IP — the whole Telegram user base got ONE 60/day bucket
// (and one 30/min window). Once it filled, every Telegram user saw the
// "daily limit" refusal while the site kept working. The worker now proves
// its identity with a derived HMAC of the SAME SYNC_INGEST_SECRET already
// provisioned on both sides (Space secret + Actions secret — zero new
// secrets), and authenticated bot traffic gets its own generous lane:
//   • 600/day — mirrors the Telegram-side GLOBAL_DAILY_CAP in telegram-bot.ts
//   • 60/min  — the Telegram worker itself already enforces 20/h/user
// Fail-closed: unset/short secret → the header is never valid → behavior is
// byte-identical to before for everyone else.
const CHATBOT_BOT_DAILY_LIMIT = 600;
const CHATBOT_BOT_RATE_LIMIT = 60; // req/min for the authenticated bot lane
const BOT_WORKER_CONTEXT = "bot-worker-v1";
const CHATBOT_DAILY_MAP_MAX = 20_000;
const chatbotDailyUsage = new Map<string, { day: string; count: number }>();

/**
 * True when the request carries a valid bot-worker auth header
 * (`x-bot-worker-auth: hex(HMAC-SHA256(SYNC_INGEST_SECRET, "bot-worker-v1"))`).
 * Timing-safe, fail-closed, and never logs the header value.
 */
function isBotWorkerRequest(c: Context): boolean {
  const secret = (process.env.SYNC_INGEST_SECRET ?? "").trim();
  if (secret.length < 16) return false;
  const provided = (c.req.header("x-bot-worker-auth") ?? "").trim().toLowerCase();
  if (!provided) return false;
  const expected = crypto.createHmac("sha256", secret).update(BOT_WORKER_CONTEXT).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Rate-limit key + budget for one request, honoring the bot-worker lane. */
function chatbotLaneFor(c: Context, ip: string): { key: string; ratePerMinute: number; dailyLimit: number } {
  if (isBotWorkerRequest(c)) {
    return { key: "bot-worker", ratePerMinute: CHATBOT_BOT_RATE_LIMIT, dailyLimit: CHATBOT_BOT_DAILY_LIMIT };
  }
  return { key: `ip:${ip}`, ratePerMinute: CHATBOT_RATE_LIMIT, dailyLimit: CHATBOT_DAILY_IP_LIMIT };
}

function chatbotDayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function bumpAndCheckChatbotDaily(key: string, limit: number): boolean {
  const day = chatbotDayUtc();
  const entry = chatbotDailyUsage.get(key);
  if (!entry || entry.day !== day) {
    if (chatbotDailyUsage.size >= CHATBOT_DAILY_MAP_MAX) {
      for (const [k, v] of chatbotDailyUsage) {
        if (v.day !== day) chatbotDailyUsage.delete(k);
      }
      // Absolute fallback: evict the oldest inserted key (Map order = insertion).
      if (chatbotDailyUsage.size >= CHATBOT_DAILY_MAP_MAX) {
        const oldest = chatbotDailyUsage.keys().next().value;
        if (oldest !== undefined) chatbotDailyUsage.delete(oldest);
      }
    }
    chatbotDailyUsage.set(key, { day, count: 1 });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

function chatbotDailyQuotaMessage(limit: number, lang: "ar" | "en"): string {
  return lang === "ar"
    ? `وصلت الحد اليومي للمحادثة (${limit} رسالة). يتجدد الرصيد كل يوم — يرجى المحاولة غداً.`
    : `You've reached today's chat limit (${limit} messages). Your allowance resets daily — please try again tomorrow.`;
}

setInterval(() => {
  const day = chatbotDayUtc();
  for (const [key, entry] of chatbotDailyUsage) {
    if (entry.day !== day) chatbotDailyUsage.delete(key);
  }
}, 30 * 60_000).unref();

// ── Language mirror: reply in the language of the user's LAST message ──
// The UI language is irrelevant — an Arabic message must get an Arabic reply
// and an English (Latin) message an English one, regardless of site locale.
// ✅ ANTI-KOSHARY AUDIT FIX (F4): ARABIC_CHAR_RE now lives in
// chatbot-normalize.js (one shared copy with telegram-bot) instead of a third
// hand-kept duplicate.

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

/** Bilingual daily-quota notice — a polite apology that states the 5-images-per-day
 * allowance and invites the user to ask anything else (SonarCloud S3358 — no nested ternaries). */
function imageQuotaExceededResponse(used: number): { en: string; ar: string } {
  return {
    en: `I'm really sorry 🙏 only ${DAILY_IMAGE_LIMIT} images per day are available to preserve the analysis quota (you've used ${used}/${DAILY_IMAGE_LIMIT} today) — but I'm fully ready to answer any other inquiry, just type your question!`,
    ar: `أعتذر منك جداً 🙏 المتاح فقط ${DAILY_IMAGE_LIMIT} صور يومياً حفاظاً على كوتة تحليل الصور (استهلكت ${used}/${DAILY_IMAGE_LIMIT} اليوم) — لكنني جاهز تماماً للرد على أي استفسار آخر، اكتب سؤالك وأنا معك!`,
  };
}

/** ✅ ROOT-CURE (2026-11-13): bilingual notice for the LIVE SCREEN lane —
 * the screen-teacher frames ride their own 60/day bucket, so this message
 * names frames (not "صور") and reminds the user the allowance renews daily. */
function screenQuotaExceededResponse(used: number): { en: string; ar: string } {
  return {
    en: `I'm really sorry 🙏 only ${DAILY_SCREEN_FRAME_LIMIT} live screen frames per day are available to preserve the live-reading quota (you've used ${used}/${DAILY_SCREEN_FRAME_LIMIT} today) — it renews tomorrow, and meanwhile I'm fully ready to answer any text question!`,
    ar: `أعتذر منك جداً 🙏 المتاح فقط ${DAILY_SCREEN_FRAME_LIMIT} لقطة شاشة حية يومياً حفاظاً على كوتة القراءة الحية (استهلكت ${used}/${DAILY_SCREEN_FRAME_LIMIT} اليوم) — تتجدد غداً، وحتى ذلك الحين أنا جاهز تماماً للرد على أي سؤال نصي!`,
  };
}

// ── Shared request preflight (anti-koshary audit fix) ──
// POST / and POST /stream previously carried two hand-kept copies of the same
// ~60-line admission sequence (rate limit → JSON parse → normalize → size
// guard → daily IP quota → vision quota → user resolution → catalog → daily
// user quota). The copies had ALREADY drifted: the non-stream normalize /
// TOO_LARGE errors omitted `chatId` while the stream included it, and the two
// endpoints disagreed on whether malformed JSON consumes the per-minute rate
// bucket (stream: yes, non-stream: no). One helper now owns the sequence and
// both endpoints receive the same prepared context. Unified-contract notes:
//   • error responses carry `chatId` consistently on BOTH endpoints;
//   • malformed JSON on POST / now consumes the rate bucket like every other
//     request — matches the stream contract, strictly more protective.
type ChatPreflightBody = {
  messages: unknown;
  language?: string;
  chatId?: string;
  mode?: "thinking" | "instant";
  pageContext?: unknown;
};

type ChatPreflight =
  | { error: Response }
  | {
      body: ChatPreflightBody;
      messages: ChatApiMessage[];
      vision: boolean;
      imageCount: number;
      screenCapture: boolean;
      quotaLane: ReturnType<typeof visionQuotaLane>;
      /** ✅ SECURITY FIX (audit run-1): true when the atomic vision reservation succeeded and is still held. */
      visionReserved: boolean;
      dailyLang: "ar" | "en";
      language: string | undefined;
      courseIntent: boolean;
      catalog: string;
      chatUser: Awaited<ReturnType<typeof resolveOptionalUser>>;
      historySummary: string | null;
    };

async function chatRequestPreflight(c: Context): Promise<ChatPreflight> {
  const ip = getChatbotIp(c);
  const lane = chatbotLaneFor(c, ip);
  if (!checkChatbotRateLimit(lane.key, lane.ratePerMinute)) {
    return { error: errorResponse(c, "RATE_LIMITED") };
  }

  // Malformed JSON is a client bug: answer 400 with a stable shape before any
  // other work (the root-cure both endpoints originally grew separately).
  let body: ChatPreflightBody;
  try {
    body = await c.req.json<ChatPreflightBody>();
  } catch {
    return { error: c.json({ error: "INVALID_JSON", message: "Request body must be valid JSON." }, 400) };
  }

  const normalized = normalizeChatInput(body.messages);
  if (!normalized.ok) {
    const isAr = resolveChatLanguage(body.language, []) === "ar";
    const f = normalized.failure;
    return { error: errorResponse(c, f.code, { lang: isAr ? "ar" : "en", chatId: body.chatId, message: isAr ? f.ar : f.en }) };
  }
  const { messages, vision, imageCount, totalTextChars, screenCapture } = normalized.data;

  if (totalTextChars > MAX_TOTAL_CHARS) {
    const tooLongAr = resolveChatLanguage(body.language, messages) === "ar";
    return { error: errorResponse(c, "TOO_LARGE", {
      chatId: body.chatId,
      lang: tooLongAr ? "ar" : "en",
      message: tooLongAr
        ? "المحادثة أصبحت طويلة جداً — ابدأ محادثة جديدة من فضلك."
        : "Conversation too long. Please start a new chat.",
    }) };
  }

  // ✅ SECURITY FIX (pre-launch audit run-2): daily per-IP message quota —
  // the abuse brake for anonymous direct-API callers. Authenticated
  // bot-worker traffic rides its own lane (no IP sharing).
  const dailyLang = resolveChatLanguage(body.language, messages) === "ar" ? "ar" : "en";
  if (!bumpAndCheckChatbotDaily(lane.key, lane.dailyLimit)) {
    return { error: errorResponse(c, "RATE_LIMITED", { lang: dailyLang, chatId: body.chatId, message: chatbotDailyQuotaMessage(lane.dailyLimit, dailyLang) }) };
  }

  // ✅ OWNER DIRECTIVE (2026-11-25, "الشات بوت أو أي حاجة في المنصة ما يتمش
  // تشغيلها إلا لمسجل دخول"): the chatbot REST surface was INTENTIONALLY
  // anonymous — the UI already redirected guests, but direct API callers
  // could burn provider quota with no account at all. The whole admission
  // sequence now requires a session: the identity resolves FIRST (cached,
  // shared with every other route through the same pipeline) and a guest is
  // answered with the stable 401 AUTH copy BEFORE anything else runs — no
  // provider call, no quota burn, no history read, no BYOK resolution.
  const chatUser = await resolveOptionalUser(c.req.raw);
  if (!chatUser) {
    return { error: errorResponse(c, "UNAUTHORIZED", { lang: dailyLang, chatId: body.chatId }) };
  }

  // Vision quota — enforced BEFORE dispatch so no provider call is wasted.
  // ✅ ROOT-CURE (2026-11-13): live screen frames ride their own 60/day lane
  // (visionQuotaLane) — the 5/day attachment cap can no longer kill an
  // ongoing screen-teacher session after five frames.
  // ✅ SECURITY FIX (audit run-1, fp ai.chatbot.vision-quota-check-increment
  // -race): the old admission read `used` then consumed it only AFTER the
  // 30-70s dispatch — a concurrent burst all read the same `used` and ALL
  // passed. Admission is now an atomic RESERVATION (tryConsumeImageQuota:
  // SELECT … FOR UPDATE + conditional upsert in one transaction) taken in
  // the preflight; every failure path below REFUNDS it exactly once. The
  // reservation is intentionally held across post-preflight awaits — any
  // throw before the endpoint returns is caught here and refunded first.
  const quotaLane = visionQuotaLane(screenCapture, ip);
  let visionReserved = false;
  if (vision) {
    const reservation = await tryConsumeImageQuota(quotaLane.key, imageCount, quotaLane.limit);
    if (!reservation.admitted) {
      const msg = quotaLane.screen ? screenQuotaExceededResponse(reservation.used) : imageQuotaExceededResponse(reservation.used);
      const lang = resolveChatLanguage(body.language, messages);
      return { error: errorResponse(c, "QUOTA_EXCEEDED", { lang: lang === "en" ? "en" : "ar", chatId: body.chatId, message: lang === "ar" ? msg.ar : msg.en }) };
    }
    visionReserved = true;
  }

  try {
    // Real course catalog (SWR-cached 10 min, fail-open to "") — lets the bot
    // quote actual course names/levels/prices instead of hallucinating them.
    // ✅ TOKEN OPTIMIZATION (v3.6.0): the FULL catalog rides only on course /
    // platform intent (sticky over recent history) or the vision lane — pure
    // technical questions carry the featured sample instead.
    // PERF: catalog and user resolution are independent — start both, await
    // each only where its value is first needed (saves one serial DB round
    // trip per chat message on the critical path).
    const courseIntent = vision || courseIntentFromMessages(messages);
    const catalogPromise = courseIntent ? getCourseCatalogText() : getCourseCatalogLiteText();

    // ── Chat-history continuity (logged-in users only, fail-open) ──
    // ✅ OWNER DIRECTIVE (2026-11-25): the identity was resolved (and required)
    // in the admission gate above — this await is a cheap cache hit now.
    const historySummary = chatUser ? await getLatestSummaryText(chatUser.id).catch(() => null) : null;
    const catalog = await catalogPromise;

    // ✅ SECURITY FIX (pre-launch audit run-2): daily per-USER message quota —
    // generous headroom for real students; only an automated loop hits it.
    if (chatUser && !bumpAndCheckChatbotDaily(`user:${chatUser.id}`, CHATBOT_DAILY_USER_LIMIT)) {
      return { error: errorResponse(c, "RATE_LIMITED", { lang: dailyLang, chatId: body.chatId, message: chatbotDailyQuotaMessage(CHATBOT_DAILY_USER_LIMIT, dailyLang) }) };
    }

    return {
      body,
      messages,
      vision,
      imageCount,
      screenCapture,
      quotaLane,
      visionReserved,
      dailyLang,
      language: resolveChatLanguage(body.language, messages),
      courseIntent,
      catalog,
      chatUser,
      historySummary,
    };
  } catch (err) {
    // ✅ SECURITY FIX (audit run-1): a reservation must never leak when the
    // preflight itself dies after admission — refund before the throw escapes.
    if (visionReserved) {
      await refundImageQuota(quotaLane.key, imageCount).catch(() => {});
    }
    throw err;
  }
}

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
    // ✅ ANTI-KOSHARY AUDIT FIX (F5): persistence moved to the chat-history
    // lib seam (clearChatHistory) — the DELETE path no longer embeds drizzle
    // imports in the route and is reusable outside HTTP (tests, Telegram).
    await clearChatHistory(user.id);
    return c.json({ success: true });
  } catch (err) {
    logger.error("[Chatbot] history clear failed", { error: logSafeError(err) });
    return errorResponse(c, "INTERNAL");
  }
});

// ── Non-streaming chat endpoint ──
chatbotRouter.post("/", async (c) => {
  // ✅ SECURITY FIX (audit run-1): vision-reservation bookkeeping lives OUTSIDE
  // the try so every failure path (UPSTREAM_EXHAUSTED, exception) can refund
  // exactly the reservation the preflight took.
  let heldReservation: { key: string; n: number } | null = null;
  try {
    // ✅ ANTI-KOSHARY AUDIT FIX: the whole admission sequence is ONE shared
    // preflight (chatRequestPreflight above) — see its unified-contract notes.
    const pre = await chatRequestPreflight(c);
    if ("error" in pre) return pre.error;
    const { body, messages, vision, imageCount, screenCapture, quotaLane, visionReserved, dailyLang, language, courseIntent, catalog, chatUser, historySummary } = pre;
    if (visionReserved) heldReservation = { key: quotaLane.key, n: imageCount };
    const nonStreamPersistDeadline = Date.now()
      + (Number.isFinite(Number(process.env.CHATBOT_NONSTREAM_PERSIST_MS)) && Number(process.env.CHATBOT_NONSTREAM_PERSIST_MS) > 0
        ? Number(process.env.CHATBOT_NONSTREAM_PERSIST_MS)
        : 30_000);
    const chatRequest = {
      messages,
      language,
      mode: body.mode,
      catalog,
      // ✅ TOKEN OPTIMIZATION: which catalog block style the prompt renders
      // (full contract vs featured-sample contract) — matches the choice above.
      catalogMode: courseIntent ? ("full" as const) : ("lite" as const),
      vision,
      // LIVE SCREEN: the last user message image is a frame of the user's
      // actual screen — arms the screen-teacher prompt (grounded guidance).
      screenCapture,
      historySummary: historySummary ?? undefined,
      // ✅ SCREEN CONTEXT: the client's live screen snapshot (open page,
      // displayed entity, nav trail) — strictly validated before it may reach
      // the system prompt; an invalid/absent payload just omits the block.
      screen: parseScreenContext(body.pageContext) ?? undefined,
      // ✅ Review fix (2026-11-11): the client's disconnect signal reaches the
      // whole cascade — the walk, every lane and every in-flight fetch now
      // observe it (abort-utils composition), not just the persistence loop.
      abortSignal: c.req.raw.signal,
      // ✅ BYOK: the authenticated user's own provider (chatbot key menu) is
      // resolved server-side from their encrypted row — tried FIRST in the
      // cascade, falling back to the platform models on any failure. A null
      // lookup (no config / disabled / corrupt) changes nothing downstream.
      byok: chatUser ? await getUserByokConfig(chatUser.id).catch(() => null) : null,
    };
    let result = await getChatResponse(chatRequest);
    let persistRound = 0;
    // ✅ ROOT-CURE (2026-11-13): a PERMANENT failure (every provider key
    // absent/invalid) never becomes better by retrying — skip the persistence
    // loop and answer the configuration notice immediately.
    while (!result.success && !(result as { permanent?: boolean }).permanent && Date.now() < nonStreamPersistDeadline && !c.req.raw.signal?.aborted) {
      persistRound += 1;
      await new Promise((r) => setTimeout(r, 4_000));
      // Persistence escalation: the FIRST retry round already skips the
      // dynamic router and goes straight to the legacy backbone (same
      // contract as /stream) — a storming dynamic pool must not re-burn
      // the retry budget before Groq/NVIDIA are tried.
      result = await getChatResponse({ ...chatRequest, preferLegacy: persistRound >= 1 });
    }

    if (result.success) {
      // ✅ SECURITY FIX (audit run-1): the vision quota was already consumed
      // ATOMICALLY in the preflight (reserve-then-refund) — no post-success
      // increment remains, so the 30-70s dispatch window can no longer be
      // raced by a concurrent burst.
      // ✅ ARCH-AUDIT FIX (unified egress pipeline): the reply now goes
      // through the ONE shared finalizeReply contract (think-strip → sanitize
      // → leak gate → deterministic truncation policy) — the same pipeline
      // the stream forwarder and the Telegram brain use, so no egress can
      // serve an answer the others would have blocked or reshaped.
      const final = finalizeReply(result.reply ?? "", dailyLang);
      if (final.leaked) logger.warn("[Chatbot] prompt-leak tripwire fired on non-stream reply — replaced with refusal");
      if (final.truncated) logger.info("[Chatbot] truncation policy trimmed a mid-sentence cutoff");
      // Persist the round for logged-in users (fails open internally).
      // ✅ AUDIT RUN-2 FIX: persist the OPAQUE model key — the raw provider
      // tag must not round-trip to the client via GET /history.
      if (chatUser) persistRoundSafe(chatUser.id, messages, vision, final.reply, opaqueModelKey(result.model ?? "unknown"), body.mode);
      return c.json({
        success: true,
        reply: final.reply,
        // ✅ ARCH-AUDIT FIX (model identity tag): the wire carries an opaque
        // model key — the never-name-providers contract is enforced in code.
        model: opaqueModelKey(result.model ?? "unknown"),
        chatId: body.chatId,
      });
    }

    // UPSTREAM_EXHAUSTED — the provider walk failed. Agent-Reach rule: the
    // upstream detail must never leak credentials, and the message must never
    // read like a login/permission problem.
    // ✅ SECURITY FIX (audit run-1): the held vision reservation is refunded —
    // a failed walk must not consume the lane (same contract as the old
    // success-only increment).
    if (heldReservation) {
      await refundImageQuota(heldReservation.key, heldReservation.n).catch(() => {});
      heldReservation = null;
    }
    return errorResponse(c, "UPSTREAM_EXHAUSTED", {
      chatId: body.chatId,
      message: scrubCredentials(result.error || "Unknown error"),
    });
  } catch (err) {
    logger.error("[Chatbot] Error in /api/chatbot", { error: logSafeError(err) });
    // ✅ SECURITY FIX (audit run-1): refund any held vision reservation on the
    // exception path too — a reservation must never leak on a failure.
    if (heldReservation) {
      await refundImageQuota(heldReservation.key, heldReservation.n).catch(() => {});
      heldReservation = null;
    }
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
//   3. When a full walk fails, the walk is RETRIED in rounds (circuit-breaker
//      state is module-level and PERSISTS across rounds — a model that failed
//      round 1 is not re-dialed in round 2) until the mode's persistence
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
  // ✅ ANTI-KOSHARY AUDIT FIX: same shared chatRequestPreflight as the
  // non-stream endpoint — one admission sequence, no drift.
  const pre = await chatRequestPreflight(c);
  if ("error" in pre) return pre.error;
  const { body, messages, vision, imageCount, screenCapture, quotaLane, visionReserved, language, courseIntent, catalog, chatUser, historySummary } = pre;

  const startedAt = Date.now();
  const mode: "thinking" | "instant" = body.mode === "instant" ? "instant" : "thinking";

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    logger.warn("[Chatbot] Stream hard cap (180s) — aborting");
    timeoutController.abort(new Error("endpoint hard cap"));
  }, SSE_ENDPOINT_HARD_CAP_MS);

  const encoder = new TextEncoder();
  // ✅ BYOK: the authenticated user's own provider resolved ONCE for the whole
  // walk — tried on the FIRST round only (rounds ≥ 2 pass preferLegacy and
  // go straight to the platform backbone), falling back on any failure.
  const userByok = chatUser ? await getUserByokConfig(chatUser.id).catch(() => null) : null;
  // Persistence escalation: rounds ≥ 2 skip the dynamic router entirely and
  // reach the legacy backbone (Groq/NVIDIA) directly — a storming dynamic
  // pool must never re-burn every round's walk budget.
  const runWalk = (round: number) => getStreamResponse({
    messages,
    language,
    mode,
    catalog,
    catalogMode: courseIntent ? ("full" as const) : ("lite" as const),
    vision,
    // LIVE SCREEN: the last user message image is a frame of the user's
    // actual screen — arms the screen-teacher prompt (grounded guidance).
    screenCapture,
    historySummary: historySummary ?? undefined,
    // ✅ SCREEN CONTEXT: the client's live screen snapshot — validated above
    // the walk so every round sees the same grounded screen state.
    screen: parseScreenContext(body.pageContext) ?? undefined,
    preferLegacy: round >= 2,
    // ✅ ARCH-AUDIT FIX: the walk sees the endpoint's abort signal — rounds
    // abandoned by the hard cap / client disconnect stop burning quota.
    abortSignal: timeoutController.signal,
    byok: userByok,
  });

  // Server-side accumulation of the assistant text — the normalized SSE
  // events ("data: {\"text\"}") are parsed so the full reply can be
  // persisted for logged-in users when the stream ends (success OR client
  // disconnect — the user saw whatever accumulated).
  let accumulatedReply = "";
  let sseCarry = "";
  const decoder = new TextDecoder();
  const forwardEncoder = new TextEncoder();
  // ✅ SECURITY FIX (pre-launch audit run-2, chatbot.prompt-leak) + ✅
  // ARCH-AUDIT FIX (stream leak gate could not retract streamed fragments):
  // the forwarder now holds back the last LEAK_TAIL_CHARS chars and only
  // re-emits text that has EXITED the window. A verbatim system-prompt
  // fragment (markers are ≤ ~50 chars; the window is 160) is therefore
  // caught BEFORE any of its bytes reach the client — no fragment can slip
  // out first, so the historical "stream-then-retroactively-fix" weakness
  // is gone. On a hit the client immediately receives the bilingual
  // refusal, nothing further is forwarded, and accumulatedReply is
  // REPLACED by the refusal so the persisted history contains no prompt
  // text either.
  let leakDetected = false;
  let leakTail = "";
  const LEAK_TAIL_CHARS = 160;
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
            if (leakDetected) continue; // swallow everything after a leak hit
            leakTail += parsed.text;
            if (containsPromptLeak(leakTail)) {
              leakDetected = true;
              const refusal = promptLeakRefusal(language);
              accumulatedReply = refusal;
              leakTail = "";
              out += `data: ${JSON.stringify({ text: refusal })}\n\n`;
              logger.warn("[Chatbot] prompt-leak tripwire fired on stream — reply replaced with refusal (no fragment had been emitted)");
              continue;
            }
            // Emit only what has left the hold-back window.
            const emitLen = leakTail.length - LEAK_TAIL_CHARS;
            if (emitLen > 0) {
              const part = leakTail.slice(0, emitLen);
              leakTail = leakTail.slice(emitLen);
              accumulatedReply += part;
              out += `data: ${JSON.stringify({ text: part })}\n\n`;
            }
          }
          // parsed.error events are NOT forwarded: the endpoint decides when
          // (and whether) to surface a soft-busy note after its own retries.
        } catch { /* malformed line — skip */ }
      }
      return out ? forwardEncoder.encode(out) : null;
    } catch { /* decode error — skip chunk */ return null; }
  };
  /**
   * ✅ ARCH-AUDIT FIX: release the hold-back tail when the winner stream
   * ends — it already passed the leak gate, so it belongs to the
   * client-visible reply (and to the persisted copy).
   */
  const flushLeakTail = (): Uint8Array | null => {
    if (leakDetected || !leakTail) { leakTail = ""; return null; }
    if (containsPromptLeak(leakTail)) {
      // Defensive final check — every delta was already checked, but a hit
      // here must behave identically: refusal replaces the accumulated copy.
      leakDetected = true;
      const refusal = promptLeakRefusal(language);
      accumulatedReply = refusal;
      leakTail = "";
      logger.warn("[Chatbot] prompt-leak tripwire fired on tail flush — reply replaced with refusal");
      return forwardEncoder.encode(`data: ${JSON.stringify({ text: refusal })}\n\n`);
    }
    const rest = leakTail;
    leakTail = "";
    accumulatedReply += rest;
    return forwardEncoder.encode(`data: ${JSON.stringify({ text: rest })}\n\n`);
  };
  // ✅ ROOT-CURE (2026-11-13, flushAccumulator persisted text the client never
  // received): the trailing unterminated SSE event's text used to be added to
  // accumulatedReply WITHOUT being emitted — the persisted history and the
  // user-visible reply diverged on a stream that ends without a final newline.
  // The flush now RETURNS the client-facing bytes; the caller enqueues them
  // exactly like flushLeakTail's output.
  const flushAccumulator = (): Uint8Array | null => {
    // ✅ AUDIT RUN-2 FIX (hardening from run-2 hunt): flush the decoder's
    // final multibyte buffer, then route the trailing event through the leak
    // gate BEFORE it can reach accumulatedReply — the trailing text must
    // never bypass the gate that governs every streamed fragment.
    try { sseCarry += decoder.decode(); } catch { /* final flush no-op */ }
    const rest = sseCarry.trim();
    sseCarry = "";
    if (rest.startsWith("data: ") && rest !== "data: [DONE]") {
      try {
        const parsed = JSON.parse(rest.slice(6)) as { text?: string };
        if (typeof parsed.text === "string" && parsed.text) {
          if (leakDetected || containsPromptLeak(leakTail + parsed.text)) {
            if (!leakDetected) {
              leakDetected = true;
              accumulatedReply = promptLeakRefusal(language);
              logger.warn("[Chatbot] prompt-leak tripwire fired on tail flush — reply replaced with refusal");
            }
            return null;
          }
          accumulatedReply += parsed.text;
          return forwardEncoder.encode(`data: ${JSON.stringify({ text: parsed.text })}\n\n`);
        }
      } catch { /* incomplete trailing event — drop */ }
    }
    return null;
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
          // ✅ ARCH-AUDIT FIX: the wire model field is an opaque key — the
          // never-name-providers contract is enforced in code, not just in
          // the prompt.
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ model: opaqueModelKey(result.model) })}\n\n`));
          leakTail = ""; // per-round hold-back state (defensive reset)

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

          // ✅ ARCH-AUDIT FIX: release the hold-back tail — it passed the
          // leak gate and belongs to the client-visible + persisted reply.
          const tailBytes = flushLeakTail();
          if (tailBytes) safeEnqueue(tailBytes);

          const trailingBytes = flushAccumulator();
          if (trailingBytes && !leakDetected) safeEnqueue(trailingBytes);
          // ✅ v1.1.2 DETERMINISTIC CITATION COMPLIANCE (stream seam): the model
          // may omit the [Saadat, ...] tag even with the prefilled line (live
          // E2E: 3 of 4 thinking-lane answers lacked it). The endpoint owns the
          // client-facing terminator, so appendOnly enforcement runs HERE —
          // the appended citation streams as a final text event AND lands in
          // the persisted copy. Refusals / concept queries are never cited
          // (anti-attribution guard inside enforcePinnedCitation).
          if (!leakDetected) {
            const seamSignal = extractRoutingSignal(messages);
            const seamCablesIntent = hasCablesIntent(seamSignal);
            const enforced = enforceRefsCitations(
              enforceCablesCitations(
                enforcePinnedCitation(accumulatedReply, seamSignal, language === "ar" ? "ar" : "en", mode, { appendOnly: true }),
                seamSignal,
                language === "ar" ? "ar" : "en",
                mode,
              ),
              seamSignal,
              language === "ar" ? "ar" : "en",
              mode,
              { cablesIntentActive: seamCablesIntent },
            );
            if (enforced !== accumulatedReply) {
              const extra = enforced.slice(accumulatedReply.length);
              accumulatedReply = enforced;
              if (extra) safeEnqueue(forwardEncoder.encode(`data: ${JSON.stringify({ text: extra })}\n\n`));
            }
          }
          const reply = accumulatedReply.trim();
          if (reply) {
            served = true;
            // ✅ SECURITY FIX (audit run-1): the vision quota was consumed
            // ATOMICALLY in the preflight (reserve-then-refund) — no
            // post-success increment remains to race (was: incrementImageQuota).
            // ✅ AUDIT RUN-2 FIX: persist the OPAQUE model key (same contract
            // as the non-stream persist — the raw provider tag never lands
            // in chatMessages.metadata).
            if (chatUser) persistRoundSafe(chatUser.id, messages, vision, reply, opaqueModelKey(result.model ?? "unknown"), mode);
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
          // ✅ SECURITY FIX (audit run-1): refund the held vision reservation —
          // the aborted walk never served a reply.
          if (visionReserved) await refundImageQuota(quotaLane.key, imageCount).catch(() => {});
          safeEnqueue(encoder.encode(`data: ${JSON.stringify({ error: softBusyText(language) })}\n\n`));
          safeEnqueue(encoder.encode("data: [DONE]\n\n"));
          finalize();
          return;
        }

        if (!served) {
          // Every round failed within the deadline — one soft busy event.
          // The client retries silently; only a total blackout ever shows it.
          logger.error("[Chatbot] stream persistence exhausted", { mode, rounds, elapsedMs: Date.now() - startedAt });
          // ✅ SECURITY FIX (audit run-1): refund the held vision reservation —
          // nothing was served, the dispatch must not consume the lane.
          if (visionReserved) await refundImageQuota(quotaLane.key, imageCount).catch(() => {});
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
        // ✅ SECURITY FIX (audit run-1): refund any held vision reservation on
        // the stream-handler exception path too.
        if (visionReserved) await refundImageQuota(quotaLane.key, imageCount).catch(() => {});
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

// ── 👍/👎 feedback votes (public, truncated server-side, rate-limited) ──
chatbotRouter.route("/feedback", chatbotFeedbackRoute);

export { chatbotRouter };
