import { env } from "./env.js";
import { logger } from "./logger.js";

// ─── Telegram broadcast bot ────────────────────────────────────────────────────
// Mirrors every site/YouTube announcement to the owner's Telegram channel
// (t.me/engahmedetap) so followers get the same notification inside Telegram.
//
// Setup (one-time, documented in .env.example):
//   1. Create a bot with @BotFather → copy the token.
//   2. Add the bot as an ADMIN (with "Post messages") to the channel.
//   3. Set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (e.g. "@engahmedetap").
// Without those two env values the delivery silently skips — nothing else
// breaks. Same never-throw contract as the rest of the notification chain.

/** Emojis + labels per notification type (Arabic-first, matches the bell). */
const TYPE_ICONS: Record<string, string> = {
  youtube: "🎬",
  lesson: "📚",
  file: "📁",
  software: "💻",
  promo: "📣",
  system: "🔔",
};

/** Escape a string for Telegram's HTML parse mode (< > &). */
export function escapeTelegramHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export interface TelegramMessageInput {
  type: string;
  title: string;
  message: string;
  url?: string;
  channelUrl?: string;
}

export interface TelegramMessageParts {
  text: string;
  inlineKeyboard: Array<Array<{ text: string; url: string }>>;
}

/**
 * Build the channel message. Pure — exported for unit tests.
 * Telegram captions/messages: text ≤ 4096 chars after entities.
 */
export function formatTelegramMessage(input: TelegramMessageInput): TelegramMessageParts {
  const icon = TYPE_ICONS[input.type] ?? TYPE_ICONS.system;
  const SITE_URL = "https://ahmedelbaz.qzz.io";

  const lines: string[] = [
    `${icon} <b>${escapeTelegramHtml(input.title)}</b>`,
    "",
    escapeTelegramHtml(input.message),
  ];

  // Content notifications nudge followers to BOTH the content and the channel.
  if (input.type === "youtube") {
    lines.push("", "🔔 فعّل الجرس على القناة عشان يوصلك كل جديد أول بأول.");
  }

  const text = lines.join("\n").slice(0, 3900); // entity-safe budget below the 4096 cap

  const inlineKeyboard: TelegramMessageParts["inlineKeyboard"] = [];
  const row: Array<{ text: string; url: string }> = [];
  if (input.url) row.push({ text: input.type === "youtube" ? "🎬 شوف الحلقة" : "🔗 افتح على الموقع", url: input.url });
  if (input.channelUrl) row.push({ text: "📢 اشترك في القناة", url: input.channelUrl });
  if (row.length > 0) inlineKeyboard.push(row);
  inlineKeyboard.push([{ text: "🌐 الموقع الرسمي", url: SITE_URL }]);

  return { text, inlineKeyboard };
}

/** True when both env values are present. */
export function isTelegramConfigured(): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
}

/**
 * POST one message to the channel.
 *
 * OWNER POLICY (2026-10-29): automatic publishing to the channel/group is
 * PERMANENTLY DISABLED — the owner is the only publisher there, and the
 * provider-probe alerts proved how fast robot noise fills the feed. This is
 * a deliberate no-op: the in-app bell and the browser-push legs of
 * pushNotification are untouched. To ever re-enable, restore the send body
 * from git history (commit before 2026-10-29) — not a config flag, on
 * purpose: a flag can be flipped by accident, a policy comment cannot.
 */
export async function sendTelegramBroadcast(input: TelegramMessageInput): Promise<boolean> {
  logger.info("[Telegram] auto-broadcast suppressed — owner publishes only", { type: input.type });
  return false;
}
