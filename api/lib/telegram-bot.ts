/**
 * Telegram Bot — the platform's Telegram arm.
 *
 * One long-polling worker (getUpdates) that turns the bot from a one-way
 * broadcast mirror into a living agent:
 *
 *   1. JOIN REQUESTS  — a user asks to join a protected group/channel → the
 *      bot approves INSTANTLY (can_invite_users admin right) and greets them
 *      in the group. This is the auto-approval gate the owner asked for.
 *   2. PRIVATE DMs    — students chat with the SAME expert brain as the site
 *      widget (getChatResponse + live course catalog + prompt v3.3.1 rules).
 *      Per-user hourly + global daily rate limits protect the provider pool.
 *
 * Design contracts (mirroring the rest of the notification stack):
 *   • NEVER THROWS — a Telegram outage must never break the API server.
 *   • Single poller per token (409 Conflict → long backoff, then stop).
 *   • All update handling is offset-confirmed; a crash re-delivers unhandled
 *     updates on reboot (approval re-try is harmless; a duplicate answer is
 *     rarer than losing one).
 *   • Group messages are IGNORED — the brain answers DMs only, so the bot
 *     never spams the group it guards.
 *
 * Env (all optional except TELEGRAM_BOT_TOKEN):
 *   TELEGRAM_BOT_POLLING=0      — disable the worker entirely
 *   TELEGRAM_DM_MODE=instant    — brain mode for DMs ('instant' | 'thinking')
 *   TELEGRAM_GROUP_WELCOME      — custom group welcome text after approval
 *   TELEGRAM_ADMIN_CHAT_ID      — gets a one-line "worker is up" ping at boot
 */
import { logger } from "./logger.js";

// ─── Telegram types (minimal — only what we touch) ───────────────────────────

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  chat_join_request?: { chat: TgChat; from: TgUser; date: number };
  my_chat_member?: unknown;
}

export interface TgApiResponse {
  ok: boolean;
  result?: unknown;
  description?: string;
  parameters?: { retry_after?: number };
}

/** Minimal sender surface — injectable for tests. */
export type TelegramApi = {
  call(method: string, payload?: Record<string, unknown>): Promise<TgApiResponse>;
};

/** Brain surface — mirrors getChatResponse's contract. */
export type ChatBrain = (
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  opts: { language: "ar" | "en"; mode: "thinking" | "instant" },
) => Promise<{ reply: string } | { error: string }>;

// ─── Constants ───────────────────────────────────────────────────────────────

const ARABIC_CHAR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
export const TELEGRAM_TEXT_CAP = 3_900; // hard API cap is 4096 — headroom keeps chunks whole
const DM_HISTORY_MAX_MESSAGES = 12;
const DM_HISTORY_TTL_MS = 30 * 60_000;
const DM_RATE_PER_HOUR = 20;
const GLOBAL_DAILY_CAP = 600;
const BRAIN_RETRY_DEADLINE_MS = 20_000;

// ─── Pure helpers (unit-tested) ──────────────────────────────────────────────

/** "ar" when the text carries Arabic glyphs, else "en". */
export function detectLanguage(text: string): "ar" | "en" {
  return ARABIC_CHAR_RE.test(text) ? "ar" : "en";
}

/**
 * Language for a message turn. Arabic-first platform: an Arabic text wins,
 * a non-command Latin text is English, and anything undetectable (bare
 * /start, emoji-only) falls back to the user's Telegram language_code,
 * then to Arabic — the platform's primary language.
 */
export function resolveTurnLanguage(text: string, user: TgUser | undefined): "ar" | "en" {
  if (ARABIC_CHAR_RE.test(text)) return "ar";
  const isBareCommand = text.startsWith("/") && !ARABIC_CHAR_RE.test(text);
  if (!isBareCommand && /[A-Za-z]/.test(text)) return "en";
  if (user?.language_code) return user.language_code.toLowerCase().startsWith("ar") ? "ar" : "en";
  return "ar";
}

/**
 * Strip markdown decoration for Telegram plain text: **bold** → bold,
 * `code` → code, heading hashes dropped. Keeps asterisks that are not
 * bold pairs (multiplication, pointers).
 */
