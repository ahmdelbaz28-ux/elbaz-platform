/**
 * CHATBOT VISION PASS — "a model that READS the image first, then a reasoning
 * model answers" (explicit product requirement).
 *
 * Flow (wired in chatbot-router.ts):
 *   1. User attaches an image (data URL, validated + size-capped).
 *   2. describeImage() sends it to a VISION-capable model with a factual,
 *      advice-free extraction instruction (text, values, dialog titles,
 *      error messages, diagram elements — everything an ETAP engineer needs).
 *   3. The description is injected into the user's message and the normal
 *      reasoning-first cascade produces the final answer.
 *
 * ZERO-GAP policy:
 *   - Every candidate is a vetted GENERAL vision chat model (pool policy —
 *     never a music/image-gen/classifier model).
 *   - Ordering: fastest reliable vision first (Groq llama-4-scout), then the
 *     strongest OpenRouter vision models.
 *   - Fail-open: if EVERY vision candidate fails, the router still answers —
 *     with an explicit "I could not read the image" note so the user is never
 *     misled (never guess about an image we could not see).
 *   - Think-tag stripped: some VL models reason visibly — same filter as the
 *     main cascade.
 */

import { GROQ_API_KEY, GROQ_ENDPOINT, OPENROUTER_API_KEY } from "./chatbot.js";
import { stripThinkBlocks } from "./think-filter.js";
import { logger } from "./logger.js";

/** One vision candidate. provider+model pairs we know are image-capable. */
interface VisionCandidate {
  provider: "groq" | "openrouter";
  model: string;
  label: string;
}

