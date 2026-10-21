/**
 * CHATBOT STREAMING — SSE streaming responses for all providers
 *
 * Contains:
 *   - Provider selection for streaming (pickWorkingModel) — mode-aware routing:
 *       thinking → NVIDIA → OpenRouter (tier-1) → Groq (strongest first)
 *       instant  → Groq → OpenRouter (preferred fast model) → NVIDIA (fastest first)
 *   - SSE stream processing helpers
 *   - NVIDIA streaming (MiniMax-M3, strongest free model)
 *   - Groq streaming with model cascade
 *   - OpenRouter streaming
 *   - getStreamResponse() — main streaming entry point
 *
 * Each mode carries its own ModeTuning (prompt, temperature, max_tokens,
 * timeouts) from MODE_TUNING in chatbot-prompts.ts, threaded through every
 * provider call and fallback chain.
 *
 * All non-streaming provider logic (config, health tracking, tryNvidia/tryGroq,
 * openRouterFallback, getChatResponse) lives in chatbot.ts.
 * System prompts live in chatbot-prompts.ts.
 */

import { getSystemPrompt, MODE_TUNING, type ModeTuning } from "./chatbot-prompts.js";
import { logger } from "./logger.js";
import {
  // ── Config constants ──
  NVIDIA_API_KEY,
  NVIDIA_ENDPOINT,
  NVIDIA_MODEL,
  GROQ_API_KEY,
  GROQ_ENDPOINT,
  GROQ_MODELS,
  OPENROUTER_API_KEY,
  AI_MODELS,
  INSTANT_FAST_MODELS,

  // ── Health state (mutable via properties; direct scalar reassignments crash in ESM) ──
  chatHealth,
  modelFailCount,

  // ── Availability checks ──
  nvidiaIsAvailable,
  groqIsAvailable,

  // ── Fallback functions ──
  groqFallback,
  nvidiaFallback,
  openRouterFallback,

  // ── Validation functions ──
  validateNvidiaKey,
  validateGroqKey,
  validateOpenRouterKey,
} from "./chatbot.js";

// ════════════════════════════════════════════════════════════════════════
// STREAMING — provider selection
// ════════════════════════════════════════════════════════════════════════

/**
 * Provider selection result — carries the mode tuning so every provider
 * call and fallback uses the same temperature / max_tokens / timeouts.
 */
type PickedProvider = {
  provider: "nvidia" | "groq" | "openrouter";
  modelId: string;
  systemPrompt: string;
  tuning: ModeTuning;
};

/**
 * Try to pick the NVIDIA provider if available (strongest free model).
 */
async function tryPickNvidiaProvider(systemPrompt: string, tuning: ModeTuning): Promise<PickedProvider | null> {
  if (!nvidiaIsAvailable()) return null;
  if (chatHealth.nvidiaKeyValid === null) {
    await validateNvidiaKey();
  }
  if (!nvidiaIsAvailable()) return null;
  logger.info(`[Chatbot] Using TIER 1: ${NVIDIA_MODEL} (NVIDIA)`);
  return { provider: "nvidia", modelId: NVIDIA_MODEL, systemPrompt, tuning };
}

/**
 * Try to pick the Groq provider if available.
 */
async function tryPickGroqProvider(systemPrompt: string, tuning: ModeTuning): Promise<PickedProvider | null> {
  if (!groqIsAvailable()) return null;
  if (chatHealth.groqKeyValid === null) {
    await validateGroqKey();
  }
  if (!groqIsAvailable()) return null;
  const modelId = GROQ_MODELS[chatHealth.groqCurrentModelIndex] || GROQ_MODELS[0];
  logger.info(`[Chatbot] Using TIER: ${modelId} (Groq — fastest)`);
  return { provider: "groq", modelId, systemPrompt, tuning };
}

/**
 * Try to pick an OpenRouter provider (last working model or best tier-1).
 *
 * Mode-aware: instant mode starts from its preferred FAST model and never
 * reuses a last-working model that belongs to the thinking tier, so the two
 * modes stay on visibly different models even when both land on OpenRouter.
 */
