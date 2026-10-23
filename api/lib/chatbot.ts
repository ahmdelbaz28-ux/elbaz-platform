/**
 * GENIUS CHATBOT — FREE-provider cascade, mode-aware routing
 *
 * Strategy (Modal removed 2026-10: service permanently 503 — replaced by
 * a fully-free cascade over NVIDIA + OpenRouter + Groq):
 *   1. NVIDIA     — minimaxai/minimax-m3 (230B MoE reasoning, strongest free)
 *   2. OpenRouter — 22 free models, tier 1 (strongest) → tier 2, with
 *                   last-working-model shortcut and 3-strike model skipping
 *   3. Groq       — llama-3.3-70b → qwen3-32b → llama-4-scout → llama-3.1-8b
 *                   (ultra-fast, absorbs OpenRouter free-tier rate limits)
 *   4. SAFETY NET: full OpenRouter sweep ignoring per-model fail counters —
 *                   guarantees the user ALWAYS gets a reply if ANY model works.
 *
 * MODES (thinking | instant) are now genuinely different:
 *   thinking → DEEP prompt + temp 0.3 + 4096 tokens + strongest-first routing
 *              (NVIDIA → OpenRouter tier-1 → Groq)
 *   instant  → CONCISE prompt + temp 0.7 + 1024 tokens + fastest-first routing
 *              (Groq → OpenRouter preferred-fast model → NVIDIA) + short
 *              fail-fast timeouts. The modes never collapse onto the same
 *              model: instant skips thinking's last-working-model shortcut.
 *   Tuning table: MODE_TUNING in chatbot-prompts.ts.
 *
 * The user never sees which provider answered, never sees any error, and never
 * sees internal reasoning. If all tiers fail, a friendly error is shown.
 *
 * ARCHITECTURE:
 *   chatbot.ts        — Config, health tracking, non-streaming provider functions, getChatResponse
 *   chatbot-stream.ts — SSE streaming for all providers, getStreamResponse, pickWorkingModel
 *   chatbot-prompts.ts — System prompt builder (getSystemPrompt) + MODE_TUNING
 *   chatbot-skills.ts — Skill blocks (source-routing, PF/SKM/PVSyst cores, mentor, platform facts)
 *   course-catalog.ts — Real course data for prompt injection (getCourseCatalogText)
 */

import { env } from "../lib/env";
import { getSystemPrompt, MODE_TUNING, type ChatbotMode, type ModeTuning } from "./chatbot-prompts.js";
import { logger } from "./logger.js";
import { routeChatCompletion } from "./ai-router.js";
import { stripThinkBlocks } from "./think-filter.js";
import { buildAugmentedTextMessages, buildVisionFailureMessages, readImageViaVisionModels } from "./chatbot-vision.js";

// ════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ── Multimodal content types (OpenAI-compatible vision format) ──
// A message's content is a plain string OR an array of typed parts. Only the
// LAST user message of a request may carry image parts (the router flattens
// everything else to text), and when it does the request is routed ONLY to
// vision-capable models.
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatApiMessage {
  role: string;
  content: string | ContentPart[];
}

// ════════════════════════════════════════════════════════════════════════
// PROVIDER CONFIG
// ════════════════════════════════════════════════════════════════════════

// ── TIER 1: NVIDIA (MiniMax-M3) — Primary (free) ──────────────────────
export const NVIDIA_API_KEY =
  env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY || "";
export const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_MODEL = "minimaxai/minimax-m3";

// ── TIER 2: Groq — Tertiary (free ultra-fast models) ──────────────────
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

// ── VISION MODELS — image understanding (forced routing for image requests) ──
// When the last user message carries an image, ONLY these models may serve it.
// Text-only models (NVIDIA MiniMax-M3 and most OpenRouter ids) are EXCLUDED:
// they would either reject the image parts or hallucinate around them.
export const GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"; // multimodal Llama 4 Scout
export const OPENROUTER_VISION_MODELS = [
  "nvidia/nemotron-3.5-super-vl:free", // VL = vision-language (free tier)
];

// ── TIER 1.5: OpenRouter — Secondary (22-model free cascade) ───────────
// Support both CHATBOT_API_KEY (from .env template) and OPENROUTER_API_KEY (legacy)
export const OPENROUTER_API_KEY =
  env.OPENROUTER_API_KEY || process.env.CHATBOT_API_KEY || "";

