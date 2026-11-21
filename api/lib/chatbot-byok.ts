/**
 * BYOK — bring-your-own-key lane (user-supplied OpenAI-compatible provider)
 *
 * Product contract (owner, 2026-11): the platform chatbot ALWAYS runs on the
 * owner-managed provider cascade (dynamic router + legacy chain). A user may
 * optionally register their own provider (baseUrl + API key + model id) via
 * the chatbot's key menu; when that config exists AND is enabled, the user's
 * endpoint is tried FIRST with the same system prompt (Saadat identity,
 * citations, numeric discipline) — and any failure drops straight back into
 * the platform cascade. The user's setup can therefore only ever ADD
 * availability, never remove it.
 *
 * Scope: TEXT lane only (chat + stream). Vision requests keep the platform
 * two-pass pipeline — a user key may not have a vision-capable model, and
 * failing the image reader on a personal key would degrade the product.
 *
 * SECURITY:
 *   - The stored key is AES-256-GCM (byok-crypto.ts); decrypted only here,
 *     in-process, per request — never logged, never returned to clients.
 *   - Every outbound fetch re-checks isPublicProviderUrl (fail-closed SSRF
 *     guard shared with the admin router) even though save-time validation
 *     already rejected non-public targets — defense in depth.
 *   - Header-only timeout (headerTimeoutSignal): a slow provider cannot hold
 *     the cascade; the body streams unbounded once headers arrive (same
 *     contract as the platform's own provider calls).
 */

import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection.js";
import { userAiProviders } from "@db/schema";
import { decryptByokKey } from "./byok-crypto.js";
import { buildUpstreamSSETransform, isPublicProviderUrl } from "./ai-router.js";
import { headerTimeoutSignal } from "./abort-utils.js";
import { stripThinkBlocks } from "./think-filter.js";
import { reportTokenUsage } from "./token-usage.js";
import { logger } from "./logger.js";
import type { ChatApiMessage } from "./chatbot.js";
import type { ModeTuning } from "./chatbot-prompts.js";

// ─────────────────────────────────────────────────────────────────────────────
// Provider catalog shown in the chatbot's key menu (frontend mirrors this).
// Each entry is an OpenAI-compatible API root (chat/completions + /models).
// ─────────────────────────────────────────────────────────────────────────────
export interface UserProviderCatalogEntry {
  id: string;
  labelAr: string;
  labelEn: string;
  /** Default API root prefilled when the user picks this provider. */
  baseUrl: string;
  /** Example model ids offered as hints in the UI. */
  exampleModels: string[];
}

export const USER_PROVIDER_CATALOG: UserProviderCatalogEntry[] = [
  {
    id: "openrouter",
    labelAr: "OpenRouter",
    labelEn: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    exampleModels: ["deepseek/deepseek-chat", "meta-llama/llama-3.3-70b-instruct", "google/gemini-2.0-flash-exp:free"],
  },
  {
    id: "groq",
    labelAr: "Groq",
    labelEn: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    exampleModels: ["llama-3.3-70b-versatile", "meta-llama/llama-4-scout-17b-16e-instruct"],
  },
  {
    id: "openai",
    labelAr: "OpenAI",
    labelEn: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    exampleModels: ["gpt-4o-mini", "gpt-4o"],
  },
  {
    id: "nvidia",
    labelAr: "NVIDIA NIM",
    labelEn: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    exampleModels: ["meta/llama-3.3-70b-instruct"],
  },
  {
    id: "cerebras",
    labelAr: "Cerebras",
    labelEn: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    exampleModels: ["llama-3.3-70b"],
  },
  {
    id: "gemini",
    labelAr: "Google Gemini",
    labelEn: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    exampleModels: ["gemini-2.0-flash"],
  },
  {
    id: "custom",
    labelAr: "مخصص (Any OpenAI-compatible)",
    labelEn: "Custom (any OpenAI-compatible)",
    baseUrl: "",
    exampleModels: [],
  },
];

