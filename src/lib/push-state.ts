/**
 * Web Push toggle — state model & copy, pure and framework-free.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Root cause this module solves: the old browser-notifications toggle failed
 * SILENTLY on every path (permission denied → quiet return, server error →
 * console.error only, SW not ready → toggle locked forever). The user pressed
 * it, nothing visibly happened, and there was no way to tell "working",
 * "blocked by the browser" and "broken" apart.
 *
 * `describePushState` maps the hook's raw state onto user-visible copy
 * (Arabic / English), a status pill, and a visual tone for EVERY state,
 * including the "browser denied permission" state whose only fix is manual
 * re-enabling from the browser's site settings.
 *
 * Kept dependency-free so it can be unit-tested in a node environment.
 */

/** Lifecycle status of the push-subscription machine. */
export type PushStatus = "idle" | "busy" | "subscribed" | "denied" | "error";

/** Result returned by subscribe()/unsubscribe() so the UI can toast it. */
export interface PushOutcome {
  ok: boolean;
  outcome: "subscribed" | "unsubscribed" | "denied" | "error";
  /** Machine-readable error code (see PUSH_ERROR_CODES) when outcome=error. */
  error?: string;
  /** Raw browser cause (e.g. "NotAllowedError: …") shown as a diagnostics line
   *  — the user-visible proof of WHY the browser refused, never swallowed. */
  errorDetail?: string;
}

/** Error codes surfaced by usePushNotification — mapped to friendly copy below. */
export const PUSH_ERROR_CODES = {
  /** Public-key endpoint unreachable or non-2xx. */
  KEY_UNAVAILABLE: "PUSH_KEY_UNAVAILABLE",
  /** Server has no VAPID keys configured — push disabled globally. */
  DISABLED_SERVER: "PUSH_DISABLED_SERVER",
  /** serviceWorker.ready never resolved within the timeout. */
  SW_READY_TIMEOUT: "SW_READY_TIMEOUT",
  /** pushManager.subscribe() rejected for an unclassified reason. */
  SUBSCRIBE_FAILED: "PUSH_SUBSCRIBE_FAILED",
  /** The browser soft-blocked the permission/prompt path (NotAllowedError). */
  SUBSCRIBE_BLOCKED: "PUSH_SUBSCRIBE_BLOCKED",
  /** Browser refused the subscription itself — push service/key mismatch. */
  SUBSCRIBE_BAD_KEY: "PUSH_BAD_KEY_OR_SERVICE",
  /** Transient abort (AbortError) — a plain retry usually fixes it. */
  SUBSCRIBE_ABORTED: "PUSH_SUBSCRIBE_ABORTED",
  /** Served VAPID key is structurally invalid — server misconfig, not the user. */
  INVALID_VAPID_KEY: "PUSH_INVALID_VAPID_KEY",
  /** Page is not a secure context (non-HTTPS) — push is unavailable. */
  ENV_INSECURE: "PUSH_ENV_INSECURE",
  /** Browser lacks the Push/Notification/ServiceWorker platform surface. */
  ENV_NO_PUSH_API: "PUSH_ENV_NO_PUSH_API",
  /** Opened inside an in-app browser (WhatsApp/Facebook/Instagram/WebView…). */
  ENV_IN_APP_BROWSER: "PUSH_ENV_IN_APP_BROWSER",
  /** iOS Safari tab — push only works from a home-screen (standalone) app. */
  ENV_IOS_BROWSER: "PUSH_ENV_IOS_BROWSER",
  /** Subscription payload incomplete — missing endpoint/keys. */
  INCOMPLETE: "PUSH_INCOMPLETE",
  /** /push/subscribe returned 401 — user must be logged in. */
  AUTH_REQUIRED: "AUTH_REQUIRED",
  /** /push/subscribe returned a non-401 error. */
  SAVE_FAILED: "PUSH_SAVE_FAILED",
  /** /push/unsubscribe cleanup path failed. */
  UNSUBSCRIBE_FAILED: "PUSH_UNSUBSCRIBE_FAILED",
} as const;

