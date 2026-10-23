/**
 * TWO-PASS VISION — "a vision model READS the image first, THEN a reasoning
 * model answers" (explicit product policy — the answer must come from the
 * strongest reasoning model, not from a weaker vision model).
 *
 * PASS 1 (READ): the attached image + a FACTUAL-EXTRACTION prompt go to a
 *                vision-capable model (dynamic pool supportsVision → Groq
 *                Llama-4-Scout → OpenRouter VL ids). Output: a complete,
 *                advice-free description of what the image shows.
 * PASS 2 (ANSWER): the description replaces the image parts inside the last
 *                user message and the NORMAL reasoning-first cascade
 *                (thinking/instant tuning, dynamic router + legacy chain)
 *                produces the final engineering answer — exactly like any
 *                text question.
 *
 * ZERO-GAP guarantees:
 *   - The extraction is think-tag-scrubbed and length-capped.
 *   - If EVERY vision model fails the read, the reasoning pass still runs —
 *     with an explicit honesty note so the model NEVER pretends to have seen
 *     the image (never guess about an image we could not read).
 *   - This module never throws: a failure degrades to the note path.
 */

import { routeChatCompletion, isDiscoveredModelId } from "./ai-router.js";
import {
  tryGroq,
  tryOpenRouterVision,
  GROQ_API_KEY,
  GROQ_VISION_MODEL,
  type ChatApiMessage,
  type ContentPart,
} from "./chatbot.js";
import { stripThinkBlocks } from "./think-filter.js";
import { logger } from "./logger.js";

/** Overall PASS-1 budget — must leave room for the reasoning cascade. */
const VISION_READ_BUDGET_MS = 35_000;
const VISION_READ_TIMEOUT_MS = 20_000;
/** Minimum remaining budget before starting ANOTHER reader stage — a stage
 *  started with less left is guaranteed to blow the request deadline. */
const VISION_STAGE_MIN_REMAINING_MS = 12_000;

// ── PASS-1 memoization (per-request) ──
// The streaming router persistence loop re-calls getStreamResponse on every
// round with the SAME messages array reference (runWalk closure). Re-running
// the vision read on each round used to burn up to 35s per round AND re-charge
// the vision providers — the reason image questions felt frozen under load.
// A WeakMap keyed on the messages array caches the read for the lifetime of
// that one request (the array is garbage-collected with the request). */
const visionReadCache = new WeakMap<ChatApiMessage[], VisionReadResult>();
/** Max description chars injected into the reasoning prompt. */
const MAX_DESCRIPTION_CHARS = 6_000;

export function visionExtractionPrompt(language?: string): string {
  if (language === "ar") {
    return `أنت محرك تحليل صور دقيق لمنصة هندسة كهربائية. سترى صورة مرفقة من المستخدم. مهمتك وصفها وصفاً واقعياً كاملاً — وصف فقط، بلا نصائح وبلا حلول.
المطلوب استخراجه بالترتيب:
1. كل النصوص الظاهرة حرفياً (عناوين النوافذ، أسماء القوائم، أسماء الحقول، رسائل الخطأ، أسماء الأزرار) — بدون ترجمة أو تعديل.
2. كل القيم والأرقام والوحدات كما هي مكتوبة (فولت، أمبير، نسب، معاملات، أبعاد كابلات).
3. طبيعة المحتوى: لقطة شاشة من برنامج (وأي برنامج)؟ جدول؟ مخطط شبكة أو one-line؟ لوحة أجهزة؟ رسالة خطأ؟
4. عناصر أي مخطط: أسماء البيسات/الفيدرات/المحولات/القواطع وطريقة التوصيل الظاهرة.
5. أي علامات تحذير أو أخطاء واضحة.
قواعد صارمة:
- إذا كانت قيمة غير مقروءة اكتب [غير مقروء] — لا تخمّن أبداً.
- لا تقدم أي إجابة أو توصية على السؤال — وصف الصورة فقط. سيجيب نموذج آخر على سؤال المستخدم بناءً على وصفك.
- ابدأ بالوصف مباشرة دون مقدمات.`;
  }
  return `You are a precise image-analysis engine for an electrical-engineering platform. You will be shown an image attached by the user. Describe it factually and completely — description ONLY, no advice, no solutions.
Extract, in order:
1. Every visible text VERBATIM (window titles, menu names, field labels, error messages, button names) — no translation, no paraphrase.
2. Every value, number and unit exactly as written (volts, amps, percentages, settings, cable sizes).
3. Content type: a software screenshot (which one)? A table? A network/one-line diagram? A device panel? An error dialog?
4. For diagrams: bus/feeder/transformer/breaker names and visible connectivity.
5. Any visible warnings or error flags.
Hard rules:
- If a value is unreadable write [unreadable] — NEVER guess.
- Do NOT answer the user's question or give any recommendation — describe the image only. Another model will answer the user's question based on your description.
- Start the description directly, no preamble.`;
}