async function tryPickOpenRouterProvider(systemPrompt: string, tuning: ModeTuning): Promise<PickedProvider | null> {
  if (!chatHealth.openrouterKeyValidated) {
    await validateOpenRouterKey();
  }
  if (chatHealth.openrouterKeyValid === false) return null;

  const preferred = tuning.openRouterPreferredModel;

  // Mode-scoped last-working shortcut: each mode only reuses a model that
  // THIS mode previously succeeded with — thinking never inherits instant's
  // fast-lane model and vice versa (no mode collapse in either direction).
  const modeKey: "thinking" | "instant" = tuning === MODE_TUNING.instant ? "instant" : "thinking";
  const lastEntry = chatHealth.lastWorkingByMode[modeKey];
  if (
    lastEntry?.model &&
    (Date.now() - lastEntry.time) < 600000 &&
    (modelFailCount[lastEntry.model] || 0) < 3 &&
    (!preferred || lastEntry.model === preferred)
  ) {
    logger.info("[Chatbot] Using last working OpenRouter model", { model: lastEntry.model, mode: modeKey });
    return { provider: "openrouter", modelId: lastEntry.model, systemPrompt, tuning };
  }

  // Mode's preferred fast model (instant), if healthy
  if (preferred && (modelFailCount[preferred] || 0) < 3 && AI_MODELS.some(m => m.id === preferred)) {
    logger.info("[Chatbot] Using preferred fast OpenRouter model", { model: preferred });
    return { provider: "openrouter", modelId: preferred, systemPrompt, tuning };
  }

  // Use best tier-1 model directly — no probing needed
  const bestModel = AI_MODELS.find(m => m.tier === 1);
  if (bestModel) {
    logger.info("[Chatbot] Using best OpenRouter model", { model: bestModel.id });
    return { provider: "openrouter", modelId: bestModel.id, systemPrompt, tuning };
  }

  return null;
}

export async function pickWorkingModel(
  _messages: { role: string; content: string }[],
  language?: string,
  mode: "thinking" | "instant" = "thinking",
  catalog?: string
): Promise<PickedProvider | null> {
  const tuning = mode === "instant" ? MODE_TUNING.instant : MODE_TUNING.thinking;
  const systemPrompt = getSystemPrompt(language, mode, catalog);

  if (mode === "instant") {
    // ─── INSTANT: fastest first — Groq → OpenRouter (fast model) → NVIDIA ───
    const groqPick = await tryPickGroqProvider(systemPrompt, tuning);
    if (groqPick) return groqPick;

    const openRouterPick = await tryPickOpenRouterProvider(systemPrompt, tuning);
    if (openRouterPick) return openRouterPick;

    logger.warn("[Chatbot] Groq + OpenRouter unavailable — using NVIDIA for instant mode");
    const nvidiaPick = await tryPickNvidiaProvider(systemPrompt, tuning);
    if (nvidiaPick) return nvidiaPick;

    return null;
  }

  // ─── THINKING: strongest first — NVIDIA → OpenRouter → Groq ───
  const nvidiaPick = await tryPickNvidiaProvider(systemPrompt, tuning);
  if (nvidiaPick) return nvidiaPick;

  const openRouterPick = await tryPickOpenRouterProvider(systemPrompt, tuning);
  if (openRouterPick) return openRouterPick;

  logger.warn("[Chatbot] NVIDIA + OpenRouter unavailable — using Groq for thinking mode");
  const groqPick = await tryPickGroqProvider(systemPrompt, tuning);
  if (groqPick) return groqPick;

  return null;
}

// ════════════════════════════════════════════════════════════════════════
// SSE STREAMING HELPERS
// ════════════════════════════════════════════════════════════════════════