/** Codes whose fix is NOT "press the toggle again" — the user must act
 *  elsewhere (browser settings, another browser, home screen, server owner).
 *  Rendered as warning tone; everything else stays danger (retry may help). */
const NON_RETRYABLE_CODES = new Set<string>([
  PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED,
  PUSH_ERROR_CODES.INVALID_VAPID_KEY,
  PUSH_ERROR_CODES.ENV_INSECURE,
  PUSH_ERROR_CODES.ENV_NO_PUSH_API,
  PUSH_ERROR_CODES.ENV_IN_APP_BROWSER,
  PUSH_ERROR_CODES.ENV_IOS_BROWSER,
]);

/** Inputs the UI needs to describe the row's current state. */
export interface PushStateInput {
  status: PushStatus;
  isBusy: boolean;
  isSubscribed: boolean;
  /** Raw error code from the last failed operation (null when none). */
  lastError: string | null;
  /** Raw browser cause ("NotAllowedError: …") from the last failed op —
   *  rendered as a small diagnostics line so a refusal is never opaque. */
  lastErrorDetail?: string | null;
}

/** Visual tone driving the row's colors. */
export type PushTone = "active" | "idle" | "warning" | "danger";

export interface PushStateDescriptor {
  /** Short status pill rendered next to the row title. */
  pill: string;
  /** One-two line hint rendered under the title. */
  hint: string;
  /** Visual tone for pill, icon badge and switch. */
  tone: PushTone;
  /** Whether the switch renders as ON. */
  switchOn: boolean;
  /** Raw browser cause for the failure — small LTR diagnostics line, empty
   *  when the failure was not a browser exception. */
  detail?: string;
}

export type PushLang = "ar" | "en";

const HINT_ON = {
  ar: "يوصلك كل جديد حتى والموقع مقفول ✓",
  en: "You'll hear from us even with the site closed ✓",
} as const;

const HINT_OFF = {
  ar: "فعّلها ليوصلك كل جديد حتى والموقع مقفول",
  en: "Enable to get new episodes even with the site closed",
} as const;

const HINT_BUSY_SUBSCRIBE = {
  ar: "بنجهّز اشتراكك — لو ظهر إذن من المتصفح وافق عليه",
  en: "Setting up your subscription — approve the browser prompt if it appears",
} as const;

const HINT_BUSY_UNSUBSCRIBE = {
  ar: "بنلغي اشتراك إشعارات المتصفح…",
  en: "Unsubscribing from browser notifications…",
} as const;

const HINT_DENIED = {
  ar: "المتصفح رفض إذن الإشعارات. من أيقونة القفل جنب رابط الموقع اسمح بالإشعارات ثم جرّب مرة تانية",
  en: "Your browser blocked notifications for this site. Tap the lock icon next to the address bar, allow Notifications, then try again",
} as const;