/** Honest note injected when the image could NOT be read by any vision model. */
export function visionFailureNote(language?: string): string {
  return language === "ar"
    ? "[ملاحظة داخلية: تعذّر قراءة الصورة المرفقة تقنياً. لا تدّعِ أبداً أنك رأيت الصورة ولا تخمّن محتواها. اعتذر بلطف للمستخدم عن تعذّر قراءة الصورة واطلب منه إعادة إرسالها أو وصف سؤاله نصياً، ثم أجب عن أي نص مكتوب إن وُجد.]"
    : "[Internal note: the attached image could not be read. NEVER claim you saw the image or guess its content. Politely apologize that the image could not be read and ask the user to re-send it or describe the question in text, then answer any written text if present.]";
}

/** Fallback question when the user attached an image with no text at all. */
export function imageOnlyQuestion(language?: string): string {
  return language === "ar"
    ? "حلل هذه الصورة واشرح ما بها بالتفصيل، واذكر أي ملاحظات هندسية مهمة."
    : "Analyze this image and explain what it shows in detail, including any important engineering notes.";
}

/** Plain text of a message content (string or parts array). */
function textOfContent(content: ChatApiMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

/**
 * Build the PASS-2 message list: identical to `messages` except the LAST
 * user message becomes plain text = [image analysis header + description]
 * followed by the user's original question. All image parts are dropped —
 * the reasoning cascade is TEXT-ONLY (text-only models never see image parts).
 */
export function buildAugmentedTextMessages(
  messages: ChatApiMessage[],
  description: string,
  language?: string,
): ChatApiMessage[] {
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return -1;
  })();
  if (lastUserIdx === -1) return messages;

  const original = textOfContent(messages[lastUserIdx].content);
  const question = original || imageOnlyQuestion(language);
  const header = language === "ar"
    ? "صورة مرفقة من المستخدم — تحليل الصورة الآلي (عامل على أساسه فقط):"
    : "Image attached by the user — automated image analysis (rely on it):";
  const augmentedText = `[${header}\n${description}\n]\n\n${question}`;

  const out = messages.map((m) => ({ ...m }));
  out[lastUserIdx] = { role: "user", content: augmentedText };
  return out;
}

/** Replace the last user message with the failure note + original text. */
export function buildVisionFailureMessages(messages: ChatApiMessage[], language?: string): ChatApiMessage[] {
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return -1;
  })();
  if (lastUserIdx === -1) return messages;
  const original = textOfContent(messages[lastUserIdx].content);
  const out = messages.map((m) => ({ ...m }));
  out[lastUserIdx] = { role: "user", content: `${visionFailureNote(language)}\n\n${original}`.trim() };
  return out;
}

export interface VisionReadResult {
  ok: boolean;
  description?: string;
  /** provider/model tag of the reader (diagnostics only). */
  visionModel?: string;
}