export function plainForTelegram(md: string): string {
  return md
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/`([^`\n]*)`/g, "$1");
}

/**
 * Split a long reply into ≤cap chunks at paragraph boundaries (never
 * mid-word, never mid-sentence when a paragraph fits). Empty input → [].
 */
export function splitForTelegram(text: string, cap = TELEGRAM_TEXT_CAP): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= cap) return [trimmed];

  const paragraphs = trimmed.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    // A single paragraph longer than the cap: hard-split on line, then char.
    if (para.length > cap) {
      pushCurrent();
      let rest = para;
      while (rest.length > cap) {
        let cut = rest.lastIndexOf("\n", cap);
        if (cut < cap * 0.5) cut = rest.lastIndexOf(" ", cap);
        if (cut < cap * 0.5) cut = cap;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
      continue;
    }
    if ((current + "\n\n" + para).trim().length > cap) pushCurrent();
    current = current ? `${current}\n\n${para}` : para;
  }
  pushCurrent();
  return chunks;
}

/** DM /start + /help message with the platform's official buttons. */
export function buildStartDm(lang: "ar" | "en"): string {
  return lang === "ar"
    ? "أهلاً بيك في المساعد الذكي لمنصة أحمد الباز 👋\n\nاسألني أي حاجة في ETAP وهندسة القوى — خطوات البرنامج، الحمايات، تدفق الأحمال، الدواير القصيرة… وأجيبك من نفس العقل اللي شغال على الموقع.\n\n🌐 الموقع: https://ahmedelbaz.qzz.io"
    : "Welcome to the Ahmed Elbaz platform assistant 👋\n\nAsk me anything about ETAP and power engineering — software steps, protection, load flow, short-circuit… powered by the exact same brain as the website.\n\n🌐 Site: https://ahmedelbaz.qzz.io";
}

/** Group welcome posted right after a join request is approved. */
export function buildGroupWelcome(name: string | undefined, lang: "ar" | "en"): string {
  const who = name ? ` ${name}` : "";
  return lang === "ar"
    ? `أهلاً بيك${who} في الجروب 👋 قدم نفسك لو حابب، ولو عندك سؤال في ETAP اسأل البوت في الخاص @Ahmedetap_bot أو زور المنصة: https://ahmedelbaz.qzz.io`
    : `Welcome${who} 👋 Feel free to introduce yourself — for ETAP questions ask the bot in DM @Ahmedetap_bot or visit the platform: https://ahmedelbaz.qzz.io`;
}

/** Polite per-user rate-limit refusal. */
export function buildRateLimitNotice(lang: "ar" | "en"): string {
  return lang === "ar"
    ? "وصلت للحد الأقصى للرسائل الساعة دي (20 رسالة) 🙏 اتفضل اسألني تاني بعد شوية، أو زور الموقع: https://ahmedelbaz.qzz.io"
    : "You've hit this hour's message cap (20) 🙏 please ask again a bit later, or use the site: https://ahmedelbaz.qzz.io";
}

/** Brain-down apology (never leaks provider internals). */
export function buildDownNotice(lang: "ar" | "en"): string {
  return lang === "ar"
    ? "معلش، حصلت مشكلة تقنية مؤقتة والرد اتأخر 🙏 جرب تاني بعد دقيقة — ولو الاستفسار مستعجل زور المنصة: https://ahmedelbaz.qzz.io"
    : "Sorry — a temporary technical issue delayed the reply 🙏 try again in a minute, or use the site: https://ahmedelbaz.qzz.io";
}

// ─── In-memory state (single instance — HF Spaces runs one pod) ──────────────

interface DmHistory {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  expiresAt: number;
}

const dmHistories = new Map<number, DmHistory>();
const dmHourCounters = new Map<number, { count: number; resetAt: number }>();
let globalDailyCounter = { count: 0, resetAt: nextUtcMidnight() };