export function isKnownUserProvider(id: string): boolean {
  return USER_PROVIDER_CATALOG.some((p) => p.id === id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Config loading (server-side; the plaintext key never leaves this module)
// ─────────────────────────────────────────────────────────────────────────────
export interface ByokConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

/**
 * Load + decrypt the user's active BYOK config, or null when absent/disabled/
 * corrupt/unsafe. Fail-closed at every step — a broken config can never break
 * the chat because callers fall through to the platform cascade on null.
 */
export async function getUserByokConfig(userId: number): Promise<ByokConfig | null> {
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(userAiProviders)
      .where(eq(userAiProviders.userId, userId))
      .limit(1);
    if (!row || !row.enabled) return null;
    const apiKey = decryptByokKey(row.apiKeyEnc);
    if (!apiKey) return null;
    const baseUrl = row.baseUrl.replace(/\/+$/, "");
    // Fail-closed SSRF re-check (save-time validation is not trusted here).
    if (!isPublicProviderUrl(`${baseUrl}/chat/completions`)) {
      logger.warn("[Chatbot/Byok] stored baseUrl failed the SSRF re-check — ignoring config", { userId });
      return null;
    }
    return { provider: row.provider, baseUrl, apiKey, modelId: row.modelId };
  } catch (err) {
    logger.warn("[Chatbot/Byok] config load failed — falling back to platform", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function buildMessages(systemPrompt: string, messages: ChatApiMessage[]) {
  return [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT lane — non-streaming attempt (runs first in runTextCascade)
// ─────────────────────────────────────────────────────────────────────────────
export async function tryByokChat(params: {
  config: ByokConfig;
  messages: ChatApiMessage[];
  systemPrompt: string;
  tuning: ModeTuning;
  abortSignal?: AbortSignal;
}): Promise<{ reply: string; model: string } | null> {
  const { config, messages, systemPrompt, tuning, abortSignal } = params;
  const timeoutMs = tuning.openRouterTierTimeouts?.[1] ?? 30_000;
  const startedAt = Date.now();
  const headerTimeout = headerTimeoutSignal(abortSignal, timeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ahmedelbaz.qzz.io",
        "X-Title": "Elbaz LMS Chatbot (user model)",
      },
      body: JSON.stringify({
        model: config.modelId,
        messages: buildMessages(systemPrompt, messages),
        temperature: tuning.temperature,
        max_tokens: tuning.maxTokens,
      }),
      signal: headerTimeout.signal,
    });
    headerTimeout.done();

    if (!response.ok) {
      const detail = await response.text().catch(() => "").then((t) => t.slice(0, 300));
      logger.warn("[Chatbot/Byok] chat attempt failed — falling back to platform", {
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        detail,
      });
      return null;
    }

    const data = (await response.json()) as {
      error?: unknown;
      choices?: { message?: { content?: string } }[];
      usage?: unknown;
    };
    if (data.error) {
      logger.warn("[Chatbot/Byok] provider returned an error envelope — falling back", { elapsedMs: Date.now() - startedAt });
      return null;
    }
    reportTokenUsage("byok-chat", config.modelId, data.usage);

    // stripThinkBlocks: same zero-visible-reasoning contract as every lane.
    const reply = stripThinkBlocks(data.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) {
      logger.warn("[Chatbot/Byok] empty reply — falling back to platform", { elapsedMs: Date.now() - startedAt });
      return null;
    }
    logger.info("[Chatbot/Byok] chat served by the user's own model", { elapsedMs: Date.now() - startedAt });
    return { reply, model: `byok:${config.modelId}` };
  } catch (err) {
    headerTimeout.done();
    if (abortSignal?.aborted) return null;
    logger.warn("[Chatbot/Byok] chat attempt threw — falling back to platform", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT lane — streaming attempt (runs first in getStreamResponse)
// Emits the same lightweight `data: {"text": …}` protocol as every platform
// lane (buildUpstreamSSETransform), so the router's terminator seam needs
// zero changes to pump a BYOK winner.
// ─────────────────────────────────────────────────────────────────────────────
export async function tryByokStream(params: {
  config: ByokConfig;
  messages: ChatApiMessage[];
  systemPrompt: string;
  tuning: ModeTuning;
  abortSignal?: AbortSignal;
}): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | null> {
  const { config, messages, systemPrompt, tuning, abortSignal } = params;
  const headerTimeoutMs = tuning.openRouterStreamTimeoutMs ?? 120_000;
  const headerTimeout = headerTimeoutSignal(abortSignal, headerTimeoutMs);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ahmedelbaz.qzz.io",
        "X-Title": "Elbaz LMS Chatbot (user model)",
      },
      body: JSON.stringify({
        model: config.modelId,
        messages: buildMessages(systemPrompt, messages),
        temperature: tuning.temperature,
        max_tokens: tuning.maxTokens,
        stream: true,
      }),
      signal: headerTimeout.signal,
    });
    headerTimeout.done();

    if (!response.ok || !response.body) {
      discardQuietly(response);
      logger.warn("[Chatbot/Byok] stream attempt rejected — falling back to platform", { status: response.status });
      return null;
    }

    const encoder = new TextEncoder();
    const transform = buildUpstreamSSETransform(encoder, (usage) => reportTokenUsage("byok-stream", config.modelId, usage));
    logger.info("[Chatbot/Byok] stream started from the user's own model");
    return { stream: response.body.pipeThrough(transform), model: `byok:${config.modelId}` };
  } catch (err) {
    headerTimeout.done();
    if (abortSignal?.aborted) return null;
    logger.warn("[Chatbot/Byok] stream attempt threw — falling back to platform", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function discardQuietly(response: Response): void {
  try { void response.body?.cancel(); } catch { /* socket already dead */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Connectivity test (key menu "اختبر الاتصال" button) — a tiny completion that
// proves baseUrl + key + model actually work together. Used by the REST test
// endpoint BEFORE save (unsaved config) and on the stored config.
// ─────────────────────────────────────────────────────────────────────────────
export async function testByokProvider(params: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  abortSignal?: AbortSignal;
}): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  const baseUrl = params.baseUrl.replace(/\/+$/, "");
  if (!isPublicProviderUrl(`${baseUrl}/chat/completions`)) {
    return { ok: false, latencyMs: 0, error: "عنوان المزود غير مسموح (يجب أن يكون نقطة نهاية عامة https)" };
  }
  const headerTimeout = headerTimeoutSignal(params.abortSignal, 15_000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.modelId,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
        temperature: 0,
      }),
      signal: headerTimeout.signal,
    });
    headerTimeout.done();
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const detail = await response.text().catch(() => "").then((t) => t.slice(0, 200));
      const status = response.status;
      const friendly =
        status === 401 || status === 403
          ? "المفتاح غير صالح أو غير مصرح به (401/403)"
          : status === 404
            ? "النموذج أو العنوان غير موجود (404) — تحقق من اسم النموذج والعنوان"
            : status === 429
              ? "تجاوز حد الاستخدام لدى المزود (429) — المفتاح يعمل لكن الحصة منتهية"
              : `المزود رفض الطلب (HTTP ${status})`;
      return { ok: false, latencyMs, error: detail ? `${friendly} — ${detail}` : friendly };
    }

    const data = (await response.json()) as { error?: unknown; choices?: { message?: { content?: string } }[] };
    if (data.error) {
      const msg = typeof data.error === "string" ? data.error : "استجابة خطأ من المزود";
      return { ok: false, latencyMs, error: msg.slice(0, 200) };
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      return { ok: false, latencyMs, error: "النموذج استجاب بمحتوى فارغ — تحقق من اسم النموذج" };
    }
    return { ok: true, latencyMs };
  } catch (err) {
    headerTimeout.done();
    if (params.abortSignal?.aborted) return { ok: false, latencyMs: Date.now() - startedAt, error: "أُلغيت عملية الاختبار" };
    return { ok: false, latencyMs: Date.now() - startedAt, error: "تعذر الوصول إلى المزود — تحقق من العنوان والاتصال" };
  }
}

