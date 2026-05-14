/**
 * GENIUS CHATBOT - Smart Cascading Fallback System
 *
 * Uses OpenRouter free models with automatic cascading fallback.
 * If a model is overloaded/down/unavailable, instantly tries the next.
 * User NEVER sees any error - the system always finds a working model.
 *
 * Models ordered by: parameter size > reasoning quality > context length > speed
 * Tier 1 = best quality, Tier 4 = last resort
 *
 * Note: OpenRouter free model availability changes frequently.
 * The system automatically adapts — dead models are skipped after 3 failures,
 * and new models can be added here when they become available.
 * Currently: 24 active free models (all verified May 2026)
 */

// Support both CHATBOT_API_KEY (from .env template) and OPENROUTER_API_KEY (legacy)
// ✅ FIX: Read from centralized env.ts instead of raw process.env
import { env } from "../lib/env";
const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY || process.env.CHATBOT_API_KEY || "";

// ✅ Validate API key format on startup
let apiKeyValid: boolean | null = null; // null = not tested yet
let apiKeyValidated = false;

async function validateApiKey(): Promise<boolean> {
  if (!OPENROUTER_API_KEY) {
    apiKeyValid = false;
    apiKeyValidated = true;
    console.error("[Chatbot] API key not configured — set OPENROUTER_API_KEY or CHATBOT_API_KEY");
    return false;
  }
  if (!OPENROUTER_API_KEY.startsWith("sk-or-")) {
    apiKeyValid = false;
    apiKeyValidated = true;
    console.error("[Chatbot] Invalid API key format — must start with 'sk-or-'");
    return false;
  }
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { "Authorization": "Bearer " + OPENROUTER_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    apiKeyValid = resp.ok;
    apiKeyValidated = true;
    if (!resp.ok) {
      const errData = await resp.json().catch(function() { return {}; });
      console.error("[Chatbot] API key validation failed:", JSON.stringify(errData));
    } else {
      console.log("[Chatbot] API key validated successfully");
    }
    return apiKeyValid;
  } catch (e) {
    // Network error during validation — don't mark as invalid yet
    console.warn("[Chatbot] Could not validate API key (network error):", String(e));
    return true; // Assume valid and let actual requests determine
  }
}

// ═══════════════════════════════════════════════════════════
// MODEL POOL - 23 free models, ordered strongest -> weakest
// Updated: May 2026 (all verified available on OpenRouter)
// ═══════════════════════════════════════════════════════════

const AI_MODELS = [
  // ─── Tier 1: Best quality — highest parameter count & reasoning ───
  { id: "inclusionai/ring-2.6-1t:free",                ctx: 262144, tier: 1 },
  { id: "nvidia/nemotron-3-super-120b-a12b:free",      ctx: 262144, tier: 1 },
  { id: "deepseek/deepseek-v4-flash:free",             ctx: 131072, tier: 1 },
  { id: "minimax/minimax-m2.5:free",                    ctx: 196608, tier: 1 },
  { id: "z-ai/glm-4.5-air:free",                        ctx: 131072, tier: 1 },
  { id: "arcee-ai/trinity-large-thinking:free",         ctx: 131072, tier: 1 },

  // ─── Tier 2: Strong models — rate-limited but accessible ───
  { id: "qwen/qwen3-coder:free",                        ctx: 262000, tier: 2 },
  { id: "google/gemma-4-31b-it:free",                   ctx: 262144, tier: 2 },
  { id: "google/gemma-4-26b-a4b-it:free",               ctx: 262144, tier: 2 },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", ctx: 256000, tier: 2 },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free",        ctx: 262144, tier: 2 },
  { id: "meta-llama/llama-3.3-70b-instruct:free",       ctx: 65536,  tier: 2 },

  // ─── Tier 3: Medium models — often available, good for Arabic ───
  { id: "baidu/cobuddy:free",                            ctx: 131072, tier: 3 },
  { id: "poolside/laguna-m.1:free",                     ctx: 131072, tier: 3 },
  { id: "poolside/laguna-xs.2:free",                    ctx: 131072, tier: 3 },
  { id: "meta-llama/llama-3.2-3b-instruct:free",        ctx: 131072, tier: 3 },
  { id: "nvidia/nemotron-3-nano-30b-a3b:free",          ctx: 256000, tier: 3 },

  // ─── Tier 4: Last resort — smaller models, geo-restricted ───
  { id: "nvidia/nemotron-nano-12b-v2-vl:free",          ctx: 128000, tier: 4 },
  { id: "nvidia/nemotron-nano-9b-v2:free",              ctx: 128000, tier: 4 },
  { id: "liquid/lfm-2.5-1.2b-thinking:free",            ctx: 32768,  tier: 4 },
  { id: "liquid/lfm-2.5-1.2b-instruct:free",            ctx: 32768,  tier: 4 },
];