// ════════════════════════════════════════════════════════════════════════
// HEALTH TRACKING — remember which provider works to optimize routing
// ════════════════════════════════════════════════════════════════════════

// ── Shared mutable health state ──
// ESM rule: imported bindings are read-only. Reassignment of scalars
// (e.g. chatHealth.groqConsecFails++) from another module throws TypeError. We use a
// single exported OBJECT whose properties are freely mutable from any importer — the
// standard ESM pattern.
export const chatHealth = {
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
  // Per-mode last-working OpenRouter model — prevents cross-mode collapse:
  // instant must never inherit thinking's tier-1 model and vice versa.
  lastWorkingByMode: {
    thinking: { model: "", time: 0 },
    instant: { model: "", time: 0 },
  } as Record<"thinking" | "instant", { model: string; time: number }>,
  modelFailResetTime: 0,
};

// These are const objects — mutating their properties IS legal in ESM
export const modelSuccessCount: Record<string, number> = {};
export const modelFailCount: Record<string, number> = {};

export const GROQ_COOLDOWN_MS = 2 * 60_000;
export const MAX_CONSEC_GROQ_FAILS = 5;
export const NVIDIA_COOLDOWN_MS = 2 * 60_000;
export const MAX_CONSEC_NVIDIA_FAILS = 5;

// ════════════════════════════════════════════════════════════════════════
// OPENROUTER MODEL POOL — 22 free models, strongest -> weakest
// ════════════════════════════════════════════════════════════════════════

export const AI_MODELS = [
  // tier 1: strongest free reasoning models first (verified live 2026-10-21)
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free",           ctx: 1000000, tier: 1 },
  { id: "nvidia/nemotron-3-super-120b-a12b:free",           ctx: 262144,  tier: 1 },
  { id: "nvidia/nemotron-3.5-lightning:free",               ctx: 1000000, tier: 1 },
  { id: "google/gemma-4-31b-it:free",                       ctx: 262144,  tier: 1 },
  { id: "thinkingmachines/inkling:free",                    ctx: 1048576, tier: 1 },
  { id: "minimax/minimax-m3.1-flash:free",                  ctx: 1000000, tier: 1 },

  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", ctx: 256000, tier: 2 },
  { id: "thinkingmachines/inkling-small:free",               ctx: 1048576, tier: 2 },
  { id: "dots-studio/dots-3-note-preview:free",              ctx: 512000,  tier: 2 },
  { id: "xingchen-agi/xing4.0-29b-a4b:free",                 ctx: 262144,  tier: 2 },
  { id: "nvidia/nemotron-3.5-super-vl:free",                 ctx: 1000000, tier: 2 },
  { id: "google/gemma-4-26b-a4b-it:free",                    ctx: 262144,  tier: 2 },
  { id: "poolside/laguna-s-2.1:free",                        ctx: 262144,  tier: 2 },
  { id: "poolside/laguna-xs-2.1:free",                       ctx: 262144,  tier: 2 },
  { id: "cohere/north-mini-code:free",                       ctx: 256000,  tier: 2 },
  { id: "liquid/lfm-2.5-2.6b:free",                          ctx: 65536,   tier: 2 },
];

// ════════════════════════════════════════════════════════════════════════
// GROQ (TIER 3) — non-streaming
// ════════════════════════════════════════════════════════════════════════

