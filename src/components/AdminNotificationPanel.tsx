import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  Bell,
  BellRing,
  Send,
  History,
  Settings,
  Clock,
  Eye,
  BookOpen,
  Gift,
  Sparkles,
  Megaphone,
  Users,
  GraduationCap,
  UserCheck,
  ShieldCheck,
  Check,
  AlertCircle,
  Loader2,
  Timer,
  Trash2,
  CalendarClock,
  ArrowDownUp,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useShowNotification } from "@/components/NotificationCenter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

export interface AdminNotificationPanelProps {
  onSend?: (notification: {
    type: string;
    title: string;
    message: string;
    recipientFilter: string;
    scheduledAt?: Date;
  }) => void;
}

type NotificationType = "enrollment" | "promo" | "update" | "custom";

type RecipientFilter =
  | "all"
  | "enrolled"
  | "course"
  | "role_admin"
  | "role_student";

interface SentNotificationRecord {
  id: string;
  type: NotificationType;
  titleEn: string;
  titleAr: string;
  messageEn: string;
  messageAr: string;
  recipientFilter: RecipientFilter;
  recipientLabel: string;
  scheduledAt: string | null;
  sentAt: number;
  status: "sent" | "scheduled" | "failed";
}

interface FormErrors {
  titleEn?: string;
  titleAr?: string;
  messageEn?: string;
  messageAr?: string;
  scheduledDate?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 500;
const DEFAULT_COOLDOWN = 60;
const HISTORY_KEY = "elbaz_admin_notification_history";
const MAX_HISTORY = 50;

const NOTIFICATION_TYPE_CONFIG: Record<
  NotificationType,
  {
    icon: ReactNode;
    color: string;
    bg: string;
    labelEn: string;
    labelAr: string;
    descriptionEn: string;
    descriptionAr: string;
    toastType: "enrollment" | "promo" | "update" | "info";
  }
> = {
  enrollment: {
    icon: <BookOpen className="h-4 w-4" />,
    color: "text-[#06b6d4]",
    bg: "bg-[rgba(6,182,212,0.1)]",
    labelEn: "Enrollment Alert",
    labelAr: "تنبيه تسجيل",
    descriptionEn: "Notify users about new enrollments or course availability",
    descriptionAr: "إخطار المستخدمين حول التسجيلات الجديدة أو توافر الكورسات",
    toastType: "enrollment",
  },
  promo: {
    icon: <Gift className="h-4 w-4" />,
    color: "text-[#f59e0b]",
    bg: "bg-[rgba(245,158,11,0.1)]",
    labelEn: "Promo / Discount",
    labelAr: "عرض / خصم",
    descriptionEn: "Send promotional offers and discount notifications",
    descriptionAr: "إرسال عروض ترويجية وإشعارات خصم",
    toastType: "promo",
  },
  update: {
    icon: <Sparkles className="h-4 w-4" />,
    color: "text-[#10b981]",
    bg: "bg-[rgba(16,185,129,0.1)]",
    labelEn: "System Update",
    labelAr: "تحديث النظام",
    descriptionEn: "Announce platform updates, maintenance, or new features",
    descriptionAr: "إعلان تحديثات المنصة أو الصيانة أو الميزات الجديدة",
    toastType: "update",
  },
  custom: {
    icon: <Megaphone className="h-4 w-4" />,
    color: "text-[#e8f0fe]",
    bg: "bg-[rgba(232,240,254,0.08)]",
    labelEn: "Custom Message",
    labelAr: "رسالة مخصصة",
    descriptionEn: "Send a custom message to selected recipients",
    descriptionAr: "إرسال رسالة مخصصة للمستلمين المحددين",
    toastType: "info",
  },
};

const RECIPIENT_FILTER_CONFIG: Record<
  RecipientFilter,
  { icon: ReactNode; labelEn: string; labelAr: string }
> = {
  all: {
    icon: <Users className="h-4 w-4" />,
    labelEn: "All Users",
    labelAr: "جميع المستخدمين",
  },
  enrolled: {
    icon: <GraduationCap className="h-4 w-4" />,
    labelEn: "Enrolled Only",
    labelAr: "المسجلين فقط",
  },
  course: {
    icon: <BookOpen className="h-4 w-4" />,
    labelEn: "Specific Course",
    labelAr: "كورس محدد",
  },
  role_admin: {
    icon: <ShieldCheck className="h-4 w-4" />,
    labelEn: "Admins Only",
    labelAr: "المديرين فقط",
  },
  role_student: {
    icon: <UserCheck className="h-4 w-4" />,
    labelEn: "Students Only",
    labelAr: "الطلاب فقط",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function generateId(): string {
  return `admin-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDateTime(iso: string, lang: "en" | "ar"): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function getMinScheduledDate(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function loadHistory(): SentNotificationRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function persistHistory(records: SentNotificationRecord[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(0, MAX_HISTORY)));
  } catch {
    // quota exceeded — silently ignore
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════════

/** Character counter that turns red when limit is approached. */
function CharCounter({
  current,
  min,
  max,
}: {
  current: number;
  min: number;
  max: number;
}) {
  const isOver = current > max;
  const isUnder = current > 0 && current < min;
  const color = isOver
    ? "text-[#f87171]"
    : isUnder
      ? "text-[#f59e0b]"
      : "text-[#64748b]";
  return (
    <span className={`text-[11px] tabular-nums ${color}`}>
      {current}/{max}
    </span>
  );
}

/** Inline validation message. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-[12px] text-[#f87171]">
      <AlertCircle className="h-3 w-3 shrink-0" />
      {message}
    </p>
  );
}

/** Inline success message. */
function FieldSuccess({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-[12px] text-[#10b981]">
      <Check className="h-3 w-3 shrink-0" />
      {message}
    </p>
  );
}

/** The cooldown countdown ring/indicator. */
function CooldownIndicator({
  remaining,
  total,
  isRTL,
}: {
  remaining: number;
  total: number;
  isRTL: boolean;
}) {
  const pct = total > 0 ? (remaining / total) * 100 : 0;
  const circumference = 2 * Math.PI * 16;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#1e2d3d] bg-[#0d1420] px-4 py-3">
      <div className="relative h-10 w-10 shrink-0">
        <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            stroke="#1e2d3d"
            strokeWidth="2.5"
          />
          <circle
            cx="18"
            cy="18"
            r="16"
            fill="none"
            stroke="#06b6d4"
            strokeWidth="2.5"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-1000"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-[#06b6d4]">
          {remaining}
        </span>
      </div>
      <div>
        <p className="text-[13px] font-medium text-[#e8f0fe]">
          {isRTL ? "يرجى الانتظار" : "Please wait"}
        </p>
        <p className="text-[11px] text-[#64748b]">
          {isRTL
            ? `ثوانٍ قبل إرسال الإشعار التالي`
            : "seconds before next notification"}
        </p>
      </div>
    </div>
  );
}

/** Toast preview — mimics the look of NotificationToast. */
function NotificationPreview({
  type,
  title,
  message,
  isVisible,
}: {
  type: NotificationType;
  title: string;
  message: string;
  isVisible: boolean;
}) {
  const cfg = NOTIFICATION_TYPE_CONFIG[type];

  return (
    <div
      className={`flex w-full items-start gap-3 rounded-xl border border-[rgba(6,182,212,0.15)] bg-[rgba(7,11,18,0.85)] p-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl transition-all duration-300 ${
        isVisible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-40"
      }`}
    >
      {/* Icon */}
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}
      >
        <span className={cfg.color}>{cfg.icon}</span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#e8f0fe]">
          {title || (type === "custom" ? "Custom Message" : cfg.labelEn)}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-[#94a3b8]">
          {message || "Notification preview will appear here..."}
        </p>
      </div>

      {/* Preview badge */}
      <Badge
        variant="outline"
        className="shrink-0 border-[#1e2d3d] text-[10px] text-[#64748b]"
      >
        Preview
      </Badge>
    </div>
  );
}

/** Single row in the history list. */
function HistoryRow({
  record,
  lang,
  onDelete,
}: {
  record: SentNotificationRecord;
  lang: "en" | "ar";
  onDelete: (id: string) => void;
}) {
  const isRTL = lang === "ar";
  const cfg = NOTIFICATION_TYPE_CONFIG[record.type];
  const isScheduled = record.status === "scheduled";
  const isFailed = record.status === "failed";

  const statusColor = isFailed
    ? "bg-[rgba(248,113,113,0.12)] text-[#f87171]"
    : isScheduled
      ? "bg-[rgba(245,158,11,0.12)] text-[#f59e0b]"
      : "bg-[rgba(16,185,129,0.12)] text-[#10b981]";

  const statusLabel = isFailed
    ? isRTL
      ? "فشل"
      : "Failed"
    : isScheduled
      ? isRTL
        ? "مجدول"
        : "Scheduled"
      : isRTL
        ? "تم الإرسال"
        : "Sent";

  return (
    <div className="group flex items-start gap-3 rounded-lg border border-[#1e2d3d] bg-[#0d1420] px-4 py-3 transition-colors hover:border-[#2d3f52]">
      {/* Icon */}
      <div
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cfg.bg}`}
      >
        <span className={cfg.color}>{cfg.icon}</span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-semibold text-[#e8f0fe]">
            {isRTL ? record.titleAr : record.titleEn}
          </p>
          <Badge className={`${statusColor} border-0 text-[10px]`}>
            {statusLabel}
          </Badge>
        </div>
        <p className="mt-0.5 line-clamp-1 text-[12px] text-[#64748b]">
          {isRTL ? record.messageAr : record.messageEn}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[#475569]">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {record.recipientLabel}
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDateTime(
              isScheduled && record.scheduledAt
                ? record.scheduledAt
                : new Date(record.sentAt).toISOString(),
              lang,
            )}
          </span>
        </div>
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={() => onDelete(record.id)}
        aria-label={isRTL ? "حذف" : "Delete"}
        className="shrink-0 rounded-md p-1.5 text-[#475569] opacity-0 transition-all hover:bg-[rgba(248,113,113,0.1)] hover:text-[#f87171] group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Empty state for history. */
function EmptyHistory({ lang }: { lang: "en" | "ar" }) {
  const isRTL = lang === "ar";
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(148,163,184,0.06)]">
        <History className="h-7 w-7 text-[#475569]" />
      </div>
      <p className="text-[14px] font-semibold text-[#94a3b8]">
        {isRTL ? "لا توجد إشعارات مرسلة" : "No notifications sent"}
      </p>
      <p className="mt-1 max-w-[260px] text-[12px] text-[#475569]">
        {isRTL
          ? "ستظهر الإشعارات التي ترسلها هنا"
          : "Notifications you send will appear here"}
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function AdminNotificationPanel({
  onSend,
}: AdminNotificationPanelProps) {
  const { lang } = useTranslation();
  const { showNotification } = useShowNotification();
  const isRTL = lang === "ar";

  // ─── Form state ───
  const [type, setType] = useState<NotificationType>("custom");
  const [titleEn, setTitleEn] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [messageEn, setMessageEn] = useState("");
  const [messageAr, setMessageAr] = useState("");
  const [recipientFilter, setRecipientFilter] =
    useState<RecipientFilter>("all");
  const [courseName, setCourseName] = useState("");
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState("");
  const [previewActive, setPreviewActive] = useState(false);

  // ─── Cooldown state ───
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [cooldownTotal, setCooldownTotal] = useState(DEFAULT_COOLDOWN);
  const lastSentRef = useRef<number>(0);
  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── UI state ───
  const [errors, setErrors] = useState<FormErrors>({});
  const [successMessage, setSuccessMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState("compose");

  // ─── History state ───
  const [history, setHistory] = useState<SentNotificationRecord[]>(loadHistory);
  const [historyFilter, setHistoryFilter] = useState<NotificationType | "all">("all");

  // ─── Settings state ───
  const [settingCooldown, setSettingCooldown] = useState(DEFAULT_COOLDOWN);

  // ═══════════════════════════════════════════════════════════════════════════
  // Cooldown timer
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (cooldownIntervalRef.current) {
      clearInterval(cooldownIntervalRef.current);
      cooldownIntervalRef.current = null;
    }

    if (cooldownRemaining <= 0) return;

    cooldownIntervalRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        const newVal = prev - 1;
        if (newVal <= 0) {
          if (cooldownIntervalRef.current) {
            clearInterval(cooldownIntervalRef.current);
            cooldownIntervalRef.current = null;
          }
          return 0;
        }
        return newVal;
      });
    }, 1000);

    return () => {
      if (cooldownIntervalRef.current) {
        clearInterval(cooldownIntervalRef.current);
        cooldownIntervalRef.current = null;
      }
    };
  }, [cooldownRemaining]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Validation
  // ═══════════════════════════════════════════════════════════════════════════

