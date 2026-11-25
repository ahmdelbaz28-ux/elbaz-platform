import { Bell, BookOpen, Gift, Sparkles, X, Youtube } from "lucide-react";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { visualRandom } from "@/lib/random";

// ─── Types ───────────────────────────────────────────────────────────────────

type ToastType = "enrollment" | "promo" | "update" | "info" | "success" | "lesson" | "file" | "software" | "youtube";

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface NotificationContextType {
  showNotification: (toast: Omit<Toast, "id">) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const NotificationContext = createContext<NotificationContextType>({
  showNotification: () => {},
});

export function useNotification() { // eslint-disable-line react-refresh/only-export-components
  return useContext(NotificationContext);
}

// ─── Icons for each type ─────────────────────────────────────────────────────

function ToastIcon({ type }: { readonly type: ToastType }) {
  const icons: Record<ToastType, ReactNode> = {
    enrollment: <BookOpen className="h-4 w-4 text-[#06b6d4]" />,
    promo: <Gift className="h-4 w-4 text-[#f59e0b]" />,
    update: <Sparkles className="h-4 w-4 text-[#10b981]" />,
    info: <Bell className="h-4 w-4 text-[#94a3b8]" />,
    success: <Sparkles className="h-4 w-4 text-[#06b6d4]" />,
    lesson: <BookOpen className="h-4 w-4 text-[#10b981]" />,
    file: <Gift className="h-4 w-4 text-[#06b6d4]" />,
    software: <Sparkles className="h-4 w-4 text-[#8b5cf6]" />,
    youtube: <Youtube className="h-4 w-4 text-[#ff3b30]" />,
  };
  return <>{icons[type] || icons.info}</>;
}

// ─── Single Toast Item ───────────────────────────────────────────────────────

function ToastItem({
  toast,
  onDismiss,
  lang,
}: {
  readonly toast: Toast;
  readonly onDismiss: (id: string) => void;
  readonly lang: "en" | "ar";
}) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const isRTL = lang === "ar";

  // Declare dismiss handler before useEffect so it can be referenced safely
  // inside the auto-dismiss timeout (React Compiler / no-use-before-define).
  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  }, [toast.id, onDismiss]);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));

    const duration = toast.duration || 5000;
    const timer = setTimeout(() => handleDismiss(), duration);
    return () => clearTimeout(timer);
  }, [toast.duration, handleDismiss]);

  return (
    <div
      role="alert"
      aria-live="polite"
      dir={isRTL ? "rtl" : "ltr"}
      // ✅ MOBILE COMPACT (owner report 2026-11-26): the card used to be a
      // fixed 320px-wide, unclamped box — a long YouTube message (~200 chars)
      // rendered ~7 text lines ≈ a 220px card, and the up-to-4-toast stack
      // completely walled off a phone screen. The card is now fluid-width and
      // tight on mobile (full width minus 32px margins, p-3, 2-line message)
      // and unchanged on ≥sm (320px, p-4, 3-line message).
      className={`notification-toast pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border border-[rgba(6,182,212,0.15)] bg-[rgba(7,11,18,0.85)] p-3 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-300 sm:w-[320px] sm:gap-3 sm:p-4 ${
        visible && !exiting
          ? "translate-y-0 opacity-100"
          : "translate-y-3 opacity-0"
      }`}
    >
      {/* Icon — compact on mobile */}
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)] sm:h-8 sm:w-8">
        <ToastIcon type={toast.type} />
      </div>

      {/* Content — title and message are line-clamped so a long server message
          (e.g. YouTube episode titles) can never inflate the card height. */}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-[13px] font-semibold leading-snug text-[#e8f0fe]">
          {toast.title}
        </p>
        <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-[#94a3b8] sm:line-clamp-3">
          {toast.message}
        </p>
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className="mt-1.5 text-[12px] font-semibold text-[#06b6d4] transition-colors hover:text-[#22d3ee] sm:mt-2"
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {/* Dismiss */}
      <button
        onClick={handleDismiss}
        aria-label={lang === "ar" ? "إغلاق" : "Dismiss"}
        className="shrink-0 rounded-md p-1 text-[#475569] transition-colors hover:bg-[rgba(255,255,255,0.05)] hover:text-[#94a3b8]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Responsive viewport helper ─────────────────────────────────────────────

/**
 * True when the viewport is ≥ md (768px). Environments without matchMedia
 * (jsdom tests, very old browsers) fall back to `true` so behavior stays
 * desktop-like there.
 */
function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window.matchMedia !== "function") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

// ─── Provider Component ─────────────────────────────────────────────────────

export function NotificationProvider({ children }: { readonly children: ReactNode }) {
  const { lang } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const isDesktop = useIsDesktopViewport();

  const showNotification = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = `toast-${Date.now()}-${visualRandom().toString(36).slice(2, 7)}`;
      setToasts((prev) => {
        // ✅ MOBILE COMPACT (owner report 2026-11-26): responsive stack cap —
        // mobile shows at most 2 compact toasts so a multi-event burst (e.g.
        // missed YouTube episodes replayed on entry) can never wall off the
        // screen; desktop keeps the 4-toast cap. Displaced events remain
        // available in the bell history — a toast is not an inbox.
        const cap = isDesktop ? 4 : 2;
        const updated = [...prev, { ...toast, id }];
        return updated.slice(-cap);
      });
    },
    [isDesktop]
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const contextValue = useMemo(() => ({ showNotification }), [showNotification]);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}

      {/* Toast container — bottom-left */}
      {/* Fluid width on mobile (left+right margins) so the card never overflows
          narrow screens; pointer-events-none on the container + auto on cards
          keeps the full-width strip tappable where no card is shown. */}
      {/* biome-ignore lint/a11y/useSemanticElements: <section> adds unwanted default styling; role=region on div is WAI-ARIA compliant for toast container */}
      <div // NOSONAR — S6819: <section> adds unwanted default styling; role=region is WAI-ARIA compliant
        id="notifications"
        role="region"
        aria-label={lang === "ar" ? "الإشعارات" : "Notifications"}
        className="pointer-events-none fixed bottom-20 left-4 right-4 z-[100] flex flex-col gap-2 md:bottom-6 md:left-6 md:right-auto md:gap-3"
      >
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onDismiss={dismissToast}
            lang={lang}
          />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

// ─── Predefined notification helpers ────────────────────────────────────────

export function useEnrollmentNotification() { // eslint-disable-line react-refresh/only-export-components
  const { showNotification } = useNotification();
  const { lang } = useTranslation();

  return useCallback(
    (courseName: string) => {
      showNotification({
        type: "enrollment",
        title: lang === "ar" ? "تسجيل جديد!" : "New Enrollment!",
        message:
          lang === "ar"
            ? `تم تسجيل طالب جديد في كورس "${courseName}"`
            : `A new student enrolled in "${courseName}"`,
        duration: 4500,
      });
    },
    [showNotification, lang]
  );
}

export function usePromoNotification() { // eslint-disable-line react-refresh/only-export-components
  const { showNotification } = useNotification();

  return useCallback(
    (title: string, message: string) => {
      showNotification({
        type: "promo",
        title,
        message,
        duration: 6000,
      });
    },
    [showNotification]
  );
}