function buildStreamErrorResponse(kind: "noProvider" | "openRouterError" | "openRouterConnectError", language?: string): { error: string } {
  const messages: Record<typeof kind, { ar: string; en: string }> = {
    noProvider: {
      ar: "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل.",
      en: "All AI models are temporarily busy. Please try again in a few seconds.",
    },
    openRouterError: {
      ar: "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.",
      en: "Sorry, an error occurred. Please try again.",
    },
    openRouterConnectError: {
      ar: "تعذر الاتصال بالخدمة. يرجى المحاولة مرة أخرى.",
      en: "Could not connect to the service. Please try again.",
    },
  };
  return { error: language === "ar" ? messages[kind].ar : messages[kind].en };
}

/**
 * Process one SSE line from an upstream chat-completion stream.
 * Mutates `state.sawContent` and `state.streamClosed`. Returns true to
 * break the surrounding for-of loop (when the stream is closed).
 */
function processSSEDeltaLine(
  line: string,
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: { sawContent: boolean; streamClosed: boolean },
): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "data: [DONE]") return false;
  if (!trimmed.startsWith("data: ")) return false;
  try {
    const parsed = JSON.parse(trimmed.slice(6));
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return false;
    if (delta.content) {
      state.sawContent = true;
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: delta.content })}\n\n`));
      } catch {
        state.streamClosed = true;
        return true;
      }
    }
  } catch {
    // Skip malformed JSON chunks
  }
  return false;
}

/**
 * Flush any trailing buffered SSE line after the upstream stream ends.
 */
function flushTrailingSSEBuffer(
  buffer: string,
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: { sawContent: boolean; streamClosed: boolean },
): void {
  if (state.streamClosed) return;
  const rest = buffer.trim();
  if (!rest.startsWith("data: ") || rest.slice(6).trim() === "[DONE]") return;
  try {
    const parsed = JSON.parse(rest.slice(6).trim());
    const delta = parsed.choices?.[0]?.delta;
    if (delta?.content) {
      state.sawContent = true;
      try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: delta.content })}\n\n`)); } catch { /* already closed */ }
    }
  } catch {
    // Skip malformed trailing chunk
  }
}

/**
 * Pump an OpenAI-compatible SSE upstream (NVIDIA) into our SSE controller.
 * If no usable content arrives, recover via OpenRouter then Groq.
 */
async function pumpNvidiaStream(
  upstream: ReadableStream<Uint8Array>,
  decoder: TextDecoder,
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController<Uint8Array>,
  request: { messages: { role: string; content: string }[]; language?: string },
  picked: PickedProvider,
): Promise<void> {
  const reader = upstream.getReader();
  const state = { sawContent: false, streamClosed: false };
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || state.streamClosed) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete line

      for (const line of lines) {
        if (state.streamClosed) break;
        if (processSSEDeltaLine(line, encoder, controller, state)) break;
      }
    }

    flushTrailingSSEBuffer(buffer, encoder, controller, state);
  } catch (e) {
    try { controller.error(e); } catch { /* already closed */ }
    return;
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  if (!state.sawContent) {
    logger.warn("[Chatbot/Stream] NVIDIA returned no content — trying OpenRouter then Groq...");
    const fbOR = await openRouterFallback(request.messages, picked.systemPrompt, request.language, picked.tuning);
    if (fbOR) {
      try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: fbOR.reply })}\n\n`)); } catch { /* controller already closed */ }
    } else {
      const fbGroq = await groqFallback(request.messages, picked.systemPrompt, picked.tuning);
      if (fbGroq) {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: fbGroq.reply })}\n\n`)); } catch { /* controller already closed */ }
      }
    }
  }

  try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* controller already closed */ }
  try { controller.close(); } catch { /* already closed */ }
}

// ════════════════════════════════════════════════════════════════════════
// NVIDIA STREAMING (TIER 1)
// ════════════════════════════════════════════════════════════════════════

/**
 * NVIDIA stream (MiniMax-M3). The NVIDIA integrate API is OpenAI-compatible,
 * so `stream: true` yields standard SSE `delta.content` chunks.
 * On failure → OpenRouter stream → Groq stream (guaranteed-reply chain).
 */