export function validateGroqKey(): boolean {
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
  messages: ChatApiMessage[],
  systemPrompt: string,
  modelId: string,
  timeoutMs: number,
  tuning: ModeTuning = MODE_TUNING.thinking,
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
        temperature: tuning.temperature,
        max_tokens: tuning.maxTokens,
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

    // stripThinkBlocks: hard guarantee — a model that ignores the prompt
    // guard and emits <think> blocks never leaks reasoning to the user.
    // Empty-after-strip counts as a fail (cascade moves to the next model).
    const reply = stripThinkBlocks(data.choices?.[0]?.message?.content ?? "");

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
// NVIDIA (MINIMAX-M3) — TIER 1 non-streaming
// ════════════════════════════════════════════════════════════════════════

export function validateNvidiaKey(): boolean {
  if (!NVIDIA_API_KEY) {
    chatHealth.nvidiaKeyValid = false;
    return false;
  }
  chatHealth.nvidiaKeyValid = true;
  logger.info("[Chatbot/NVIDIA] API key configured (will be validated on first request).");
  return true;
}

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
  messages: ChatApiMessage[],
  systemPrompt: string,
  timeoutMs: number,
  tuning: ModeTuning = MODE_TUNING.thinking,
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
        temperature: tuning.temperature,
        max_tokens: tuning.maxTokens,
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

    // stripThinkBlocks: see tryGroq — zero visible reasoning, ever.
    const reply = stripThinkBlocks(data.choices?.[0]?.message?.content ?? "");

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
  messages: ChatApiMessage[],
  systemPrompt: string,
  tuning?: ModeTuning
): Promise<{ reply: string; model: string } | null> {
  if (!nvidiaIsAvailable()) return null;
  const t = tuning ?? MODE_TUNING.thinking;
  const result = await tryNvidia(messages, systemPrompt, Math.max(30000, Math.round(t.nvidiaStreamTimeoutMs / 2)), t);
  return result;
}

// ════════════════════════════════════════════════════════════════════════
// INSTANT FAST MODEL LANE — small-active-param MoE models (a3b/a4b), tried
// in order when instant mode lands on OpenRouter. Deliberately disjoint
// from thinking's tier-1 so the modes stay on different models.
// ════════════════════════════════════════════════════════════════════════

export const INSTANT_FAST_MODELS = [
  "google/gemma-4-26b-a4b-it:free",                      // MoE A4B — fastest capable (live)
  "xingchen-agi/xing4.0-29b-a4b:free",                   // MoE A4B (live)
  "minimax/minimax-m3.1-flash:free",                     // flash — built for speed (live)
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",  // MoE A3B — proven live in prod 2026-10-21
  "nvidia/nemotron-3.5-lightning:free",                  // lightning tier — fast (live)
  "thinkingmachines/inkling-small:free",                 // small variant, 1M ctx (live)
  // NOTE: models are verified against OpenRouter's live free catalog; ids
  // that drift away now hard-skip (HTTP 404) without burning sweep budget.
];

// ════════════════════════════════════════════════════════════════════════
// OPENROUTER (TIER 3) — non-streaming
// ════════════════════════════════════════════════════════════════════════

export async function validateOpenRouterKey(): Promise<boolean> {
  if (!OPENROUTER_API_KEY) {
    chatHealth.openrouterKeyValid = false;
    chatHealth.openrouterKeyValidated = true;
    logger.warn("[Chatbot/OpenRouter] No OPENROUTER_API_KEY configured — chatbot falls back to NVIDIA/Groq tiers.");
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
  messages: ChatApiMessage[],
  systemPrompt: string,
  timeoutMs: number,
  tuning: ModeTuning = MODE_TUNING.thinking,
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
        temperature: tuning.temperature,
        max_tokens: tuning.maxTokens,
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

    // stripThinkBlocks: see tryGroq — zero visible reasoning, ever.
    const reply = stripThinkBlocks(data.choices?.[0]?.message?.content ?? "");
    if (!reply || reply.trim().length === 0) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      return null;
    }

    modelSuccessCount[modelId] = (modelSuccessCount[modelId] || 0) + 1;
    modelFailCount[modelId] = 0;
    chatHealth.lastWorkingModel = modelId;
    chatHealth.lastWorkingTime = Date.now();
    // Record per-mode so the other mode never inherits this model shortcut
    const modeKey: "thinking" | "instant" = tuning === MODE_TUNING.instant ? "instant" : "thinking";
    chatHealth.lastWorkingByMode[modeKey] = { model: modelId, time: Date.now() };

    return { reply: reply.trim(), model: modelId };
  } catch {
    if (timeoutId) clearTimeout(timeoutId);
    modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
    return null;
  }
}

