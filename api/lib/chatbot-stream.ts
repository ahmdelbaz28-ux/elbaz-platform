/**
 * CHATBOT STREAMING — SSE streaming responses for all providers
 *
 * Contains:
 *   - Provider selection for streaming (pickWorkingModel)
 *   - SSE stream processing helpers
 *   - Modal/GLM-5.1 streaming with smart retry
 *   - Groq streaming with model cascade
 *   - OpenRouter streaming
 *   - getStreamResponse() — main streaming entry point
 *
 * All non-streaming provider logic (config, health tracking, tryModal/tryGroq/tryNvidia,
 * openRouterFallback, getChatResponse) lives in chatbot.ts.
 * System prompts live in chatbot-prompts.ts.
 */

import { getSystemPrompt } from "./chatbot-prompts.js";
import { logger } from "./logger.js";
import {
  // ── Config constants ──
  MODAL_API_KEY,
  MODAL_ENDPOINT,
  MODAL_MODEL,
  GROQ_API_KEY,
  GROQ_ENDPOINT,
  GROQ_MODELS,
  OPENROUTER_API_KEY,
  AI_MODELS,

  // ── Health state (mutable via properties; direct scalar reassignments crash in ESM) ──
  chatHealth,
  modelFailCount,

  // ── Availability checks ──
  modalIsAvailable,
  groqIsAvailable,

  // ── Fallback functions ──
  tryModalTier,
  groqFallback,
  nvidiaFallback,
  openRouterFallback,

  // ── Validation functions ──
  validateModalKey,
  validateGroqKey,
  validateOpenRouterKey,

  // ── Sleep ──
  sleep,
} from "./chatbot.js";

// ════════════════════════════════════════════════════════════════════════
// STREAMING — provider selection
// ════════════════════════════════════════════════════════════════════════

/**
 * Try to pick the Modal provider if available.
 */
async function tryPickModalProvider(systemPrompt: string): Promise<{ provider: "modal"; modelId: string; systemPrompt: string } | null> {
  if (!modalIsAvailable()) return null;
  if (chatHealth.modalKeyValid === null) {
    // Need to reach into chatbot.ts for validateModalKey
    await validateModalKey();
  }
  if (!modalIsAvailable()) return null;
  logger.info("[Chatbot] Using TIER 1: GLM-5.1-FP8 (Modal)");
  return { provider: "modal", modelId: MODAL_MODEL, systemPrompt };
}

/**
 * Try to pick the Groq provider if available.
 */
async function tryPickGroqProvider(systemPrompt: string): Promise<{ provider: "groq"; modelId: string; systemPrompt: string } | null> {
  if (!groqIsAvailable()) return null;
  if (chatHealth.groqKeyValid === null) {
    await validateGroqKey();
  }
  if (!groqIsAvailable()) return null;
  const modelId = GROQ_MODELS[chatHealth.groqCurrentModelIndex] || GROQ_MODELS[0];
  logger.info(`[Chatbot] Using TIER 2: ${modelId} (Groq)`);
  return { provider: "groq", modelId, systemPrompt };
}

/**
 * Try to pick an OpenRouter provider (last working model or best tier-1).
 */
async function tryPickOpenRouterProvider(systemPrompt: string): Promise<{ provider: "openrouter"; modelId: string; systemPrompt: string } | null> {
  if (!chatHealth.openrouterKeyValidated) {
    await validateOpenRouterKey();
  }
  if (chatHealth.openrouterKeyValid === false) return null;

  // Use last working model or best tier-1 model — NO PROBING (saves 30s)
  if (chatHealth.lastWorkingModel && (Date.now() - chatHealth.lastWorkingTime) < 600000) {
    if ((modelFailCount[chatHealth.lastWorkingModel] || 0) < 3) {
      logger.info("[Chatbot] Using last working OpenRouter model", { model: chatHealth.lastWorkingModel });
      return { provider: "openrouter", modelId: chatHealth.lastWorkingModel, systemPrompt };
    }
  }

  // Use best tier-1 model directly — no probing needed
  const bestModel = AI_MODELS.find(m => m.tier === 1);
  if (bestModel) {
    logger.info("[Chatbot] Using best OpenRouter model", { model: bestModel.id });
    return { provider: "openrouter", modelId: bestModel.id, systemPrompt };
  }

  return null;
}