/** Sanity floor — shorter than this is not a usable description. */
const MIN_DESCRIPTION_CHARS = 20;

/**
 * PASS 1 — read the image via the vision-capable lane.
 * Order: dynamic pool (supportsVision, all providers) → Groq Llama-4-Scout
 * (single attempt) → OpenRouter VL models. Never throws.
 * Memoized per messages-array: repeated calls within one request (router
 * persistence rounds) return the cached read instantly.
 */
export async function readImageViaVisionModels(
  messages: ChatApiMessage[],
  language?: string,
): Promise<VisionReadResult> {
  const cached = visionReadCache.get(messages);
  if (cached) return cached;

  const result = await performVisionRead(messages, language);
  visionReadCache.set(messages, result);
  return result;
}

async function performVisionRead(
  messages: ChatApiMessage[],
  language?: string,
): Promise<VisionReadResult> {
  const systemPrompt = visionExtractionPrompt(language);
  const startedAt = Date.now();
  /** True when another reader stage still fits inside the overall budget. */
  const stageFits = () => Date.now() - startedAt + VISION_STAGE_MIN_REMAINING_MS < VISION_READ_BUDGET_MS;

  const accept = (reply: string | null | undefined, model: string): VisionReadResult | null => {
    const cleaned = stripThinkBlocks(reply ?? "");
    if (cleaned && cleaned.trim().length >= MIN_DESCRIPTION_CHARS) {
      logger.info(`[Chatbot/Vision] image read by ${model}`);
      return {
        ok: true,
        description: cleaned.trim().slice(0, MAX_DESCRIPTION_CHARS),
        visionModel: model,
      };
    }
    return null;
  };

  // 1) Dynamic pool — vision-capable models across every configured provider.
  try {
    if (stageFits()) {
      const routed = await routeChatCompletion({
        messages,
        systemPrompt,
        mode: "thinking",
        vision: true,
        gen: { temperature: 0.1, maxTokens: 1500, attemptTimeoutMs: VISION_READ_TIMEOUT_MS, globalBudgetMs: 20_000 },
      });
      if (routed.ok) {
        const hit = accept(routed.result.reply, routed.result.model);
        if (hit) return hit;
      }
    }
  } catch (err) {
    logger.warn("[Chatbot/Vision] dynamic vision read failed — trying legacy chain", { error: String(err) });
  }

  // 2) Legacy chain — one Groq Scout attempt, then the OpenRouter VL sweep.
  //    (The second Scout attempt doubled the worst-case read to ~50s and blew
  //    the instant persistence deadline — removed: one scout + VL sweep is
  //    enough redundancy alongside the dynamic pool.)
  if (GROQ_API_KEY && isDiscoveredModelId("groq", GROQ_VISION_MODEL) && stageFits()) {
    // Scout dialing is additionally gated by the live discovery registry —
    // when Groq rotates the model out (2026-10-23: 404), the read skips the
    // dead attempt and moves straight to the OpenRouter VL sweep.
    try {
      const r1 = await tryGroq(messages, systemPrompt, GROQ_VISION_MODEL, VISION_READ_TIMEOUT_MS);
      const hit1 = r1 ? accept(r1.reply, `groq/${GROQ_VISION_MODEL}`) : null;
      if (hit1) return hit1;
    } catch (err) {
      logger.warn("[Chatbot/Vision] Groq scout read failed", { error: String(err) });
    }
  }

  if (stageFits()) {
    try {
      const or = await tryOpenRouterVision(messages, systemPrompt, 15_000);
      const hit = or ? accept(or.reply, or.model) : null;
      if (hit) return hit;
    } catch (err) {
      logger.warn("[Chatbot/Vision] OpenRouter VL read failed", { error: String(err) });
    }
  }

  logger.error("[Chatbot/Vision] ALL vision readers failed — continuing with the honesty note");
  return { ok: false };
}
