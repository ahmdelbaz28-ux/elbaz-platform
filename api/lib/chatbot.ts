/**
 * GENIUS CHATBOT — 3-tier provider cascade
 *
 * Strategy:
 *   1. PRIMARY: Modal — zai-org/GLM-5.1-FP8 (reasoning model, best quality)
 *   2. SECONDARY: Groq — DeepSeek V4, MiMo, Big Pickle, North Mini Code (free, fast)
 *   3. FALLBACK: OpenRouter — free-model cascade (21 models)
 *
 * The user never sees which provider answered, never sees any error, and never
 * sees internal reasoning. If all tiers fail, a friendly error is shown.
 *
 * ARCHITECTURE:
 *   chatbot.ts        — Config, health tracking, non-streaming provider functions, getChatResponse
 *   chatbot-stream.ts — SSE streaming for all providers, getStreamResponse, pickWorkingModel
 *   chatbot-prompts.ts — System prompt builder (getSystemPrompt)
 */

import { env } from "../lib/env";
import { getSystemPrompt } from "./chatbot-prompts.js";
import { logger } from "./logger.js";

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ════════════════════════════════════════════════════════════════════════
// PROVIDER CONFIG
// ════════════════════════════════════════════════════════════════════════

// ── TIER 1: Modal (GLM-5.1-FP8) — Primary ─────────────────────────────
export const MODAL_API_KEY =
  env.MODAL_API_KEY || process.env.MODAL_API_KEY || "";
export const MODAL_ENDPOINT = "https://api.us-west-2.modal.direct/v1/chat/completions";
export const MODAL_MODEL = "zai-org/GLM-5.1-FP8";

// ── TIER 2: Groq — Secondary (free ultra-fast models) ───────────────────
export const GROQ_API_KEY =
  env.GROQ_API_KEY || process.env.GROQ_API_KEY || "";
export const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODELS = [
  "llama-3.3-70b-versatile",           // 374ms | Best quality free
  "qwen/qwen3-32b",                    // 732ms | New reasoning model
  "llama-3.1-8b-instant",              // 200ms | Fastest, 131K context
  "meta-llama/llama-4-scout-17b-16e-instruct", // 435ms | New Llama 4
  "qwen/qwen3.6-27b",                  // 565ms | Qwen 3.6 latest
];

// ── TIER 2.5: NVIDIA (MiniMax-M3) — Third tier ─────────────────────────
export const NVIDIA_API_KEY =
  env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY || "";
export const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_MODEL = "minimaxai/minimax-m3";

// ── TIER 3: OpenRouter — Fallback cascade ──────────────────────────────
// Support both CHATBOT_API_KEY (from .env template) and OPENROUTER_API_KEY (legacy)
export const OPENROUTER_API_KEY =
  env.OPENROUTER_API_KEY || process.env.CHATBOT_API_KEY || "";

// ════════════════════════════════════════════════════════════════════════
// HEALTH TRACKING — remember which provider works to optimize routing
// ════════════════════════════════════════════════════════════════════════

// ── Shared mutable health state ──
// ESM rule: imported bindings are read-only. Reassignment (e.g. chatHealth.modalConsecFails++)
// from another module throws TypeError. We use a single exported OBJECT whose
// properties are freely mutable from any importer — the standard ESM pattern.
export const chatHealth = {
  modalKeyValid: null as boolean | null,
  modalConsecFails: 0,
  modalLastSuccess: 0,
  modalLastFailTime: 0,

  groqKeyValid: null as boolean | null,
  groqConsecFails: 0,
  groqLastSuccess: 0,
  groqLastFailTime: 0,
  groqCurrentModelIndex: 0,

  nvidiaKeyValid: null as boolean | null,
  nvidiaConsecFails: 0,
  nvidiaLastSuccess: 0,
  nvidiaLastFailTime: 0,

  openrouterKeyValidated: false,
  openrouterKeyValid: null as boolean | null,

  lastWorkingModel: "",
  lastWorkingTime: 0,
  modelFailResetTime: 0,
};