async function streamNvidiaProvider(
  request: { messages: { role: string; content: string }[]; language?: string },
  picked: PickedProvider,
  encoder: TextEncoder,
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  let response: Response | null = null;
  try {
    response = await fetch(NVIDIA_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: picked.modelId,
        messages: [
          { role: "system", content: picked.systemPrompt },
          ...request.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: picked.tuning.temperature,
        max_tokens: picked.tuning.maxTokens,
        stream: true,
      }),
      signal: AbortSignal.timeout(picked.tuning.nvidiaStreamTimeoutMs),
    });
  } catch (e) {
    chatHealth.nvidiaConsecFails++;
    chatHealth.nvidiaLastFailTime = Date.now();
    logger.warn("[Chatbot/Stream/NVIDIA] request threw", { error: String(e) });
  }

  if (!response || !response.ok || !response.body) {
    if (response && (response.status === 401 || response.status === 403)) {
      chatHealth.nvidiaKeyValid = false;
    }
    if (response) {
      chatHealth.nvidiaConsecFails++;
      chatHealth.nvidiaLastFailTime = Date.now();
    }
    logger.warn(`[Chatbot/Stream/NVIDIA] failed (HTTP ${response?.status ?? "no-response"}) — falling back to OpenRouter stream.`);
    const orPick = await tryPickOpenRouterProvider(picked.systemPrompt, picked.tuning);
    if (orPick) {
      return await streamOpenRouterProvider(request, orPick, encoder);
    }
    return await streamGroqProvider(request, { provider: "groq", modelId: "", systemPrompt: picked.systemPrompt, tuning: picked.tuning }, encoder);
  }

  // SUCCESS
  chatHealth.nvidiaConsecFails = 0;
  chatHealth.nvidiaLastSuccess = Date.now();
  chatHealth.nvidiaKeyValid = true;
  logger.info("[Chatbot/Stream/NVIDIA] SUCCESS");

  const upstream = response.body;
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await pumpNvidiaStream(upstream, decoder, encoder, controller, request, picked);
    },
  });

  return { stream, model: picked.modelId };
}

// ════════════════════════════════════════════════════════════════════════
// GROQ STREAMING (TIER 3)
// ════════════════════════════════════════════════════════════════════════

/**
 * Build a TransformStream that decodes upstream SSE chunks and re-emits
 * lightweight `data: {"text": "..."}` events for our client.
 */