export async function pickWorkingModel(
  _messages: { role: string; content: string }[],
  language?: string,
  mode: "thinking" | "instant" = "thinking"
): Promise<
  | { provider: "modal"; modelId: string; systemPrompt: string }
  | { provider: "groq"; modelId: string; systemPrompt: string }
  | { provider: "openrouter"; modelId: string; systemPrompt: string }
  | null
> {
  const systemPrompt = getSystemPrompt(language);

  // ─── THINKING MODE: Modal (GLM-5.1) first — best quality reasoning ───
  if (mode === "thinking") {
    const modalPick = await tryPickModalProvider(systemPrompt);
    if (modalPick) return modalPick;
  }

  // ─── INSTANT MODE: Groq first — ultra-fast models ───
  // ─── THINKING fallback: Groq cascade ───
  const groqPick = await tryPickGroqProvider(systemPrompt);
  if (groqPick) return groqPick;

  logger.warn("[Chatbot] Modal + Groq unavailable — using TIER 3: OpenRouter");
  const openRouterPick = await tryPickOpenRouterProvider(systemPrompt);
  if (openRouterPick) return openRouterPick;

  // ─── INSTANT MODE last resort: Modal (if instant mode skipped it) ───
  if (mode === "instant") {
    const modalPick = await tryPickModalProvider(systemPrompt);
    if (modalPick) return modalPick;
  }

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
 * If Modal produced no usable content, recover via Groq then OpenRouter.
 */
async function recoverEmptyModalStream(
  request: { messages: { role: string; content: string }[]; language?: string },
  picked: { systemPrompt: string },
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController<Uint8Array>,
): Promise<void> {
  logger.warn("[Chatbot/Stream] Modal returned no content (only reasoning) — trying Groq...");
  const fb2 = await groqFallback(request.messages, picked.systemPrompt);
  if (fb2) {
    try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: fb2.reply })}\n\n`)); } catch { /* controller already closed */ }
    return;
  }
  const fb = await openRouterFallback(request.messages, picked.systemPrompt, request.language);
  if (fb) {
    try { controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: fb.reply })}\n\n`)); } catch { /* controller already closed */ }
  }
}

/**
 * Modal streaming start callback: pump upstream chunks into the SSE controller.
 */
async function pumpModalStream(
  upstream: ReadableStream<Uint8Array>,
  decoder: TextDecoder,
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController<Uint8Array>,
  request: { messages: { role: string; content: string }[]; language?: string },
  picked: { systemPrompt: string },
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
    await recoverEmptyModalStream(request, picked, encoder, controller);
  }

  try { controller.enqueue(encoder.encode("data: [DONE]\n\n")); } catch { /* controller already closed */ }
  try { controller.close(); } catch { /* already closed */ }
}

/**
 * Build the Modal fetch request body for the chosen model + system prompt.
 */
