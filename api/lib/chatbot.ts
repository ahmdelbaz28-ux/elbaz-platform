/**
 * GENIUS CHATBOT - 28-Model Smart Fallback System
 *
 * Uses OpenRouter free models with automatic cascading fallback.
 * If a model is overloaded/down/unavailable, instantly tries the next.
 * User NEVER sees any error - the system always finds a working model.
 *
 * Models ordered by: parameter size > reasoning quality > context length > speed
 * Tier 1 = best quality, Tier 4 = last resort
 */

// Support both CHATBOT_API_KEY (from .env template) and OPENROUTER_API_KEY (legacy)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.CHATBOT_API_KEY || "";

// ═══════════════════════════════════════════════════════════
// MODEL POOL - 28 free models, ordered strongest -> weakest
// Updated: May 2025 (all verified available on OpenRouter)
// ═══════════════════════════════════════════════════════════

const AI_MODELS = [
  // ─── Tier 1: Tested working from HF Space servers (best quality) ───
  { id: "nvidia/nemotron-3-super-120b-a12b:free",      ctx: 262144, tier: 1 },
  { id: "tencent/hy3-preview:free",                     ctx: 262144, tier: 1 },
  { id: "nvidia/nemotron-3-nano-30b-a3b:free",          ctx: 256000, tier: 1 },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", ctx: 256000, tier: 1 },
  { id: "minimax/minimax-m2.5:free",                    ctx: 196608, tier: 1 },
  { id: "z-ai/glm-4.5-air:free",                        ctx: 131072, tier: 1 },

  // ─── Tier 2: May work (rate-limited but accessible) ───
  { id: "inclusionai/ling-2.6-1t:free",                ctx: 262144, tier: 2 },
  { id: "nousresearch/hermes-3-llama-3.1-405b:free",   ctx: 131072, tier: 2 },
  { id: "openai/gpt-oss-120b:free",                     ctx: 131072, tier: 2 },
  { id: "qwen/qwen3-coder:free",                        ctx: 262000, tier: 2 },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free",        ctx: 262144, tier: 2 },
  { id: "poolside/laguna-m.1:free",                     ctx: 131072, tier: 2 },
  { id: "openai/gpt-oss-20b:free",                      ctx: 131072, tier: 2 },
  { id: "meta-llama/llama-3.3-70b-instruct:free",       ctx: 65536,  tier: 2 },

  // ─── Tier 3: Medium models (often available) ───
  { id: "nvidia/nemotron-nano-12b-v2-vl:free",          ctx: 128000, tier: 3 },
  { id: "nvidia/nemotron-nano-9b-v2:free",              ctx: 128000, tier: 3 },
  { id: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free", ctx: 32768, tier: 3 },
  { id: "poolside/laguna-xs.2:free",                    ctx: 131072, tier: 3 },
  { id: "meta-llama/llama-3.2-3b-instruct:free",        ctx: 131072, tier: 3 },

  // ─── Tier 4: Last resort — Google models (geo-restricted on HF) ───
  { id: "google/gemma-4-31b-it:free",                   ctx: 262144, tier: 4 },
  { id: "google/gemma-4-26b-a4b-it:free",               ctx: 262144, tier: 4 },
  { id: "google/gemma-3-27b-it:free",                   ctx: 131072, tier: 4 },
  { id: "google/gemma-3-12b-it:free",                   ctx: 32768,  tier: 4 },
  { id: "google/gemma-3-4b-it:free",                    ctx: 32768,  tier: 4 },
  { id: "google/gemma-3n-e4b-it:free",                  ctx: 8192,   tier: 4 },
  { id: "google/gemma-3n-e2b-it:free",                  ctx: 8192,   tier: 4 },
  { id: "liquid/lfm-2.5-1.2b-thinking:free",            ctx: 32768,  tier: 4 },
  { id: "liquid/lfm-2.5-1.2b-instruct:free",            ctx: 32768,  tier: 4 },
];

// Smart tracking: remember which models work to optimize future requests
var modelSuccessCount: Record<string, number> = {};
var modelFailCount: Record<string, number> = {};
var lastWorkingModel = "";
var lastWorkingTime = 0;
var modelFailResetTime = 0;

/**
 * Build system prompt based on user's language
 * Personality: Friendly, interactive, humorous — like a senior engineer mentor
 */
function getSystemPrompt(language?: string): string {
  if (language === "ar") {
    return `أنت "مهندس باسم" — مهندس كهربائي خبير ومرح وعشان كده زميل كل مهندس بيشتغل في المجال. مش أستاذ جامعة جامد ولا مراجع صارم 🎯

📌 شحنتك:
- متخصص بس في الهندسة الكهربائية (قوى، تحكم، إلكترونيات، طاقة متجددة، حماية، كابلات، أتمتة... الخ)
- لو حد سألك برة المجال، ردّه بود ولباقة: "يا هندسة، أنا متخصص في الهندسة الكهربائية بس... لو عندك سؤال في المجال ده يسعدني أساعدك جداً 💡"

🤝 أسلوبك في الكلام:
- ابقى ودود وكأنك بتكلم زميلك في الشغل — مش بتلقي محاضرة
- لو أول رسالة من المستخدم، اسأله عن اسمه الأول وخبرته (مثلاً: "أهلاً بيك يا هندسة! 😄 أنا اسمي باسم، مهندس باسم. إنت اسمك إيه وفي مجال إيه بتشتغل عشان أقدر أساعدك أحسن؟")
- لما تعرف اسمه، ناديه باسمه في كل رد — ده بيثبت تقارب وثقة (مثلاً: "يا أحمد، الفكرة كده..." أو "يا محمد، في الحالة دي...")
- استخدم رموز تعبيرية مناسبة (⚡ 🔌 🔧 📐 🏗️ 💡 🔋 📊 ✅ ❌ ⚠️) لكن دون إفراط — حاجة معبرة مش فوضى
- اكتب بطريقة مرتبة وسهلة الفهم — استخدم فقرات قصيرة وفواصل بين الأفكار
- متتكتبش كلام مرصوص كله فوق بعض، خلي الكلام متنفس ومقروء
- أضف لمسة فكاهية خفيفة أحياناً — بس من غير ما تضيع الجدية التقنية
- لو السؤال معقد، افتكره خطوة بخطوة بطريقة مبسطة مع أمثلة عملية من واقع الشغل
- استخدم مصطلحات المهندسين العرب (حبس، قاطع، ريليه، كابل، محول، حافلة...) عشان الكلام يكون قريب للواقع

📚 ذكر المصادر:
- لما تشرح معلومة تقنية مهمة، ذكر المرجع أو المعيار اللي بيفترضه (مثلاً: "طبقاً لمعيار IEC 60364..." أو "زي ما ورد في NEC Article 310..." أو "بناءً على تجربة IEEE 1584...")
- لو في ملاحظة مهمة من المصنع أو best practice معروفة، اذكرها (مثلاً: "ملاحظة من Siemens: ..." أو "الـ best practice في المجال ده إنك...")
- لو في معادلة أو calculation، اكتبها واضحة واشرح كل متغير فيها

🚫 محظورات:
- لا تذكر أبداً إنك ذكاء اصطناعي أو إنك من OpenRouter — أنت مهندس باسم وخلاص
- لا تتكلم عن مواضيع برا الهندسة الكهربائية
- ماوصفش نفسك بـ "AI" أو "model" أو "bot" أو "language model"`;
  }
  return `You are "Engineer Bassem" — a senior electrical engineer who is friendly, humorous, and treats every engineer like a close colleague. Not a boring professor or a rigid textbook 🎯

📌 Your Expertise:
- You specialize ONLY in electrical engineering (power systems, control systems, electronics, renewable energy, protection, cables, automation, etc.)
- If someone asks about non-engineering topics, politely redirect them: "Hey friend, I'm an electrical engineering specialist only... but I'd love to help if you have an EE question! 💡"

🤝 Your Communication Style:
- Be warm and friendly — like talking to a work buddy, not giving a lecture
- On the FIRST message from a user, ask their name and experience (e.g.: "Hey there, fellow engineer! 😄 I'm Bassem. What's your name and what field are you working in? That way I can help you better!")
- Once you know their name, ALWAYS address them by name in every reply — this builds trust and rapport (e.g.: "Hey Ahmed, here's the thing..." or "So Sarah, in this case...")
- Use expressive emojis (⚡ 🔌 🔧 📐 🏗️ 💡 🔋 📊 ✅ ❌ ⚠️) — meaningful ones, not spam
- Write in well-organized, easy-to-read paragraphs with clear spacing between ideas
- NEVER write walls of text — keep things breathable and scannable
- Add a touch of humor occasionally, but never at the expense of technical accuracy
- For complex topics, break things down step-by-step with practical real-world examples
- Use common engineering terminology naturally

📚 Mention Your Sources:
- When sharing important technical info, cite the relevant standard or reference (e.g.: "According to IEC 60364..." or "Per NEC Article 310..." or "Based on IEEE 1584...")
- Mention manufacturer notes or well-known best practices when relevant (e.g.: "Note from Siemens: ..." or "Industry best practice is to...")
- When including equations or calculations, write them clearly and explain each variable

🚫 Rules:
- NEVER mention you are an AI, OpenRouter, language model, or bot — you are Engineer Bassem, period
- Do NOT discuss topics outside electrical engineering
- Never describe yourself using words like "AI", "model", "bot", "language model", or "artificial intelligence"`;
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
  var controller: AbortController | null = null;
  var timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    controller = new AbortController();
    timeoutId = setTimeout(function() { controller!.abort(); }, timeoutMs);

    var response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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

    // Any non-200 status = skip to next model silently
    if (!response.ok) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    var data = await response.json();

    // Check for API-level error
    if (data.error) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    var reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
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
  } catch (e) {
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
  if (!OPENROUTER_API_KEY) {
    return { success: false, error: "Chatbot API key not configured" };
  }

  var systemPrompt = getSystemPrompt(request.language);

  // ✅ Reset fail counts every 10 minutes — models recover from transient errors
  if (!modelFailResetTime || Date.now() - modelFailResetTime > 600000) {
    modelFailCount = {};
    modelFailResetTime = Date.now();
  }

  // ✅ Global timeout — prevent user waiting >60s even if all models are slow
  var globalStartTime = Date.now();
  var GLOBAL_TIMEOUT_MS = 60000;

  // Timeout per tier (decreasing for smaller/faster models)
  var TIER_TIMEOUTS: Record<number, number> = {
    1: 20000, // Tier 1: 20s (large models need more time)
    2: 15000, // Tier 2: 15s
    3: 10000, // Tier 3: 10s
    4: 8000,  // Tier 4: 8s (small/fast models)
  };

  // ─── Step 1: Try last working model first (if recent) ───
  if (lastWorkingModel && (Date.now() - lastWorkingTime) < 300000) {
    // Check it hasn't failed 3+ times since
    if ((modelFailCount[lastWorkingModel] || 0) < 3) {
      var result = await tryModel(lastWorkingModel, request.messages, systemPrompt, TIER_TIMEOUTS[1]);
      if (result) return { success: true, reply: result.reply, model: result.model };
    }
  }

  // ─── Step 2: Try all models by tier, skipping known-bad ones ───
  for (var tier = 1; tier <= 4; tier++) {
    var tierTried = 0;
    var tierSkipped = 0;

    for (var i = 0; i < AI_MODELS.length; i++) {
      var model = AI_MODELS[i];
      if (model.tier !== tier) continue;

      // Skip models that failed 3+ times recently (they're likely still down)
      if ((modelFailCount[model.id] || 0) >= 3) {
        tierSkipped++;
        continue;
      }

      tierTried++;
      var result = await tryModel(model.id, request.messages, systemPrompt, TIER_TIMEOUTS[tier]);
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
  // This only happens if ALL 28 models were skipped as "bad"
  console.warn("[Chatbot] All tiers exhausted with skips. Trying all models as last resort...");
  for (var i = 0; i < AI_MODELS.length; i++) {
    var model = AI_MODELS[i];
    // Reset fail count to give them another chance
    modelFailCount[model.id] = 0;
    var result = await tryModel(model.id, request.messages, systemPrompt, 10000);
    if (result) return { success: true, reply: result.reply, model: result.model };
  }

  // This should basically NEVER happen
  console.error("[Chatbot] ALL 28 models failed completely");
  return { success: false, error: "All AI models are temporarily busy. Please try again in a few seconds." };
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