export async function tryLastWorkingModel(
  messages: ChatApiMessage[],
  systemPrompt: string,
  tierTimeouts: Record<number, number>,
  tuning?: ModeTuning,
): Promise<{ reply: string; model: string } | null> {
  // Mode-scoped shortcut: each mode only reuses a model that THIS mode
  // previously succeeded with — no cross-mode inheritance in either direction.
  const modeKey: "thinking" | "instant" = tuning === MODE_TUNING.instant ? "instant" : "thinking";
  const entry = chatHealth.lastWorkingByMode[modeKey];
  if (!entry || !entry.model) return null;
  if ((Date.now() - entry.time) >= 300000) return null;
  if ((modelFailCount[entry.model] || 0) >= 3) return null;
  return await tryModel(entry.model, messages, systemPrompt, tierTimeouts[1], tuning);
}

export async function tryModelsByTier(
  messages: ChatApiMessage[],
  systemPrompt: string,
  tierTimeouts: Record<number, number>,
  globalStartTime: number,
  globalTimeoutMs: number,
  tuning?: ModeTuning,
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
      const result = await tryModel(model.id, messages, systemPrompt, tierTimeouts[tier], tuning);
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
  messages: ChatApiMessage[],
  systemPrompt: string,
  tuning?: ModeTuning,
): Promise<{ reply: string; model: string } | null> {
  logger.warn("[Chatbot/OpenRouter] All tiers exhausted with skips. Trying all models as last resort...");
  for (const model of AI_MODELS) {
    modelFailCount[model.id] = 0;
    const result = await tryModel(model.id, messages, systemPrompt, 10000, tuning);
    if (result) return result;
  }
  return null;
}

export async function openRouterFallback(
  messages: ChatApiMessage[],
  systemPrompt: string,
  _language?: string,
  tuning?: ModeTuning
): Promise<{ reply: string; model: string } | null> {
  const t = tuning ?? MODE_TUNING.thinking;
  if (!chatHealth.openrouterKeyValidated) {
    await validateOpenRouterKey();
  }
  if (chatHealth.openrouterKeyValid === false) return null;

  if (!chatHealth.modelFailResetTime || Date.now() - chatHealth.modelFailResetTime > 600000) {
    for (const k in modelFailCount) { modelFailCount[k] = 0; }
    chatHealth.modelFailResetTime = Date.now();
  }

  const globalStartTime = Date.now();

  const lastResult = await tryLastWorkingModel(messages, systemPrompt, t.openRouterTierTimeouts, t);
  if (lastResult) return lastResult;

  // Mode's fast lane (instant): try every fast MoE model with a SHORT
  // timeout before the generic tier sweep — one hanging model costs 8s,
  // not the request, and instant never lands on thinking's tier-1 model
  // while any fast model is alive.
  if (t.openRouterPreferredModel) {
    for (const fastModel of INSTANT_FAST_MODELS) {
      if ((modelFailCount[fastModel] || 0) >= 3) continue;
      const fastResult = await tryModel(fastModel, messages, systemPrompt, 8000, t);
      if (fastResult) return fastResult;
    }
  }

  const tierResult = await tryModelsByTier(messages, systemPrompt, t.openRouterTierTimeouts, globalStartTime, t.openRouterGlobalTimeoutMs, t);
  if (tierResult) return tierResult;

  const lastResort = await tryAllModelsAsLastResort(messages, systemPrompt, t);
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
  const nvidiaDead = chatHealth.nvidiaKeyValid === false || !NVIDIA_API_KEY;
  const groqDead = chatHealth.groqKeyValid === false || !GROQ_API_KEY;
  const orDead = chatHealth.openrouterKeyValid === false || !OPENROUTER_API_KEY;

  if (nvidiaDead && groqDead && orDead) {
    return {
      success: false,
      error: language === "ar"
        ? "مفتاحات API الخاصة بالشات بوت غير مُهيأة أو غير صالحة. يرجى التواصل مع الدعم الفني."
        : "The chatbot API keys are not configured or invalid. Please contact support.",
    };
  }

  logger.error("[Chatbot] All tiers failed (NVIDIA + OpenRouter + Groq).");
  return {
    success: false,
    error: language === "ar"
      ? "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل."
      : "All AI models are temporarily busy. Please try again in a few seconds.",
  };
}

