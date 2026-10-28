import { env } from "./env.js";
import { logger } from "./logger.js";
import { telegramApiBase, telegramRelayHeaders } from "./telegram-transport.js";

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
 * POST one message to the channel. Never throws — a Telegram outage must not
 * break content publishing or the YouTube watcher tick.
 */
export async function sendTelegramBroadcast(input: TelegramMessageInput): Promise<boolean> {
  if (!isTelegramConfigured()) return false;

  const { text, inlineKeyboard } = formatTelegramMessage(input);
  // Transport is configurable (telegram-transport.ts) — direct Bot API by
  // default, or the Cloudflare Worker relay when TELEGRAM_API_BASE is set.
  const api = `${telegramApiBase()}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;

  try {
    const res = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...telegramRelayHeaders() },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: false },
        reply_markup: { inline_keyboard: inlineKeyboard },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      logger.warn("[Telegram] sendMessage rejected", { status: res.status, body: bodyText.slice(0, 200) });
      return false;
    }
    logger.info("[Telegram] broadcast delivered", { type: input.type });
    return true;
  } catch (err) {
    logger.warn("[Telegram] sendMessage failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