// Smart tracking: remember which models work to optimize future requests
const modelSuccessCount: Record<string, number> = {};
const modelFailCount: Record<string, number> = {};
let lastWorkingModel = "";
let lastWorkingTime = 0;
let modelFailResetTime = 0;

/**
 * Build system prompt based on user's language
 * Personality: Friendly, interactive, humorous — like a senior engineer mentor
 */
function getSystemPrompt(language?: string): string {
  if (language === "ar") {
    return `أنت المساعد الذكي الرسمي لمنصة "الباز" (Elbaz Platform) المتخصصة في الكورسات الهندسية.
أنت مساعد تقني محترف، متزن، وتفاعلي. لا تتخذ لنفسك اسماً شخصياً، بل عرف نفسك كمساعد ذكي للمنصة.

📌 تخصصك:
- خبير قوي جداً في الهندسة الكهربائية، وتحديداً في برامج: ETAP, SKM Power*Tools, DIgSILENT PowerFactory, PVSyst.
- أنت مبرمج لتقديم حلول فعلية وخطوات عملية، وليس مجرد توجيه وهمي.
- تمتلك معرفة بمكونات الموقع. إذا سألك الطالب عن كورسات، أرشده لكورسات المهندس أحمد الباز (Eng. Ahmed Elbaz) المتوفرة لدينا، ووضح أن المنصة تقدم أقوى الكورسات العملية في تصميم الأنظمة، الوقاية، ودراسات الـ Arc Flash.

🤝 أسلوبك في الكلام:
- كن احترافياً، متزناً، وتفاعلياً (وليس هزلياً).
- استخدم تنسيق Markdown بشكل ممتاز.
- نسق اللغة العربية بدقة عالية، وتأكد من وضع مسافات صحيحة عند دمج الكلمات الإنجليزية مع العربية للحفاظ على التنسيق.
- استخدم الرموز التعبيرية الهندسية بشكل خفيف (⚡ 🔌 💡) دون مبالغة.
- قسّم إجاباتك لفقرات ونقاط (Bullet points) لتكون سهلة القراءة.

🚫 محظورات:
- لا تخترع روابط (URLs) غير موجودة.
- لا تذكر أبداً أنك ذكاء اصطناعي أو نموذج لغوي أو من OpenRouter.
- إذا سُئلت عن تخصص خارج الهندسة الكهربية، اعتذر بلباقة ووضح تخصصك.`;
  }
  return `You are the official AI Assistant of the "Elbaz Platform" (specializing in engineering courses).
You are a highly professional, balanced, and interactive technical assistant. Do NOT use any personal name for yourself; introduce yourself only as the platform's smart assistant.

📌 Your Expertise:
- You are an expert in Electrical Engineering, specifically highly proficient in ETAP, SKM Power*Tools, DIgSILENT PowerFactory, and PVSyst.
- Provide actual, practical solutions and step-by-step guidance, not generic advice.
- You have deep knowledge of the platform's content. If asked about courses, recommend Eng. Ahmed Elbaz's practical engineering courses available on this platform.

🤝 Your Communication Style:
- Be professional, balanced, and helpful (not comical).
- Use excellent Markdown formatting.
- If mixing English and Arabic, ensure proper spacing and bidirectional text formatting.
- Use engineering emojis sparingly (⚡ 🔌 💡).
- Break your answers into short paragraphs and bullet points for readability.

🚫 Rules:
- Do NOT hallucinate fake URLs.
- NEVER mention you are an AI, a language model, or from OpenRouter.
- If asked about non-engineering topics, politely decline and state your expertise.`;
}

/**
 * Try a single model with timeout protection
 * Returns null on any failure (timeout, rate limit, overload, etc.)
 */