/** Friendly copy per known error code — anything else falls back to generic. */
const ERROR_HINTS: Record<string, { ar: string; en: string }> = {
  [PUSH_ERROR_CODES.KEY_UNAVAILABLE]: {
    ar: "خدمة الإشعارات مش متاحة حالياً — اتأكد من الاتصال بالإنترنت وجرب تاني",
    en: "The notifications service is unreachable right now — check your connection and try again",
  },
  [PUSH_ERROR_CODES.DISABLED_SERVER]: {
    ar: "خدمة الإشعارات متوقفة على السيرفر مؤقتاً — جرب بعد شوية",
    en: "Push notifications are temporarily disabled server-side — try again later",
  },
  [PUSH_ERROR_CODES.SW_READY_TIMEOUT]: {
    ar: "خدمة الإشعارات في المتصفح لسه بتتجهز — أول مرة بتاخد وقت (بيتحمّل ملفات الموقع). استنى دقيقة واضغط تاني",
    en: "The browser's notification service is still preparing — the first time takes a while. Wait a minute and try again",
  },
  [PUSH_ERROR_CODES.SUBSCRIBE_FAILED]: {
    ar: "المتصفح رفض إنشاء اشتراك الإشعارات — أعد المحاولة",
    en: "The browser refused to create the push subscription — please retry",
  },
  [PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED]: {
    ar: "المتصفح حاجب طلبات الإذن للموقع ده (غالباً بعد تجاهل الطلب كذا مرة). من أيقونة القفل/ⓘ جنب الرابط ← إشعارات ← اسمح، وبعدها اضغط تاني",
    en: "The browser blocked notification prompts for this site (usually after ignoring them several times). Use the lock/ⓘ icon next to the address bar → Notifications → Allow, then try again",
  },
  [PUSH_ERROR_CODES.SUBSCRIBE_BAD_KEY]: {
    ar: "المتصفح رفض الاشتراك — خدمة الإشعارات مش متاحة على الجهاز/الشبكة دي. جرب من كروم محدّث، ولو استمرت بلّغ الدعم",
    en: "The browser refused the subscription — the push service is unavailable on this device/network. Try an up-to-date Chrome; contact support if it persists",
  },
  [PUSH_ERROR_CODES.SUBSCRIBE_ABORTED]: {
    ar: "اتلغى طلب الاشتراك بشكل مؤقت — اضغط تاني",
    en: "The subscription request was aborted — please try again",
  },
  [PUSH_ERROR_CODES.INVALID_VAPID_KEY]: {
    ar: "فيه مشكلة إعدادات في خدمة الإشعارات على السيرفر — الإدارة اتعلمت بيها، جرب تاني بعد شوية",
    en: "The notifications service is misconfigured server-side — the team has been notified, please try again later",
  },
  [PUSH_ERROR_CODES.ENV_INSECURE]: {
    ar: "الإشعارات محتاجة اتصال مؤمّن (HTTPS) — افتح الموقع بالرابط المؤمّن",
    en: "Notifications need a secure connection (HTTPS) — open the site over HTTPS",
  },
  [PUSH_ERROR_CODES.ENV_NO_PUSH_API]: {
    ar: "المتصفح ده مش بيدعم إشعارات المواقع الخلفية — استخدم كروم أو إيدج أو فايرفوكس محدّث",
    en: "This browser doesn't support background web push — use an up-to-date Chrome, Edge or Firefox",
  },
  [PUSH_ERROR_CODES.ENV_IN_APP_BROWSER]: {
    ar: "انت فاتح الموقع من جوه تطبيق تاني (واتساب/فيسبوك/انستجرام…) والمتصفح المدمج مش بيدعم الإشعارات. انسخ الرابط وافتحه في كروم (أندرويد) أو سفاري (آيفون) وفعّل الإشعارات من هناك",
    en: "You opened the site inside another app (WhatsApp/Facebook/Instagram…) — built-in browsers don't support push. Copy the link and open it in Chrome (Android) or Safari (iPhone), then enable notifications there",
  },
  [PUSH_ERROR_CODES.ENV_IOS_BROWSER]: {
    ar: "آيفون مش بيسمح بإشعارات المواقع غير بعد إضافة الموقع للشاشة الرئيسية: زرار المشاركة ← Add to Home Screen، وافتح الموقع من الأيقونة وفعّل الإشعارات",
    en: "iPhone allows site push only after adding it to the Home Screen: Share → Add to Home Screen, open the site from the icon, then enable notifications",
  },
  [PUSH_ERROR_CODES.INCOMPLETE]: {
    ar: "الاشتراك وصل ناقص من المتصفح — أعد المحاولة",
    en: "The subscription came back incomplete — please retry",
  },
  [PUSH_ERROR_CODES.AUTH_REQUIRED]: {
    ar: "سجّل دخولك الأول عشان نربط الإشعارات بحسابك",
    en: "Please sign in first so notifications can be linked to your account",
  },
  [PUSH_ERROR_CODES.SAVE_FAILED]: {
    ar: "الاشتراك اتعمل في المتصفح لكن ماحفظش على حسابك — جرب تاني",
    en: "The subscription was created but couldn't be saved to your account — please retry",
  },
  [PUSH_ERROR_CODES.UNSUBSCRIBE_FAILED]: {
    ar: "تعذّر إلغاء الاشتراك — جرب تاني",
    en: "Couldn't remove the subscription — please retry",
  },
};

