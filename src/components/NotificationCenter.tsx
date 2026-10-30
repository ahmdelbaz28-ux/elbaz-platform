/* eslint-disable react-refresh/only-export-components */
import { visualRandom } from "@/lib/random";
import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import {
  Bell,
  BellOff,
  BookOpen,
  Gift,
  Loader2,
  Sparkles,
  Check,
  CheckCheck,
  Inbox,
  TriangleAlert,
  X,
  BellRing,
  Youtube,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { useNotification } from "@/components/NotificationToast";
import {
  describePushState,
  PUSH_ERROR_CODES,
  type PushOutcome,
  type PushStatus,
  type PushTone,
} from "@/lib/push-state";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Display categories used in the notification center panel. */
export type NotificationDisplayType = "enrollment" | "promo" | "update" | "youtube" | "system";

/** Canonical toast types from the existing NotificationToast system, plus the
 *  server broadcast types (lesson/file/software/youtube) mapped on arrival. */
type SourceToastType = "enrollment" | "promo" | "update" | "info" | "success";

/** A single persisted notification record stored in localStorage. */
export interface NotificationRecord {
  id: string;
  displayType: NotificationDisplayType;
  sourceType: SourceToastType;
  title: string;
  message: string;
  timestamp: number; // unix ms
  read: boolean;
  /** Server event id — dedupes polled events against already-shown toasts. */
  eventId?: string;
  /** Click-through target: site path ("/courses/x") or absolute URL (YouTube). */
  url?: string;
  /** YouTube channel link for the subscribe CTA. */
  channelUrl?: string;
}

/** Config for the push notification hook. */
interface PushNotificationConfig {
  /** VAPID public key override — normally fetched from the server. */
  vapidPublicKey?: string;
  /** Called after the service worker receives a push message. */
  onPushMessage?: (payload: MessageEvent) => void;
}

/** Server response shape of GET /api/notifications/push/public-key. */
interface PushPublicKeyResponse {
  enabled: boolean;
  publicKey: string | null;
}

/** Config for the realtime polling hook. */
interface RealtimeConfig {
  /** Polling interval in ms (default 15 000). */
  interval?: number;
  /** Called when a new enrollment is detected. */
  onNewEnrollment?: (courseName: string) => void;
  /** Called when a generic new event arrives (includes url/channelUrl). */
  onNewEvent?: (event: {
    id: string;
    type: string;
    title: string;
    message: string;
    url?: string;
    channelUrl?: string;
    data?: unknown;
  }) => void;
}

/** Shape returned by useNotificationHistory. */
interface NotificationHistoryState {
  notifications: NotificationRecord[];
  unreadCount: number;
  addNotification: (record: {
    displayType: NotificationDisplayType;
    sourceType: SourceToastType;
    title: string;
    message: string;
    eventId?: string;
    url?: string;
    channelUrl?: string;
  }) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

/** Shape returned by usePushNotification. */
interface PushNotificationState {
  permission: NotificationPermission;
  isSupported: boolean;
  /** False when the server has no VAPID keys — the toggle stays hidden. */
  isPushEnabled: boolean;
  isSubscribed: boolean;
  /** True while a subscribe/unsubscribe round-trip is in flight. */
  isBusy: boolean;
  /** Lifecycle status driving the toggle row's pill/hint/tone (see push-state.ts). */
  status: PushStatus;
  /** Machine-readable error code from the last failed operation (null when none). */
  lastError: string | null;
  requestPermission: () => Promise<NotificationPermission>;
  subscribe: () => Promise<PushOutcome>;
  unsubscribe: () => Promise<PushOutcome>;
}

/** Shape returned by useRealtimeNotifications. */
interface RealtimeNotificationState {
  isActive: boolean;
  lastPollTime: number | null;
  error: string | null;
  /** Manually trigger an immediate poll. */
  pollNow: () => Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = "elbaz_notification_history";
const MAX_STORED = 50;
const MAX_VISIBLE = 20;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Time budget for `serviceWorker.ready` — it hangs FOREVER when the PWA SW
 *  never registered, which used to lock the toggle permanently with zero
 *  feedback (the silent "مش شغال" bug). Racing a timeout keeps the UI alive. */
const SW_READY_TIMEOUT_MS = 8_000;

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Map a source toast type to a display type for the center panel. */
function toDisplayType(source: string): NotificationDisplayType {
  switch (source) {
    case "enrollment":
      return "enrollment";
    case "promo":
      return "promo";
    case "update":
    case "lesson":
    case "file":
    case "software":
      return "update";
    case "youtube":
      return "youtube";
    case "success":
      return "update";
    default:
      return "system";
  }
}

/** Generate a unique id. */
function uid(): string {
  return `notif-${Date.now()}-${visualRandom().toString(36).slice(2, 8)}`;
}

/**
 * Return a human-readable relative time string.
 * Supports Arabic (RTL) and English (LTR).
 */
function relativeTime(ms: number, lang: "en" | "ar"): string {
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (lang === "ar") return relativeTimeArabic(seconds, minutes, hours, days);
  return relativeTimeEnglish(seconds, minutes, hours, days);
}

function relativeTimeArabic(seconds: number, minutes: number, hours: number, days: number): string { // NOSONAR — complex function, refactoring would risk breaking critical behavior
  if (seconds < 60) return "الآن";
  if (minutes < 60) {
    const minutesUnitLe10 = minutes <= 10 ? "دقائق" : "دقيقة";
    const minutesUnitEq2 = minutes === 2 ? "دقيقتين" : minutesUnitLe10;
    const minutesUnit = minutes === 1 ? "دقيقة" : minutesUnitEq2;
    return `منذ ${minutes} ${minutesUnit}`;
  }
  if (hours < 24) {
    const hoursUnitLe10 = hours <= 10 ? "ساعات" : "ساعة";
    const hoursUnitEq2 = hours === 2 ? "ساعتين" : hoursUnitLe10;
    const hoursUnit = hours === 1 ? "ساعة" : hoursUnitEq2;
    return `منذ ${hours} ${hoursUnit}`;
  }
  const daysUnitLe10 = days <= 10 ? "أيام" : "يوم";
  const daysUnitEq2 = days === 2 ? "يومين" : daysUnitLe10;
  const daysUnit = days === 1 ? "يوم" : daysUnitEq2;
  return `منذ ${days} ${daysUnit}`;
}

function relativeTimeEnglish(seconds: number, minutes: number, hours: number, days: number): string {
  if (seconds < 60) return "Just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** Convert a base64-url VAPID key to Uint8Array. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replaceAll("-", "+").replaceAll("_", "/");
  const rawData = atob(b64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    arr[i] = rawData.codePointAt(i) ?? 0;
  }
  return arr;
}

// ═══════════════════════════════════════════════════════════════════════════════
// useNotificationHistory hook
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Manages notification history persisted in localStorage.
 * - Persists up to MAX_STORED (50) notifications.
 * - Tracks read / unread state per notification.
 * - Auto-cleans entries older than 7 days on mount.
 */
export function useNotificationHistory(): NotificationHistoryState {
  const [notifications, setNotifications] = useState<NotificationRecord[]>(() => {
    if (globalThis === undefined) return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: NotificationRecord[] = JSON.parse(raw);
      // Auto-clean notifications older than 7 days on init
      const now = Date.now();
      return parsed.filter((n) => now - n.timestamp < SEVEN_DAYS_MS);
    } catch {
      return [];
    }
  });

  // Persist to localStorage whenever notifications change
  const persist = useCallback((items: NotificationRecord[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // quota exceeded – silently ignore
    }
  }, []);

  const addNotification = useCallback(
    (record: {
      displayType: NotificationDisplayType;
      sourceType: SourceToastType;
      title: string;
      message: string;
      eventId?: string;
      url?: string;
      channelUrl?: string;
    }) => {
      const now = Date.now();
      const entry: NotificationRecord = {
        ...record,
        id: uid(),
        read: false,
        timestamp: now,
      };
      setNotifications((prev) => {
        // Dedupe: a polled server event that was already shown as a live
        // toast (same eventId) must not appear twice in the bell history.
        if (record.eventId && prev.some((n) => n.eventId === record.eventId)) {
          return prev;
        }
        const updated = [entry, ...prev];
        const trimmed = updated.slice(0, MAX_STORED);
        persist(trimmed);
        return trimmed;
      });
    },
    [persist],
  );

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const updated = prev.map((n) =>
          n.id === id ? { ...n, read: true } : n,
        );
        persist(updated);
        return updated;
      });
    },
    [persist],
  );

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      persist(updated);
      return updated;
    });
  }, [persist]);

  const clearAll = useCallback(() => {
    setNotifications([]);
    persist([]);
  }, [persist]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    addNotification,
    markAsRead,
    markAllAsRead,
    clearAll,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// usePushNotification hook
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Web Push API integration — full closed-tab delivery pipeline:
 * - Fetches the server's VAPID public key (`/api/notifications/push/public-key`).
 * - Requests permission from a user gesture, subscribes via the PWA service
 *   worker, then stores the endpoint server-side (`/push/subscribe`) so every
 *   broadcast fans out to this browser even when all tabs are closed.
 * - Unsubscribe mirrors the same path (`/push/unsubscribe`).
 * - Forwards SW→page push messages (`PUSH_RECEIVED`) to `onPushMessage`.
 */
/** Race a promise against a timeout, rejecting with a machine-readable code. */
function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(code)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(code));
      },
    );
  });
}