// These are const objects — mutating their properties IS legal in ESM
export const modelSuccessCount: Record<string, number> = {};
export const modelFailCount: Record<string, number> = {};

export const MODAL_COOLDOWN_MS = 5 * 60_000;
export const MAX_CONSEC_MODAL_FAILS = 5;
export const GROQ_COOLDOWN_MS = 2 * 60_000;
export const MAX_CONSEC_GROQ_FAILS = 5;
export const NVIDIA_COOLDOWN_MS = 2 * 60_000;
export const MAX_CONSEC_NVIDIA_FAILS = 5;

// ════════════════════════════════════════════════════════════════════════
// OPENROUTER FALLBACK MODEL POOL — 21 free models, strongest -> weakest
// ════════════════════════════════════════════════════════════════════════

export const AI_MODELS = [
  { id: "google/gemma-4-31b-it:free",                   ctx: 262144, tier: 1 },
  { id: "nvidia/nemotron-3-super-120b-a12b:free",        ctx: 262144, tier: 1 },

  { id: "google/gemma-4-26b-a4b-it:free",               ctx: 262144, tier: 2 },
  { id: "meta-llama/llama-3.3-70b-instruct:free",       ctx: 65536,  tier: 2 },
  { id: "deepseek/deepseek-chat-v3:free",                ctx: 131072, tier: 2 },
  { id: "qwen/qwen3-32b:free",                          ctx: 131072, tier: 2 },
  { id: "inclusionai/ring-2.6-1t:free",                 ctx: 262144, tier: 2 },
  { id: "minimax/minimax-m2.5:free",                    ctx: 196608, tier: 2 },
  { id: "z-ai/glm-4.5-air:free",                        ctx: 131072, tier: 2 },
  { id: "arcee-ai/trinity-large-thinking:free",          ctx: 131072, tier: 2 },
  { id: "qwen/qwen3-coder:free",                        ctx: 262000, tier: 2 },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", ctx: 256000, tier: 2 },
  { id: "qwen/qwen3-next-80b-a3b-instruct:free",         ctx: 262144, tier: 2 },
  { id: "baidu/cobuddy:free",                           ctx: 131072, tier: 2 },
  { id: "poolside/laguna-m.1:free",                     ctx: 131072, tier: 2 },
  { id: "poolside/laguna-xs.2:free",                    ctx: 131072, tier: 2 },
  { id: "meta-llama/llama-3.2-3b-instruct:free",       ctx: 131072, tier: 2 },
  { id: "nvidia/nemotron-3-nano-30b-a3b:free",          ctx: 256000, tier: 2 },
  { id: "nvidia/nemotron-nano-12b-v2-vl:free",          ctx: 128000, tier: 2 },
  { id: "nvidia/nemotron-nano-9b-v2:free",              ctx: 128000, tier: 2 },
  { id: "liquid/lfm-2.5-1.2b-thinking:free",             ctx: 32768,  tier: 2 },
  { id: "liquid/lfm-2.5-1.2b-instruct:free",            ctx: 32768,  tier: 2 },
];

// ════════════════════════════════════════════════════════════════════════
// MODAL (TIER 1) — non-streaming
// ════════════════════════════════════════════════════════════════════════

export async function validateModalKey(): Promise<boolean> {
  if (!MODAL_API_KEY.startsWith("modalresearch_") && !MODAL_API_KEY.startsWith("ak-")) {
    logger.warn("[Chatbot/Modal] API key has unexpected format", { keyPrefix: `${MODAL_API_KEY.substring(0, 15)}...` });
  }
  chatHealth.modalKeyValid = true;
  logger.info("[Chatbot/Modal] API key configured (will be validated on first request).");
  return true;
}

export function modalIsAvailable(): boolean {
  if (!MODAL_API_KEY) return false;
  if (chatHealth.modalKeyValid === false) return false;
  if (chatHealth.modalConsecFails >= MAX_CONSEC_MODAL_FAILS) {
    if (chatHealth.modalLastFailTime && Date.now() - chatHealth.modalLastFailTime < MODAL_COOLDOWN_MS) {
      return false;
    }
  }
  return true;
}