function buildSSEContentTransformStream(encoder: TextEncoder): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      try {
        const text = decoder.decode(chunk, { stream: true });
        const lines = text.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: delta.content })}\n\n`)); } catch { /* closed */ }
            }
          } catch { /* skip malformed JSON */ }
        }
      } catch { /* decode error */ }
    },
    flush(controller) {
      try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* closed */ }
      try { controller.terminate(); } catch { /* terminated */ }
    },
  });
}

/**
 * Try a single Groq streaming fetch attempt with the given timeout.
 */
async function tryGroqStreamFetch(
  request: { messages: { role: string; content: string }[] },
  picked: PickedProvider,
  modelId: string,
  timeout: number,
  attempt: number,
  totalAttempts: number,
): Promise<Response | null> {
  try {
    return await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: picked.systemPrompt },
          ...request.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: picked.tuning.temperature,
        max_tokens: picked.tuning.maxTokens,
        stream: true,
      }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    logger.warn(`[Chatbot/Stream/Groq] ${modelId} attempt ${attempt + 1} threw`, { error: String(e) });
    if (attempt < totalAttempts - 1) await new Promise(r => setTimeout(r, 3000));
    return null;
  }
}

/**
 * Inspect a Groq fetch Response and decide whether to use it, retry, or
 * give up on this model.
 */
async function evaluateGroqStreamResponse(
  response: Response,
  modelId: string,
  attempt: number,
  totalAttempts: number,
): Promise<{ kind: "ok" | "retry" | "nextModel" }> {
  if (response.status === 429 || response.status === 503) {
    logger.warn(`[Chatbot/Stream/Groq] ${modelId} overloaded (${response.status}) — trying next model...`);
    return { kind: "nextModel" };
  }
  if (!response.ok || !response.body) {
    logger.warn(`[Chatbot/Stream/Groq] ${modelId} attempt ${attempt + 1} failed: HTTP ${response.status}`);
    if (attempt < totalAttempts - 1) {
      await new Promise(r => setTimeout(r, 3000));
      return { kind: "retry" };
    }
    return { kind: "nextModel" };
  }
  return { kind: "ok" };
}

/**
 * Groq stream — try each Groq model in cascade.
 * Per-attempt timeouts come from the mode tuning (instant: 12s/20s,
 * thinking: 60s/90s).
 */
async function streamGroqProvider(
  request: { messages: { role: string; content: string }[]; language?: string },
  picked: PickedProvider,
  encoder: TextEncoder,
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const timeouts: number[] = picked.tuning.groqStreamTimeouts;

  for (let i = 0; i < GROQ_MODELS.length; i++) {
    const modelId = GROQ_MODELS[i];
    chatHealth.groqCurrentModelIndex = i;

    for (let attempt = 0; attempt < timeouts.length; attempt++) {
      const response = await tryGroqStreamFetch(request, picked, modelId, timeouts[attempt], attempt, timeouts.length);
      if (!response) {
        if (attempt < timeouts.length - 1) continue;
        break;
      }

      const evaluation = await evaluateGroqStreamResponse(response, modelId, attempt, timeouts.length);
      if (evaluation.kind === "nextModel") break;
      if (evaluation.kind === "retry") continue;

      // SUCCESS
      chatHealth.groqConsecFails = 0;
      chatHealth.groqLastSuccess = Date.now();
      chatHealth.groqKeyValid = true;
      logger.info(`[Chatbot/Stream/Groq] ${modelId} SUCCESS`);

      const transformStreamOC = buildSSEContentTransformStream(encoder);
      return { stream: response.body!.pipeThrough(transformStreamOC), model: modelId };
    }

    chatHealth.groqConsecFails++;
    chatHealth.groqLastFailTime = Date.now();
    logger.warn(`[Chatbot/Stream/Groq] ${modelId} exhausted — trying next model...`);
  }

  // All Groq models failed
  logger.error("[Chatbot/Stream] All Groq models exhausted — falling back to OpenRouter.");
  return await streamOpenRouterFallback(request, picked.systemPrompt, picked.tuning);
}

// ════════════════════════════════════════════════════════════════════════
// OPENROUTER STREAMING (TIER 2)
// ════════════════════════════════════════════════════════════════════════

/**
 * OpenRouter stream — direct fetch + transform that extracts `delta.content`.
 * If the picked model fails, sweeps tier-1 then tier-2 models before giving up.
 */
async function streamOpenRouterProvider(
  request: { messages: { role: string; content: string }[]; language?: string },
  picked: PickedProvider,
  encoder: TextEncoder,
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const candidates: string[] = [picked.modelId];
  // Instant mode: fast MoE lane comes right after the preferred model —
  // the thinking tier-1 model is tried only after every fast option.
  if (picked.tuning.openRouterPreferredModel) {
    for (const fastModel of INSTANT_FAST_MODELS) {
      if (!candidates.includes(fastModel) && (modelFailCount[fastModel] || 0) < 3) candidates.push(fastModel);
    }
  }
  for (const m of AI_MODELS) {
    if (!candidates.includes(m.id) && (modelFailCount[m.id] || 0) < 3) candidates.push(m.id);
  }

  // Sweep budget: real network attempts only. HTTP 404 means the model id no
  // longer exists on OpenRouter (pool drift) — those rejects arrive in ~50ms,
  // so they hard-skip the model WITHOUT consuming the budget; otherwise a
  // dead top-of-pool can shield every working model behind the cap.
  let realAttempts = 0;
  for (const modelId of candidates) {
    if (realAttempts >= 8) break;
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://ahmedelbaz.qzz.io",
          "X-Title": "Elbaz LMS Chatbot",
        },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: picked.systemPrompt },
            ...request.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          temperature: picked.tuning.temperature,
          max_tokens: picked.tuning.maxTokens,
          stream: true,
        }),
        signal: AbortSignal.timeout(picked.tuning.openRouterStreamTimeoutMs),
      });

      if (!response.ok || !response.body) {
        if (response.status === 404) {
          // Dead model id — mark skipped (fail threshold) and keep sweeping.
          modelFailCount[modelId] = 3;
          logger.warn(`[Chatbot/Stream/OpenRouter] ${modelId} unavailable (HTTP 404) — hard-skipped (no budget cost)`);
          continue;
        }
        modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
        realAttempts++;
        logger.warn(`[Chatbot/Stream/OpenRouter] ${modelId} failed (HTTP ${response.status}) — trying next model...`);
        continue;
      }

      const transformStream = buildSSEContentTransformStream(encoder);
      return { stream: response.body.pipeThrough(transformStream), model: modelId };
    } catch (e) {
      modelFailCount[modelId] = (modelFailCount[modelId] || 0) + 1;
      realAttempts++;
      logger.warn(`[Chatbot/Stream/OpenRouter] ${modelId} threw — trying next model...`, { error: String(e) });
    }
  }

  // Safety net: same depth as the non-streaming path — full OpenRouter
  // non-streaming sweep → Groq → NVIDIA, each emitted as a single SSE chunk,
  // instead of failing the stream outright.
  logger.warn("[Chatbot/Stream/OpenRouter] All streaming candidates failed — using non-streaming cascade fallback.");
  return await streamOpenRouterFallback(request, picked.systemPrompt, picked.tuning);
}

// ════════════════════════════════════════════════════════════════════════
// FALLBACK STREAM HELPERS
// ════════════════════════════════════════════════════════════════════════

/**
 * Wrap a non-streaming fallback reply as a single-chunk SSE stream.
 */
function singleChunkStream(reply: string, encoder: TextEncoder): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: reply })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch { /* controller already closed */ }
    },
  });
}

/**
 * Last-chain fallback: full non-streaming OpenRouter sweep → Groq → NVIDIA,
 * each emitted as a single SSE text chunk so the client sees one clean reply.
 */
async function streamOpenRouterFallback(
  request: { messages: { role: string; content: string }[]; language?: string },
  systemPrompt: string,
  tuning: ModeTuning = MODE_TUNING.thinking,
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const encoder = new TextEncoder();

  const orResult = await openRouterFallback(request.messages, systemPrompt, request.language, tuning);
  if (orResult) return { stream: singleChunkStream(orResult.reply, encoder), model: orResult.model };

  logger.error("[Chatbot/Stream] OpenRouter fallback failed — trying Groq non-streaming.");
  const groqResult = await groqFallback(request.messages, systemPrompt, tuning);
  if (groqResult) return { stream: singleChunkStream(groqResult.reply, encoder), model: groqResult.model };

  logger.error("[Chatbot/Stream] Groq also failed — trying NVIDIA non-streaming.");
  const nvidiaResult = await nvidiaFallback(request.messages, systemPrompt, tuning);
  if (nvidiaResult) return { stream: singleChunkStream(nvidiaResult.reply, encoder), model: nvidiaResult.model };

  return {
    error: request.language === "ar"
      ? "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل."
      : "All AI models are temporarily busy. Please try again in a few seconds.",
  };
}

// ════════════════════════════════════════════════════════════════════════
// MAIN STREAMING ENTRY POINT
// ════════════════════════════════════════════════════════════════════════

export async function getStreamResponse(request: {
  messages: { role: string; content: string }[];
  language?: string;
  mode?: "thinking" | "instant";
  /** Real course-catalog text (api/lib/course-catalog.ts) — injected into the system prompt. */
  catalog?: string;
}): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const picked = await pickWorkingModel(request.messages, request.language, request.mode || "thinking", request.catalog);

  if (!picked) {
    return buildStreamErrorResponse("noProvider", request.language);
  }

  const encoder = new TextEncoder();

  if (picked.provider === "nvidia") {
    return await streamNvidiaProvider(request, picked, encoder);
  }

  if (picked.provider === "groq") {
    return await streamGroqProvider(request, picked, encoder);
  }

  return await streamOpenRouterProvider(request, picked, encoder);
}