/** Same-origin base for API calls (Capacitor builds talk to the remote API). */
function apiBaseUrl(): string {
   
  return (globalThis as any).Capacitor?.isNativePlatform?.() // eslint-disable-line @typescript-eslint/no-explicit-any
    ? (import.meta.env.VITE_API_URL || "https://ahmedelbaz.qzz.io")
    : "";
}

export function usePushNotification(
  config: PushNotificationConfig = {},
): PushNotificationState {
  const { vapidPublicKey } = config;

  const [permission, setPermission] = useState<NotificationPermission>(
    () =>
      typeof Notification === "undefined"
        ? "denied"
        : Notification.permission,
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isPushEnabled, setIsPushEnabled] = useState(Boolean(vapidPublicKey));
  const [isBusy, setIsBusy] = useState(false);
  // Start in "denied" when the browser already blocked notifications — the
  // toggle row then shows the manual fix instead of pretending it's clickable.
  const [status, setStatus] = useState<PushStatus>(() => {
    if (typeof Notification === "undefined") return "idle";
    return Notification.permission === "denied" ? "denied" : "idle";
  });
  const [lastError, setLastError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isNativeApp = Boolean((globalThis as any).Capacitor?.isNativePlatform?.());
  const isSupported =
    globalThis !== undefined &&
    "serviceWorker" in navigator &&
    "PushManager" in globalThis &&
    !isNativeApp;

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!("Notification" in globalThis)) return "denied";
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  // ── Mirror the server's view: is this browser's endpoint stored? ──
  useEffect(() => {
    if (!isSupported) return;
    let cancelled = false;
    void (async () => {
      try {
        // Timeout guard: `serviceWorker.ready` never resolves when no SW is
        // registered — without the race the toggle used to lock up silently.
        const registration = await withTimeout(
          navigator.serviceWorker.ready,
          SW_READY_TIMEOUT_MS,
          PUSH_ERROR_CODES.SW_READY_TIMEOUT,
        );
        const sub = await registration.pushManager.getSubscription();
        const isSub = Boolean(sub);
        if (!cancelled) {
          setIsSubscribed(isSub);
          setStatus(
            isSub
              ? "subscribed"
              : typeof Notification !== "undefined" && Notification.permission === "denied"
                ? "denied"
                : "idle",
          );
        }
      } catch {
        // SW not ready / push blocked — toggle shows the error/blocked state.
        if (!cancelled) setStatus("error");
      }
      // Feature flag: does the server have VAPID keys configured?
      try {
        const res = await fetch(`${apiBaseUrl()}/api/notifications/push/public-key`);
        if (res.ok) {
          const data = (await res.json()) as PushPublicKeyResponse;
          if (!cancelled) setIsPushEnabled(Boolean(data.enabled && data.publicKey));
        }
      } catch {
        if (!cancelled) setIsPushEnabled(Boolean(vapidPublicKey));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSupported, vapidPublicKey]);

  const subscribe = useCallback(async (): Promise<PushOutcome> => {
    if (!isSupported || isBusy) {
      return { ok: false, outcome: "error", error: "PUSH_BUSY" };
    }
    setIsBusy(true);
    setStatus("busy");
    setLastError(null);
    try {
      // 0. A previously-denied site can never be re-enabled from JS (the
      //    browser prompt is gone) — surface the manual fix, never fail silent.
      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        setStatus("denied");
        return { ok: false, outcome: "denied" };
      }

      // 1. Resolve the VAPID public key (server is the source of truth).
      let appServerKey = vapidPublicKey ?? null;
      if (!appServerKey) {
        const res = await fetch(`${apiBaseUrl()}/api/notifications/push/public-key`);
        if (!res.ok) throw new Error(PUSH_ERROR_CODES.KEY_UNAVAILABLE);
        const data = (await res.json()) as PushPublicKeyResponse;
        if (!data.enabled || !data.publicKey) throw new Error(PUSH_ERROR_CODES.DISABLED_SERVER);
        appServerKey = data.publicKey;
      }

      // 2. Permission (must come from a user gesture — the toggle click).
      let current = Notification.permission;
      if (current === "default") {
        current = await Notification.requestPermission();
        setPermission(current);
      }
      if (current !== "granted") {
        // Android Chrome quietly auto-dismisses prompts for non-installed
        // sites — the user must allow manually from site settings. Surface it.
        setStatus("denied");
        return { ok: false, outcome: "denied" };
      }

      // 3. Subscribe through the (already registered) PWA service worker.
      const registration = await withTimeout(
        navigator.serviceWorker.ready,
        SW_READY_TIMEOUT_MS,
        PUSH_ERROR_CODES.SW_READY_TIMEOUT,
      );
      let subscription: PushSubscription;
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(appServerKey) as BufferSource,
        });
      } catch {
        throw new Error(PUSH_ERROR_CODES.SUBSCRIBE_FAILED);
      }

      // 4. Store the endpoint server-side so broadcasts fan out to it.
      const subJson = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
        throw new Error(PUSH_ERROR_CODES.INCOMPLETE);
      }
      const saveRes = await fetch(`${apiBaseUrl()}/api/notifications/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subJson),
      });
      if (saveRes.status === 401) throw new Error(PUSH_ERROR_CODES.AUTH_REQUIRED);
      if (!saveRes.ok) throw new Error(PUSH_ERROR_CODES.SAVE_FAILED);

      setIsSubscribed(true);
      setStatus("subscribed");
      console.info("[Push] Subscribed successfully", subJson.endpoint);
      return { ok: true, outcome: "subscribed" };
    } catch (err) {
      const code = err instanceof Error ? err.message : PUSH_ERROR_CODES.SUBSCRIBE_FAILED;
      console.error("[Push] Subscribe failed", err);
      setIsSubscribed(false);
      setStatus("error");
      setLastError(code);
      return { ok: false, outcome: "error", error: code };
    } finally {
      setIsBusy(false);
    }
  }, [isSupported, isBusy, vapidPublicKey]);

  const unsubscribe = useCallback(async (): Promise<PushOutcome> => {
    if (!isSupported || isBusy) {
      return { ok: false, outcome: "error", error: "PUSH_BUSY" };
    }
    setIsBusy(true);
    setStatus("busy");
    setLastError(null);
    try {
      const registration = await withTimeout(
        navigator.serviceWorker.ready,
        SW_READY_TIMEOUT_MS,
        PUSH_ERROR_CODES.SW_READY_TIMEOUT,
      );
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        // Best-effort server cleanup — a failed call still leaves the browser
        // unsubscribed, and the dead endpoint is pruned on the next broadcast.
        void fetch(`${apiBaseUrl()}/api/notifications/push/unsubscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
        console.info("[Push] Unsubscribed successfully");
      }
      setIsSubscribed(false);
      setStatus("idle");
      return { ok: true, outcome: "unsubscribed" };
    } catch (err) {
      const code = err instanceof Error ? err.message : PUSH_ERROR_CODES.UNSUBSCRIBE_FAILED;
      console.error("[Push] Unsubscribe failed", err);
      setStatus("error");
      setLastError(code);
      return { ok: false, outcome: "error", error: code };
    } finally {
      setIsBusy(false);
    }
  }, [isSupported, isBusy]);

  // Listen for push messages forwarded by the service worker
  const onPushMessage = config.onPushMessage;
  useEffect(() => {
    if (!isSupported || !onPushMessage) return;

    const handler = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_RECEIVED") {
        onPushMessage(event);
      }
    };

    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, [isSupported, onPushMessage]);

  return {
    permission,
    isSupported,
    isPushEnabled,
    isSubscribed,
    isBusy,
    status,
    lastError,
    requestPermission,
    subscribe,
    unsubscribe,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// useRealtimeNotifications hook
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Polling-based real-time notifications.
 * - Polls every `interval` ms (default 15 000) for new events.
 * - Only active when user is authenticated.
 * - Debounced to prevent spam.
 * - Fires `onNewEnrollment` when a new student registration is detected.
 */
export function useRealtimeNotifications(
  config: RealtimeConfig = {},
): RealtimeNotificationState {
  const { isAuthenticated } = useAuth();
  const interval = config.interval ?? 15_000;
  const { onNewEnrollment, onNewEvent } = config;

  const [lastPollTime, setLastPollTime] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lastEventIdRef = useRef<string | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const onNewEnrollmentRef = useRef(onNewEnrollment);
  const onNewEventRef = useRef(onNewEvent);

  // Keep callback refs fresh
  useEffect(() => {
    onNewEnrollmentRef.current = onNewEnrollment;
  }, [onNewEnrollment]);
  useEffect(() => {
    onNewEventRef.current = onNewEvent;
  }, [onNewEvent]);

  const pollNow = useCallback(async () => {
    try {
      // Build URL with lastEventId for incremental polling
      const params = new URLSearchParams();
      if (lastEventIdRef.current) {
        params.set("after", lastEventIdRef.current);
      }
      const baseUrl = (globalThis as any).Capacitor?.isNativePlatform?.() ? (import.meta.env.VITE_API_URL || "https://ahmedelbaz.qzz.io") : ""; // eslint-disable-line @typescript-eslint/no-explicit-any
      const res = await fetch(`${baseUrl}/api/notifications/poll?${params.toString()}`);
      if (!res.ok) {
        // 404 = endpoint not deployed yet; 401/403 = session ended mid-poll —
        // all three are quiet no-ops (no error toast, no console noise).
        if (res.status === 404 || res.status === 401 || res.status === 403) return;
        throw new Error(`Poll failed: ${res.status}`);
      }
      const data = await res.json();
      setLastPollTime(Date.now());
      setError(null);

      if (!Array.isArray(data?.events) || data.events.length === 0) return;

      // Process events (debounced to prevent spam)
      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(() => {
        for (const event of data.events) {
          // Update cursor
          if (event.id) lastEventIdRef.current = event.id;

          // Skip events already surfaced (dedupe by server event id)
          if (event.id && seenEventIdsRef.current.has(event.id)) continue;
          if (event.id) seenEventIdsRef.current.add(event.id);

          // Enrollment event
          if (event.type === "enrollment" && onNewEnrollmentRef.current) {
            onNewEnrollmentRef.current(event.courseName ?? event.data?.courseName ?? "Unknown Course");
          }

          // Generic event (title/message/url forwarded to the toast + bell)
          if (onNewEventRef.current) {
            onNewEventRef.current({
              id: event.id,
              type: event.type,
              title: event.title ?? "",
              message: event.message ?? "",
              url: event.url,
              channelUrl: event.channelUrl,
              data: event.data,
            });
          }
        }
      }, 500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Poll error";
      // Only update error state if it's not a 404 (endpoint may not exist yet)
      if (!msg.includes("404")) {
        setError(msg);
      }
    }
  }, []);

  // Set up interval polling — only when authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastPollTime(null);
      setError(null);
      return;
    }

    // Initial poll
    pollNow();

    const timer = setInterval(pollNow, interval);

    return () => {
      clearInterval(timer);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [isAuthenticated, interval, pollNow]);

  return {
    isActive: isAuthenticated,
    lastPollTime,
    error,
    pollNow,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// useShowNotification hook — drop-in replacement for useNotification
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Drop-in replacement for `useNotification` that also persists each
 * notification to the notification history (localStorage).
 *
 * Usage:
 * ```tsx
 * import { useShowNotification } from "@/components/NotificationCenter";
 * // instead of: import { useNotification } from "@/components/NotificationToast";
 *
 * const { showNotification } = useShowNotification();
 * showNotification({ type: "enrollment", title: "...", message: "..." });
 * ```
 */
export function useShowNotification() {
  const { showNotification } = useNotification();
  const { addNotification } = useNotificationHistory();

  const showAndSave = useCallback(
    (toast: {
      type: SourceToastType | "lesson" | "file" | "software" | "youtube";
      title: string;
      message: string;
      duration?: number;
      action?: { label: string; onClick: () => void };
      eventId?: string;
      url?: string;
      channelUrl?: string;
    }) => {
      showNotification(toast);
      addNotification({
        displayType: toDisplayType(toast.type),
        sourceType: toast.type as SourceToastType,
        title: toast.title,
        message: toast.message,
        eventId: toast.eventId,
        url: toast.url,
        channelUrl: toast.channelUrl,
      });
    },
    [showNotification, addNotification],
  );

  return { showNotification: showAndSave };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Icon / Color Mapping
// ═══════════════════════════════════════════════════════════════════════════════

const DISPLAY_CONFIG: Record<
  NotificationDisplayType,
  {
    icon: ReactNode;
    iconBg: string;
    ring: string;
    accent: string;
  }
> = {
  enrollment: {
    icon: <BookOpen className="h-4 w-4" />,
    iconBg: "bg-[rgba(6,182,212,0.1)]",
    ring: "ring-[rgba(6,182,212,0.15)]",
    accent: "text-[#06b6d4]",
  },
  promo: {
    icon: <Gift className="h-4 w-4" />,
    iconBg: "bg-[rgba(245,158,11,0.1)]",
    ring: "ring-[rgba(245,158,11,0.15)]",
    accent: "text-[#f59e0b]",
  },
  update: {
    icon: <Sparkles className="h-4 w-4" />,
    iconBg: "bg-[rgba(16,185,129,0.1)]",
    ring: "ring-[rgba(16,185,129,0.15)]",
    accent: "text-[#10b981]",
  },
  youtube: {
    icon: <Youtube className="h-4 w-4" />,
    iconBg: "bg-[rgba(255,59,48,0.1)]",
    ring: "ring-[rgba(255,59,48,0.18)]",
    accent: "text-[#ff5f57]",
  },
  system: {
    icon: <Bell className="h-4 w-4" />,
    iconBg: "bg-[rgba(148,163,184,0.08)]",
    ring: "ring-[rgba(148,163,184,0.1)]",
    accent: "text-[#94a3b8]",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════════

/** A single notification row inside the scrollable list. */
function NotificationRow({
  record,
  lang,
  onMarkRead,
}: {
  readonly record: NotificationRecord;
  readonly lang: "en" | "ar";
  readonly onMarkRead: (id: string) => void;
}) {
  const cfg = DISPLAY_CONFIG[record.displayType] ?? DISPLAY_CONFIG.system;
  const navigate = useNavigate();

  /** Site paths navigate inside the SPA; absolute URLs open in a new tab. */
  const openTarget = useCallback(() => {
    if (!record.url) return;
    if (record.url.startsWith("/")) {
      navigate(record.url);
    } else {
      window.open(record.url, "_blank", "noopener,noreferrer");
    }
  }, [record.url, navigate]);

  const handleRowClick = useCallback(() => {
    if (!record.read) onMarkRead(record.id);
    openTarget();
  }, [record.read, record.id, onMarkRead, openTarget]);

  return (
    <button
      type="button"
      dir={lang === "ar" ? "rtl" : "ltr"}
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleRowClick();
        }
      }}
      aria-label={`${record.title} – ${record.message}`}
      className={`group flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 text-start transition-all duration-200 ${
        record.read
          ? "border-transparent bg-transparent opacity-60 hover:bg-[rgba(255,255,255,0.02)] hover:opacity-80"
          : `border-[#1e2d3d] bg-[rgba(13,20,32,0.6)] ring-1 ring-inset ${cfg.ring} hover:bg-[rgba(13,20,32,0.9)]`
      }`}
    >
      {/* Icon */}
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg.iconBg}`}
      >
        <span className={cfg.accent}>{cfg.icon}</span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className={`truncate text-[13px] font-semibold ${
              record.read ? "text-[#94a3b8]" : "text-[#e8f0fe]"
            }`}
          >
            {record.title}
          </p>
          {!record.read && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-[#06b6d4] shadow-[0_0_6px_rgba(6,182,212,0.5)]"
              aria-hidden="true"
            />
          )}
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[#64748b]">
          {record.message}
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-[11px] text-[#475569]">
            {relativeTime(record.timestamp, lang)}
          </p>
          {record.channelUrl && (
            <a
              href={record.channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[11px] font-semibold text-[#ff5f57] transition-colors hover:text-[#ff8179]"
            >
              <Youtube className="h-3 w-3" />
              {lang === "ar" ? "القناة + الجرس 🔔" : "Channel + bell 🔔"}
            </a>
          )}
        </div>
      </div>
    </button>
  );
}

/** Empty state when there are zero notifications. */
function EmptyState({ lang }: { readonly lang: "en" | "ar" }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(148,163,184,0.06)]">
        <Inbox className="h-7 w-7 text-[#475569]" />
      </div>
      <p className="text-[14px] font-semibold text-[#94a3b8]">
        {lang === "ar" ? "لا توجد إشعارات" : "No notifications yet"}
      </p>
      <p className="mt-1 max-w-[220px] text-[12px] text-[#475569]">
        {lang === "ar"
          ? "ستظهر الإشعارات الجديدة هنا"
          : "New notifications will appear here"}
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NotificationCenter (default export)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Comprehensive Notification Center component for the Elbaz LMS Platform.
 *
 * - Renders a bell icon with an unread-count badge.
 * - Opens a dropdown panel with a scrollable notification list (max 20 visible).
 * - Integrates with `useNotificationHistory` for persistence.
 * - Bridges incoming toasts from `NotificationProvider` into the history.
 * - Supports RTL (Arabic) and LTR (English) layouts.
 *
 * Usage:
 * ```tsx
 * import NotificationCenter from "@/components/NotificationCenter";
 * // Inside a JSX tree that is wrapped by <NotificationProvider>
 * <NotificationCenter />
 * ```
 */
/** Per-tone classes for the push toggle row (card, icon badge, pill, hint). */
const PUSH_ROW_TONES: Record<
  PushTone,
  { row: string; badge: string; pill: string; hint: string }
> = {
  active: {
    row: "bg-[rgba(6,182,212,0.08)] ring-1 ring-inset ring-[rgba(6,182,212,0.2)] hover:bg-[rgba(6,182,212,0.12)]",
    badge: "bg-gradient-to-br from-[#06b6d4] to-[#0284c7] text-white shadow-[0_0_12px_rgba(6,182,212,0.35)]",
    pill: "bg-[rgba(6,182,212,0.15)] text-[#22d3ee]",
    hint: "text-[#64748b]",
  },
  idle: {
    row: "bg-[rgba(255,255,255,0.03)] ring-1 ring-inset ring-[rgba(148,163,184,0.14)] hover:bg-[rgba(255,255,255,0.055)]",
    badge: "bg-[rgba(148,163,184,0.1)] text-[#64748b]",
    pill: "bg-[rgba(148,163,184,0.12)] text-[#94a3b8]",
    hint: "text-[#64748b]",
  },
  warning: {
    row: "bg-[rgba(245,158,11,0.07)] ring-1 ring-inset ring-[rgba(245,158,11,0.22)] hover:bg-[rgba(245,158,11,0.1)]",
    badge: "bg-[rgba(245,158,11,0.14)] text-[#fbbf24]",
    pill: "bg-[rgba(245,158,11,0.16)] text-[#fbbf24]",
    hint: "text-[rgba(251,191,36,0.8)]",
  },
  danger: {
    row: "bg-[rgba(244,63,94,0.07)] ring-1 ring-inset ring-[rgba(244,63,94,0.22)] hover:bg-[rgba(244,63,94,0.1)]",
    badge: "bg-[rgba(244,63,94,0.14)] text-[#fb7185]",
    pill: "bg-[rgba(244,63,94,0.16)] text-[#fb7185]",
    hint: "text-[#fda4af]",
  },
};

export default function NotificationCenter() { // NOSONAR — large component with bell + dropdown + history hook + push-subscription wiring; extraction would require prop-drilling many state hooks
  const { lang } = useTranslation();
  const isRTL = lang === "ar";
  const navigate = useNavigate();

  // ── Local state ──
  const [isOpen, setIsOpen] = useState(false);

  // ── History hook ──
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
  } = useNotificationHistory();

  // ── Web Push (closed-tab system notifications) ──
  const push = usePushNotification();
  const { showNotification } = useNotification();
  // Show the row whenever push is supported & enabled — EVEN when the browser
  // already denied permission: a blocked state with the manual fix is far more
  // helpful than a mysteriously missing toggle (the old behavior hid it).
  const showPushToggle =
    push.isSupported && push.isPushEnabled && typeof Notification !== "undefined";
  const pushDescriptor = showPushToggle
    ? describePushState(
        {
          status: push.status,
          isBusy: push.isBusy,
          isSubscribed: push.isSubscribed,
          lastError: push.lastError,
        },
        lang,
      )
    : null;

  const handlePushToggle = useCallback(() => {
    if (push.isBusy) return;
    if (push.isSubscribed) {
      void push.unsubscribe().then((res) => {
        if (res.ok) {
          showNotification({
            type: "info",
            title: isRTL ? "تم إيقاف إشعارات المتصفح" : "Browser notifications turned off",
            message: isRTL
              ? "مش هيوصلك تنبيه والموقع مقفول — تقدر تفعّلها تاني في أي وقت"
              : "You won't get system alerts while the site is closed — re-enable anytime",
          });
        } else {
          showNotification({
            type: "info",
            title: isRTL ? "تعذّر إيقاف الإشعارات" : "Couldn't turn off notifications",
            message: isRTL ? "جرب تاني من فضلك" : "Please try again",
          });
        }
      });
      return;
    }
    void push.subscribe().then((res) => {
      if (res.ok) {
        showNotification({
          type: "success",
          title: isRTL ? "تم تفعيل إشعارات المتصفح ✓" : "Browser notifications enabled ✓",
          message: isRTL
            ? "هيوصلك كل جديد حتى والموقع مقفول"
            : "You'll hear from us even with the site closed",
        });
      } else if (res.outcome === "denied") {
        showNotification({
          type: "info",
          title: isRTL ? "المتصفح محتاج إذنك" : "Browser needs your permission",
          message: isRTL
            ? "من أيقونة القفل جنب رابط الموقع اسمح بالإشعارات ثم جرّب تاني"
            : "Tap the lock icon next to the address bar, allow Notifications, then try again",
        });
      } else {
        showNotification({
          type: "info",
          title: isRTL ? "تعذّر تفعيل الإشعارات" : "Couldn't enable notifications",
          message: isRTL
            ? "جرب تاني — ولو استمرت المشكلة اتأكد من اتصالك بالإنترنت"
            : "Please try again — if it persists, check your connection",
        });
      }
    });
  }, [push, isRTL, showNotification]);

  // ── Notification click opened/focused this tab → navigate to the target ──
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "NOTIFICATION_CLICKED" && typeof event.data.url === "string") {
        const url = event.data.url as string;
        if (url.startsWith("/")) navigate(url);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [navigate]);

  // ── Refs for click-outside and ESC handling ──
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Close on outside click ──
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // ── Close on Escape ──
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  // ── Scroll to top when opened ──
  useEffect(() => {
    if (isOpen && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [isOpen]);

  // ── Keep the panel inside the viewport (mobile edge cure) ──
  // The dropdown is anchored to the bell, which can sit within a few px of the
  // screen edge (mobile drawer header). CSS anchoring alone lets the fixed-width
  // panel overflow the opposite edge — cut-off title, half-visible rows. After
  // opening (and on resize) we measure the real rect and shift the panel back
  // inside via the individual `translate` property, which composes with the
  // class-based transform used by the open/close animation instead of fighting it.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const clampToViewport = () => {
      panel.style.setProperty("translate", "0px 0px");
      const rect = panel.getBoundingClientRect();
      const margin = 8;
      let dx = 0;
      if (rect.left < margin) {
        dx = margin - rect.left;
      } else if (rect.right > window.innerWidth - margin) {
        dx = window.innerWidth - margin - rect.right;
      }
      if (dx !== 0) panel.style.setProperty("translate", `${dx}px 0px`);
    };
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => {
      window.removeEventListener("resize", clampToViewport);
      panel.style.setProperty("translate", "0px 0px");
    };
  }, [isOpen]);

  // ── Visible notifications (max 20) ──
  const visibleNotifications = notifications.slice(0, MAX_VISIBLE);

  const arAriaLabel = unreadCount > 0 ? `${unreadCount} إشعارات غير مقروءة` : "الإشعارات";
  const enAriaLabel = unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications";
  const bellAriaLabel = isRTL ? arAriaLabel : enAriaLabel;

  return (
    <div className="relative" data-notification-center>
      {/* ── Bell Button ── */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={bellAriaLabel}
        className="relative rounded-lg border border-[#1e2d3d] bg-[#0d1420] p-2 text-[#94a3b8] transition-all duration-200 hover:border-[#2d3f52] hover:bg-[rgba(13,20,32,0.8)] hover:text-[#e8f0fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06b6d4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b12]"
      >
        <Bell
          className={`h-[18px] w-[18px] transition-transform duration-200 ${
            isOpen ? "scale-110" : ""
          }`}
        />

        {/* ── Unread Badge ── */}
        {unreadCount > 0 && (
          <span
            className={`absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gradient-to-r from-[#06b6d4] to-[#0284c7] px-1 text-[10px] font-bold leading-none text-white shadow-[0_0_8px_rgba(6,182,212,0.5)] ${
              isRTL ? "-right-auto -left-1.5" : ""
            }`}
            aria-hidden="true"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}

        {/* Subtle ring animation when there are unread */}
        {unreadCount > 0 && (
          <span
            className="pointer-events-none absolute inset-0 rounded-lg"
            style={{
              animation: "notif-pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
            }}
            aria-hidden="true"
          />
        )}
      </button>

      {/* ── Dropdown Panel ── */}
      <div // NOSONAR — S6819: native <dialog> has unwanted modal backdrop; this is a non-modal dropdown
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={isRTL ? "مركز الإشعارات" : "Notification Center"}
        dir={isRTL ? "rtl" : "ltr"}
        className={`absolute z-50 mt-2 w-[360px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-[#1e2d3d] bg-[#0d1420] shadow-[0_16px_48px_rgba(0,0,0,0.5)] transition-all duration-200 ${
          // In LTR the dropdown opens to the right edge of the trigger; in
          // RTL it mirrors to the left edge. Previously both branches were
          // "right-0" (SonarCloud S3923).
          isRTL ? "left-0" : "right-0"
        } ${
          isOpen
            ? "pointer-events-auto translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-2 opacity-0"
        }`}
        style={{ maxHeight: "min(520px, calc(100vh - 100px))" }}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-[#1e2d3d] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <BellRing className="h-4 w-4 text-[#06b6d4]" />
            <h3 className="text-[14px] font-bold text-[#e8f0fe]">
              {isRTL ? "الإشعارات" : "Notifications"}
            </h3>
            {unreadCount > 0 && (
              <span className="rounded-full bg-[rgba(6,182,212,0.12)] px-2 py-0.5 text-[11px] font-semibold text-[#06b6d4]">
                {unreadCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllAsRead()}
                aria-label={isRTL ? "تحديد الكل كمقروء" : "Mark all as read"}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-[#94a3b8] transition-colors hover:bg-[rgba(6,182,212,0.08)] hover:text-[#06b6d4]"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {isRTL ? "تحديد الكل" : "Mark all"}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label={isRTL ? "إغلاق" : "Close"}
              className="rounded-md p-1.5 text-[#475569] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-[#94a3b8]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Web Push toggle: system notifications with the site closed ── */}
        {showPushToggle && pushDescriptor && (
          <div className="border-b border-[#1e2d3d] px-2.5 py-2.5">
            {/* One full-row switch (WAI-ARIA `switch`) — the whole card is the
                tap target, not just the tiny track. Tone reflects the state:
                active=on/working, idle=off, warning=permission blocked by the
                browser, danger=operation failed. Every state is visible — no
                silent failures. */}
            <button
              type="button"
              role="switch"
              aria-checked={push.isSubscribed}
              aria-label={isRTL ? "تفعيل إشعارات المتصفح" : "Enable browser notifications"}
              disabled={push.isBusy}
              onClick={handlePushToggle}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#06b6d4] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1420] disabled:cursor-wait active:scale-[0.99] ${PUSH_ROW_TONES[pushDescriptor.tone].row}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-300 ${PUSH_ROW_TONES[pushDescriptor.tone].badge}`}
              >
                {pushDescriptor.tone === "warning" ? (
                  <BellOff className="h-4 w-4" />
                ) : pushDescriptor.tone === "danger" ? (
                  <TriangleAlert className="h-4 w-4" />
                ) : (
                  <BellRing className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[13px] font-bold text-[#e8f0fe]">
                    {isRTL ? "إشعارات المتصفح" : "Browser notifications"}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold leading-none ${PUSH_ROW_TONES[pushDescriptor.tone].pill}`}
                  >
                    {pushDescriptor.pill}
                  </span>
                </span>
                <span
                  className={`mt-1 line-clamp-2 block text-[11px] leading-snug transition-colors duration-300 ${PUSH_ROW_TONES[pushDescriptor.tone].hint}`}
                >
                  {pushDescriptor.hint}
                </span>
              </span>
              {/* Switch — track 48×28, knob 24; the knob travels on the physical
                  `left` axis in BOTH directions so the slide animates smoothly
                  in LTR and RTL alike (the panel sets `dir`). */}
              <span
                aria-hidden="true"
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300 ${
                  pushDescriptor.switchOn
                    ? "bg-gradient-to-r from-[#06b6d4] to-[#0284c7] shadow-[0_0_14px_rgba(6,182,212,0.4)]"
                    : "bg-[#22303f] ring-1 ring-inset ring-[#33475c]"
                } ${push.isBusy ? "opacity-80" : ""}`}
              >
                {push.isBusy ? (
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-[#e8f0fe]" />
                  </span>
                ) : (
                  <span
                    className="absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.45)] transition-all duration-300"
                    style={{
                      left: pushDescriptor.switchOn ? (isRTL ? 2 : 22) : isRTL ? 22 : 2,
                    }}
                  >
                    {pushDescriptor.switchOn && (
                      <Check className="h-3.5 w-3.5 text-[#0284c7]" strokeWidth={3} />
                    )}
                  </span>
                )}
              </span>
            </button>
          </div>
        )}

        {/* ── Notification List ── */}
        {/* biome-ignore lint/a11y/useSemanticElements: <ul> adds unwanted list styling; role=list on div is WAI-ARIA compliant for custom scrollable list */}
        <div // NOSONAR — S6819: <ul> adds unwanted list styling; role=list is WAI-ARIA compliant
          ref={listRef}
          role="list"
          aria-label={isRTL ? "قائمة الإشعارات" : "Notification list"}
          className="max-h-[380px] overflow-y-auto overscroll-contain px-2.5 py-2"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "#1e2d3d transparent",
          }}
        >
          {visibleNotifications.length === 0 ? (
            <EmptyState lang={lang} />
          ) : (
            <div className="flex flex-col gap-1.5">
              {visibleNotifications.map((record) => (
                <NotificationRow
                  key={record.id}
                  record={record}
                  lang={lang}
                  onMarkRead={markAsRead}
                />
              ))}

              {/* Truncation indicator */}
              {notifications.length > MAX_VISIBLE && (
                <div className="mt-1 border-t border-[#1e2d3d] pt-2 text-center">
                  <p className="text-[11px] text-[#475569]">
                    {isRTL
                      ? `يوجد ${notifications.length - MAX_VISIBLE} إشعارات أخرى`
                      : `${notifications.length - MAX_VISIBLE} more notifications`}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        {notifications.length > 0 && (
          <div className="border-t border-[#1e2d3d] px-4 py-2.5">
            <button
              type="button"
              onClick={() => markAllAsRead()}
              aria-label={isRTL ? "تحديد الكل كمقروء" : "Mark all as read"}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[rgba(6,182,212,0.08)] px-3 py-2 text-[12px] font-semibold text-[#06b6d4] transition-all hover:bg-[rgba(6,182,212,0.15)]"
            >
              <Check className="h-3.5 w-3.5" />
              {isRTL ? "تحديد الكل كمقروء" : "Mark all as read"}
            </button>
          </div>
        )}
      </div>

      {/* ── Inline keyframes for pulse animation ── */}
      <style>{`
        @keyframes notif-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(6,182,212,0); }
          50% { box-shadow: 0 0 0 4px rgba(6,182,212,0.12); }
        }
        /* Custom scrollbar for Webkit browsers */
        [data-notification-center] div::-webkit-scrollbar {
          width: 5px;
        }
        [data-notification-center] div::-webkit-scrollbar-track {
          background: transparent;
        }
        [data-notification-center] div::-webkit-scrollbar-thumb {
          background: #1e2d3d;
          border-radius: 999px;
        }
        [data-notification-center] div::-webkit-scrollbar-thumb:hover {
          background: #2d3f52;
        }
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export types for external consumers
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  PushNotificationConfig,
  RealtimeConfig,
};