export async function tryGroqTier(
  messages: ChatApiMessage[],
  systemPrompt: string,
  tuning: ModeTuning = MODE_TUNING.thinking
): Promise<{ success: boolean; reply?: string; model?: string } | null> {
  if (!groqIsAvailable()) {
    logger.info("[Chatbot] Groq not available (no key or cooldown).");
    return null;
  }
  if (chatHealth.groqKeyValid === null) {
    await validateGroqKey();
  }
  if (!groqIsAvailable()) return null;

  const [firstTimeout, retryTimeout] = tuning.groqAttemptTimeouts;
  for (let i = 0; i < GROQ_MODELS.length; i++) {
    chatHealth.groqCurrentModelIndex = i;
    const modelId = GROQ_MODELS[i];

    let result = await tryGroq(messages, systemPrompt, modelId, firstTimeout, tuning);
    if (result) return buildSuccessResult(result);

    result = await tryGroq(messages, systemPrompt, modelId, retryTimeout, tuning);
    if (result) return buildSuccessResult(result);

    logger.warn(`[Chatbot] Groq/${modelId} failed after 2 attempts — trying next model...`);
  }

  logger.error("[Chatbot] All Groq models failed.");
  return null;
}

/**
 * MAIN non-streaming cascade — mode-aware routing:
 *
 *   thinking (default) — STRONGEST first (accuracy matters most):
 *     1. NVIDIA MiniMax-M3 (230B MoE reasoning — skipped instantly if no key)
 *     2. OpenRouter: last-working shortcut → 22 models tier1→tier2 →
 *        full last-resort sweep (fail counters reset) — all inside openRouterFallback
 *     3. Groq: 5 ultra-fast models × 2 attempts
 *
 *   instant — FASTEST first (latency matters most):
 *     1. Groq: ultra-fast models with short 12s/20s timeouts
 *     2. OpenRouter sweep starting from its preferred FAST model
 *     3. NVIDIA MiniMax-M3
 *
 * Each mode gets its own system prompt + generation params (MODE_TUNING).
 * If every provider fails, a friendly error is returned. As long as ANY of the
 * three free providers has one working model, the user gets a reply.
 *
 * VISION OVERRIDE: when the request carries an image (request.vision), the
 * mode cascade is bypassed ENTIRELY — getVisionResponse routes ONLY to
 * vision-capable models (mandatory: text-only models never see image parts).
 */
export async function getChatResponse(request: {
  messages: ChatApiMessage[];
  language?: string;
  mode?: "thinking" | "instant";
  /** Real course-catalog text (api/lib/course-catalog.ts) — injected into the system prompt. */
  catalog?: string;
  /** Image attached to the last user message — force vision-only routing. */
  vision?: boolean;
  /** Rolling summary of this user's older conversations (chat-history.ts). */
  historySummary?: string;
}): Promise<{ success: boolean; reply?: string; error?: string; model?: string }> {
  if (request.vision) return getVisionResponse(request);

  return runTextCascade({
    messages: request.messages,
    language: request.language,
    mode: request.mode,
    catalog: request.catalog,
    historySummary: request.historySummary,
  });
}

/**
 * The reasoning-first TEXT cascade (dynamic router → legacy env chain).
 * Shared by the plain text path (getChatResponse) and PASS 2 of the vision
 * flow (getVisionResponse answers from the image description via THIS).
 */
