/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHATBOT UNIFIED ERROR ENVELOPE + CREDENTIAL SCRUBBING
 *  (Reach-gems: distilled from Panniantong/Agent-Reach, MIT — runtime/result.py)
 * ───────────────────────────────────────────────────────────────────────────
 *  Agent-Reach gives its agent ONE JSON shape with stable error codes, each
 *  carrying a hint that says what to do next (and what NOT to do). This module
 *  ports that discipline to the chatbot API so the future Telegram bot (Plan C)
 *  can branch on `code` exactly like Agent-Reach's agent branches on
 *  `error.code`, while the existing frontend keeps working untouched — the
 *  envelope is ADDITIVE: `error` (human text) stays, `code` + `hint` are new.
 *
 *  It also ports their `scrub_url_credentials` rule: NO credential embedded in
 *  a URL (userinfo, api_key=, access_token=, Bearer, fragment tokens) may ever
 *  reach a user-facing error message or a log line. Non-sensitive query
 *  params survive (page=2 stays) so diagnostics stay useful.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ─── Error codes (stable — branch on these, never on message text) ──────────

export type ChatbotErrorCode =
  | "BAD_REQUEST"        // malformed body / missing fields
  | "BAD_INPUT"          // structurally valid but unusable input
  | "TOO_LARGE"          // payload/text/image above the caps
  | "RATE_LIMITED"       // per-IP request-rate limiter tripped
  | "QUOTA_EXCEEDED"     // daily vision-quota exhausted
  | "UNAUTHORIZED"       // auth required for this endpoint
  | "UPSTREAM_EXHAUSTED" // every provider walk failed / deadline passed
  | "INTERNAL";          // unexpected server error

export interface ChatbotErrorInfo {
  /** HTTP status the envelope is returned with. */
  http: number;
  /** Arabic user-facing message (the site's primary audience). */
  ar: string;
  /** English user-facing message. */
  en: string;
  /** Machine/orientation hint — what caused it and what the caller should do
   *  (Agent-Reach's `error.hint`: "what to do / what NOT to do"). */
  hint: string;
}

/**
 * The error catalog — the single source of truth (Agent-Reach's DEFAULT_HINTS
 * pattern: one place, one row per code, hints include anti-patterns).
 */
export const CHATBOT_ERROR_CATALOG: Record<ChatbotErrorCode, ChatbotErrorInfo> = {
  BAD_REQUEST: {
    http: 400,
    ar: "الطلب غير مفهوم — تأكد من إرسال الرسائل بشكل صحيح ثم حاول مرة أخرى",
    en: "Malformed request — make sure the messages array is correct and try again",
    hint: "Body must be JSON with a non-empty `messages` array. Do not retry unchanged if the body is built by hand.",
  },
  BAD_INPUT: {
    http: 400,
    ar: "الرسالة غير صالحة — اكتب سؤالك كنص عادي وحاول مرة أخرى",
    en: "Invalid message content — write your question as plain text and try again",
    hint: "Input failed per-field validation. Do not retry with the same payload; fix the offending field first.",
  },
  TOO_LARGE: {
    http: 413,
    ar: "المحادثة أو المرفقات كبيرة جداً — ابدأ محادثة جديدة أو أرفق صورة أصغر",
    en: "The conversation or attachment is too large — start a new chat or attach a smaller image",
    hint: "Hard caps: per-message chars, total chars, per-image base64, images per request. Trim the payload; do not split-and-spam.",
  },
  RATE_LIMITED: {
    http: 429,
    ar: "طلبات كثيرة في وقت قصير — استنى دقيقة واحدة وحاول تاني",
    en: "Too many requests in a short time — wait one minute and try again",
    hint: "Per-IP sliding window. Respect the window and back off; do NOT hammer retries — it extends the effective block.",
  },
  QUOTA_EXCEEDED: {
    http: 429,
    ar: "خلصت كوتة تحليل الصور اليومية — جرب بكرة أو اسأل نصياً وأنا معاك فوراً",
    en: "Today's image-analysis quota is used up — try again tomorrow or ask textually, I'm right here",
    hint: "Daily vision quota per IP. Text questions remain fully available; the quota resets at midnight (server time).",
  },
  UNAUTHORIZED: {
    http: 401,
    ar: "تسجيل الدخول مطلوب لتنفيذ هذا الإجراء",
    en: "Sign-in is required for this action",
    hint: "Endpoint requires a valid session. Callers should redirect to sign-in; do not retry anonymously.",
  },
  UPSTREAM_EXHAUSTED: {
    http: 503,
    ar: "الخدمة مشغولة حالياً — جرب تاني بعد قليل وسيصلك الرد",
    en: "The service is busy right now — try again shortly and you'll get your answer",
    hint: "Every provider walk failed or the persistence deadline passed. Retry with backoff; do NOT report this as a login/permission problem.",
  },
  INTERNAL: {
    http: 500,
    ar: "حدث خطأ غير متوقع — جرب مرة أخرى، ولو تكرر بلّغنا من زر الدعم",
    en: "An unexpected error occurred — try again, and if it repeats please report it via the support button",
    hint: "Unexpected exception. Details are in the server log (credential-scrubbed). Do not expose stack traces to users.",
  },
} as const;