function buildModalStreamBody(picked: { modelId: string; systemPrompt: string }, request: { messages: { role: string; content: string }[] }) {
  return JSON.stringify({
    model: picked.modelId,
    messages: [
      { role: "system", content: picked.systemPrompt },
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    temperature: 0.7,
    max_tokens: 2048,
    stream: true,
  });
}

// ════════════════════════════════════════════════════════════════════════
// MODAL STREAMING
// ════════════════════════════════════════════════════════════════════════

/**
 * Try a single Modal fetch attempt with the given timeout.
 * Returns the Response on success, or null if the caller should retry.
 */
async function tryModalStreamFetch(
  picked: { modelId: string; systemPrompt: string },
  request: { messages: { role: string; content: string }[] },
  timeout: number,
  attempt: number,
  totalAttempts: number,
  isLastAttempt: boolean
): Promise<Response | null> {
  logger.info(`[Chatbot/Stream] GLM-5.1 attempt ${attempt + 1}/${totalAttempts} (${timeout / 1000}s timeout)`);
  let response: Response;
  try {
    response = await fetch(MODAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MODAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: buildModalStreamBody(picked, request),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    chatHealth.modalConsecFails++;
    chatHealth.modalLastFailTime = Date.now();
    logger.warn(`[Chatbot/Stream] Modal attempt ${attempt + 1} threw`, { error: String(e) });
    if (!isLastAttempt) {
      logger.info("[Chatbot/Stream] Retrying Modal in 5s (queue congestion)...");
      await sleep(5000);
    }
    return null;
  }

  if (response.status === 429 || response.status === 503) {
    chatHealth.modalConsecFails++;
    chatHealth.modalLastFailTime = Date.now();
    const retryAfter = response.headers.get("retry-after") || "5";
    logger.warn(`[Chatbot/Stream] Modal overloaded (${response.status}) — waiting ${retryAfter}s before retry...`);
    await sleep(Number.parseInt(retryAfter, 10) * 1000);
    if (!isLastAttempt) {
      logger.info("[Chatbot/Stream] Retrying Modal after queue clear...");
    }
    return null;
  }

  if (!response.ok || !response.body) {
    chatHealth.modalConsecFails++;
    chatHealth.modalLastFailTime = Date.now();
    logger.warn(`[Chatbot/Stream] Modal attempt ${attempt + 1} failed: HTTP ${response.status}`);
    if (!isLastAttempt) {
      logger.info("[Chatbot/Stream] Retrying Modal...");
      await sleep(3000);
    }
    return null;
  }

  // SUCCESS
  chatHealth.modalConsecFails = 0;
  chatHealth.modalLastSuccess = Date.now();
  chatHealth.modalKeyValid = true;
  logger.info(`[Chatbot/Stream] GLM-5.1 attempt ${attempt + 1} SUCCESS`);
  return response;
}

/**
 * Modal stream (GLM-5.1) with smart RETRY — 3 attempts with backoff.
 */
async function streamModalProvider(
  request: { messages: { role: string; content: string }[]; language?: string },
  picked: { modelId: string; systemPrompt: string },
  encoder: TextEncoder,
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const timeouts = [180000, 300000, 480000]; // 3min, 5min, 8min
  let response: Response | null = null;

  for (let attempt = 0; attempt < timeouts.length; attempt++) {
    const timeout = timeouts[attempt];
    const isLastAttempt = attempt === timeouts.length - 1;
    const result = await tryModalStreamFetch(picked, request, timeout, attempt, timeouts.length, isLastAttempt);
    if (result) {
      response = result;
      break;
    }
  }

  if (!response?.body) {
    logger.error("[Chatbot/Stream] All Modal attempts failed — falling back to Groq.");
    return await streamGroqFallback(request, picked.systemPrompt);
  }

  const upstream = response.body;
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await pumpModalStream(upstream, decoder, encoder, controller, request, picked);
    },
  });

  return { stream, model: picked.modelId };
}

// ════════════════════════════════════════════════════════════════════════
// GROQ STREAMING
// ════════════════════════════════════════════════════════════════════════

/**
 * Build a TransformStream that decodes upstream SSE chunks and re-emits
 * lightweight `data: {"text": "..."}` events for our client.
 */
function buildSSEContentTransformStream(encoder: TextEncoder): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
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
  picked: { systemPrompt: string },
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
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
      }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    logger.warn(`[Chatbot/Stream/Groq] ${modelId} attempt ${attempt + 1} threw`, { error: String(e) });
    if (attempt < totalAttempts - 1) await sleep(5000);
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
      await sleep(3000);
      return { kind: "retry" };
    }
    return { kind: "nextModel" };
  }
  return { kind: "ok" };
}

/**
 * Groq stream — try each Groq model in cascade.
 */
async function streamGroqProvider(
  request: { messages: { role: string; content: string }[]; language?: string },
  picked: { systemPrompt: string },
  encoder: TextEncoder,
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const timeouts = [120000, 180000]; // 2min, 3min with backoff

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
  return await streamOpenRouterFallback(request, picked.systemPrompt);
}