export async function tryModal(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  timeoutMs: number
): Promise<{ reply: string; model: string } | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => { controller.abort(); }, timeoutMs);

    const response = await fetch(MODAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MODAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODAL_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }

    if (response.status === 401 || response.status === 403) {
      chatHealth.modalKeyValid = false;
      chatHealth.modalConsecFails++;
      chatHealth.modalLastFailTime = Date.now();
      logger.error("[Chatbot/Modal] request rejected", { status: response.status });
      return null;
    }
    if (!response.ok) {
      chatHealth.modalConsecFails++;
      chatHealth.modalLastFailTime = Date.now();
      return null;
    }

    const data = await response.json() as {
      error?: unknown;
      choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
    };

    if (data.error) {
      chatHealth.modalConsecFails++;
      chatHealth.modalLastFailTime = Date.now();
      return null;
    }

    const reply = data.choices?.[0]?.message?.content ?? "";

    if (!reply || reply.trim().length === 0) {
      chatHealth.modalConsecFails++;
      chatHealth.modalLastFailTime = Date.now();
      return null;
    }

    chatHealth.modalConsecFails = 0;
    chatHealth.modalLastSuccess = Date.now();
    chatHealth.modalKeyValid = true;
    return { reply: reply.trim(), model: MODAL_MODEL };
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    chatHealth.modalConsecFails++;
    chatHealth.modalLastFailTime = Date.now();
    logger.warn("[Chatbot/Modal] request failed", { error: String(e) });
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// GROQ (TIER 2) — non-streaming
// ════════════════════════════════════════════════════════════════════════

export async function validateGroqKey(): Promise<boolean> {
  if (!GROQ_API_KEY) {
    chatHealth.groqKeyValid = false;
    return false;
  }
  chatHealth.groqKeyValid = true;
  logger.info("[Chatbot/Groq] API key configured.");
  return true;
}

export function groqIsAvailable(): boolean {
  if (!GROQ_API_KEY) return false;
  if (chatHealth.groqKeyValid === false) return false;
  if (chatHealth.groqConsecFails >= MAX_CONSEC_GROQ_FAILS) {
    if (chatHealth.groqLastFailTime && Date.now() - chatHealth.groqLastFailTime < GROQ_COOLDOWN_MS) {
      return false;
    }
  }
  return true;
}

export async function tryGroq(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  modelId: string,
  timeoutMs: number
): Promise<{ reply: string; model: string } | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => { controller.abort(); }, timeoutMs);

    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }

    if (response.status === 401 || response.status === 403) {
      chatHealth.groqKeyValid = false;
      chatHealth.groqConsecFails++;
      chatHealth.groqLastFailTime = Date.now();
      logger.error("[Chatbot/Groq] request rejected", { status: response.status });
      return null;
    }

    if (!response.ok) {
      chatHealth.groqConsecFails++;
      chatHealth.groqLastFailTime = Date.now();
      return null;
    }

    const data = await response.json() as {
      error?: unknown;
      choices?: { message?: { content?: string | null } }[];
    };

    if (data.error) {
      chatHealth.groqConsecFails++;
      chatHealth.groqLastFailTime = Date.now();
      return null;
    }

    const reply = data.choices?.[0]?.message?.content ?? "";

    if (!reply || reply.trim().length === 0) {
      chatHealth.groqConsecFails++;
      chatHealth.groqLastFailTime = Date.now();
      return null;
    }

    chatHealth.groqConsecFails = 0;
    chatHealth.groqLastSuccess = Date.now();
    chatHealth.groqKeyValid = true;
    return { reply: reply.trim(), model: modelId };
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    chatHealth.groqConsecFails++;
    chatHealth.groqLastFailTime = Date.now();
    logger.warn("[Chatbot/Groq] request failed", { error: String(e) });
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// NVIDIA (MINIMAX-M3) — non-streaming
// ════════════════════════════════════════════════════════════════════════