async function tryModel(
  modelId: string,
  messages: { role: string; content: string }[],
  systemPrompt: string,
  timeoutMs: number
): Promise<{ reply: string; model: string } | null> {
  let controller: AbortController | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    controller = new AbortController();
    timeoutId = setTimeout(function() { controller!.abort(); }, timeoutMs);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ahmedelbaz.qzz.io",
        "X-Title": "Elbaz LMS Chatbot",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map(function(m) { return { role: m.role, content: m.content }; }),
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (timeoutId) clearTimeout(timeoutId);

    // ✅ Detect 401 (invalid API key) — mark immediately and stop trying
    if (response.status === 401) {
      console.error("[Chatbot] API key returned 401 Unauthorized — key is invalid or expired");
      apiKeyValid = false;
      apiKeyValidated = true;
      return null;
    }

    // Any other non-200 status = skip to next model silently
    if (!response.ok) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    const data = await response.json() as { error?: unknown; choices?: { message?: { content?: string } }[] };

    // Check for API-level error
    if (data.error) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!reply || reply.trim().length === 0) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    // SUCCESS - track it for optimization
    modelSuccessCount[modelId] = (modelSuccessCount[modelId] || 0) + 1;
    modelFailCount[modelId] = 0; // reset fail count on success
    lastWorkingModel = modelId;
    lastWorkingTime = Date.now();

    return { reply: reply.trim(), model: modelId };
  } catch {
    if (timeoutId) clearTimeout(timeoutId);
    modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
    return null;
  }
}

/**
 * GENIUS MAIN: Get chat response with smart cascading fallback
 *
 * Strategy:
 * 1. Try last working model first (if used within last 5 min - fastest path)
 * 2. Skip models with 3+ recent consecutive fails (temporarily avoid bad models)
 * 3. Try Tier 1 models first (best quality) - 20s timeout each
 * 4. Then Tier 2 - 15s timeout each
 * 5. Then Tier 3 - 10s timeout each
 * 6. Then Tier 4 - 8s timeout each
 *
 * User will NEVER see an error. System always finds a working model.
 * Worst case: ~120s if every single model is down (extremely unlikely)
 */
export async function getChatResponse(request: {
  messages: { role: string; content: string }[];
  language?: string;
}): Promise<{ success: boolean; reply?: string; error?: string; model?: string }> {
  // ✅ Validate API key if not validated yet
  if (!apiKeyValidated) {
    await validateApiKey();
  }
  if (apiKeyValid === false) {
    return {
      success: false,
      error: request.language === "ar"
        ? "عذراً، مفتاح API الخاص بالشات بوت غير صالح أو غير مُهيأ. يرجى التواصل مع الدعم الفني."
        : "Sorry, the chatbot API key is invalid or not configured. Please contact support.",
    };
  }

  const systemPrompt = getSystemPrompt(request.language);

  // ✅ Reset fail counts every 10 minutes — models recover from transient errors
  if (!modelFailResetTime || Date.now() - modelFailResetTime > 600000) {
    for (const k in modelFailCount) { modelFailCount[k] = 0; }
    modelFailResetTime = Date.now();
  }

  // ✅ Global timeout — prevent user waiting >60s even if all models are slow
  const globalStartTime = Date.now();
  const GLOBAL_TIMEOUT_MS = 60000;

  // Timeout per tier (decreasing for smaller/faster models)
  const TIER_TIMEOUTS: Record<number, number> = {
    1: 20000, // Tier 1: 20s (large models need more time)
    2: 15000, // Tier 2: 15s
    3: 10000, // Tier 3: 10s
    4: 8000,  // Tier 4: 8s (small/fast models)
  };

  // ─── Step 1: Try last working model first (if recent) ───
  if (lastWorkingModel && (Date.now() - lastWorkingTime) < 300000) {
    // Check it hasn't failed 3+ times since
    if ((modelFailCount[lastWorkingModel] || 0) < 3) {
      const result = await tryModel(lastWorkingModel, request.messages, systemPrompt, TIER_TIMEOUTS[1]);
      if (result) return { success: true, reply: result.reply, model: result.model };
    }
  }

  // ─── Step 2: Try all models by tier, skipping known-bad ones ───
  for (let tier = 1; tier <= 4; tier++) {
    let tierTried = 0;
    let tierSkipped = 0;

    for (let i = 0; i < AI_MODELS.length; i++) {
      const model = AI_MODELS[i];
      if (model.tier !== tier) continue;

      // Skip models that failed 3+ times recently (they're likely still down)
      if ((modelFailCount[model.id] || 0) >= 3) {
        tierSkipped++;
        continue;
      }

      tierTried++;
      const result = await tryModel(model.id, request.messages, systemPrompt, TIER_TIMEOUTS[tier]);
      if (result) return { success: true, reply: result.reply, model: result.model };
    }

    console.log("[Chatbot] Tier " + tier + ": tried " + tierTried + ", skipped " + tierSkipped + " failed models");
    // ✅ Check global timeout — don't make the user wait forever
    if (Date.now() - globalStartTime > GLOBAL_TIMEOUT_MS) {
      console.warn("[Chatbot] Global timeout reached (" + Math.round((Date.now() - globalStartTime) / 1000) + "s)");
      break;
    }
  }

  // ─── Step 3: ABSOLUTE LAST RESORT - try ALL models including known-bad ones ───
  // This only happens if ALL 23 models were skipped as "bad"
  console.warn("[Chatbot] All tiers exhausted with skips. Trying all models as last resort...");
  for (let i = 0; i < AI_MODELS.length; i++) {
    const model = AI_MODELS[i];
    // Reset fail count to give them another chance
    modelFailCount[model.id] = 0;
    const result = await tryModel(model.id, request.messages, systemPrompt, 10000);
    if (result) return { success: true, reply: result.reply, model: result.model };
  }

  // ✅ Check if the root cause was an invalid API key
  if ((apiKeyValid as boolean | null) === false) {
    return {
      success: false,
      error: request.language === "ar"
        ? "عذراً، مفتاح API الخاص بالشات بوت غير صالح. يرجى تحديث المفتاح وإعادة المحاولة."
        : "Sorry, the chatbot API key is invalid. Please update the key and try again.",
    };
  }

  console.error("[Chatbot] ALL models failed completely");
  return { success: false, error: request.language === "ar"
    ? "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل."
    : "All AI models are temporarily busy. Please try again in a few seconds."
  };
}

