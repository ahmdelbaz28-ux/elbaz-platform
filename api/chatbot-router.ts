/**
 * Chatbot API Router
 *
 * Mounts the AI chatbot endpoints:
 *   POST /api/chatbot        — non-streaming response
 *   POST /api/chatbot/stream  — SSE streaming response
 */

import { Hono } from "hono";
import { getChatResponse, getStreamResponse } from "./lib/chatbot.js";
// Removed checkRateLimit

const chatbotRouter = new Hono();

// ── Simple in-memory rate limiter for chatbot (no auth required) ──
const chatbotRequests = new Map<string, { count: number; resetAt: number }>();
const CHATBOT_RATE_LIMIT = 20; // requests per window per IP
const CHATBOT_WINDOW_MS = 60_000; // 1 minute window

function getChatbotIp(c: any): string {
  return c.req.header("cf-connecting-ip")
    || c.req.header("x-real-ip")
    || (c.req.header("x-forwarded-for")?.split(",").shift()?.trim())
    || "unknown";
}

function checkChatbotRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = chatbotRequests.get(ip);
  if (!entry || now > entry.resetAt) {
    chatbotRequests.set(ip, { count: 1, resetAt: now + CHATBOT_WINDOW_MS });
    return true;
  }
  if (entry.count >= CHATBOT_RATE_LIMIT) {
    return false;
  }
  entry.count++;
  return true;
}

// Periodic cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of chatbotRequests) {
    if (now > entry.resetAt) chatbotRequests.delete(key);
  }
}, 5 * 60_000).unref();

// ── Non-streaming chat endpoint ──
chatbotRouter.post("/", async (c) => {
  try {
    const ip = getChatbotIp(c);
    if (!checkChatbotRateLimit(ip)) {
      return c.json({ success: false, error: "Rate limit exceeded. Please try again later." }, 429);
    }
    const body = await c.req.json<{ messages: { role: string; content: string }[]; language?: string; chatId?: string }>();

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ success: false, error: "Messages array is required" }, 400);
    }

    // Limit message count to prevent abuse
    const messages = body.messages.slice(-50);

    const result = await getChatResponse({
      messages,
      language: body.language,
    });

    if (result.success) {
      return c.json({
        success: true,
        reply: result.reply,
        model: result.model,
        chatId: body.chatId,
      });
    }

    return c.json({
      success: false,
      error: result.error || "Unknown error",
      chatId: body.chatId,
    }, 503);
  } catch (err) {
    console.error("[Chatbot] Error in /api/chatbot:", err);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

// ── Streaming chat endpoint (SSE) ──
chatbotRouter.post("/stream", async (c) => {
  // GLM-5.1-FP8 is a REASONING model - needs 60-120s to think before generating
  // 180s timeout: 2 minutes for reasoning models (Modal GLM)
  const timeoutMs = 180_000; // 3 minutes - give GLM time to think
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    console.warn("[Chatbot] Stream timeout (180s) - aborting request");
    timeoutController.abort();
  }, timeoutMs);

  try {
    const ip = getChatbotIp(c);
    if (!checkChatbotRateLimit(ip)) {
      clearTimeout(timeoutId);
      return c.json({ success: false, error: "Rate limit exceeded. Please try again later." }, 429);
    }
    const body = await c.req.json<{ messages: { role: string; content: string }[]; language?: string; chatId?: string }>();

    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      clearTimeout(timeoutId);
      return c.json({ success: false, error: "Messages array is required" }, 400);
    }

    const messages = body.messages.slice(-50);

    // Create promise that rejects on timeout
    const streamPromise = getStreamResponse({
      messages,
      language: body.language,
    });

    // Race between stream response and timeout
    let result;
    try {
      result = await Promise.race([
        streamPromise,
        new Promise<never>((_, reject) => {
          timeoutController.signal.addEventListener("abort", () => {
            reject(new Error("AI response timeout (180s)"));
          });
        }),
      ]);
    } catch (raceErr: any) {
      clearTimeout(timeoutId);
      console.warn("[Chatbot] Stream race failed:", raceErr.message);
      return c.json({ success: false, error: "Request timeout. GLM is thinking, please try again.", chatId: body.chatId }, 504);
    }

    if ("error" in result) {
      clearTimeout(timeoutId);
      return c.json({ success: false, error: result.error, chatId: body.chatId }, 503);
    }

    // Send model name as first SSE event, then pipe the actual stream
    const encoder = new TextEncoder();
    const modelEvent = encoder.encode("data: " + JSON.stringify({ model: result.model }) + "\n\n");

    // Create a combined stream: model event FIRST, then actual content stream
    let controllerRef: ReadableStreamDefaultController | null = null;
    let isStreamClosed = false;

    const combinedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        // Send model name first so client can show "Thinking with [model]..."
        try {
          controller.enqueue(modelEvent);
        } catch {
          isStreamClosed = true;
        }
      },
      cancel() {
        // Handle client disconnect
        isStreamClosed = true;
        clearTimeout(timeoutId);
        try { timeoutController.abort(); } catch {}
      },
    });

    // Pipe the actual content stream in background (non-blocking)
    (async () => {
      try {
        const reader = result.stream.getReader();
        const decoder = new TextDecoder();

        while (true) {
          // Check for timeout or stream closure
          if (timeoutController.signal.aborted || isStreamClosed) break;

          try {
            const { done, value } = await reader.read();
            if (done || isStreamClosed) break;

            if (value && !isStreamClosed) {
              try {
                controllerRef?.enqueue(value);
              } catch {
                isStreamClosed = true;
                break;
              }
            }
          } catch (readErr: any) {
            if (readErr.name === "AbortError") break;
            console.warn("[Chatbot] Stream read error:", readErr.message);
            break;
          }
        }

        // Clean close
        clearTimeout(timeoutId);
        if (!isStreamClosed) {
          try {
            controllerRef?.close();
          } catch {}
          isStreamClosed = true;
        }
      } catch (pipeErr: any) {
        console.warn("[Chatbot] Stream pipe error:", pipeErr.message);
        clearTimeout(timeoutId);
        if (!isStreamClosed) {
          try {
            controllerRef?.close();
          } catch {}
          isStreamClosed = true;
        }
      }
    })();

    return new Response(combinedStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("[Chatbot] Error in /api/chatbot/stream:", err);
    return c.json({ success: false, error: "Internal server error" }, 500);
  }
});

export { chatbotRouter };
