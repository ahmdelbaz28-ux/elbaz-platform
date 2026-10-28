import { Hono } from "hono";
import { z } from "zod";
import { resolveOptionalUser } from "./context";
import { getClientIpFromHono } from "./lib/client-ip";
import { recordChatbotFeedback, FEEDBACK_COMMENT_CAP } from "./lib/chatbot-feedback";
import { logger } from "./lib/logger";

// ─── Chatbot feedback (👍/👎 on assistant replies) ────────────────────────────
// Mounted at /api/chatbot/feedback inside chatbot-router.
//
//   POST /  → record one vote. Public (anonymous votes allowed) — the vote is
//             the signal; snapshots are truncated server-side. Rate-limited
//             per IP (30 votes/10 min) so a script can't flood the table.

const feedbackSchema = z.object({
  chatId: z.string().min(4).max(64),
  rating: z.enum(["up", "down"]),
  question: z.string().min(1).max(8_000),
  answer: z.string().min(1).max(8_000),
  comment: z.string().max(FEEDBACK_COMMENT_CAP).optional(),
  language: z.enum(["ar", "en"]).optional(),
  mode: z.enum(["thinking", "instant"]).optional(),
  model: z.string().max(120).optional(),
});

// In-memory vote limiter — same shape as the chatbot router's (single instance
// is fine without Redis; HF Spaces runs one pod).
const voteWindowMs = 10 * 60_000;
const voteMaxPerWindow = 30;
const votes = new Map<string, { count: number; resetAt: number }>();

function voteAllowed(ip: string): boolean {
  const now = Date.now();
  const entry = votes.get(ip);
  if (!entry || now > entry.resetAt) {
    votes.set(ip, { count: 1, resetAt: now + voteWindowMs });
    return true;
  }
  if (entry.count >= voteMaxPerWindow) return false;
  entry.count += 1;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of votes) {
    if (now > entry.resetAt) votes.delete(key);
  }
}, 5 * 60_000).unref();

export const chatbotFeedbackRoute = new Hono();

chatbotFeedbackRoute.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid feedback payload" }, 400);
  }

  const ip = getClientIpFromHono(c);
  if (!voteAllowed(ip)) {
    return c.json({ error: "Too many votes — slow down" }, 429);
  }

  const user = await resolveOptionalUser(c.req.raw);
  const data = parsed.data;

  const stored = await recordChatbotFeedback({
    chatId: data.chatId,
    rating: data.rating,
    question: data.question,
    answer: data.answer,
    comment: data.comment,
    language: data.language,
    mode: data.mode,
    model: data.model,
    source: "web",
    userId: user?.id ?? null,
  });

  if (!stored) {
    return c.json({ error: "Failed to store feedback" }, 500);
  }
  logger.info("[ChatbotFeedback] vote recorded", { rating: data.rating, source: "web" });
  return c.json({ ok: true });
});
