import { createHash } from "node:crypto";
import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * 🧠 Elite AI Diagnostics v1.1
 * ══════════════════════════
 * Automatically analyzes server errors using AI and provides actionable repair advice.
 * This is the ultimate "Elite" tool for zero-downtime maintenance.
 *
 * ✅ SECURITY FIX (audit run-1, api.ai-diagnostics.unscrubbed-error-egress-
 * openrouter): the raw egress shipped verbatim message + stack + request path
 * to a third-party LLM with no scrubbing, dedup or rate limit, while the
 * sibling Sentry egress (lib/sentry.ts beforeSend) scrubs — this module now
 * meets the same standard:
 *   - no stack frames leave the process (internal paths stay internal);
 *   - the message is truncated and stripped of obvious credential material;
 *   - identical error signatures are deduplicated per day (no spam, no cost);
 *   - a hard daily cap bounds the third-party spend during error storms.
 */

const MAX_MESSAGE_CHARS = 240;
const MAX_CONTEXT_CHARS = 160;
const MAX_CALLS_PER_DAY = 10;
const DEDUP_TTL_MS = 6 * 60 * 60 * 1000; // same signature → analyze once per 6h

/** Very-light redaction: values that look like tokens/keys/passwords never leave. */
const SENSITIVE_PATTERNS: RegExp[] = [
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /(api[_-]?key|token|password|passwd|secret|authorization)\s*[:=]\s*\S+/gi,
];

export function sanitizeDiagnosticMessage(raw: string): string {
  let msg = raw;
  for (const re of SENSITIVE_PATTERNS) {
    msg = msg.replace(re, (_m, prefix) => `${prefix ?? ""}[REDACTED]`);
  }
  return msg.slice(0, MAX_MESSAGE_CHARS);
}

export function sanitizeDiagnosticContext(raw: string): string {
  return raw.replace(SENSITIVE_PATTERNS[0], "$1[REDACTED]").slice(0, MAX_CONTEXT_CHARS);
}

export function diagnosticSignature(sanitizedMessage: string): string {
  return createHash("sha256").update(sanitizedMessage).digest("hex").slice(0, 24);
}

const seenSignatures = new Map<string, number>();
let callsToday = 0;
let windowStartedAt = Date.now();

function underBudget(signature: string): boolean {
  const now = Date.now();
  if (now - windowStartedAt >= 24 * 60 * 60 * 1000) {
    windowStartedAt = now;
    callsToday = 0;
    seenSignatures.clear();
  }
  const lastSeen = seenSignatures.get(signature);
  if (lastSeen && now - lastSeen < DEDUP_TTL_MS) return false;
  if (callsToday >= MAX_CALLS_PER_DAY) return false;
  return true;
}

function recordCall(signature: string): void {
  callsToday++;
  seenSignatures.set(signature, Date.now());
  // bounded memory: drop the oldest half when the dedup map grows large
  if (seenSignatures.size > 500) {
    const keys = Array.from(seenSignatures.keys()).slice(0, 250);
    for (const k of keys) seenSignatures.delete(k);
  }
}

export async function diagnoseError(error: Error | string, context: string = "Server Runtime") {
  if (!env.OPENROUTER_API_KEY || env.NODE_ENV !== "production") {
    logger.info("[AI-Diagnostics] Skipped (API Key missing or Dev mode)");
    return null;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  // ✅ Stack frames no longer leave the process — internal file paths and
  // source structure stay in operator logs only (parity with sentry.ts).
  const sanitizedMessage = sanitizeDiagnosticMessage(errorMessage);
  const sanitizedContext = sanitizeDiagnosticContext(context);
  const signature = diagnosticSignature(sanitizedMessage);

  if (!underBudget(signature)) {
    logger.info("[AI-Diagnostics] Skipped (dedup window or daily cap)", { signature });
    return null;
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.FRONTEND_URL,
        "X-Title": "Elbaz Platform AI Guardian",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "system",
            content: "You are an Elite DevSecOps Engineer. Analyze the provided error from a Hono/Node.js app on HuggingFace Spaces. Provide a concise (max 3 bullet points) diagnostic and the exact fix for Eng. Ahmed Elbaz."
          },
          {
            role: "user",
            // ✅ SECURITY FIX: message + context only, sanitized + truncated.
            // No stack traces cross the process boundary.
            content: `Context: ${sanitizedContext}\nError: ${sanitizedMessage}`
          }
        ]
      })
    });
    recordCall(signature);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();
    const diagnosis = data.choices?.[0]?.message?.content || "Could not generate AI diagnosis.";

    logger.info("AI REPAIR ADVISOR — Analysis Complete", { diagnosis, signature });

    return diagnosis;
  } catch (err) {
    logger.warn("[AI-Diagnostics] Failed to communicate with OpenRouter", { error: String(err) });
    return null;
  }
}