function nextUtcMidnight(): number {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function dmAllowed(chatId: number): boolean {
  const now = Date.now();
  if (now > globalDailyCounter.resetAt) globalDailyCounter = { count: 0, resetAt: nextUtcMidnight() };
  if (globalDailyCounter.count >= GLOBAL_DAILY_CAP) return false;
  const entry = dmHourCounters.get(chatId);
  if (!entry || now > entry.resetAt) {
    dmHourCounters.set(chatId, { count: 1, resetAt: now + 60 * 60_000 });
    globalDailyCounter.count += 1;
    return true;
  }
  if (entry.count >= DM_RATE_PER_HOUR) return false;
  entry.count += 1;
  globalDailyCounter.count += 1;
  return true;
}

function rememberTurn(chatId: number, user: string, assistant: string): void {
  const now = Date.now();
  const history = dmHistories.get(chatId);
  const fresh = history && now < history.expiresAt ? history : { messages: [], expiresAt: now + DM_HISTORY_TTL_MS };
  fresh.messages.push({ role: "user", content: user }, { role: "assistant", content: assistant });
  while (fresh.messages.length > DM_HISTORY_MAX_MESSAGES) fresh.messages.shift();
  fresh.expiresAt = now + DM_HISTORY_TTL_MS;
  dmHistories.set(chatId, fresh);
}

// Tests re-import the module per file — expose a reset for isolation.
export function resetTelegramBotStateForTests(): void {
  dmHistories.clear();
  dmHourCounters.clear();
  globalDailyCounter = { count: 0, resetAt: nextUtcMidnight() };
}

// ─── Update handling core ────────────────────────────────────────────────────

export interface TelegramBotDeps {
  api: TelegramApi;
  brain: ChatBrain;
  dmMode: "thinking" | "instant";
  groupWelcomeOverride?: string | undefined;
  now?: () => number;
}

async function sendChatMessage(
  deps: TelegramBotDeps,
  chatId: number,
  text: string,
  opts: { disablePreview?: boolean; keyboard?: Array<Array<{ text: string; url: string }>> } = {},
): Promise<void> {
  try {
    await deps.api.call("sendMessage", {
      chat_id: chatId,
      text,
      link_preview_options: { is_disabled: opts.disablePreview ?? false },
      ...(opts.keyboard ? { reply_markup: { inline_keyboard: opts.keyboard } } : {}),
    });
  } catch (err) {
    logger.warn("[TelegramBot] sendMessage failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Approve a join request + greet the newcomer in the group. Never throws. */
export async function handleJoinRequest(deps: TelegramBotDeps, chat: TgChat, from: TgUser): Promise<boolean> {
  try {
    const res = await deps.api.call("approveChatJoinRequest", { chat_id: chat.id, user_id: from.id });
    if (!res.ok) {
      logger.warn("[TelegramBot] join approval rejected", { description: (res.description ?? "").slice(0, 120) });
      return false;
    }
    logger.info("[TelegramBot] join request approved", { chatType: chat.type });
    // Greet groups only — a channel post would broadcast to every follower.
    if (chat.type === "group" || chat.type === "supergroup") {
      const lang = resolveTurnLanguage("", from);
      const welcome = deps.groupWelcomeOverride ?? buildGroupWelcome(from.first_name, lang);
      await sendChatMessage(deps, chat.id, welcome, { disablePreview: true });
    }
    return true;
  } catch (err) {
    logger.warn("[TelegramBot] join approval failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** One private DM turn: rate limit → brain (with history + one legacy retry) → chunked reply. */
export async function handlePrivateMessage(deps: TelegramBotDeps, msg: TgMessage): Promise<void> {
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim();
  if (!text) return;
  const lang = resolveTurnLanguage(text, msg.from);

  // Commands first — they never consume the rate budget.
  if (text === "/start" || text === "/help") {
    await sendChatMessage(deps, chatId, buildStartDm(lang), {
      keyboard: [[
        { text: lang === "ar" ? "🌐 الموقع" : "🌐 Website", url: "https://ahmedelbaz.qzz.io" },
        { text: lang === "ar" ? "📢 القناة" : "📢 Channel", url: "https://t.me/engahmedetap" },
      ]],
    });
    return;
  }
  if (text === "/clear") {
    dmHistories.delete(chatId);
    await sendChatMessage(deps, chatId, lang === "ar" ? "تم مسح ذاكرة المحادثة — نبدأ من جديد ✅" : "Conversation memory cleared — starting fresh ✅", { disablePreview: true });
    return;
  }

  if (!dmAllowed(chatId)) {
    await sendChatMessage(deps, chatId, buildRateLimitNotice(lang), { disablePreview: true });
    return;
  }

  // Typing indicator — the brain can take tens of seconds in thinking mode.
  void deps.api.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);

  const history = dmHistories.get(chatId);
  const prior = history && history.expiresAt > Date.now() ? history.messages : [];
  const turns = [...prior, { role: "user" as const, content: text }];

  let reply: string | null = null;
  const deadline = (deps.now ?? Date.now)() + BRAIN_RETRY_DEADLINE_MS;
  let attempt = 0;
  while (reply === null && (deps.now ?? Date.now)() < deadline) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3_000));
    attempt += 1;
    const result = await deps.brain(turns, { language: lang, mode: deps.dmMode });
    if ("reply" in result) {
      reply = result.reply;
    } else {
      logger.warn("[TelegramBot] brain attempt failed", { attempt, error: result.error.slice(0, 120) });
    }
  }

  if (reply === null) {
    await sendChatMessage(deps, chatId, buildDownNotice(lang), { disablePreview: true });
    return;
  }

  const plain = plainForTelegram(reply);
  rememberTurn(chatId, text, plain);
  const chunks = splitForTelegram(plain);
  for (let i = 0; i < chunks.length; i++) {
    await sendChatMessage(deps, chatId, chunks[i], { disablePreview: true });
    if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 350));
  }
}

/** Route one raw Telegram update. Returns true when the update was handled. */
export async function handleTelegramUpdate(deps: TelegramBotDeps, update: TgUpdate): Promise<boolean> {
  try {
    if (update.chat_join_request) {
      return await handleJoinRequest(deps, update.chat_join_request.chat, update.chat_join_request.from);
    }
    if (update.message && update.message.chat.type === "private") {
      const fromBot = update.message.from?.is_bot === true;
      if (!fromBot) await handlePrivateMessage(deps, update.message);
      return true;
    }
    return false;
  } catch (err) {
    logger.warn("[TelegramBot] update handling failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

// ─── Long-polling worker (production wiring) ─────────────────────────────────

const MAX_CONFLICTS = 5;
/** After repeated conflicts: long cool-down, then resume (a stray second
 *  poller — e.g. a debugging session — must not permanently kill the
 *  production worker; Telegram hands the conflict to BOTH clients). */
const CONFLICT_COOLDOWN_MS = 5 * 60_000;

function createRealApi(token: string): TelegramApi {
  return {
    async call(method, payload) {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
        signal: AbortSignal.timeout(35_000), // getUpdates long-polls 25s + margin
      });
      return (await res.json()) as TgApiResponse;
    },
  };
}

let workerRunning = false;

/**
 * Start the polling worker. Safe to call once per process — subsequent calls
 * no-op while a worker is alive. Returns false when disabled (no token or
 * TELEGRAM_BOT_POLLING=0).
 */
export async function startTelegramBot(): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || process.env.TELEGRAM_BOT_POLLING === "0" || workerRunning) return false;
  workerRunning = true;

  const deps: TelegramBotDeps = {
    api: createRealApi(token),
    dmMode: process.env.TELEGRAM_DM_MODE === "thinking" ? "thinking" : "instant",
    groupWelcomeOverride: process.env.TELEGRAM_GROUP_WELCOME || undefined,
    // Lazy import — keeps this module (and every test importing it) free of
    // the full chatbot dependency graph until the worker actually starts.
    brain: async (messages, opts) => {
      const [{ getChatResponse }, { getCourseCatalogText }, { sanitizeReplyOutput }] = await Promise.all([
        import("./chatbot.js"),
        import("./course-catalog.js"),
        import("./chatbot-prompts.js"),
      ]);
      const catalog = await getCourseCatalogText();
      const result = await getChatResponse({ messages, language: opts.language, mode: opts.mode, catalog });
      if (result.success) return { reply: sanitizeReplyOutput(result.reply ?? "") };
      return { error: result.error || "upstream exhausted" };
    },
  };

  // Fully contained: every await in this body is guarded — an escaping
  // rejection from any Telegram call can never kill the host process.
  void (async () => {
    try {
      const me = await deps.api.call("getMe");
      if (!me.ok) {
        logger.error("[TelegramBot] getMe rejected — check TELEGRAM_BOT_TOKEN");
        workerRunning = false;
        return;
      }
      logger.info("[TelegramBot] polling worker started");
      const adminChat = process.env.TELEGRAM_ADMIN_CHAT_ID;
      if (adminChat) {
        await sendChatMessage(deps, Number(adminChat), "🟢 البوت التليجرام شغال دلوقتي بعقل المساعد الذكي — جرب ابعتله /start", { disablePreview: true });
      }

      let offset = 0;
      let conflicts = 0;
      while (workerRunning) {
        try {
          const res = await deps.api.call("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "chat_join_request"] });
          if (!res.ok) {
            const retryAfter = res.parameters?.retry_after;
            const desc = res.description ?? "";
            if (desc.includes("Conflict")) {
              conflicts += 1;
              logger.warn("[TelegramBot] getUpdates conflict — another poller is active", { conflicts });
              if (conflicts >= MAX_CONFLICTS) {
                conflicts = Math.floor(MAX_CONFLICTS / 2); // resume after the cool-down
                await new Promise((r) => setTimeout(r, CONFLICT_COOLDOWN_MS));
                continue;
              }
              await new Promise((r) => setTimeout(r, 60_000));
              continue;
            }
            await new Promise((r) => setTimeout(r, (retryAfter ?? 5) * 1_000));
            continue;
          }
          conflicts = 0;
          const updates = (res.result as TgUpdate[] | undefined) ?? [];
          for (const update of updates) {
            await handleTelegramUpdate(deps, update);
            offset = update.update_id + 1;
          }
        } catch (err) {
          logger.warn("[TelegramBot] poll cycle failed", { error: err instanceof Error ? err.message : String(err) });
          await new Promise((r) => setTimeout(r, 10_000));
        }
      }
      workerRunning = false;
      logger.info("[TelegramBot] polling worker stopped");
    } catch (err) {
      // Boot-phase failure (getMe network error, etc.) — log and stand down;
      // the server itself must keep serving.
      workerRunning = false;
      logger.error("[TelegramBot] worker terminated", { error: err instanceof Error ? err.message : String(err) });
    }
  })().catch((err) => {
    workerRunning = false;
    logger.error("[TelegramBot] worker escaped rejection (contained)", { error: err instanceof Error ? err.message : String(err) });
  });

  return true;
}

/** Test/ops hook — flips the loop flag so a running cycle exits cleanly. */
export function stopTelegramBot(): void {
  workerRunning = false;
}