export function nvidiaIsAvailable(): boolean {
  if (!NVIDIA_API_KEY) return false;
  if (chatHealth.nvidiaKeyValid === false) return false;
  if (chatHealth.nvidiaConsecFails >= MAX_CONSEC_NVIDIA_FAILS) {
    if (chatHealth.nvidiaLastFailTime && Date.now() - chatHealth.nvidiaLastFailTime < NVIDIA_COOLDOWN_MS) {
      return false;
    }
  }
  return true;
}

export async function tryNvidia(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  timeoutMs: number
): Promise<{ reply: string; model: string } | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => { controller.abort(); }, timeoutMs);

    const response = await fetch(NVIDIA_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }

    if (response.status === 401 || response.status === 403) {
      chatHealth.nvidiaKeyValid = false;
      chatHealth.nvidiaConsecFails++;
      chatHealth.nvidiaLastFailTime = Date.now();
      logger.error("[Chatbot/NVIDIA] request rejected", { status: response.status });
      return null;
    }

    if (!response.ok) {
      chatHealth.nvidiaConsecFails++;
      chatHealth.nvidiaLastFailTime = Date.now();
      return null;
    }

    const data = await response.json() as {
      error?: unknown;
      choices?: { message?: { content?: string | null } }[];
    };

    if (data.error) {
      chatHealth.nvidiaConsecFails++;
      chatHealth.nvidiaLastFailTime = Date.now();
      return null;
    }

    const reply = data.choices?.[0]?.message?.content ?? "";

    if (!reply || reply.trim().length === 0) {
      chatHealth.nvidiaConsecFails++;
      chatHealth.nvidiaLastFailTime = Date.now();
      return null;
    }

    chatHealth.nvidiaConsecFails = 0;
    chatHealth.nvidiaLastSuccess = Date.now();
    chatHealth.nvidiaKeyValid = true;
    return { reply: reply.trim(), model: NVIDIA_MODEL };
  } catch (e) {
    if (timeoutId) clearTimeout(timeoutId);
    chatHealth.nvidiaConsecFails++;
    chatHealth.nvidiaLastFailTime = Date.now();
    logger.warn("[Chatbot/NVIDIA] request failed", { error: String(e) });
    return null;
  }
}

export async function nvidiaFallback(
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<{ reply: string; model: string } | null> {
  if (!nvidiaIsAvailable()) return null;
  const result = await tryNvidia(messages, systemPrompt, 30000);
  return result;
}

// ════════════════════════════════════════════════════════════════════════
// OPENROUTER (TIER 3) — non-streaming
// ════════════════════════════════════════════════════════════════════════

export async function validateOpenRouterKey(): Promise<boolean> {
  if (!OPENROUTER_API_KEY) {
    chatHealth.openrouterKeyValid = false;
    chatHealth.openrouterKeyValidated = true;
    logger.warn("[Chatbot/OpenRouter] No OPENROUTER_API_KEY configured — chatbot will not work without either MODAL_API_KEY or OPENROUTER_API_KEY.");
    return false;
  }
  if (!OPENROUTER_API_KEY.startsWith("sk-or-")) {
    chatHealth.openrouterKeyValid = false;
    chatHealth.openrouterKeyValidated = true;
    logger.error("[Chatbot/OpenRouter] Invalid API key format — must start with 'sk-or-'", { keyPrefix: `${OPENROUTER_API_KEY.substring(0, 6)}...` });
    return false;
  }
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    chatHealth.openrouterKeyValid = resp.ok;
    chatHealth.openrouterKeyValidated = true;
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      logger.error("[Chatbot/OpenRouter] API key validation failed", { error: JSON.stringify(errData) });
      logger.error("[Chatbot/OpenRouter] The OPENROUTER_API_KEY in HF Space Secrets is invalid or expired.");
      logger.error("[Chatbot/OpenRouter] Get a new key at https://openrouter.ai/keys and update it in HF Space Settings → Repository secrets.");
    } else {
      logger.info("[Chatbot/OpenRouter] API key validated successfully.");
    }
    return chatHealth.openrouterKeyValid;
  } catch (e) {
    logger.warn("[Chatbot/OpenRouter] Could not validate API key (network error — assuming valid)", { error: String(e) });
    chatHealth.openrouterKeyValid = true;
    chatHealth.openrouterKeyValidated = true;
    return true;
  }
}

