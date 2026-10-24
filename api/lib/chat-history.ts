/**
 * Chat History Persistence (chatMessages table — previously unused)
 *
 * Responsibilities:
 *   • persistChatRound        — save every user+assistant round for logged-in users
 *   • getChatHistory          — last 50 rounds + the latest rolling summary
 *   • maybeUpdateRollingSummary — regenerate the rolling summary of context older
 *                                 than ~1 day (fail-open, throttled by coverage)
 *
 * Design notes:
 *   • The summary is stored as a chatMessages row with role="summary" (the role
 *     column is varchar(20)) — no new table, no migration. Exactly one current
 *     summary per user (older ones pruned).
 *   • Every step fails open: history problems must NEVER break the chat itself.
 *   • Content caps mirror chatbot-router's MAX_MESSAGE_CHARS so a poisoned
 *     history row can never blow the provider context window.
 */
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import { getDb } from "../queries/connection.js";
import { chatMessages } from "@db/schema";
import { getChatResponse } from "./chatbot.js";
import { logger } from "./logger.js";

export const CHAT_HISTORY_LIMIT = 50;
const SUMMARY_ROLE = "summary";
/** Context older than this window is folded into the rolling summary. */
const SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1000; // ~1 day
/** Don't regenerate the summary for fewer than this many uncovered old rounds. */
const SUMMARY_MIN_UNCOVERED_ROUNDS = 12;
/** Cap on old messages fed into one summarization call. */
const SUMMARY_MAX_SOURCE_MESSAGES = 200;
const MAX_SAVED_CHARS = 8_000;
const MAX_SUMMARY_CHARS = 1_500;
/** Keep at most this many summary rows per user (older ones pruned). */
const SUMMARY_ROWS_TO_KEEP = 3;

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  model?: string;
}

interface PersistRoundOptions {
  userText: string;
  assistantText: string;
  model?: string;
  vision?: boolean;
  mode?: string;
  courseId?: number | null;
}

function clip(text: string): string {
  return text.slice(0, MAX_SAVED_CHARS);
}

/**
 * Save one chat round (user + assistant) for a logged-in user.
 * Fire-and-forget friendly: never throws — persistence must not break chatting.
 */
export async function persistChatRound(userId: number, opts: PersistRoundOptions): Promise<void> {
  try {
    const userText = clip(opts.userText).trim();
    const assistantText = clip(opts.assistantText).trim();
    if (!userText || !assistantText) return;

    const metadata: Record<string, unknown> = {
      mode: opts.mode ?? "thinking",
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.vision ? { vision: true } : {}),
    };

    const db = getDb();
    await db.insert(chatMessages).values([
      {
        userId,
        role: "user",
        content: userText,
        metadata: opts.courseId ? { ...metadata, courseId: opts.courseId } : metadata,
      },
      {
        userId,
        role: "assistant",
        content: assistantText,
        metadata: { ...metadata },
      },
    ]);

    // Roll the summary forward in the background — never awaited by the caller.
    void maybeUpdateRollingSummary(userId).catch((err) => {
      logger.warn("[ChatHistory] background summary update failed", { error: String(err) });
    });
  } catch (err) {
    logger.warn("[ChatHistory] persistChatRound failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Last 50 messages (display history) + the latest rolling summary (AI context).
 */
export async function getChatHistory(userId: number): Promise<{ messages: HistoryMessage[]; summary: string | null }> {
  const db = getDb();
  const rows = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      createdAt: chatMessages.createdAt,
      metadata: chatMessages.metadata,
    })
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, userId), ne(chatMessages.role, SUMMARY_ROLE)))
    .orderBy(desc(chatMessages.id))
    .limit(CHAT_HISTORY_LIMIT);

  const messages: HistoryMessage[] = rows
    .slice()
    .reverse()
    .filter((r) => r.role === "user" || r.role === "assistant")
    .map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        id: `server-${r.id}`,
        role: r.role as "user" | "assistant",
        content: r.content,
        createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
        ...(typeof meta.model === "string" ? { model: meta.model } : {}),
      };
    });

  const summary = await getLatestSummaryText(userId);
  return { messages, summary };
}

/** Latest rolling summary text for a user (null when none). */
export async function getLatestSummaryText(userId: number): Promise<string | null> {
  try {
    const db = getDb();
    const [row] = await db
      .select({ content: chatMessages.content })
      .from(chatMessages)
      .where(and(eq(chatMessages.userId, userId), eq(chatMessages.role, SUMMARY_ROLE)))
      .orderBy(desc(chatMessages.id))
      .limit(1);
    return row?.content ?? null;
  } catch {
    return null;
  }
}

