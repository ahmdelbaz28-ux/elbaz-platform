/**
 * SCHEMA — Chatbot domain
 *
 * Tables: chatbotFeedback
 *
 * chatbotFeedback stores the 👍/👎 vote a user gives on an assistant reply
 * (web widget or Telegram DM). It is the real-world fuel for the chatbot
 * evolution loop: failing conversations get reviewed in the admin panel and
 * become test fixtures for the next prompt iteration.
 *
 * Privacy: question/answer snapshots are truncated at write time and exist
 * ONLY to make the vote reviewable — no browser fingerprint, no IP.
 */

import {
  mysqlTable,
  bigint,
  varchar,
  text,
  timestamp,
  index,
  foreignKey,
} from "drizzle-orm/mysql-core";
import { users } from "./auth.js";

export const chatbotFeedback = mysqlTable(
  "chatbotFeedback",
  {
    id: bigint("id", { mode: "number", unsigned: true }).primaryKey().autoincrement(),
    /** Client conversation id (localStorage chat id / telegram chat id). */
    chatId: varchar("chatId", { length: 64 }).notNull(),
    /** Site user when logged in — NULL for anonymous or deleted accounts. */
    userId: bigint("userId", { mode: "number", unsigned: true }),
    /** "up" | "down" — enforced at the API layer. */
    rating: varchar("rating", { length: 8 }).notNull(),
    /** Optional one-line reason the user typed after voting. */
    comment: varchar("comment", { length: 600 }),
    /** Snapshot of the question (truncated ≤ 2000 chars at insert). */
    question: text("question").notNull(),
    /** Snapshot of the assistant reply (truncated ≤ 4000 chars at insert). */
    answer: text("answer").notNull(),
    /** "ar" | "en" — language the round ran in. */
    language: varchar("language", { length: 8 }).notNull().default("ar"),
    /** "thinking" | "instant" — chat mode. */
    mode: varchar("mode", { length: 12 }),
    /** Model label returned by the cascade (engine identity stays private). */
    model: varchar("model", { length: 120 }),
    /** "web" | "telegram" — where the vote happened. */
    source: varchar("source", { length: 16 }).notNull().default("web"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("chatbot_feedback_created_idx").on(table.createdAt),
    index("chatbot_feedback_rating_idx").on(table.rating),
    index("chatbot_feedback_chat_idx").on(table.chatId),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "fk_chatbot_feedback_user",
    }).onDelete("set null").onUpdate("cascade"),
  ],
);

export type ChatbotFeedback = typeof chatbotFeedback.$inferSelect;
export type InsertChatbotFeedback = typeof chatbotFeedback.$inferInsert;