export async function tryModel(
  modelId: string,
  messages: { role: string; content: string }[],
  systemPrompt: string,
  timeoutMs: number
): Promise<{ reply: string; model: string } | null> {
  let controller: AbortController | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    controller = new AbortController();
    timeoutId = setTimeout(() => { controller!.abort(); }, timeoutMs);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ahmedelbaz.qzz.io",
        "X-Title": "Elbaz LMS Chatbot",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (response.status === 401) {
      logger.error("[Chatbot/OpenRouter] API key returned 401 Unauthorized — key is invalid or expired");
      chatHealth.openrouterKeyValid = false;
      chatHealth.openrouterKeyValidated = true;
      return null;
    }

    if (!response.ok) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    const data = await response.json() as { error?: unknown; choices?: { message?: { content?: string } }[] };

    if (data.error) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    const reply = data.choices?.[0]?.message?.content;
    if (!reply || reply.trim().length === 0) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    modelSuccessCount[modelId] = (modelSuccessCount[modelId] || 0) + 1;
    modelFailCount[modelId] = 0;
    chatHealth.lastWorkingModel = modelId;
    chatHealth.lastWorkingTime = Date.now();

    return { reply: reply.trim(), model: modelId };
  } catch {
    if (timeoutId) clearTimeout(timeoutId);
    modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
    return null;
  }
}

export async function tryLastWorkingModel(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  tierTimeouts: Record<number, number>,
): Promise<{ reply: string; model: string } | null> {
  if (!chatHealth.lastWorkingModel) return null;
  if ((Date.now() - chatHealth.lastWorkingTime) >= 300000) return null;
  if ((modelFailCount[chatHealth.lastWorkingModel] || 0) >= 3) return null;
  return await tryModel(chatHealth.lastWorkingModel, messages, systemPrompt, tierTimeouts[1]);
}

export async function tryModelsByTier(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  tierTimeouts: Record<number, number>,
  globalStartTime: number,
  globalTimeoutMs: number,
): Promise<{ reply: string; model: string } | null> {
  for (let tier = 1; tier <= 4; tier++) {
    let tierTried = 0;
    let tierSkipped = 0;

    for (const model of AI_MODELS) {
      if (model.tier !== tier) continue;
      if ((modelFailCount[model.id] || 0) >= 3) {
        tierSkipped++;
        continue;
      }
      tierTried++;
      const result = await tryModel(model.id, messages, systemPrompt, tierTimeouts[tier]);
      if (result) return result;
    }

    logger.info(`[Chatbot/OpenRouter] Tier ${tier}: tried ${tierTried}, skipped ${tierSkipped}`);
    if (Date.now() - globalStartTime > globalTimeoutMs) {
      logger.warn(`[Chatbot/OpenRouter] Global timeout reached (${Math.round((Date.now() - globalStartTime) / 1000)}s)`);
      break;
    }
  }
  return null;
}

export async function tryAllModelsAsLastResort(
  messages: { role: string; content: string }[],
  systemPrompt: string,
): Promise<{ reply: string; model: string } | null> {
  logger.warn("[Chatbot/OpenRouter] All tiers exhausted with skips. Trying all models as last resort...");
  for (const model of AI_MODELS) {
    modelFailCount[model.id] = 0;
    const result = await tryModel(model.id, messages, systemPrompt, 10000);
    if (result) return result;
  }
  return null;
}