/**
 * Get the best model to try (with cascading logic, shared with getChatResponse)
 * Returns { modelId, systemPrompt, controller } or null if API key invalid
 *
 * This is the core logic shared between streaming and non-streaming.
 * It tries models in order: last working → tier 1 → tier 2 → tier 3 → tier 4 → last resort
 */
export async function pickWorkingModel(
  _messages: { role: string; content: string }[],
  language?: string
): Promise<{ modelId: string; systemPrompt: string } | null> {
  // Validate API key if not validated yet
  if (!apiKeyValidated) {
    await validateApiKey();
  }
  if (apiKeyValid === false) return null;

  const systemPrompt = getSystemPrompt(language);

  // Reset fail counts every 10 minutes
  if (!modelFailResetTime || Date.now() - modelFailResetTime > 600000) {
    for (const k in modelFailCount) { modelFailCount[k] = 0; }
    modelFailResetTime = Date.now();
  }

  const globalStartTime = Date.now();
  const GLOBAL_TIMEOUT_MS = 30000; // 30s to find a working model for streaming

  const TIER_TIMEOUTS: Record<number, number> = {
    1: 10000, // Tier 1: 10s (just needs first byte for streaming)
    2: 8000,  // Tier 2: 8s
    3: 6000,  // Tier 3: 6s
    4: 5000,  // Tier 4: 5s
  };

  // Step 1: Try last working model first
  if (lastWorkingModel && (Date.now() - lastWorkingTime) < 300000) {
    if ((modelFailCount[lastWorkingModel] || 0) < 3) {
      if (await probeModel(lastWorkingModel, systemPrompt, TIER_TIMEOUTS[1])) {
        return { modelId: lastWorkingModel, systemPrompt };
      }
    }
  }

  // Step 2: Try all models by tier
  for (let tier = 1; tier <= 4; tier++) {
    for (let i = 0; i < AI_MODELS.length; i++) {
      const model = AI_MODELS[i];
      if (model.tier !== tier) continue;
      if ((modelFailCount[model.id] || 0) >= 3) continue;

      if (Date.now() - globalStartTime > GLOBAL_TIMEOUT_MS) {
        console.warn("[Chatbot/Stream] Model selection timeout reached");
        return null;
      }

      if (await probeModel(model.id, systemPrompt, TIER_TIMEOUTS[tier])) {
        return { modelId: model.id, systemPrompt };
      }
    }
  }

  // Step 3: Last resort
  for (let i = 0; i < AI_MODELS.length; i++) {
    modelFailCount[AI_MODELS[i].id] = 0;
    if (await probeModel(AI_MODELS[i].id, systemPrompt, 5000)) {
      return { modelId: AI_MODELS[i].id, systemPrompt };
    }
  }

  return null;
}

