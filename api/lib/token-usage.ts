/**
 * TOKEN USAGE TELEMETRY — observable token spend for the AI assistant.
 *
 * ✅ TOKEN OPTIMIZATION LAYER (prompt v3.6.0): before this module the
 * platform had ZERO visibility into billed tokens — no provider `usage`
 * field was parsed anywhere, so token optimizations could not be measured.
 *
 * Every LLM call site (Groq/NVIDIA/OpenRouter legacy lanes, the dynamic
 * ai-router walk, vision passes) now parses the OpenAI-compatible `usage`
 * object and reports it here. Billing math:
 *   prompt_tokens  — the system prompt + history re-billed on EVERY call
 *                    (the cascade re-bills it per attempt; this is where
 *                    cache-friendly layout + payload gating pay off)
 *   completion_tokens — the generated answer
 *   cached_tokens  — provider-side prompt-cache hits (prefix reuse) when
 *                    the provider reports prompt_tokens_details
 *
 * Aggregates: rolling per-process counters logged every N calls so the
 * platform owner can read the daily spend trend from logs alone (the
 * runtime is a single Space container — process counters are the deploy
 * unit; persistence-level dashboards can be added later from the same
 * reportTokenUsage lines).
 */

import { logger } from "./logger.js";

export interface ProviderUsage {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown } | null;
  cached_tokens?: unknown; // some providers flatten it
}

function toNum(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
}

/** Parse an OpenAI-compatible usage object; null when absent/invalid. */
export function parseUsage(raw: unknown): { prompt: number; completion: number; total: number; cached: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as ProviderUsage;
  const prompt = toNum(u.prompt_tokens);
  const completion = toNum(u.completion_tokens);
  if (prompt === 0 && completion === 0) return null;
  const total = toNum(u.total_tokens) || prompt + completion;
  const cached = toNum(u.prompt_tokens_details?.cached_tokens) || toNum(u.cached_tokens);
  return { prompt, completion, total, cached };
}

// ─── Rolling aggregates (process scope) ─────────────────────────────────────

interface UsageAggregates {
  calls: number;
  prompt: number;
  completion: number;
  cached: number;
  sinceTs: number;
}

const agg: UsageAggregates = { calls: 0, prompt: 0, completion: 0, cached: 0, sinceTs: Date.now() };
const AGG_REPORT_EVERY = 40; // log a summary line every 40 billed calls
/** A billed call whose prompt exceeded this logs a dedicated warning —
 *  these are exactly the requests the optimization layers exist to stop. */
const PROMPT_TOKEN_ALERT_THRESHOLD = 24_000;

/**
 * Report one billed LLM call. `lane` identifies the call site ("groq",
 * "nvidia", "openrouter", "ai-router", "vision-read", "summary", ...).
 * Never throws — telemetry must never break a chat.
 */
export function reportTokenUsage(lane: string, model: string, raw: unknown): void {
  try {
    const usage = parseUsage(raw);
    if (!usage) return;
    agg.calls += 1;
    agg.prompt += usage.prompt;
    agg.completion += usage.completion;
    agg.cached += usage.cached;

    logger.info("[Chatbot/Tokens] billed call", {
      lane,
      model,
      prompt: usage.prompt,
      completion: usage.completion,
      total: usage.total,
      cached: usage.cached,
    });

    if (usage.prompt > PROMPT_TOKEN_ALERT_THRESHOLD) {
      logger.warn("[Chatbot/Tokens] oversized prompt billed — optimization layers should have prevented this", {
        lane,
        model,
        prompt: usage.prompt,
      });
    }

    if (agg.calls % AGG_REPORT_EVERY === 0) {
      const minutes = Math.max(1, Math.round((Date.now() - agg.sinceTs) / 60_000));
      logger.info("[Chatbot/Tokens] aggregate", {
        calls: agg.calls,
        promptTokens: agg.prompt,
        completionTokens: agg.completion,
        cachedTokens: agg.cached,
        avgPromptPerCall: Math.round(agg.prompt / agg.calls),
        windowMinutes: minutes,
      });
    }
  } catch {
    // telemetry must never break the chat
  }
}

/** Test hook — snapshot + reset the process aggregates. */
export function resetTokenUsageAggregates(): { calls: number; prompt: number; completion: number; cached: number } {
  const snap = { calls: agg.calls, prompt: agg.prompt, completion: agg.completion, cached: agg.cached };
  agg.calls = 0;
  agg.prompt = 0;
  agg.completion = 0;
  agg.cached = 0;
  agg.sinceTs = Date.now();
  return snap;
}