async function runTextCascade(request: {
  messages: ChatApiMessage[];
  language?: string;
  mode?: "thinking" | "instant";
  catalog?: string;
  historySummary?: string;
}): Promise<{ success: boolean; reply?: string; error?: string; model?: string }> {
  const mode: ChatbotMode = request.mode === "instant" ? "instant" : "thinking";
  const tuning = MODE_TUNING[mode];
  const systemPrompt = getSystemPrompt(request.language, mode, request.catalog, false, request.historySummary);

  // ─── DYNAMIC ROUTER (v9) — admin-managed providers first ──────────────
  // Any provider the admin configured in the dashboard (with a valid key and
  // discovered models) is tried before the legacy env cascade: priority
  // order → tier order, with automatic model↔provider failover. Null here
  // (no pool / all cooling down / budget spent) drops to the legacy chain
  // below, so the chatbot can never become LESS available than before.
  const routed = await routeChatCompletion({
    messages: request.messages,
    systemPrompt,
    mode,
    vision: false,
    language: request.language,
    // Instant lane hoists the general-purpose fast model (language compliance).
    preferredModelId: tuning.openRouterPreferredModel,
    gen: mode === "instant"
      ? { temperature: tuning.temperature, maxTokens: tuning.maxTokens, attemptTimeoutMs: 10_000, globalBudgetMs: 12_000 }
      : { temperature: tuning.temperature, maxTokens: tuning.maxTokens, attemptTimeoutMs: 20_000, globalBudgetMs: 22_000 },
  });
  if (routed.ok) return buildSuccessResult({ reply: routed.result.reply, model: routed.result.model });

  if (mode === "instant") {
    // INSTANT — fastest provider first: Groq → OpenRouter (fast model) → NVIDIA
    const groqResult = await tryGroqTier(request.messages, systemPrompt, tuning);
    if (groqResult) return groqResult;

    const orResult = await openRouterFallback(request.messages, systemPrompt, request.language, tuning);
    if (orResult) return buildSuccessResult(orResult);

    if (nvidiaIsAvailable()) {
      if (chatHealth.nvidiaKeyValid === null) await validateNvidiaKey();
      if (nvidiaIsAvailable()) {
        const nvidiaResult = await nvidiaFallback(request.messages, systemPrompt, tuning);
        if (nvidiaResult) return buildSuccessResult(nvidiaResult);
      }
    }
  } else {
    // THINKING — strongest provider first: NVIDIA → OpenRouter → Groq
    if (nvidiaIsAvailable()) {
      if (chatHealth.nvidiaKeyValid === null) await validateNvidiaKey();
      if (nvidiaIsAvailable()) {
        const nvidiaResult = await nvidiaFallback(request.messages, systemPrompt, tuning);
        if (nvidiaResult) return buildSuccessResult(nvidiaResult);
      }
    }

    const orResult = await openRouterFallback(request.messages, systemPrompt, request.language, tuning);
    if (orResult) return buildSuccessResult(orResult);

    const groqResult = await tryGroqTier(request.messages, systemPrompt, tuning);
    if (groqResult) return groqResult;
  }

  return buildAllTiersFailedResponse(request.language);
}

// ════════════════════════════════════════════════════════════════════════
// NON-STREAMING GROQ FALLBACK (used by streaming fallback path)
// ════════════════════════════════════════════════════════════════════════

