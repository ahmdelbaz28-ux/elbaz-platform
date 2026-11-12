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

export const feedbackSchema = z.object({
  chatId: z.string().min(4).max(64),
  rating: z.enum(["up", "down"]),
  // ✅ FIX (2026-11-13): the caps now MATCH the DB columns (question 2000 /
  // answer 4000 in chatbot-feedback.ts) — the old 8_000 let schema-valid
  // votes through only to be silently truncated at insert time.
  question: z.string().min(1).max(2_000),
  answer: z.string().min(1).max(4_000),
  comment: z.string().max(FEEDBACK_COMMENT_CAP).optional(),
  language: z.enum(["ar", "en"]).optional(),
  mode: z.enum(["thinking", "instant"]).optional(),
  model: z
    .string()
    .max(120)
    .optional()
    // ✅ AUDIT RUN-2 FIX (raw provider tags could re-enter persisted state
    // through the vote path): the model field is normalized to the opaque
    // key shape — anything else is dropped, not stored verbatim.
    .transform((v) => (v && /^m_[0-9a-f]{10}$/.test(v) ? v : undefined)),
});

// In-memory vote limiter — same shape as the chatbot router's (single instance
// is fine without Redis; HF Spaces runs one pod).
const voteWindowMs = 10 * 60_000;
const voteMaxPerWindow = 30;
const votes = new Map<string, { count: number; resetAt: number }>();
// ✅ SECURITY FIX (pre-launch audit run-2, chatbot.map-bounds): spoofable
// x-forwarded-for values used to grow the map without bound (time-only
// cleanup). Same MAX_SIZE pattern as the shield's rateLimitMap.
const VOTES_MAP_MAX_SIZE = 5000;

function voteAllowed(ip: string): boolean {
  const now = Date.now();
  if (votes.size >= VOTES_MAP_MAX_SIZE) cleanupVotes(now);
  const entry = votes.get(ip);
  if (!entry || now > entry.resetAt) {
    votes.set(ip, { count: 1, resetAt: now + voteWindowMs });
    return true;
  }
  if (entry.count >= voteMaxPerWindow) return false;
  entry.count += 1;
  return true;
}

function cleanupVotes(now: number): void {
  for (const [key, entry] of votes) {
    if (now > entry.resetAt) votes.delete(key);
  }
}

setInterval(() => {
  cleanupVotes(Date.now());
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
