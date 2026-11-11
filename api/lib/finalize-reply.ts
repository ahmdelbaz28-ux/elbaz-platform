/**
 * FINALIZE-REPLY — the ONE shared egress pipeline for every chatbot reply.
 *
 * ✅ ARCH-AUDIT FIX (agent-architecture-audit, executive verdict): the three
 * egress paths (web non-stream `chatbot-router.ts`, web stream forwarder
 * `chatbot-router.ts`, Telegram DM brain `telegram-bot.ts`) used to run three
 * divergent hand-rolled pipelines — different stage coverage and different
 * granularity — so an answer one platform would have blocked could ship on
 * another. This module composes the canonical stages in one place:
 *
 *   1. THINK-STRIP      — stripThinkBlocks: <think>/<reasoning> blocks never
 *                         reach the user (hard zero-gap guarantee).
 *   2. SANITIZE         — sanitizeReplyOutput: CJK/space/empty-paren cleanup.
 *   3. LEAK GATE        — containsPromptLeak: verbatim system-prompt fragments
 *                         are replaced with the bilingual refusal.
 *   4. TRUNCATION POLICY— a reply that does not end like a finished sentence
 *                         (silent mid-sentence token cutoff) is trimmed at the
 *                         last complete sentence boundary — deterministically,
 *                         with no hidden second LLM call.
 *
 * Streaming egress keeps its fragment-level gate (the rolling hold-back window
 * in chatbot-router.ts uses the same leak/sanitize primitives); this module is
 * the whole-reply contract used by non-stream web, Telegram, and any future
 * egress. `looksComplete` lives here (moved from ai-router.ts, re-exported
 * there for compatibility) so the rescue heuristic and the truncation policy
 * can never drift apart.
 */

import { createHash } from "node:crypto";
import { stripThinkBlocks } from "./think-filter.js";
import { sanitizeReplyOutput, containsPromptLeak, promptLeakRefusal } from "./chatbot-prompts.js";

const SENTENCE_END_RE = /[.!?…:؛،"'”’）)\]】»*]\s*$/;

/** Heuristic: the text ends like a finished sentence (not cut mid-thought). */
export function looksComplete(text: string): boolean {
  const t = text.trimEnd();
  if (!t) return false;
  return SENTENCE_END_RE.test(t);
}

/** Minimum length a reply must have before the truncation policy touches it. */
const TRIM_MIN_LENGTH = 80;
/** Never trim away more than 40% of the reply — a list/heading-heavy text
 *  without terminal punctuation is legitimate, not truncated. */
const TRIM_MAX_LOSS_RATIO = 0.6;

/**
 * Deterministic truncation polish: cut a mid-sentence-cutoff reply back to
 * its last complete sentence. Deliberately conservative — the policy applies
 * ONLY to single-paragraph prose replies:
 *   - fenced code blocks are skipped (code legitimately ends mid-line),
 *   - multi-line answers (lists, steps, headings) are skipped (items end in
 *     newlines, not punctuation — cutting would drop real content),
 *   - replies shorter than TRIM_MIN_LENGTH are skipped,
 *   - a cut that would lose more than 40% of the text is abandoned.
 * When the policy does not apply the reply is returned unchanged.
 */
export function trimToLastSentence(text: string): string {
  const t = text.trim();
  if (!t || t.includes("```") || t.includes("\n") || t.length < TRIM_MIN_LENGTH) return text;
  let lastEnd = -1;
  const re = /[.!?…؛]/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const after = t.slice(m.index + m[0].length);
    // Sentence end counts when it is followed by whitespace or end of text —
    // decimals ("5.5"), URLs, and abbreviations inside a word do not cut.
    if (after.length === 0 || /^\s/.test(after)) lastEnd = m.index + m[0].length;
  }
  if (lastEnd <= 0 || lastEnd >= t.length) return text;
  const trimmed = t.slice(0, lastEnd).trimEnd();
  if (trimmed.length < t.length * TRIM_MAX_LOSS_RATIO) return text;
  return trimmed;
}

export interface FinalizedReply {
  /** Client-safe reply (refusal text when the leak gate fired). */
  reply: string;
  /** True when the reply tripped the prompt-leak tripwire and was replaced. */
  leaked: boolean;
  /** True when the truncation policy shortened the reply. */
  truncated: boolean;
}

/**
 * The whole-reply egress contract. Every non-fragment egress MUST route its
 * model output through this function immediately before it reaches the user.
 */
export function finalizeReply(raw: string, language?: string): FinalizedReply {
  // 1+2. think-strip → sanitize (order matters: a think block may wrap a leak).
  let reply = sanitizeReplyOutput(stripThinkBlocks(raw ?? ""));
  // 3. leak gate — verbatim prompt fragments become the bilingual refusal.
  if (containsPromptLeak(reply)) {
    return { reply: promptLeakRefusal(language), leaked: true, truncated: false };
  }
  // 4. truncation policy — deterministic, no hidden second LLM call.
  let truncated = false;
  const polished = trimToLastSentence(reply);
  if (polished !== reply) {
    reply = polished;
    truncated = true;
  }
  return { reply, leaked: false, truncated };
}

/**
 * ✅ ARCH-AUDIT FIX (model identity tag on the wire): the wire model field
 * must never carry `provider.slug/modelId` — the never-name-providers contract
 * is enforced in code, not just in the prompt. The key is a stable SHA-1
 * prefix: distinct models stay distinguishable in feedback analytics, no
 * provider identity is recoverable from it. Server logs keep the real tag.
 */
export function opaqueModelKey(modelTag: string): string {
  return `m_${createHash("sha1").update(modelTag).digest("hex").slice(0, 10)}`;
}