const VISION_CANDIDATES: VisionCandidate[] = [
  { provider: "groq", model: "meta-llama/llama-4-scout-17b-16e-instruct", label: "groq/llama-4-scout" },
  { provider: "openrouter", model: "nvidia/nemotron-3.5-super-vl:free", label: "or/nemotron-3.5-super-vl" },
  { provider: "openrouter", model: "google/gemma-4-31b-it:free", label: "or/gemma-4-31b" },
  { provider: "openrouter", model: "thinkingmachines/inkling:free", label: "or/inkling" },
  { provider: "openrouter", model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", label: "or/nemotron-omni" },
];

const VISION_TIMEOUT_MS = 25_000;
/** Overall vision-pass budget — must leave room for the reasoning cascade. */
const VISION_TOTAL_BUDGET_MS = 45_000;
/** Max description chars injected into the reasoning prompt. */
const MAX_DESCRIPTION_CHARS = 6_000;

function visionSystemPrompt(language?: string): string {
  if (language === "ar") {
    return `أنت محرك تحليل صور دقيق لمنصة هندسة كهربائية. مهمتك وصف الصورة المرفقة وصفاً واقعياً كاملاً — فقط.
المطلوب استخراجه بالترتيب:
1. كل النصوص الظاهرة حرفياً (عناوين النوافذ، أسماء القوائم، أسماء الحقول، رسائل الخطأ، أسماء الأزرار).
2. كل القيم والأرقام والوحدات كما هي مكتوبة (الفولت، الأمبير، النسب، المعاملات).
3. طبيعة المحتوى: هل هي لقطة شاشة من برنامج (وأي برنامج)؟ جدول؟ مخطط شبكة؟ رسم one-line؟ لوحة أجهزة؟ رسالة خطأ؟
4. عناصر أي مخطط: أسماء البيسات/الفيدرات/المحولات/القواطع وطرق التوصيل الظاهرة.
5. أي علامات تحذير أو أخطاء واضحة.
قواعد صارمة:
- اذكر النصوص كما هي بدون ترجمة أو تعديل.
- إذا كانت قيمة غير مقروءة اكتب [غير مقروء] — لا تخمّن أبداً.
- لا تقدم نصائح ولا حلولاً ولا مقدمة — وصف فقط.`;
  }
  return `You are a precise image-analysis engine for an electrical-engineering platform. Describe the attached image factually and completely — description ONLY.
Extract, in order:
1. Every visible text VERBATIM (window titles, menu names, field labels, error messages, button names).
2. Every value, number and unit exactly as written (volts, amps, percentages, settings).
3. Content type: is it a software screenshot (which one)? A table? A network/one-line diagram? A device panel? An error dialog?
4. For diagrams: bus/feeder/transformer/breaker names and visible connectivity.
5. Any visible warnings or error flags.
Hard rules:
- Quote text as-is, no translation, no paraphrase.
- If a value is unreadable write [unreadable] — NEVER guess.
- No advice, no solutions, no preamble — description only.`;
}

function visionUserInstruction(userText: string, language?: string): string {
  const focus = userText.trim();
  if (!focus) {
    return language === "ar"
      ? "حلل هذه الصورة وصفها وصفاً كاملاً وفق التعليمات."
      : "Analyze this image and describe it fully per the instructions.";
  }
  return language === "ar"
    ? `سؤال المستخدم المرتبط بهذه الصورة: "${focus}"\nحلل الصورة وصفها كاملاً، مع التركيز على ما يخص سؤال المستخدم.`
    : `The user's question about this image: "${focus}"\nAnalyze the image fully, focusing on what relates to the user's question.`;
}

export interface VisionResult {
  ok: boolean;
  /** Factual description of the image (already think-stripped). */
  description?: string;
  /** Which vision model produced it (for logs/diagnostics). */
  visionModel?: string;
}

interface OpenAIMessage {
  role: string;
  content: string | { type: string; text?: string; image_url?: { url: string } }[];
}

async function tryVisionCandidate(
  candidate: VisionCandidate,
  imageDataUrl: string,
  userText: string,
  language?: string,
): Promise<string | null> {
  const messages: OpenAIMessage[] = [
    { role: "system", content: visionSystemPrompt(language) },
    {
      role: "user",
      content: [
        { type: "text", text: visionUserInstruction(userText, language) },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];

  const url = candidate.provider === "groq" ? GROQ_ENDPOINT : "https://openrouter.ai/api/v1/chat/completions";
  const headers: Record<string, string> = {
    "Authorization": `Bearer ${candidate.provider === "groq" ? GROQ_API_KEY : OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
  };
  if (candidate.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://ahmedelbaz.qzz.io";
    headers["X-Title"] = "Elbaz LMS Chatbot";
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: candidate.model,
        messages,
        temperature: 0.1, // factual extraction — minimal creativity
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn(`[Chatbot/Vision] ${candidate.label} failed (HTTP ${response.status})`);
      return null;
    }

    const data = await response.json() as {
      error?: unknown;
      choices?: { message?: { content?: string | null } }[];
    };
    if (data.error) return null;

    const description = stripThinkBlocks(data.choices?.[0]?.message?.content ?? "");
    // A "description" that is essentially empty is a failed read.
    if (!description || description.trim().length < 20) return null;
    return description.trim();
  } catch (e) {
    logger.warn(`[Chatbot/Vision] ${candidate.label} threw`, { error: String(e) });
    return null;
  }
}

/**
 * Read an attached image into a factual description via the vision cascade.
 * NEVER throws — a failed vision pass is reported as { ok: false } and the
 * caller answers gracefully.
 */
export async function describeImage(
  imageDataUrl: string,
  userText: string,
  language?: string,
): Promise<VisionResult> {
  const startedAt = Date.now();
  for (const candidate of VISION_CANDIDATES) {
    if (candidate.provider === "groq" && !GROQ_API_KEY) continue;
    if (candidate.provider === "openrouter" && !OPENROUTER_API_KEY) continue;
    // Overall deadline: stop trying candidates once the vision budget is
    // spent — the reasoning cascade still needs its own time slice.
    if (Date.now() - startedAt > VISION_TOTAL_BUDGET_MS) {
      logger.warn("[Chatbot/Vision] total vision budget exhausted — continuing without image context");
      break;
    }

    const description = await tryVisionCandidate(candidate, imageDataUrl, userText, language);
    if (description) {
      logger.info(`[Chatbot/Vision] image read by ${candidate.label}`);
      return {
        ok: true,
        description: description.slice(0, MAX_DESCRIPTION_CHARS),
        visionModel: candidate.label,
      };
    }
  }

  logger.error("[Chatbot/Vision] ALL vision candidates failed — replying without image context");
  return { ok: false };
}