export async function groqFallback(
  messages: ChatApiMessage[],
  systemPrompt: string,
  tuning: ModeTuning = MODE_TUNING.thinking
): Promise<{ reply: string; model: string } | null> {
  const [firstTimeout, retryTimeout] = tuning.groqAttemptTimeouts;
  for (const modelId of GROQ_MODELS) {
    let result = await tryGroq(messages, systemPrompt, modelId, firstTimeout, tuning);
    if (result) return result;
    result = await tryGroq(messages, systemPrompt, modelId, retryTimeout, tuning);
    if (result) return result;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════
// VISION CASCADE (non-streaming) — image requests are routed ONLY to
// vision-capable models: Groq Llama-4-Scout → OpenRouter VL ids.
// The text-only tiers (NVIDIA MiniMax-M3 etc.) are deliberately excluded.
// ════════════════════════════════════════════════════════════════════════

function buildVisionUnavailableResponse(language?: string): { success: boolean; error: string } {
  return {
    success: false,
    error: language === "ar"
      ? "تعذر تحليل الصورة حالياً — خدمة تحليل الصور مشغولة. جرب مرة أخرى بعد قليل أو اكتب سؤالك نصاً ⚡"
      : "Image analysis is temporarily busy. Please try again shortly, or send your question as text ⚡",
  };
}

export async function tryOpenRouterVision(
  messages: ChatApiMessage[],
  systemPrompt: string,
  timeoutMs: number,
  tuning: ModeTuning = MODE_TUNING.thinking,
): Promise<{ reply: string; model: string } | null> {
  for (const modelId of OPENROUTER_VISION_MODELS) {
    const result = await tryModel(modelId, messages, systemPrompt, timeoutMs, tuning);
    if (result) return result;
  }
  return null;
}

export async function getVisionResponse(request: {
  messages: ChatApiMessage[];
  language?: string;
  mode?: "thinking" | "instant";
  catalog?: string;
  /** Rolling summary of this user's older conversations (chat-history.ts). */
  historySummary?: string;
}): Promise<{ success: boolean; reply?: string; error?: string; model?: string }> {
  // ── PASS 1 (READ): a vision-capable model extracts a factual description ──
  // The vision lane is offered ONLY the raw multimodal messages with the
  // extraction prompt — never the ETAP persona, never asked for the answer.
  const read = await readImageViaVisionModels(request.messages, request.language);

  // ── PASS 2 (ANSWER): the description becomes TEXT and the normal
  // reasoning-first cascade produces the final engineering answer. The
  // reasoning models (strongest available) always write the answer — a weak
  // vision model never has the last word.
  const pass2Messages = read.ok && read.description
    ? buildAugmentedTextMessages(request.messages, read.description, request.language)
    : buildVisionFailureMessages(request.messages, request.language);

  const result = await runTextCascade({
    messages: pass2Messages,
    language: request.language,
    mode: request.mode,
    catalog: request.catalog,
    historySummary: request.historySummary,
  });

  // Every vision reader AND the whole text cascade failed — the legacy
  // vision-only sweep is the last resort: offer the raw multimodal request
  // to the vision models directly (better than a bare error message).
  if (!result.success) {
    const mode: ChatbotMode = request.mode === "instant" ? "instant" : "thinking";
    const tuning = MODE_TUNING[mode];
    const visionSystemPrompt = getSystemPrompt(request.language, mode, request.catalog, true, request.historySummary);
    const [firstTimeout, retryTimeout] = tuning.groqAttemptTimeouts;

    const routedVision = await routeChatCompletion({
      messages: request.messages,
      systemPrompt: visionSystemPrompt,
      mode,
      vision: true,
      gen: { temperature: tuning.temperature, maxTokens: tuning.maxTokens, attemptTimeoutMs: 25_000, globalBudgetMs: 26_000 },
    });
    if (routedVision.ok) return buildSuccessResult({ reply: routedVision.result.reply, model: routedVision.result.model });

    let lastChance = await tryGroq(request.messages, visionSystemPrompt, GROQ_VISION_MODEL, firstTimeout, tuning);
    if (!lastChance) lastChance = await tryGroq(request.messages, visionSystemPrompt, GROQ_VISION_MODEL, retryTimeout, tuning);
    if (lastChance) return buildSuccessResult(lastChance);

    const orVision = await tryOpenRouterVision(request.messages, visionSystemPrompt, tuning.openRouterTierTimeouts[2] ?? 15000, tuning);
    if (orVision) return buildSuccessResult(orVision);

    logger.error("[Chatbot/Vision] two-pass + legacy vision sweep all failed.");
    return buildVisionUnavailableResponse(request.language);
  }

  return result;
}

// ════════════════════════════════════════════════════════════════════════
// STATS / MONITORING
// ════════════════════════════════════════════════════════════════════════

export function getChatbotStats() {
  return {
    tier1: {
      provider: "nvidia",
      model: NVIDIA_MODEL,
      configured: !!NVIDIA_API_KEY,
      keyValid: chatHealth.nvidiaKeyValid,
      consecFails: chatHealth.nvidiaConsecFails,
      lastSuccessAgo: chatHealth.nvidiaLastSuccess ? `${Math.round((Date.now() - chatHealth.nvidiaLastSuccess) / 1000)}s ago` : "never",
      available: nvidiaIsAvailable(),
    },
    tier2: {
      provider: "openrouter",
      configured: !!OPENROUTER_API_KEY,
      keyValid: chatHealth.openrouterKeyValid,
      totalModels: AI_MODELS.length,
      lastWorkingModel: chatHealth.lastWorkingModel,
      lastWorkingTimeAgo: chatHealth.lastWorkingTime ? `${Math.round((Date.now() - chatHealth.lastWorkingTime) / 1000)}s ago` : "never",
      modelSuccessCounts: modelSuccessCount,
      modelFailCounts: modelFailCount,
    },
    tier3: {
      provider: "groq",
      models: GROQ_MODELS,
      currentModel: GROQ_MODELS[chatHealth.groqCurrentModelIndex] || GROQ_MODELS[0],
      configured: !!GROQ_API_KEY,
      keyValid: chatHealth.groqKeyValid,
      consecFails: chatHealth.groqConsecFails,
      lastSuccessAgo: chatHealth.groqLastSuccess ? `${Math.round((Date.now() - chatHealth.groqLastSuccess) / 1000)}s ago` : "never",
      available: groqIsAvailable(),
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