const GENERIC_ERROR_HINT = {
  ar: "حصلت مشكلة غير متوقعة — أعد المحاولة",
  en: "Something went wrong unexpectedly — please retry",
} as const;

const PILL = {
  ar: { on: "مفعّلة", off: "غير مفعّلة", busy: "جاري التجهيز…", denied: "محظورة", error: "فشل" },
  en: { on: "On", off: "Off", busy: "Working…", denied: "Blocked", error: "Failed" },
} as const;

/**
 * Map raw push state → user-visible descriptor for the toggle row.
 * Total function: every (status, isBusy, isSubscribed, lastError) combination
 * yields a complete descriptor — no silent states.
 */
export function describePushState(input: PushStateInput, lang: PushLang): PushStateDescriptor {
  const { status, isBusy, isSubscribed, lastError, lastErrorDetail } = input;

  // ── Error overrides everything: the user must see why it failed ──
  if (status === "error") {
    const hint =
      (lastError !== null && ERROR_HINTS[lastError]?.[lang]) || GENERIC_ERROR_HINT[lang];
    // Non-retryable causes (browser hard-block, wrong browser, server key…) get
    // the warning tone — pressing the toggle again cannot fix them, and the
    // danger/red styling would push the user into a useless retry loop.
    const tone: PushTone =
      lastError !== null && NON_RETRYABLE_CODES.has(lastError) ? "warning" : "danger";
    const detail =
      lastErrorDetail && lastErrorDetail.trim().length > 0
        ? lastErrorDetail.trim().slice(0, 140)
        : undefined;
    return { pill: PILL[lang].error, hint, tone, switchOn: isSubscribed, detail };
  }

  // ── Browser denied permission: not retryable from JS, show the manual fix ──
  if (status === "denied") {
    return { pill: PILL[lang].denied, hint: HINT_DENIED[lang], tone: "warning", switchOn: false };
  }

  // ── In-flight: show what the operation is waiting on ──
  if (status === "busy" || isBusy) {
    return {
      pill: PILL[lang].busy,
      hint: isSubscribed ? HINT_BUSY_UNSUBSCRIBE[lang] : HINT_BUSY_SUBSCRIBE[lang],
      tone: "active",
      switchOn: isSubscribed,
    };
  }

  // ── Steady states ──
  if (status === "subscribed" || isSubscribed) {
    return { pill: PILL[lang].on, hint: HINT_ON[lang], tone: "active", switchOn: true };
  }

  return { pill: PILL[lang].off, hint: HINT_OFF[lang], tone: "idle", switchOn: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pure diagnostics — classify the environment & browser exceptions BEFORE and
// AFTER pushManager.subscribe() so a refusal always names its real cause.
// (The old flow caught every DOMException as one generic "browser refused —
//  retry" which is unfalsifiable and unfixable from the user's side.)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate a VAPID application server key BEFORE handing it to the browser:
 * an uncompressed P-256 point is exactly 65 bytes starting with 0x04. Chrome
 * throws InvalidAccessError on anything else — catching it here turns a
 * cryptic browser refusal into an explicit server-misconfig message.
 * Tolerates base64url padding; rejects PEM/whitespace/other encodings.
 */
export function validateVapidPublicKey(key: string | null | undefined): boolean {
  if (typeof key !== "string") return false;
  const trimmed = key.trim();
  if (trimmed.length === 0 || trimmed.length !== key.length) return false;
  // Tolerate base64url padding ("=") — the browser-side decoder handles it —
  // but reject every other non-base64url byte (PEM, '+', '/', whitespace…).
  const core = trimmed.replace(/=+$/, "");
  if (core.length === 0 || /[^A-Za-z0-9\-_]/.test(core)) return false;
  try {
    const padded = core + "=".repeat((4 - (core.length % 4)) % 4);
    const raw = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    if (raw.length !== 65) return false;
    return raw.charCodeAt(0) === 0x04;
  } catch {
    return false;
  }
}

/**
 * Map the DOMException thrown by pushManager.subscribe() onto a precise error
 * code. Every branch names a cause whose fix the UI can describe — instead of
 * one "browser refused" bucket.
 */
export function classifyPushException(name: string, message = ""): string {
  const m = message.toLowerCase();
  switch (name) {
    case "NotAllowedError":
      // Permission/prompt refused at subscribe time: Chrome's quiet-block after
      // ignored prompts, iOS non-standalone, WebView policies.
      return PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED;
    case "InvalidAccessError":
    case "NotSupportedError":
      // Bad applicationServerKey, or the device/network has no push service.
      return PUSH_ERROR_CODES.SUBSCRIBE_BAD_KEY;
    case "AbortError":
      // Some engines reject a permission refusal with AbortError and a message
      // like "Registration failed - permission denied" (measured: incognito &
      // restricted profiles). When the message names permission, the honest
      // classification is BLOCKED — retrying cannot fix it.
      if (m.includes("permission") || m.includes("denied")) {
        return PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED;
      }
      // Otherwise transient — the push service aborted; a retry usually works.
      return PUSH_ERROR_CODES.SUBSCRIBE_ABORTED;
    case "InvalidStateError":
      // No ACTIVE service worker on the registration yet → same UX as timeout.
      return PUSH_ERROR_CODES.SW_READY_TIMEOUT;
    default:
      // Some engines reject with a bare Error instead of a DOMException —
      // salvage the cause from the message before falling back to generic.
      if (m.includes("permission") || m.includes("denied")) {
        return PUSH_ERROR_CODES.SUBSCRIBE_BLOCKED;
      }
      if (m.includes("key") || m.includes("vapid") || m.includes("push service")) {
        return PUSH_ERROR_CODES.SUBSCRIBE_BAD_KEY;
      }
      return PUSH_ERROR_CODES.SUBSCRIBE_FAILED;
  }
}

/** Pre-flight environment codes — what the toggle can know before any click. */
export type PushEnvironmentCode =
  | "ok"
  | "insecure"
  | "no_sw"
  | "no_push"
  | "no_notification"
  | "in_app_browser"
  | "ios_browser";

export interface PushEnvironmentInput {
  isSecureContext: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  userAgent: string;
  /** display-mode: standalone / iOS navigator.standalone — installed PWA. */
  isStandalone: boolean;
}

/** UA markers of WebView-based in-app browsers (no push support there). */
const IN_APP_UA_RE =
  /\b(FBAN|FBAV|FBSV|FB_IAB|FB4A|Instagram|Line\/|MicroMessenger|WhatsApp|Twitter|Tumblr)\b|\(.*;\s*wv\)/;

/** Map a PushEnvironmentCode onto its user-facing error code. */
export function pushEnvironmentErrorCode(code: PushEnvironmentCode): string | null {
  switch (code) {
    case "insecure":
      return PUSH_ERROR_CODES.ENV_INSECURE;
    case "no_sw":
    case "no_push":
    case "no_notification":
      return PUSH_ERROR_CODES.ENV_NO_PUSH_API;
    case "in_app_browser":
      return PUSH_ERROR_CODES.ENV_IN_APP_BROWSER;
    case "ios_browser":
      return PUSH_ERROR_CODES.ENV_IOS_BROWSER;
    default:
      return null;
  }
}

/**
 * Pre-flight classification of the browser environment. Runs BEFORE the
 * permission prompt / subscription attempt so an unsupported context shows
 * its exact reason instead of a doomed "refused — retry" loop.
 * Order matters: structural gaps first, then context, then platform rules.
 */
export function classifyPushEnvironment(input: PushEnvironmentInput): PushEnvironmentCode {
  if (!input.isSecureContext) return "insecure";
  if (!input.hasServiceWorker) return "no_sw";
  if (!input.hasNotification) return "no_notification";
  if (!input.hasPushManager) return "no_push";
  if (IN_APP_UA_RE.test(input.userAgent)) return "in_app_browser";
  const isIOS = /iP(hone|od|ad)/.test(input.userAgent);
  // iPadOS 13+ requests desktop sites (Macintosh UA) — known blind spot, but
  // those devices can still subscribe; desktop-UA iOS push works on iPadOS.
  if (isIOS && !input.isStandalone) return "ios_browser";
  return "ok";
}
