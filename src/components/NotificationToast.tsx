import { useEffect, useState, useCallback, createContext, useContext, type ReactNode } from "react";
import { X, Bell, Sparkles, Gift, BookOpen } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

// ─── Types ───────────────────────────────────────────────────────────────────

type ToastType = "enrollment" | "promo" | "update" | "info" | "success";

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

export function useNotification() {
  return useContext(NotificationContext);
}

// ─── Icons for each type ─────────────────────────────────────────────────────

function ToastIcon({ type }: { type: ToastType }) {
  const icons: Record<ToastType, ReactNode> = {
    enrollment: <BookOpen className="h-4 w-4 text-[#06b6d4]" />,
    promo: <Gift className="h-4 w-4 text-[#f59e0b]" />,
    update: <Sparkles className="h-4 w-4 text-[#10b981]" />,
    info: <Bell className="h-4 w-4 text-[#94a3b8]" />,
    success: <Sparkles className="h-4 w-4 text-[#06b6d4]" />,
  };
  return <>{icons[type] || icons.info}</>;
}

// ─── Single Toast Item ───────────────────────────────────────────────────────

function ToastItem({
  toast,
  onDismiss,
  lang,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
  lang: "en" | "ar";
}) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const isRTL = lang === "ar";

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));

    const duration = toast.duration || 5000;
    const timer = setTimeout(() => handleDismiss(), duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration]);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="alert"
      aria-live="polite"
      dir={isRTL ? "rtl" : "ltr"}
      className={`notification-toast flex w-[320px] items-start gap-3 rounded-xl border border-[rgba(6,182,212,0.15)] bg-[rgba(7,11,18,0.85)] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-300 ${
        visible && !exiting
          ? "translate-y-0 opacity-100"
          : "translate-y-3 opacity-0"
      }`}
    >
      {/* Icon */}
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)]">
        <ToastIcon type={toast.type} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#e8f0fe]">
          {toast.title}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-[#94a3b8]">
          {toast.message}
        </p>
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className="mt-2 text-[12px] font-semibold text-[#06b6d4] transition-colors hover:text-[#22d3ee]"
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

// ─── Provider Component ─────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { lang } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showNotification = useCallback((toast: Omit<Toast, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => {
      // Keep max 4 toasts
      const updated = [...prev, { ...toast, id }];
      return updated.slice(-4);
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <NotificationContext.Provider value={{ showNotification }}>
      {children}

      {/* Toast container — bottom-left */}
      <div
        id="notifications"
        aria-label={lang === "ar" ? "الإشعارات" : "Notifications"}
        className="fixed bottom-20 left-4 z-[100] flex flex-col gap-3 md:bottom-6 md:left-6"
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

export function useEnrollmentNotification() {
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

export function usePromoNotification() {
  const { showNotification } = useNotification();
  const { lang } = useTranslation();

  return useCallback(
    (title: string, message: string) => {
      showNotification({
        type: "promo",
        title,
        message,
        duration: 6000,
      });
    },
    [showNotification, lang]
  );
}