  const validate = useCallback((): boolean => {
    const next: FormErrors = {};
    let valid = true;

    // English title — required
    if (!titleEn.trim()) {
      next.titleEn = isRTL ? "العنوان الإنجليزي مطلوب" : "English title is required";
      valid = false;
    } else if (titleEn.trim().length < TITLE_MIN) {
      next.titleEn =
        isRTL
          ? `يجب أن يكون العنوان ${TITLE_MIN} أحرف على الأقل`
          : `Title must be at least ${TITLE_MIN} characters`;
      valid = false;
    } else if (titleEn.length > TITLE_MAX) {
      next.titleEn =
        isRTL
          ? `يجب ألا يتجاوز العنوان ${TITLE_MAX} حرفًا`
          : `Title must not exceed ${TITLE_MAX} characters`;
      valid = false;
    }

    // Arabic title — required
    if (!titleAr.trim()) {
      next.titleAr = isRTL ? "العنوان العربي مطلوب" : "Arabic title is required";
      valid = false;
    } else if (titleAr.trim().length < TITLE_MIN) {
      next.titleAr =
        isRTL
          ? `يجب أن يكون العنوان ${TITLE_MIN} أحرف على الأقل`
          : `Title must be at least ${TITLE_MIN} characters`;
      valid = false;
    } else if (titleAr.length > TITLE_MAX) {
      next.titleAr =
        isRTL
          ? `يجب ألا يتجاوز العنوان ${TITLE_MAX} حرفًا`
          : `Title must not exceed ${TITLE_MAX} characters`;
      valid = false;
    }

    // English message — required
    if (!messageEn.trim()) {
      next.messageEn = isRTL ? "الرسالة الإنجليزية مطلوبة" : "English message is required";
      valid = false;
    } else if (messageEn.trim().length < MESSAGE_MIN) {
      next.messageEn =
        isRTL
          ? `يجب أن تكون الرسالة ${MESSAGE_MIN} أحرف على الأقل`
          : `Message must be at least ${MESSAGE_MIN} characters`;
      valid = false;
    } else if (messageEn.length > MESSAGE_MAX) {
      next.messageEn =
        isRTL
          ? `يجب ألا تتجاوز الرسالة ${MESSAGE_MAX} حرفًا`
          : `Message must not exceed ${MESSAGE_MAX} characters`;
      valid = false;
    }

    // Arabic message — required
    if (!messageAr.trim()) {
      next.messageAr = isRTL ? "الرسالة العربية مطلوبة" : "Arabic message is required";
      valid = false;
    } else if (messageAr.trim().length < MESSAGE_MIN) {
      next.messageAr =
        isRTL
          ? `يجب أن تكون الرسالة ${MESSAGE_MIN} أحرف على الأقل`
          : `Message must be at least ${MESSAGE_MIN} characters`;
      valid = false;
    } else if (messageAr.length > MESSAGE_MAX) {
      next.messageAr =
        isRTL
          ? `يجب ألا تتجاوز الرسالة ${MESSAGE_MAX} حرفًا`
          : `Message must not exceed ${MESSAGE_MAX} characters`;
      valid = false;
    }

    // Course name required when filter is "course"
    if (recipientFilter === "course" && !courseName.trim()) {
      next.scheduledDate =
        isRTL ? "اسم الكورس مطلوب" : "Course name is required";
      valid = false;
    }

    // Schedule date must be in the future
    if (isScheduled && scheduledDate) {
      const selectedDate = new Date(scheduledDate);
      if (selectedDate <= new Date()) {
        next.scheduledDate =
          isRTL
            ? "يجب أن يكون الموعد في المستقبل"
            : "Schedule time must be in the future";
        valid = false;
      }
    }

    setErrors(next);
    return valid;
  }, [titleEn, titleAr, messageEn, messageAr, recipientFilter, courseName, isScheduled, scheduledDate, isRTL]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Reset form
  // ═══════════════════════════════════════════════════════════════════════════

  const resetForm = useCallback(() => {
    setType("custom");
    setTitleEn("");
    setTitleAr("");
    setMessageEn("");
    setMessageAr("");
    setRecipientFilter("all");
    setCourseName("");
    setIsScheduled(false);
    setScheduledDate("");
    setErrors({});
    setSuccessMessage("");
    setPreviewActive(false);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Preview notification
  // ═══════════════════════════════════════════════════════════════════════════

  const handlePreview = useCallback(() => {
    if (cooldownRemaining > 0) return;

    const displayTitle = isRTL ? titleAr : titleEn;
    const displayMessage = isRTL ? messageAr : messageEn;

    const cfg = NOTIFICATION_TYPE_CONFIG[type];
    showNotification({
      type: cfg.toastType,
      title: displayTitle || cfg.labelEn,
      message: displayMessage || "Preview notification",
      duration: 4000,
    });
    setPreviewActive(true);
    setTimeout(() => setPreviewActive(false), 5000);
  }, [type, titleEn, titleAr, messageEn, messageAr, isRTL, showNotification, cooldownRemaining]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Send notification
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSend = useCallback(async () => {
    if (cooldownRemaining > 0) return;
    if (!validate()) return;

    setIsSending(true);
    setSuccessMessage("");

    // Simulate a brief send delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    const recipientLabel =
      RECIPIENT_FILTER_CONFIG[recipientFilter][isRTL ? "labelAr" : "labelEn"];

    const record: SentNotificationRecord = {
      id: generateId(),
      type,
      titleEn: titleEn.trim(),
      titleAr: titleAr.trim(),
      messageEn: messageEn.trim(),
      messageAr: messageAr.trim(),
      recipientFilter,
      recipientLabel:
        recipientFilter === "course" ? courseName.trim() : recipientLabel,
      scheduledAt: isScheduled ? scheduledDate : null,
      sentAt: Date.now(),
      status: isScheduled ? "scheduled" : "sent",
    };

    // Update history
    setHistory((prev) => {
      const updated = [record, ...prev].slice(0, MAX_HISTORY);
      persistHistory(updated);
      return updated;
    });

    // Fire callback
    onSend?.({
      type,
      title: isRTL ? record.titleAr : record.titleEn,
      message: isRTL ? record.messageAr : record.messageEn,
      recipientFilter,
      scheduledAt: record.scheduledAt ? new Date(record.scheduledAt) : undefined,
    });

    // Show a toast confirmation to the admin
    const cfg = NOTIFICATION_TYPE_CONFIG[type];
    showNotification({
      type: cfg.toastType,
      title: isRTL ? "تم الإرسال بنجاح" : "Notification Sent",
      message: isRTL
        ? `تم إرسال "${record.titleAr}" إلى ${record.recipientLabel}`
        : `"${record.titleEn}" sent to ${record.recipientLabel}`,
      duration: 4000,
    });

    // Start cooldown
    const cooldown = settingCooldown || DEFAULT_COOLDOWN;
    setCooldownTotal(cooldown);
    setCooldownRemaining(cooldown);
    lastSentRef.current = Date.now();

    setSuccessMessage(
      isRTL ? "تم إرسال الإشعار بنجاح!" : "Notification sent successfully!",
    );

    setIsSending(false);

    // Reset form after short delay so user sees the success
    setTimeout(() => resetForm(), 2000);
  }, [
    cooldownRemaining,
    validate,
    type,
    titleEn,
    titleAr,
    messageEn,
    messageAr,
    recipientFilter,
    courseName,
    isScheduled,
    scheduledDate,
    isRTL,
    onSend,
    showNotification,
    settingCooldown,
    resetForm,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Delete from history
  // ═══════════════════════════════════════════════════════════════════════════

  const handleDeleteHistory = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((r) => r.id !== id);
      persistHistory(updated);
      return updated;
    });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Save settings
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSaveSettings = useCallback(() => {
    const cd = Math.max(10, Math.min(300, settingCooldown));
    setSettingCooldown(cd);
    setCooldownTotal(cd);
    showNotification({
      type: "update",
      title: isRTL ? "تم حفظ الإعدادات" : "Settings Saved",
      message:
        isRTL
          ? `تم ضبط فترة الانتظار على ${cd} ثانية`
          : `Cooldown set to ${cd} seconds`,
      duration: 3000,
    });
  }, [settingCooldown, showNotification, isRTL]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Computed values
  // ═══════════════════════════════════════════════════════════════════════════

  const typeConfig = NOTIFICATION_TYPE_CONFIG[type];
  const recipientConfig = RECIPIENT_FILTER_CONFIG[recipientFilter];
  const filteredHistory =
    historyFilter === "all"
      ? history
      : history.filter((r) => r.type === historyFilter);
  const isOnCooldown = cooldownRemaining > 0;
  const isFormEmpty =
    !titleEn && !titleAr && !messageEn && !messageAr;
  const previewTitle = isRTL ? titleAr : titleEn;
  const previewMessage = isRTL ? messageAr : messageEn;

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="w-full rounded-2xl border border-[#1e2d3d] bg-[#0d1420]"
    >
      {/* ─── Header ─── */}
      <div className="flex items-center gap-3 border-b border-[#1e2d3d] px-6 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(6,182,212,0.1)]">
          <BellRing className="h-5 w-5 text-[#06b6d4]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-[#e8f0fe]">
            {isRTL ? "مركز إرسال الإشعارات" : "Notification Center"}
          </h2>
          <p className="text-[13px] text-[#64748b]">
            {isRTL
              ? "إرسال وإدارة الإشعارات للمستخدمين"
              : "Send and manage notifications for users"}
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-[rgba(6,182,212,0.25)] text-[12px] text-[#06b6d4]"
        >
          {history.length}{" "}
          {isRTL ? "إشعار مرسل" : "sent"}
        </Badge>
      </div>

      {/* ─── Tabs ─── */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="px-6 pb-6"
      >
        <TabsList className="mt-4 flex w-full border border-[#1e2d3d] bg-[#070b12]">
          <TabsTrigger
            value="compose"
            className="flex-1 data-[state=active]:bg-[#06b6d4] data-[state=active]:text-[#070b12]"
          >
            <Send className={`h-4 w-4 ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
            {isRTL ? "إرسال جديد" : "Send New"}
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="flex-1 data-[state=active]:bg-[#06b6d4] data-[state=active]:text-[#070b12]"
          >
            <History className={`h-4 w-4 ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
            {isRTL ? "السجل" : "History"}
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="flex-1 data-[state=active]:bg-[#06b6d4] data-[state=active]:text-[#070b12]"
          >
            <Settings className={`h-4 w-4 ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
            {isRTL ? "الإعدادات" : "Settings"}
          </TabsTrigger>
        </TabsList>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 1 — Compose / Send New
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="compose" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
            {/* ── Left Column: Form ── */}
            <div className="space-y-6">
              {/* Cooldown indicator */}
              {isOnCooldown && (
                <CooldownIndicator
                  remaining={cooldownRemaining}
                  total={cooldownTotal}
                  isRTL={isRTL}
                />
              )}

              {/* Success message */}
              {successMessage && (
                <FieldSuccess message={successMessage} />
              )}

              {/* ── Notification Type ── */}
              <Card className="border-[#1e2d3d] bg-[#111827] py-4">
                <CardHeader className="pb-0">
                  <CardTitle className="text-[14px] text-[#e8f0fe]">
                    {isRTL ? "نوع الإشعار" : "Notification Type"}
                  </CardTitle>
                  <CardDescription className="text-[12px]">
                    {isRTL
                      ? "اختر نوع الإشعار المناسب"
                      : "Choose the appropriate notification type"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 pt-4 sm:grid-cols-4">
                  {(Object.keys(NOTIFICATION_TYPE_CONFIG) as NotificationType[]).map(
                    (nt) => {
                      const cfg = NOTIFICATION_TYPE_CONFIG[nt];
                      const isSelected = type === nt;
                      return (
                        <button
                          key={nt}
                          type="button"
                          onClick={() => setType(nt)}
                          className={`flex flex-col items-center gap-2 rounded-xl border px-3 py-3 text-center transition-all ${
                            isSelected
                              ? "border-[#06b6d4] bg-[rgba(6,182,212,0.08)] ring-1 ring-[rgba(6,182,212,0.2)]"
                              : "border-[#1e2d3d] bg-[#0d1420] hover:border-[#2d3f52]"
                          }`}
                        >
                          <div
                            className={`flex h-9 w-9 items-center justify-center rounded-lg ${cfg.bg}`}
                          >
                            <span className={cfg.color}>{cfg.icon}</span>
                          </div>
                          <span
                            className={`text-[11px] font-medium ${
                              isSelected ? "text-[#06b6d4]" : "text-[#94a3b8]"
                            }`}
                          >
                            {isRTL ? cfg.labelAr : cfg.labelEn}
                          </span>
                        </button>
                      );
                    },
                  )}
                </CardContent>
              </Card>

              {/* ── Titles (EN / AR) ── */}
              <div className="grid gap-4 sm:grid-cols-2">
                {/* English Title */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[#94a3b8]">
                      {isRTL ? "العنوان (إنجليزي)" : "Title (English)"}
                      <span className="ml-1 text-[#f87171]">*</span>
                    </Label>
                    <CharCounter
                      current={titleEn.length}
                      min={TITLE_MIN}
                      max={TITLE_MAX}
                    />
                  </div>
                  <Input
                    value={titleEn}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.length <= TITLE_MAX) setTitleEn(v);
                      setErrors((prev) => ({ ...prev, titleEn: undefined }));
                      setSuccessMessage("");
                    }}
                    placeholder={
                      isRTL ? "أدخل العنوان بالإنجليزية..." : "Enter title in English..."
                    }
                    dir="ltr"
                    className={`border-[#1e2d3d] bg-[#0d1420] text-[#e8f0fe] placeholder:text-[#475569] ${
                      errors.titleEn ? "border-[#f87171] focus-visible:border-[#f87171] focus-visible:ring-[#f87171]/30" : ""
                    }`}
                  />
                  <FieldError message={errors.titleEn} />
                </div>

                {/* Arabic Title */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[#94a3b8]">
                      {isRTL ? "العنوان (عربي)" : "Title (Arabic)"}
                      <span className="ml-1 text-[#f87171]">*</span>
                    </Label>
                    <CharCounter
                      current={titleAr.length}
                      min={TITLE_MIN}
                      max={TITLE_MAX}
                    />
                  </div>
                  <Input
                    value={titleAr}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.length <= TITLE_MAX) setTitleAr(v);
                      setErrors((prev) => ({ ...prev, titleAr: undefined }));
                      setSuccessMessage("");
                    }}
                    placeholder={
                      isRTL ? "أدخل العنوان بالعربية..." : "أدخل العنوان بالعربية..."
                    }
                    dir="rtl"
                    className={`border-[#1e2d3d] bg-[#0d1420] text-[#e8f0fe] placeholder:text-[#475569] ${
                      errors.titleAr ? "border-[#f87171] focus-visible:border-[#f87171] focus-visible:ring-[#f87171]/30" : ""
                    }`}
                  />
                  <FieldError message={errors.titleAr} />
                </div>
              </div>

              {/* ── Messages (EN / AR) ── */}
              <div className="grid gap-4 sm:grid-cols-2">
                {/* English Message */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[#94a3b8]">
                      {isRTL ? "الرسالة (إنجليزي)" : "Message (English)"}
                      <span className="ml-1 text-[#f87171]">*</span>
                    </Label>
                    <CharCounter
                      current={messageEn.length}
                      min={MESSAGE_MIN}
                      max={MESSAGE_MAX}
                    />
                  </div>
                  <Textarea
                    value={messageEn}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.length <= MESSAGE_MAX) setMessageEn(v);
                      setErrors((prev) => ({ ...prev, messageEn: undefined }));
                      setSuccessMessage("");
                    }}
                    placeholder={
                      isRTL
                        ? "اكتب الرسالة بالإنجليزية..."
                        : "Write the message in English..."
                    }
                    dir="ltr"
                    rows={4}
                    className={`min-h-[100px] border-[#1e2d3d] bg-[#0d1420] text-[#e8f0fe] placeholder:text-[#475569] ${
                      errors.messageEn ? "border-[#f87171] focus-visible:border-[#f87171] focus-visible:ring-[#f87171]/30" : ""
                    }`}
                  />
                  <FieldError message={errors.messageEn} />
                </div>

                {/* Arabic Message */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-[#94a3b8]">
                      {isRTL ? "الرسالة (عربي)" : "Message (Arabic)"}
                      <span className="ml-1 text-[#f87171]">*</span>
                    </Label>
                    <CharCounter
                      current={messageAr.length}
                      min={MESSAGE_MIN}
                      max={MESSAGE_MAX}
                    />
                  </div>
                  <Textarea
                    value={messageAr}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.length <= MESSAGE_MAX) setMessageAr(v);
                      setErrors((prev) => ({ ...prev, messageAr: undefined }));
                      setSuccessMessage("");
                    }}
                    placeholder={isRTL ? "اكتب الرسالة بالعربية..." : "اكتب الرسالة بالعربية..."}
                    dir="rtl"
                    rows={4}
                    className={`min-h-[100px] border-[#1e2d3d] bg-[#0d1420] text-[#e8f0fe] placeholder:text-[#475569] ${
                      errors.messageAr ? "border-[#f87171] focus-visible:border-[#f87171] focus-visible:ring-[#f87171]/30" : ""
                    }`}
                  />
                  <FieldError message={errors.messageAr} />
                </div>
              </div>

              {/* ── Recipient Filter ── */}
              <Card className="border-[#1e2d3d] bg-[#111827] py-4">
                <CardHeader className="pb-0">
                  <CardTitle className="text-[14px] text-[#e8f0fe]">
                    {isRTL ? "المستلمون" : "Recipients"}
                  </CardTitle>
                  <CardDescription className="text-[12px]">
                    {isRTL
                      ? "اختر من سيستلم هذا الإشعار"
                      : "Choose who will receive this notification"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-[#94a3b8]">
                        {isRTL ? "تصنيف المستلمين" : "Recipient Filter"}
                      </Label>
                      <Select
                        value={recipientFilter}
                        onValueChange={(val) =>
                          setRecipientFilter(val as RecipientFilter)
                        }
                      >
                        <SelectTrigger className="w-full border-[#1e2d3d] bg-[#0d1420] text-[#e8f0fe]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-[#1e2d3d] bg-[#111827]">
                          {(
                            Object.keys(RECIPIENT_FILTER_CONFIG) as RecipientFilter[]
                          ).map((rf) => {
                            const cfg = RECIPIENT_FILTER_CONFIG[rf];
                            return (
                              <SelectItem
                                key={rf}
                                value={rf}
                                className="text-[#e8f0fe] focus:bg-[#1e2d3d]"
                              >
                                <span className="flex items-center gap-2">
                                  {cfg.icon}
                                  {isRTL ? cfg.labelAr : cfg.labelEn}
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Course name (conditional) */}
                    {recipientFilter === "course" && (
                      <div className="space-y-1.5">
                        <Label className="text-[#94a3b8]">
                          {isRTL ? "اسم الكورس" : "Course Name"}
                          <span className="ml-1 text-[#f87171]">*</span>
                        </Label>
                        <Input
                          value={courseName}
                          onChange={(e) => {
                            setCourseName(e.target.value);
                            setErrors((prev) => ({
                              ...prev,
                              scheduledDate: undefined,
                            }));
                          }}
                          placeholder={
                            isRTL
                              ? "أدخل اسم الكورس..."
                              : "Enter course name..."
                          }
                          className={`border-[#1e2d3d] bg-[#0d1420] text-[#e8f0fe] placeholder:text-[#475569] ${
                            errors.scheduledDate
                              ? "border-[#f87171]"
                              : ""
                          }`}
                        />
                        <FieldError message={errors.scheduledDate} />
                      </div>
                    )}
                  </div>

                  {/* Recipient summary */}
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-[rgba(6,182,212,0.15)] bg-[rgba(6,182,212,0.05)] px-3 py-2">
                    <span className={typeConfig.color}>{recipientConfig.icon}</span>
                    <span className="text-[12px] text-[#94a3b8]">
                      {isRTL ? "سيتم الإرسال إلى: " : "Will send to: "}
                      <span className="font-semibold text-[#06b6d4]">
                        {isRTL
                          ? RECIPIENT_FILTER_CONFIG[recipientFilter].labelAr
                          : RECIPIENT_FILTER_CONFIG[recipientFilter].labelEn}
                        {recipientFilter === "course" && courseName.trim()
                          ? ` — ${courseName.trim()}`
                          : ""}
                      </span>
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* ── Schedule ── */}
              <Card className="border-[#1e2d3d] bg-[#111827] py-4">
                <CardContent className="pt-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(245,158,11,0.1)]">
                        <CalendarClock className="h-4 w-4 text-[#f59e0b]" />
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-[#e8f0fe]">
                          {isRTL ? "جدولة الإرسال" : "Schedule Delivery"}
                        </p>
                        <p className="text-[11px] text-[#64748b]">
                          {isRTL
                            ? "اختر وقتًا محددًا لإرسال الإشعار"
                            : "Set a specific time to send the notification"}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={isScheduled}
                      onCheckedChange={setIsScheduled}
                      className="data-[state=checked]:bg-[#f59e0b]"
                    />
                  </div>

                  {isScheduled && (
                    <div className="mt-4 space-y-1.5">
                      <Label className="text-[#94a3b8]">
                        {isRTL ? "التاريخ والوقت" : "Date & Time"}
                      </Label>
                      <Input
                        type="datetime-local"
                        value={scheduledDate}
                        min={getMinScheduledDate()}
                        onChange={(e) => {
                          setScheduledDate(e.target.value);
                          setErrors((prev) => ({
                            ...prev,
                            scheduledDate: undefined,
                          }));
                          setSuccessMessage("");
                        }}
                        dir="ltr"
                        className={`w-full border-[#1e2d3d] bg-[#0d1420] text-[#e8f0fe] ${
                          errors.scheduledDate
                            ? "border-[#f87171] focus-visible:border-[#f87171] focus-visible:ring-[#f87171]/30"
                            : ""
                        }`}
                      />
                      <FieldError message={errors.scheduledDate} />
                      {scheduledDate && !errors.scheduledDate && (
                        <p className="mt-1 text-[11px] text-[#10b981]">
                          {isRTL
                            ? `سيتم الإرسال في: ${formatDateTime(scheduledDate, lang)}`
                            : `Scheduled for: ${formatDateTime(scheduledDate, lang)}`}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Action Buttons ── */}
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetForm}
                  className="border border-[#1e2d3d] text-[#94a3b8] hover:bg-[#1e2d3d] hover:text-[#e8f0fe]"
                >
                  <RotateCcw className={`h-4 w-4 ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
                  {isRTL ? "إعادة تعيين" : "Reset Form"}
                </Button>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePreview}
                    disabled={isFormEmpty || isOnCooldown}
                    className="border-[#1e2d3d] bg-[#111827] text-[#94a3b8] hover:bg-[#1e2d3d] hover:text-[#e8f0fe]"
                  >
                    <Eye className={`h-4 w-4 ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
                    {isRTL ? "معاينة" : "Preview"}
                  </Button>

                  <Button
                    type="button"
                    onClick={handleSend}
                    disabled={isOnCooldown || isSending}
                    className="bg-[#06b6d4] text-[#070b12] hover:bg-[#22d3ee] disabled:opacity-50"
                  >
                    {isSending ? (
                      <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
                    ) : isOnCooldown ? (
                      <Timer className={`h-4 w-4 ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
                    ) : (
                      <Send className={`h-4 w-4 ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
                    )}
                    {isSending
                      ? isRTL
                        ? "جاري الإرسال..."
                        : "Sending..."
                      : isOnCooldown
                        ? `${cooldownRemaining}s`
                        : isScheduled
                          ? isRTL
                            ? "جدولة الإرسال"
                            : "Schedule Send"
                          : isRTL
                            ? "إرسال الإشعار"
                            : "Send Notification"}
                  </Button>
                </div>
              </div>
            </div>

            {/* ── Right Column: Preview ── */}
            <div className="space-y-4">
              <div className="sticky top-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-[#64748b]" />
                  <h3 className="text-[13px] font-semibold text-[#94a3b8]">
                    {isRTL ? "معاينة مباشرة" : "Live Preview"}
                  </h3>
                </div>

                <NotificationPreview
                  type={type}
                  title={previewTitle}
                  message={previewMessage}
                  isVisible={previewActive || !isFormEmpty}
                />

                {/* Type description */}
                <div className="rounded-lg border border-[#1e2d3d] bg-[#070b12] p-3">
                  <p className="text-[11px] text-[#64748b]">
                    {isRTL
                      ? "يظهر الإشعار للمستخدمين بالشكل التالي"
                      : "The notification will appear to users as follows"}
                  </p>
                </div>

                {/* Notification metadata summary */}
                <div className="rounded-lg border border-[#1e2d3d] bg-[#070b12] p-4 space-y-3">
                  <p className="text-[12px] font-semibold text-[#94a3b8]">
                    {isRTL ? "ملخص الإشعار" : "Notification Summary"}
                  </p>

                  <div className="space-y-2 text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[#64748b]">
                        {isRTL ? "النوع" : "Type"}
                      </span>
                      <Badge
                        variant="outline"
                        className="border-[#1e2d3d] text-[10px]"
                      >
                        <span
                          className={`flex items-center gap-1 ${typeConfig.color}`}
                        >
                          {typeConfig.icon}
                          {isRTL ? typeConfig.labelAr : typeConfig.labelEn}
                        </span>
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[#64748b]">
                        {isRTL ? "المستلمون" : "Recipients"}
                      </span>
                      <span className="flex items-center gap-1 text-[#94a3b8]">
                        {recipientConfig.icon}
                        {isRTL
                          ? RECIPIENT_FILTER_CONFIG[recipientFilter].labelAr
                          : RECIPIENT_FILTER_CONFIG[recipientFilter].labelEn}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[#64748b]">
                        {isRTL ? "التوقيت" : "Timing"}
                      </span>
                      <span
                        className={`flex items-center gap-1 ${
                          isScheduled ? "text-[#f59e0b]" : "text-[#10b981]"
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        {isScheduled
                          ? isRTL
                            ? "مجدول"
                            : "Scheduled"
                          : isRTL
                            ? "فوري"
                            : "Immediate"}
                      </span>
                    </div>

                    {isScheduled && scheduledDate && (
                      <div className="flex items-center justify-between">
                        <span className="text-[#64748b]">
                          {isRTL ? "التاريخ" : "Date"}
                        </span>
                        <span className="text-[#94a3b8]">
                          {formatDateTime(scheduledDate, lang)}
                        </span>
                      </div>
                    )}

                    <div className="border-t border-[#1e2d3d] pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[#64748b]">
                          {isRTL ? "الحالة" : "Status"}
                        </span>
                        {isOnCooldown ? (
                          <Badge className="border-0 bg-[rgba(245,158,11,0.12)] text-[10px] text-[#f59e0b]">
                            <Timer className={`h-3 w-3 ${isRTL ? "ml-1" : "mr-1"}`} />
                            {isRTL ? "انتظار" : "Cooldown"}
                          </Badge>
                        ) : Object.values(errors).some(Boolean) ? (
                          <Badge className="border-0 bg-[rgba(248,113,113,0.12)] text-[10px] text-[#f87171]">
                            <AlertCircle className={`h-3 w-3 ${isRTL ? "ml-1" : "mr-1"}`} />
                            {isRTL ? "أخطاء" : "Errors"}
                          </Badge>
                        ) : isFormEmpty ? (
                          <Badge variant="outline" className="border-[#1e2d3d] text-[10px] text-[#64748b]">
                            {isRTL ? "فارغ" : "Empty"}
                          </Badge>
                        ) : (
                          <Badge className="border-0 bg-[rgba(16,185,129,0.12)] text-[10px] text-[#10b981]">
                            <Check className={`h-3 w-3 ${isRTL ? "ml-1" : "mr-1"}`} />
                            {isRTL ? "جاهز" : "Ready"}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 2 — History
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="history" className="mt-6">
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[15px] font-semibold text-[#e8f0fe]">
                  {isRTL ? "سجل الإشعارات المرسلة" : "Notification History"}
                </h3>
                <p className="text-[12px] text-[#64748b]">
                  {isRTL
                    ? `${history.length} إشعار مرسل`
                    : `${history.length} notifications sent`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Filter */}
                <Select
                  value={historyFilter}
                  onValueChange={(val) =>
                    setHistoryFilter(val as NotificationType | "all")
                  }
                >
                  <SelectTrigger className="w-[160px] border-[#1e2d3d] bg-[#111827] text-[#e8f0fe]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-[#1e2d3d] bg-[#111827]">
                    <SelectItem
                      value="all"
                      className="text-[#e8f0fe] focus:bg-[#1e2d3d]"
                    >
                      {isRTL ? "الكل" : "All Types"}
                    </SelectItem>
                    {(
                      Object.keys(NOTIFICATION_TYPE_CONFIG) as NotificationType[]
                    ).map((nt) => (
                      <SelectItem
                        key={nt}
                        value={nt}
                        className="text-[#e8f0fe] focus:bg-[#1e2d3d]"
                      >
                        {isRTL
                          ? NOTIFICATION_TYPE_CONFIG[nt].labelAr
                          : NOTIFICATION_TYPE_CONFIG[nt].labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Clear all */}
                {history.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setHistory([]);
                      persistHistory([]);
                    }}
                    className="border border-[#1e2d3d] text-[#f87171] hover:bg-[rgba(248,113,113,0.1)]"
                  >
                    <Trash2 className={`h-3.5 w-3.5 ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
                    {isRTL ? "مسح الكل" : "Clear All"}
                  </Button>
                )}
              </div>
            </div>

            {/* List */}
            {filteredHistory.length === 0 ? (
              <EmptyHistory lang={lang} />
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-y-auto rounded-xl border border-[#1e2d3d] bg-[#070b12] p-2">
                {filteredHistory.map((record) => (
                  <HistoryRow
                    key={record.id}
                    record={record}
                    lang={lang}
                    onDelete={handleDeleteHistory}
                  />
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 3 — Settings
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="settings" className="mt-6">
          <div className="space-y-6">
            {/* Rate Limiting */}
            <Card className="border-[#1e2d3d] bg-[#111827] py-4">
              <CardHeader className="pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)]">
                    <Timer className="h-4 w-4 text-[#06b6d4]" />
                  </div>
                  <div>
                    <CardTitle className="text-[14px] text-[#e8f0fe]">
                      {isRTL
                        ? "معدل الإرسال المحدود"
                        : "Rate Limiting / Cooldown"}
                    </CardTitle>
                    <CardDescription className="text-[12px]">
                      {isRTL
                        ? "تحديد الفترة الزمنية بين الإشعارات لمنع الإرسال المتكرر"
                        : "Set the minimum time between sends to prevent spam"}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label className="text-[#94a3b8]">
                        {isRTL
                          ? "فترة الانتظار (بالثواني)"
                          : "Cooldown Duration (seconds)"}
                      </Label>
                      <Input
                        type="number"
                        value={settingCooldown}
                        min={10}
                        max={300}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val)) {
                            setSettingCooldown(val);
                          }
                        }}
                        dir="ltr"
                        className="w-full border-[#1e2d3d] bg-[#0d1420] text-[#e8f0fe]"
                      />
                      <p className="text-[11px] text-[#475569]">
                        {isRTL
                          ? "الحد الأدنى: 10 ثوانٍ — الحد الأقصى: 300 ثانية"
                          : "Min: 10s — Max: 300s"}
                      </p>
                    </div>

                    <div className="flex items-end">
                      <Button
                        type="button"
                        onClick={handleSaveSettings}
                        className="w-full bg-[#06b6d4] text-[#070b12] hover:bg-[#22d3ee]"
                      >
                        {isRTL ? "حفظ" : "Save"}
                      </Button>
                    </div>
                  </div>

                  {/* Visual presets */}
                  <div>
                    <p className="mb-2 text-[11px] text-[#64748b]">
                      {isRTL ? "اختيارات سريعة:" : "Quick presets:"}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: isRTL ? "30 ثانية" : "30s", value: 30 },
                        { label: isRTL ? "60 ثانية" : "60s", value: 60 },
                        { label: isRTL ? "2 دقيقة" : "2 min", value: 120 },
                        { label: isRTL ? "5 دقائق" : "5 min", value: 300 },
                      ].map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setSettingCooldown(preset.value)}
                          className={`rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-all ${
                            settingCooldown === preset.value
                              ? "border-[#06b6d4] bg-[rgba(6,182,212,0.1)] text-[#06b6d4]"
                              : "border-[#1e2d3d] text-[#94a3b8] hover:border-[#2d3f52] hover:text-[#e8f0fe]"
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Notification Defaults */}
            <Card className="border-[#1e2d3d] bg-[#111827] py-4">
              <CardHeader className="pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(16,185,129,0.1)]">
                    <Bell className="h-4 w-4 text-[#10b981]" />
                  </div>
                  <div>
                    <CardTitle className="text-[14px] text-[#e8f0fe]">
                      {isRTL ? "إعدادات الإشعارات الافتراضية" : "Default Notification Settings"}
                    </CardTitle>
                    <CardDescription className="text-[12px]">
                      {isRTL
                        ? "إعدادات افتراضية عند إنشاء إشعار جديد"
                        : "Default settings when composing a new notification"}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {/* Info rows */}
                  {[
                    {
                      icon: <BookOpen className="h-4 w-4 text-[#06b6d4]" />,
                      labelEn: "Default Type",
                      labelAr: "النوع الافتراضي",
                      valueEn: "Custom Message",
                      valueAr: "رسالة مخصصة",
                    },
                    {
                      icon: <Users className="h-4 w-4 text-[#94a3b8]" />,
                      labelEn: "Default Recipients",
                      labelAr: "المستلمون الافتراضيون",
                      valueEn: "All Users",
                      valueAr: "جميع المستخدمين",
                    },
                    {
                      icon: <Clock className="h-4 w-4 text-[#f59e0b]" />,
                      labelEn: "Default Timing",
                      labelAr: "التوقيت الافتراضي",
                      valueEn: "Immediate",
                      valueAr: "فوري",
                    },
                    {
                      icon: <ArrowDownUp className="h-4 w-4 text-[#64748b]" />,
                      labelEn: "Title Length Limit",
                      labelAr: "حد طول العنوان",
                      valueEn: `${TITLE_MIN}–${TITLE_MAX} chars`,
                      valueAr: `${TITLE_MIN}–${TITLE_MAX} حرف`,
                    },
                    {
                      icon: <ArrowDownUp className="h-4 w-4 text-[#64748b]" />,
                      labelEn: "Message Length Limit",
                      labelAr: "حد طول الرسالة",
                      valueEn: `${MESSAGE_MIN}–${MESSAGE_MAX} chars`,
                      valueAr: `${MESSAGE_MIN}–${MESSAGE_MAX} حرف`,
                    },
                  ].map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-[#1e2d3d] bg-[#0d1420] px-3 py-2.5"
                    >
                      <div className="flex items-center gap-2.5">
                        {item.icon}
                        <span className="text-[12px] text-[#94a3b8]">
                          {isRTL ? item.labelAr : item.labelEn}
                        </span>
                      </div>
                      <span className="text-[12px] font-medium text-[#e8f0fe]">
                        {isRTL ? item.valueAr : item.valueEn}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Stats */}
            <Card className="border-[#1e2d3d] bg-[#111827] py-4">
              <CardHeader className="pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(148,163,184,0.08)]">
                    <History className="h-4 w-4 text-[#94a3b8]" />
                  </div>
                  <CardTitle className="text-[14px] text-[#e8f0fe]">
                    {isRTL ? "إحصائيات الإشعارات" : "Notification Stats"}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    {
                      label: isRTL ? "إجمالي المرسل" : "Total Sent",
                      value: history.filter((r) => r.status === "sent").length,
                      color: "#10b981",
                    },
                    {
                      label: isRTL ? "مجدول" : "Scheduled",
                      value: history.filter((r) => r.status === "scheduled").length,
                      color: "#f59e0b",
                    },
                    {
                      label: isRTL ? "فاشل" : "Failed",
                      value: history.filter((r) => r.status === "failed").length,
                      color: "#f87171",
                    },
                    {
                      label: isRTL ? "فترة الانتظار" : "Cooldown",
                      value: `${settingCooldown}s`,
                      color: "#06b6d4",
                    },
                  ].map((stat, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-[#1e2d3d] bg-[#0d1420] p-3 text-center"
                    >
                      <p
                        className="text-xl font-bold"
                        style={{ color: stat.color }}
                      >
                        {stat.value}
                      </p>
                      <p className="mt-1 text-[11px] text-[#64748b]">
                        {stat.label}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
