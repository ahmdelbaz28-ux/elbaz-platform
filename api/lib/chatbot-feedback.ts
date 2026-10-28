/**
 * Chatbot Feedback Loop (chatbotFeedback table)
 *
 * Responsibilities:
 *   • recordChatbotFeedback   — persist one 👍/👎 vote (fail-open: a feedback
 *                               problem must NEVER break the chat itself)
 *   • listChatbotFeedback     — admin review feed (newest first, optional rating filter)
 *   • getChatbotFeedbackStats — up/down/total counts for the admin header cards
 *
 * Privacy & size rules:
 *   • question/answer snapshots are truncated BEFORE insert — a poisoned row
 *     can never blow up the admin panel or the DB (mirrors chat-history caps).
 *   • No IP, no user-agent, no fingerprint — the vote is the signal, the
 *     snapshot is only there to make it reviewable.
 */
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../queries/connection.js";
import { chatbotFeedback } from "@db/schema";
import { logger } from "./logger.js";

export const FEEDBACK_QUESTION_CAP = 2_000;
export const FEEDBACK_ANSWER_CAP = 4_000;
export const FEEDBACK_COMMENT_CAP = 600;
export const FEEDBACK_CHAT_ID_CAP = 64;

export type FeedbackRating = "up" | "down";

export interface FeedbackInput {
  chatId: string;
  rating: FeedbackRating;
  question: string;
  answer: string;
  comment?: string | undefined;
  language?: "ar" | "en" | undefined;
  mode?: "thinking" | "instant" | undefined;
  model?: string | undefined;
  source?: "web" | "telegram" | undefined;
  userId?: number | null | undefined;
}

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

/** Insert one vote. Returns false when the DB layer fails (fail-open). */
export async function recordChatbotFeedback(input: FeedbackInput): Promise<boolean> {
  try {
    await getDb().insert(chatbotFeedback).values({
      chatId: clip(input.chatId, FEEDBACK_CHAT_ID_CAP) || "anonymous",
      rating: input.rating,
      question: clip(input.question, FEEDBACK_QUESTION_CAP),
      answer: clip(input.answer, FEEDBACK_ANSWER_CAP),
      comment: input.comment ? clip(input.comment, FEEDBACK_COMMENT_CAP) : null,
      language: input.language === "en" ? "en" : "ar",
      mode: input.mode === "thinking" || input.mode === "instant" ? input.mode : null,
      model: input.model ? clip(input.model, 120) : null,
      source: input.source === "telegram" ? "telegram" : "web",
      userId: input.userId ?? null,
    });
    return true;
  } catch (err) {
    logger.warn("[ChatbotFeedback] insert failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export interface FeedbackRow {
  id: number;
  chatId: string;
  rating: string;
  comment: string | null;
  question: string;
  answer: string;
  language: string;
  mode: string | null;
  model: string | null;
  source: string;
  createdAt: Date;
}

/** Admin review feed — newest first, optional rating filter, bounded limit. */
export async function listChatbotFeedback(opts: { limit?: number; rating?: "up" | "down" | undefined } = {}): Promise<FeedbackRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  try {
    const base = getDb().select({
      id: chatbotFeedback.id,
      chatId: chatbotFeedback.chatId,
      rating: chatbotFeedback.rating,
      comment: chatbotFeedback.comment,
      question: chatbotFeedback.question,
      answer: chatbotFeedback.answer,
      language: chatbotFeedback.language,
      mode: chatbotFeedback.mode,
      model: chatbotFeedback.model,
      source: chatbotFeedback.source,
      createdAt: chatbotFeedback.createdAt,
    }).from(chatbotFeedback);
    const rows = opts.rating
      ? await base.where(eq(chatbotFeedback.rating, opts.rating)).orderBy(desc(chatbotFeedback.createdAt)).limit(limit)
      : await base.orderBy(desc(chatbotFeedback.createdAt)).limit(limit);
    return rows;
  } catch (err) {
    logger.warn("[ChatbotFeedback] list failed", { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

export interface FeedbackStats {
  up: number;
  down: number;
  total: number;
}

/** Up/down counts — the header cards of the admin tab. */
export async function getChatbotFeedbackStats(): Promise<FeedbackStats> {
  try {
    const rows = await getDb()
      .select({ rating: chatbotFeedback.rating, count: sql<number>`count(*)` })
      .from(chatbotFeedback)
      .groupBy(chatbotFeedback.rating);
    let up = 0;
    let down = 0;
    for (const row of rows) {
      if (row.rating === "up") up = Number(row.count) || 0;
      else if (row.rating === "down") down = Number(row.count) || 0;
    }
    return { up, down, total: up + down };
  } catch (err) {
    logger.warn("[ChatbotFeedback] stats failed", { error: err instanceof Error ? err.message : String(err) });
    return { up: 0, down: 0, total: 0 };
  }
}