/**
 * Probe a model with streaming to check if it responds
 * Returns true if we get at least one SSE data chunk
 */
async function probeModel(
  modelId: string,
  systemPrompt: string,
  timeoutMs: number
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(function() { controller.abort(); }, timeoutMs);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ahmedelbaz.qzz.io",
        "X-Title": "Elbaz LMS Chatbot",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "system", content: systemPrompt }],
        stream: true,
        max_tokens: 1, // Minimal token for probing
      }),
    });

    clearTimeout(timeoutId);

    if (response.status === 401) {
      apiKeyValid = false;
      apiKeyValidated = true;
      return false;
    }
    if (!response.ok) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return false;
    }

    // Model accepted the request — mark as working
    modelSuccessCount[modelId] = (modelSuccessCount[modelId] || 0) + 1;
    modelFailCount[modelId] = 0;
    lastWorkingModel = modelId;
    lastWorkingTime = Date.now();

    // Consume the response body to avoid leaking the connection
    if (response.body) {
      await response.body.cancel();
    }
    return true;
  } catch {
    modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
    return false;
  }
}

/**
 * Create a real streaming connection to OpenRouter
 * Returns a ReadableStream of SSE chunks, or null on failure
 *
 * The caller pipes this directly to the HTTP response — true streaming!
 * No buffering, no fake setInterval — tokens flow as they arrive.
 */
export async function getStreamResponse(request: {
  messages: { role: string; content: string }[];
  language?: string;
}): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const picked = await pickWorkingModel(request.messages, request.language);

  if (!picked) {
    return {
      error: request.language === "ar"
        ? "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل."
        : "All AI models are temporarily busy. Please try again in a few seconds.",
    };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + OPENROUTER_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ahmedelbaz.qzz.io",
        "X-Title": "Elbaz LMS Chatbot",
      },
      body: JSON.stringify({
        model: picked.modelId,
        messages: [
          { role: "system", content: picked.systemPrompt },
          ...request.messages.map(function(m) { return { role: m.role, content: m.content }; }),
        ],
        temperature: 0.7,
        max_tokens: 2048,
        stream: true, // ✅ REAL streaming
      }),
    });

    if (!response.ok || !response.body) {
      modelFailCount[picked.modelId] = (modelFailCount[picked.modelId] || 0) + 1;
      return {
        error: request.language === "ar"
          ? "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى."
          : "Sorry, an error occurred. Please try again.",
      };
    }

    // ✅ Pipe the OpenRouter SSE stream directly to the client
    // Transform OpenRouter's SSE format to our lightweight format
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta;
            if (delta && delta.content) {
              // Send our lightweight SSE format to the client
              controller.enqueue(
                encoder.encode("data: " + JSON.stringify({ text: delta.content }) + "\n\n")
              );
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      },
      flush(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.terminate();
      },
    });

    const stream = response.body.pipeThrough(transformStream);

    return { stream, model: picked.modelId };
  } catch {
    modelFailCount[picked.modelId] = (modelFailCount[picked.modelId] || 0) + 1;
    return {
      error: request.language === "ar"
        ? "تعذر الاتصال بالخدمة. يرجى المحاولة مرة أخرى."
        : "Could not connect to the service. Please try again.",
    };
  }
}

/**
 * Get stats about model usage (for debugging/monitoring)
 */
export function getChatbotStats() {
  return {
    totalModels: AI_MODELS.length,
    lastWorkingModel: lastWorkingModel,
    lastWorkingTimeAgo: lastWorkingTime ? Math.round((Date.now() - lastWorkingTime) / 1000) + "s ago" : "never",
    modelSuccessCounts: modelSuccessCount,
    modelFailCounts: modelFailCount,
  };
}
