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
}

/** Error codes surfaced by usePushNotification — mapped to friendly copy below. */
export const PUSH_ERROR_CODES = {
  /** Public-key endpoint unreachable or non-2xx. */
  KEY_UNAVAILABLE: "PUSH_KEY_UNAVAILABLE",
  /** Server has no VAPID keys configured — push disabled globally. */
  DISABLED_SERVER: "PUSH_DISABLED_SERVER",
  /** serviceWorker.ready never resolved within the timeout. */
  SW_READY_TIMEOUT: "SW_READY_TIMEOUT",
  /** pushManager.subscribe() rejected (unsupported browser state, etc.). */
  SUBSCRIBE_FAILED: "PUSH_SUBSCRIBE_FAILED",
  /** Subscription payload incomplete — missing endpoint/keys. */
  INCOMPLETE: "PUSH_INCOMPLETE",
  /** /push/subscribe returned 401 — user must be logged in. */
  AUTH_REQUIRED: "AUTH_REQUIRED",
  /** /push/subscribe returned a non-401 error. */
  SAVE_FAILED: "PUSH_SAVE_FAILED",
  /** /push/unsubscribe cleanup path failed. */
  UNSUBSCRIBE_FAILED: "PUSH_UNSUBSCRIBE_FAILED",
} as const;

/** Inputs the UI needs to describe the row's current state. */
export interface PushStateInput {
  status: PushStatus;
  isBusy: boolean;
  isSubscribed: boolean;
  /** Raw error code from the last failed operation (null when none). */
  lastError: string | null;
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
    ar: "المتصفح اتأخر في تجهيز خدمة الإشعارات — أعد المحاولة",
    en: "The browser took too long preparing the notification service — please retry",
  },
  [PUSH_ERROR_CODES.SUBSCRIBE_FAILED]: {
    ar: "المتصفح رفض إنشاء اشتراك الإشعارات — أعد المحاولة",
    en: "The browser refused to create the push subscription — please retry",
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
  const { status, isBusy, isSubscribed, lastError } = input;

  // ── Error overrides everything: the user must see why it failed ──
  if (status === "error") {
    const hint =
      (lastError !== null && ERROR_HINTS[lastError]?.[lang]) || GENERIC_ERROR_HINT[lang];
    return { pill: PILL[lang].error, hint, tone: "danger", switchOn: isSubscribed };
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