// ─── Envelope builder ────────────────────────────────────────────────────────

export interface ChatbotErrorEnvelope {
  success: false;
  /** Human-facing localized message (the field the existing frontend reads). */
  error: string;
  /** Stable machine code — branch on this, never on message text. */
  code: ChatbotErrorCode;
  /** Orientation hint for API consumers (Telegram bot, logs, support). */
  hint: string;
  /** Echoed chat id when the caller provided one. */
  chatId?: string;
}

export function chatbotError(
  code: ChatbotErrorCode,
  opts: { lang?: "ar" | "en"; chatId?: string; message?: string } = {},
): { envelope: ChatbotErrorEnvelope; http: number } {
  const info = CHATBOT_ERROR_CATALOG[code];
  const message = opts.message ?? (opts.lang === "en" ? info.en : info.ar);
  return {
    envelope: {
      success: false,
      error: message,
      code,
      hint: info.hint,
      ...(opts.chatId !== undefined ? { chatId: opts.chatId } : {}),
    },
    http: info.http,
  };
}

// ─── Credential scrubbing (Agent-Reach's scrub_url_credentials pattern) ─────

/** Query parameters whose values must never appear in diagnostics. */
const SENSITIVE_QUERY_KEYS = new Set([
  "api_key", "apikey", "access_token", "token", "auth", "password",
  "secret", "key", "signature", "session", "sessionid", "jwt",
]);

const QUERY_PARAM_RE = /([?&])([A-Za-z0-9_-]+)=([^&#\s"']+)/g;
/** scheme:// followed by one or more `credential@` segments before the host. */
const USERINFO_RE = /([A-Za-z][A-Za-z0-9+.-]*:\/\/)((?:[^\s/@"]+@)+)/g;
/** #fragment keys that CONTAIN a sensitive word (auth_token, x-access-token...). */
const FRAGMENT_TOKEN_RE = /(#[A-Za-z0-9_-]*(?:access_token|token|auth|secret|key)[A-Za-z0-9_-]*)=[^&\s"']+/gi;
const BEARER_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

function scrubQueryParamValue(value: string): string {
  return "*".repeat(Math.min(value.length, 6));
}

/**
 * Strip every credential embedded in `text` before it reaches a user-facing
 * message or a log line: `user:pass@host`, `?api_key=…`, `#access_token=…`,
 * `Bearer …`. Non-sensitive params (e.g. `page=2`) are preserved verbatim.
 */
export function scrubCredentials(text: unknown): string {
  let out = String(text ?? "");
  // credential@host (with or without a password) → ***@host
  out = out.replace(USERINFO_RE, (_m, scheme: string) => `${scheme}***@`);
  // ?key=value → ?key=*** (only for sensitive keys)
  out = out.replace(
    QUERY_PARAM_RE,
    (m, sep: string, rawKey: string, value: string) => {
      const key = rawKey.toLowerCase();
      if (!SENSITIVE_QUERY_KEYS.has(key)) return m;
      return `${sep}${rawKey}=${scrubQueryParamValue(value)}`;
    },
  );
  // #fragment tokens (auth_token=, access_token=, my-secret-id=, ...)
  out = out.replace(FRAGMENT_TOKEN_RE, "$1=***");
  // Authorization-style headers pasted into errors
  out = out.replace(BEARER_RE, "$1 ***");
  return out;
}

/** Scrubbed one-liner for `logger.error(...)` payloads. */
export function logSafeError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return scrubCredentials(raw).slice(0, 500);
}
