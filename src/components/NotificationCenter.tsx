/* eslint-disable react-refresh/only-export-components */
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import {
  Bell,
  BookOpen,
  Gift,
  Sparkles,
  Check,
  CheckCheck,
  Inbox,
  X,
  BellRing,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { useNotification } from "@/components/NotificationToast";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

/** Display categories used in the notification center panel. */
export type NotificationDisplayType = "enrollment" | "promo" | "update" | "system";

/** Canonical toast types from the existing NotificationToast system. */
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
}

/** Config for the push notification hook. */
interface PushNotificationConfig {
  /** VAPID public key (applicationServerKey as base64-url string). */
  vapidPublicKey?: string;
  /** Called after the service worker receives a push message. */
  onPushMessage?: (payload: MessageEvent) => void;
}

/** Config for the realtime polling hook. */
interface RealtimeConfig {
  /** Polling interval in ms (default 15 000). */
  interval?: number;
  /** Called when a new enrollment is detected. */
  onNewEnrollment?: (courseName: string) => void;
  /** Called when a generic new event arrives. */
  onNewEvent?: (event: { type: string; data?: unknown }) => void;
}

/** Shape returned by useNotificationHistory. */
interface NotificationHistoryState {
  notifications: NotificationRecord[];
  unreadCount: number;
  addNotification: (record: Omit<NotificationRecord, "id" | "read" | "timestamp">) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
}

/** Shape returned by usePushNotification. */
interface PushNotificationState {
  permission: NotificationPermission;
  isSupported: boolean;
  isSubscribed: boolean;
  requestPermission: () => Promise<NotificationPermission>;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
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

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Map a source toast type to a display type for the center panel. */
function toDisplayType(source: SourceToastType): NotificationDisplayType {
  switch (source) {
    case "enrollment":
      return "enrollment";
    case "promo":
      return "promo";
    case "update":
      return "update";
    case "success":
      return "update";
    case "info":
    default:
      return "system";
  }
}

/** Generate a unique id. */
function uid(): string {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  if (lang === "ar") {
    if (seconds < 60) return "الآن";
    if (minutes < 60) return `منذ ${minutes} ${minutes === 1 ? "دقيقة" : minutes === 2 ? "دقيقتين" : minutes <= 10 ? "دقائق" : "دقيقة"}`;
    if (hours < 24) return `منذ ${hours} ${hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : hours <= 10 ? "ساعات" : "ساعة"}`;
    return `منذ ${days} ${days === 1 ? "يوم" : days === 2 ? "يومين" : days <= 10 ? "أيام" : "يوم"}`;
  }

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
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(b64);
  const arr = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    arr[i] = rawData.charCodeAt(i);
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
    if (typeof window === "undefined") return [];
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
    (record: Omit<NotificationRecord, "id" | "read" | "timestamp">) => {
      const now = Date.now();
      const entry: NotificationRecord = {
        ...record,
        id: uid(),
        read: false,
        timestamp: now,
      };
      setNotifications((prev) => {
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
 * Web Push API integration.
 * - Request permission on first call.
 * - Subscribe / unsubscribe push notifications.
 * - Handle incoming push messages via a service-worker message listener.
 */
export function usePushNotification(
  config: PushNotificationConfig = {},
): PushNotificationState {
  const { vapidPublicKey, onPushMessage } = config;

  const [permission, setPermission] = useState<NotificationPermission>(
    () =>
      typeof Notification !== "undefined"
        ? Notification.permission
        : "denied",
  );
  const [isSubscribed, setIsSubscribed] = useState(false);

  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;

  const requestPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!("Notification" in window)) return "denied";
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  }, []);

  const subscribe = useCallback(async () => {
    if (!isSupported || !vapidPublicKey) return;

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
      setPermission(permission);
    }
    if (permission !== "granted") return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
      setIsSubscribed(true);
      // Send subscription to server (implement as needed)
      console.info("[Push] Subscribed successfully", subscription.endpoint);
    } catch (err) {
      console.error("[Push] Subscribe failed", err);
      setIsSubscribed(false);
    }
  }, [isSupported, vapidPublicKey]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        setIsSubscribed(false);
        console.info("[Push] Unsubscribed successfully");
      }
    } catch (err) {
      console.error("[Push] Unsubscribe failed", err);
    }
  }, [isSupported]);

  // Listen for push messages from the service worker
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
    isSubscribed,
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
      const res = await fetch(`/api/notifications/poll?${params.toString()}`);
      if (!res.ok) {
        // Not found / not implemented — this is acceptable for now
        if (res.status === 404) return;
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

          // Enrollment event
          if (event.type === "enrollment" && onNewEnrollmentRef.current) {
            onNewEnrollmentRef.current(event.courseName ?? event.data?.courseName ?? "Unknown Course");
          }

          // Generic event
          if (onNewEventRef.current) {
            onNewEventRef.current({ type: event.type, data: event.data });
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
      type: SourceToastType;
      title: string;
      message: string;
      duration?: number;
      action?: { label: string; onClick: () => void };
    }) => {
      showNotification(toast);
      addNotification({
        displayType: toDisplayType(toast.type),
        sourceType: toast.type,
        title: toast.title,
        message: toast.message,
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
  record: NotificationRecord;
  lang: "en" | "ar";
  onMarkRead: (id: string) => void;
}) {
  const cfg = DISPLAY_CONFIG[record.displayType] ?? DISPLAY_CONFIG.system;

  return (
    <div
      role="listitem"
      dir={lang === "ar" ? "rtl" : "ltr"}
      onClick={() => {
        if (!record.read) onMarkRead(record.id);
      }}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !record.read) {
          e.preventDefault();
          onMarkRead(record.id);
        }
      }}
      tabIndex={0}
      aria-label={`${record.title} – ${record.message}`}
      className={`group flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-all duration-200 ${
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
        <p className="mt-1.5 text-[11px] text-[#475569]">
          {relativeTime(record.timestamp, lang)}
        </p>
      </div>
    </div>
  );
}

/** Empty state when there are zero notifications. */
function EmptyState({ lang }: { lang: "en" | "ar" }) {
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
export default function NotificationCenter() {
  const { lang } = useTranslation();
  const isRTL = lang === "ar";

  // ── Local state ──
  const [isOpen, setIsOpen] = useState(false);

  // ── History hook ──
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
  } = useNotificationHistory();

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

  // ── Visible notifications (max 20) ──
  const visibleNotifications = notifications.slice(0, MAX_VISIBLE);

  return (
    <div className="relative" data-notification-center>
      {/* ── Bell Button ── */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={
          isRTL
            ? unreadCount > 0
              ? `${unreadCount} إشعارات غير مقروءة`
              : "الإشعارات"
            : unreadCount > 0
              ? `${unreadCount} unread notifications`
              : "Notifications"
        }
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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="false"
        aria-label={isRTL ? "مركز الإشعارات" : "Notification Center"}
        dir={isRTL ? "rtl" : "ltr"}
        className={`absolute z-50 mt-2 w-[360px] overflow-hidden rounded-xl border border-[#1e2d3d] bg-[#0d1420] shadow-[0_16px_48px_rgba(0,0,0,0.5)] transition-all duration-200 ${
          isRTL ? "right-0" : "right-0"
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

        {/* ── Notification List ── */}
        <div
          ref={listRef}
          role="list"
          aria-label={isRTL ? "قائمة الإشعارات" : "Notification list"}
          className="max-h-[380px] overflow-y-auto overscroll-contain p-2"
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