// ════════════════════════════════════════════════════════════════════════
// OPENROUTER STREAMING
// ════════════════════════════════════════════════════════════════════════

/**
 * OpenRouter stream — direct fetch + transform that extracts `delta.content`.
 */
async function streamOpenRouterProvider(
  request: { messages: { role: string; content: string }[]; language?: string },
  picked: { modelId: string; systemPrompt: string },
  encoder: TextEncoder,
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
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
        model: picked.modelId,
        messages: [
          { role: "system", content: picked.systemPrompt },
          ...request.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      modelFailCount[picked.modelId] = (modelFailCount[picked.modelId] || 0) + 1;
      return buildStreamErrorResponse("openRouterError", request.language);
    }

    const transformStream = buildSSEContentTransformStream(encoder);
    const stream = response.body.pipeThrough(transformStream);
    return { stream, model: picked.modelId };
  } catch {
    modelFailCount[picked.modelId] = (modelFailCount[picked.modelId] || 0) + 1;
    return buildStreamErrorResponse("openRouterConnectError", request.language);
  }
}

// ════════════════════════════════════════════════════════════════════════
// FALLBACK STREAM HELPERS
// ════════════════════════════════════════════════════════════════════════

/**
 * If a Modal stream fails, try Groq fallback,
 * then emit as a single SSE text chunk so the client sees one clean reply.
 */
async function streamGroqFallback(
  request: { messages: { role: string; content: string }[]; language?: string },
  systemPrompt: string
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const ocResult = await groqFallback(request.messages, systemPrompt);
  if (ocResult) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: ocResult.reply })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch { /* controller already closed */ }
      },
    });
    return { stream, model: ocResult.model };
  }

  // Groq failed — try NVIDIA (MiniMax-M3)
  const nvidiaResult = await nvidiaFallback(request.messages, systemPrompt);
  if (nvidiaResult) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: nvidiaResult.reply })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch { /* controller already closed */ }
      },
    });
    return { stream, model: nvidiaResult.model };
  }

  // NVIDIA also failed — try OpenRouter
  const orResult = await openRouterFallback(request.messages, systemPrompt, request.language);
  if (!orResult) {
    return {
      error: request.language === "ar"
        ? "جميع نماذج الذكاء الاصطناعي مشغولة حالياً. يرجى المحاولة بعد قليل."
        : "All AI models are temporarily busy. Please try again in a few seconds.",
    };
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: orResult.reply })}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch { /* controller already closed */ }
    },
  });
  return { stream, model: orResult.model };
}

/**
 * If a Modal stream fails, fall back to a NON-streaming OpenRouter response,
 * then emit it as a single SSE text chunk.
 */
async function streamOpenRouterFallback(
  request: { messages: { role: string; content: string }[]; language?: string },
  systemPrompt: string
): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const orResult = await openRouterFallback(request.messages, systemPrompt, request.language);
  if (orResult) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: orResult.reply })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch { /* controller already closed */ }
      },
    });
    return { stream, model: orResult.model };
  }

  // OpenRouter failed — last resort: try Modal (GLM-5.1) non-streaming.
  logger.error("[Chatbot/Stream] OpenRouter fallback failed — last resort: Modal non-streaming.");
  const modalResult = await tryModalTier!(request.messages, systemPrompt);
  if (modalResult?.success && modalResult.reply) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: modalResult.reply })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch { /* controller already closed */ }
      },
    });
    return { stream, model: modalResult.model || MODAL_MODEL };
  }

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
}): Promise<{ stream: ReadableStream<Uint8Array>; model: string } | { error: string }> {
  const mode = request.mode || "thinking";
  const picked = await pickWorkingModel(request.messages, request.language, mode);

  if (!picked) {
    return buildStreamErrorResponse("noProvider", request.language);
  }

  const encoder = new TextEncoder();

  if (picked.provider === "modal") {
    return await streamModalProvider(request, picked, encoder);
  }

  if (picked.provider === "groq") {
    return await streamGroqProvider(request, picked, encoder);
  }

  return await streamOpenRouterProvider(request, picked, encoder);
}