/**
 * Rolling summary maintenance — regenerates when enough uncovered context
 * older than ~1 day has accumulated. Throttled by coverage bookkeeping
 * (metadata.coveredUntilId on the summary row).
 */
export async function maybeUpdateRollingSummary(userId: number): Promise<void> {
  const db = getDb();
  const boundary = new Date(Date.now() - SUMMARY_WINDOW_MS);

  // Current coverage — a summary row covers everything up to (and including)
  // the message id stored in its metadata.
  const [current] = await db
    .select({ id: chatMessages.id, metadata: chatMessages.metadata })
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, userId), eq(chatMessages.role, SUMMARY_ROLE)))
    .orderBy(desc(chatMessages.id))
    .limit(1);
  const coveredUntilId = Number(((current?.metadata ?? {}) as Record<string, unknown>).coveredUntilId ?? 0) || 0;

  // Uncovered rounds older than the window.
  const uncovered = await db
    .select({ count: sql<number>`count(*)` })
    .from(chatMessages)
    .where(and(
      eq(chatMessages.userId, userId),
      ne(chatMessages.role, SUMMARY_ROLE),
      gt(chatMessages.id, coveredUntilId),
      lt(chatMessages.createdAt, boundary),
    ));
  const uncoveredCount = Number(uncovered[0]?.count ?? 0);
  if (uncoveredCount < SUMMARY_MIN_UNCOVERED_ROUNDS) return;

  // Source transcript — the OLDEST uncovered old messages, capped.
  const sourceRows = await db
    .select({ role: chatMessages.role, content: chatMessages.content, id: chatMessages.id })
    .from(chatMessages)
    .where(and(
      eq(chatMessages.userId, userId),
      ne(chatMessages.role, SUMMARY_ROLE),
      gt(chatMessages.id, coveredUntilId),
      lt(chatMessages.createdAt, boundary),
    ))
    .orderBy(chatMessages.id)
    .limit(SUMMARY_MAX_SOURCE_MESSAGES);
  if (sourceRows.length === 0) return;

  const previousSummary = current?.id
    ? (await db.select({ content: chatMessages.content }).from(chatMessages).where(eq(chatMessages.id, current.id)).limit(1))[0]?.content
    : null;

  const transcript = sourceRows
    .map((r) => `${r.role === "user" ? "المستخدم" : "المساعد"}: ${clip(r.content)}`)
    .join("\n")
    .slice(0, 40_000);

  const instruction = `${previousSummary ? `ملخص المحادثات الأقدم سابقاً:\n${previousSummary.slice(0, MAX_SUMMARY_CHARS)}\n\n` : ""}لخّص المحادثة التالية بين المستخدم والمساعد في نقاط موجزة (مواضيع مهتم بها المستخدم، كورسات يسأل عنها، قرارات أو معلومات مهمة يجب تذكرها لاحقاً). اكتب الملخص فقط بدون أي مقدمة:\n\n${transcript}`;

  const result = await getChatResponse({
    messages: [{ role: "user", content: instruction }],
    mode: "instant",
    language: "ar",
  });
  if (!result.success || !result.reply?.trim()) {
    logger.warn("[ChatHistory] summary generation returned no content", { userId });
    return;
  }

  const lastCoveredId = sourceRows[sourceRows.length - 1]?.id ?? coveredUntilId;
  await db.insert(chatMessages).values({
    userId,
    role: SUMMARY_ROLE,
    content: clip(result.reply.trim()),
    metadata: {
      coveredUntilId: lastCoveredId,
      coveredUntilAt: boundary.toISOString(),
      sourceRounds: sourceRows.length,
      generatedAt: new Date().toISOString(),
    },
  });

  // Hygiene — keep only the newest summary rows per user.
  const oldSummaries = await db
    .select({ id: chatMessages.id })
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, userId), eq(chatMessages.role, SUMMARY_ROLE)))
    .orderBy(desc(chatMessages.id))
    .limit(20);
  const stale = oldSummaries.slice(SUMMARY_ROWS_TO_KEEP).map((r) => r.id);
  for (const id of stale) {
    await db.delete(chatMessages).where(eq(chatMessages.id, id));
  }

  logger.info("[ChatHistory] rolling summary updated", { userId, coveredUntilId: lastCoveredId, rounds: sourceRows.length });
}