export async function openRouterFallback(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  _language?: string
): Promise<{ reply: string; model: string } | null> {
  if (!chatHealth.openrouterKeyValidated) {
    await validateOpenRouterKey();
  }
  if (chatHealth.openrouterKeyValid === false) return null;

  if (!chatHealth.modelFailResetTime || Date.now() - chatHealth.modelFailResetTime > 600000) {
    for (const k in modelFailCount) { modelFailCount[k] = 0; }
    chatHealth.modelFailResetTime = Date.now();
  }

  const globalStartTime = Date.now();
  const GLOBAL_TIMEOUT_MS = 60000;

  const TIER_TIMEOUTS: Record<number, number> = {
    1: 20000,
    2: 15000,
    3: 10000,
    4: 8000,
  };

  const lastResult = await tryLastWorkingModel(messages, systemPrompt, TIER_TIMEOUTS);
  if (lastResult) return lastResult;

  const tierResult = await tryModelsByTier(messages, systemPrompt, TIER_TIMEOUTS, globalStartTime, GLOBAL_TIMEOUT_MS);
  if (tierResult) return tierResult;

  const lastResort = await tryAllModelsAsLastResort(messages, systemPrompt);
  if (lastResort) return lastResort;

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// MAIN: non-streaming response
// ════════════════════════════════════════════════════════════════════════

function buildSuccessResult(result: { reply: string; model: string }): { success: boolean; reply: string; model: string } {
  return { success: true, reply: result.reply, model: result.model };
}

function buildAllTiersFailedResponse(language?: string): { success: boolean; error: string } {
  const modalDead = chatHealth.modalKeyValid === false || !MODAL_API_KEY;
  const groqDead = chatHealth.groqKeyValid === false || !GROQ_API_KEY;
  const orDead = chatHealth.openrouterKeyValid === false || !OPENROUTER_API_KEY;

  if (modalDead && groqDead && orDead) {
    return {
      success: false,
      error: language === "ar"
        ? "مفتاحات API الخاصة بالشات بوت غير مُهيأة أو غير صالحة. يرجى التواصل مع الدعم الفني."
        : "The chatbot API keys are not configured or invalid. Please contact support.",
    };
  }

  logger.error("[Chatbot] All tiers failed (Modal + Groq + OpenRouter).");
  return {
    success: false,
    error: language === "ar"
      ? "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل."
      : "All AI models are temporarily busy. Please try again in a few seconds.",
  };
}

export async function tryModalTier(
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<{ success: boolean; reply?: string; model?: string } | null> {
  if (!modalIsAvailable()) {
    logger.info("[Chatbot] Modal not available — trying Groq next.");
    return null;
  }
  if (chatHealth.modalKeyValid === null) {
    await validateModalKey();
  }
  if (!modalIsAvailable()) return null;

  let result = await tryModal(messages, systemPrompt, 180000);
  if (result) return buildSuccessResult(result);

  logger.warn("[Chatbot] Modal attempt 1 failed — waiting 5s then retrying (5min timeout)...");
  await sleep(5000);
  result = await tryModal(messages, systemPrompt, 300000);
  if (result) return buildSuccessResult(result);

  logger.warn("[Chatbot] Modal attempt 2 failed — waiting 10s then FINAL retry (8min timeout)...");
  await sleep(10000);
  result = await tryModal(messages, systemPrompt, 480000);
  if (result) return buildSuccessResult(result);

  logger.error("[Chatbot] GLM-5.1 completely failed after 3 attempts.");
  return null;
}

export async function tryGroqTier(
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<{ success: boolean; reply?: string; model?: string } | null> {
  if (!groqIsAvailable()) {
    logger.info("[Chatbot] Groq not available — trying NVIDIA...");
    const nvidiaResult = await nvidiaFallback(messages, systemPrompt);
    if (nvidiaResult) return buildSuccessResult(nvidiaResult);
    logger.info("[Chatbot] NVIDIA also not available — using OpenRouter fallback.");
    return null;
  }
  if (chatHealth.groqKeyValid === null) {
    await validateGroqKey();
  }
  if (!groqIsAvailable()) return null;

  for (let i = 0; i < GROQ_MODELS.length; i++) {
    chatHealth.groqCurrentModelIndex = i;
    const modelId = GROQ_MODELS[i];

    let result = await tryGroq(messages, systemPrompt, modelId, 120000);
    if (result) return buildSuccessResult(result);

    result = await tryGroq(messages, systemPrompt, modelId, 180000);
    if (result) return buildSuccessResult(result);

    logger.warn(`[Chatbot] Groq/${modelId} failed after 2 attempts — trying next model...`);
  }

  logger.error("[Chatbot] All Groq models failed — falling back to NVIDIA (MiniMax-M3).");
  const nvidiaResult = await nvidiaFallback(messages, systemPrompt);
  if (nvidiaResult) return buildSuccessResult(nvidiaResult);
  logger.error("[Chatbot] NVIDIA also failed — falling back to OpenRouter.");
  return null;
}

export async function getChatResponse(request: {
  messages: { role: string; content: string }[];
  language?: string;
  mode?: "thinking" | "instant";
}): Promise<{ success: boolean; reply?: string; error?: string; model?: string }> {
  const systemPrompt = getSystemPrompt(request.language);
  const mode = request.mode || "thinking";

  if (mode === "thinking") {
    const modalResult = await tryModalTier(request.messages, systemPrompt);
    if (modalResult) return modalResult;
  }

  const groqResult = await tryGroqTier(request.messages, systemPrompt);
  if (groqResult) return groqResult;

  const orResult = await openRouterFallback(request.messages, systemPrompt, request.language);
  if (orResult) return buildSuccessResult(orResult);

  if (mode === "instant") {
    const modalResult = await tryModalTier(request.messages, systemPrompt);
    if (modalResult) return modalResult;
  }

  return buildAllTiersFailedResponse(request.language);
}

// ════════════════════════════════════════════════════════════════════════
// NON-STREAMING GROQ FALLBACK (used by streaming fallback path)
// ════════════════════════════════════════════════════════════════════════

export async function groqFallback(
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<{ reply: string; model: string } | null> {
  for (const modelId of GROQ_MODELS) {
    const result = await tryGroq(messages, systemPrompt, modelId, 120000);
    if (result) return result;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════
// STATS / MONITORING
// ════════════════════════════════════════════════════════════════════════

export function getChatbotStats() {
  return {
    tier1: {
      provider: "modal",
      model: MODAL_MODEL,
      configured: !!MODAL_API_KEY,
      keyValid: chatHealth.modalKeyValid,
      consecFails: chatHealth.modalConsecFails,
      lastSuccessAgo: chatHealth.modalLastSuccess ? `${Math.round((Date.now() - chatHealth.modalLastSuccess) / 1000)}s ago` : "never",
      available: modalIsAvailable(),
    },
    tier2: {
      provider: "groq",
      models: GROQ_MODELS,
      currentModel: GROQ_MODELS[chatHealth.groqCurrentModelIndex] || GROQ_MODELS[0],
      configured: !!GROQ_API_KEY,
      keyValid: chatHealth.groqKeyValid,
      consecFails: chatHealth.groqConsecFails,
      lastSuccessAgo: chatHealth.groqLastSuccess ? `${Math.round((Date.now() - chatHealth.groqLastSuccess) / 1000)}s ago` : "never",
      available: groqIsAvailable(),
    },
    tier2_5: {
      provider: "nvidia",
      model: NVIDIA_MODEL,
      configured: !!NVIDIA_API_KEY,
      keyValid: chatHealth.nvidiaKeyValid,
      consecFails: chatHealth.nvidiaConsecFails,
      lastSuccessAgo: chatHealth.nvidiaLastSuccess ? `${Math.round((Date.now() - chatHealth.nvidiaLastSuccess) / 1000)}s ago` : "never",
      available: nvidiaIsAvailable(),
    },
    tier3: {
      provider: "openrouter",
      configured: !!OPENROUTER_API_KEY,
      keyValid: chatHealth.openrouterKeyValid,
      totalModels: AI_MODELS.length,
      lastWorkingModel: chatHealth.lastWorkingModel,
      lastWorkingTimeAgo: chatHealth.lastWorkingTime ? `${Math.round((Date.now() - chatHealth.lastWorkingTime) / 1000)}s ago` : "never",
      modelSuccessCounts: modelSuccessCount,
      modelFailCounts: modelFailCount,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
// RE-EXPORTS from sub-modules
// ════════════════════════════════════════════════════════════════════════

// Streaming functions are implemented in chatbot-stream.ts.
// They are re-exported here so that chatbot.ts remains the single import
// target for downstream consumers (chatbot-router.ts, chatbot.test.ts).
export { getStreamResponse, pickWorkingModel } from "./chatbot-stream.js";

