import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react";
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
  Users,
  Check,
  AlertCircle,
  Loader2,
  Timer,
  ArrowDownUp,
  RotateCcw,
  FileText,
  Download,
  Youtube,
  ExternalLink,
} from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useShowNotification } from "@/components/NotificationCenter";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bilingual } from "@/lib/i18n";
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

/**
 * ✅ ROOT FIX (dashboard audit): the old composer offered "enrollment" /
 * "update" / "custom" notification types — the backend `admin.sendBroadcast`
 * z.enum REJECTS all three ("promo" | "system" | "lesson" | "file" |
 * "software" | "youtube"), which is exactly why Admin.tsx used to hardcode
 * `type: "promo"` and silently ignore whatever the admin picked. The composer
 * now speaks the SERVER's vocabulary, so the selected type actually lands in
 * the stored notification.
 */
type NotificationType =
  | "promo"
  | "system"
  | "lesson"
  | "file"
  | "software"
  | "youtube";

export type BroadcastType = NotificationType;

export interface AdminNotificationPanelProps {
  /**
   * Ship the composed notification to the server. ROOT FIX: this is now
   * awaited — the success toast / history refresh only happen once the
   * backend CONFIRMS the broadcast. The old panel showed "sent successfully"
   * immediately, even when the mutation failed.
   */
  readonly onSend?: (notification: {
    readonly type: NotificationType;
    readonly title: string;
    readonly message: string;
    /** Optional click-through target (relative path or http(s) URL). */
    readonly url?: string;
    readonly titleAr?: string;
    readonly titleEn?: string;
    readonly messageAr?: string;
    readonly messageEn?: string;
  }) => Promise<unknown> | void;
}

/** One broadcast row as stored by the server (notifications table). */
interface BroadcastRecord {
  readonly id: string;
  readonly type: NotificationType;
  readonly titleAr: string;
  readonly titleEn: string;
  readonly messageAr: string;
  readonly messageEn: string;
  readonly url: string | null;
  readonly sentAt: number;
}

interface FormErrors {
  titleEn?: string;
  titleAr?: string;
  messageEn?: string;
  messageAr?: string;
  url?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════════

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 500;
/** Mirrors the server's `url` refine: relative path or http(s) only. */
const URL_MAX = 700;
const DEFAULT_COOLDOWN = 60;

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
  promo: {
    icon: <Gift className="h-4 w-4" />,
    color: "text-[#f59e0b]",
    bg: "bg-[rgba(245,158,11,0.1)]",
    labelEn: "Promo / Announcement",
    labelAr: "عرض / إعلان",
    descriptionEn: "Promotional offers and general announcements",
    descriptionAr: "العروض الترويجية والإعلانات العامة",
    toastType: "promo",
  },
  system: {
    icon: <Sparkles className="h-4 w-4" />,
    color: "text-[#10b981]",
    bg: "bg-[rgba(16,185,129,0.1)]",
    labelEn: "System Notice",
    labelAr: "إشعار نظامي",
    descriptionEn: "Platform updates, maintenance windows, new features",
    descriptionAr: "تحديثات المنصة أو الصيانة أو الميزات الجديدة",
    toastType: "update",
  },
  lesson: {
    icon: <BookOpen className="h-4 w-4" />,
    color: "text-[#06b6d4]",
    bg: "bg-[rgba(6,182,212,0.1)]",
    labelEn: "New Lesson",
    labelAr: "درس جديد",
    descriptionEn: "New course episode just landed",
    descriptionAr: "إضافة درس جديد لأحد الكورسات",
    toastType: "enrollment",
  },
  file: {
    icon: <FileText className="h-4 w-4" />,
    color: "text-[#818cf8]",
    bg: "bg-[rgba(129,140,248,0.1)]",
    labelEn: "New File",
    labelAr: "ملف جديد",
    descriptionEn: "New reference / library file available",
    descriptionAr: "توافر ملف أو مرجع جديد في المكتبة",
    toastType: "info",
  },
  software: {
    icon: <Download className="h-4 w-4" />,
    color: "text-[#a78bfa]",
    bg: "bg-[rgba(167,139,250,0.1)]",
    labelEn: "New Software",
    labelAr: "برنامج جديد",
    descriptionEn: "New software entry in the downloads section",
    descriptionAr: "إضافة برنامج جديد في قسم التحميلات",
    toastType: "info",
  },
  youtube: {
    icon: <Youtube className="h-4 w-4" />,
    color: "text-[#f87171]",
    bg: "bg-[rgba(248,113,113,0.1)]",
    labelEn: "YouTube Video",
    labelAr: "فيديو يوتيوب",
    descriptionEn: "New episode detected on the YouTube channel",
    descriptionAr: "فيديو جديد على قناة يوتيوب",
    toastType: "info",
  },
};

const NOTIFICATION_TYPES = Object.keys(NOTIFICATION_TYPE_CONFIG) as NotificationType[];

function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && (NOTIFICATION_TYPES as string[]).includes(value);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function formatDateTime(iso: string | number, lang: "en" | "ar"): string {
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
    return String(iso);
  }
}

/**
 * Map a server broadcast row (admin.broadcastHistory → notifications table)
 * into the component's record shape. Arabic is the primary display (matches
 * pushNotification: `title`/`message` are Arabic-first, English lives in
 * data.en).
 */
function mapServerBroadcast(row: {
  eventId: string;
  type: unknown;
  title: string;
  message: string;
  url: string | null;
  en: { title?: string; message?: string } | null;
  createdAt: string | Date;
}): BroadcastRecord | null {
  if (!isNotificationType(row.type)) return null;
  return {
    id: row.eventId,
    type: row.type,
    titleAr: row.title,
    titleEn: row.en?.title || row.title,
    messageAr: row.message,
    messageEn: row.en?.message || "",
    url: row.url ?? null,
    sentAt:
      row.createdAt instanceof Date
        ? row.createdAt.getTime()
        : new Date(row.createdAt).getTime(),
  };
}

/** Server-side validation twin: relative path or http(s) URL. */
function isValidLinkUrl(value: string): boolean {
  return value.startsWith("/") || /^https?:\/\//i.test(value);
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
  readonly current: number;
  readonly min: number;
  readonly max: number;
}) {
  const isOver = current > max;
  const isUnder = current > 0 && current < min;
  const innerColor = isUnder ? "text-[#f59e0b]" : "text-[#64748b]";
  const color = isOver ? "text-[#f87171]" : innerColor;
  return (
    <span className={`text-[11px] tabular-nums ${color}`}>
      {current}/{max}
    </span>
  );
}

/** Inline validation message. */
function FieldError({ message }: { readonly message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-[12px] text-[#f87171]">
      <AlertCircle className="h-3 w-3 shrink-0" />
      {message}
    </p>
  );
}

/** Inline success message. */
function FieldSuccess({ message }: { readonly message?: string }) {
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
  readonly remaining: number;
  readonly total: number;
  readonly isRTL: boolean;
}) {
  const pct = total > 0 ? (remaining / total) * 100 : 0;
  const circumference = 2 * Math.PI * 16;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#1e2d3d] bg-[#0d1420] px-4 py-3">
      <div className="relative h-10 w-10 shrink-0">
        <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36" role="img" aria-hidden="true">
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
  readonly type: NotificationType;
  readonly title: string;
  readonly message: string;
  readonly isVisible: boolean;
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
          {title || cfg.labelEn}
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

/** Single row in the history list (server-backed — read-only audit trail). */
function HistoryRow({
  record,
  lang,
}: {
  readonly record: BroadcastRecord;
  readonly lang: "en" | "ar";
}) {
  const isRTL = lang === "ar";
  const cfg = NOTIFICATION_TYPE_CONFIG[record.type];

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
          <Badge className="border-0 bg-[rgba(16,185,129,0.12)] text-[10px] text-[#10b981]">
            {bilingual("تم الإرسال", "Sent", isRTL)}
          </Badge>
        </div>
        <p className="mt-0.5 line-clamp-1 text-[12px] text-[#64748b]">
          {isRTL ? record.messageAr : record.messageEn}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[#475569]">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {bilingual("جميع المستخدمين", "All Users", isRTL)}
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDateTime(record.sentAt, lang)}
          </span>
          {record.url && (
            <>
              <span>•</span>
              <span className="flex max-w-[220px] items-center gap-1 truncate" dir="ltr">
                <ExternalLink className="h-3 w-3 shrink-0" />
                {record.url}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Empty state for history. */
function EmptyHistory({
  lang,
  error,
}: {
  readonly lang: "en" | "ar";
  readonly error?: boolean;
}) {
  const isRTL = lang === "ar";
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(148,163,184,0.06)]">
        <History className="h-7 w-7 text-[#475569]" />
      </div>
      <p className="text-[14px] font-semibold text-[#94a3b8]">
        {error
          ? isRTL
            ? "تعذر تحميل السجل من السيرفر"
            : "Could not load history from the server"
          : isRTL
            ? "لا توجد إشعارات مرسلة"
            : "No notifications sent"}
      </p>
      <p className="mt-1 max-w-[260px] text-[12px] text-[#475569]">
        {error
          ? isRTL
            ? "تأكد من الاتصال ثم أعد المحاولة"
            : "Check connectivity and try again"
          : isRTL
            ? "كل إشعار تبثه يظهر هنا مباشرة من السيرفر"
            : "Every broadcast you send appears here straight from the server"}
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════════

export default function AdminNotificationPanel({ // NOSONAR — admin broadcast composer; the form state is tightly coupled to the honest-send flow
  onSend,
}: AdminNotificationPanelProps) {
  const { lang } = useTranslation();
  const { showNotification } = useShowNotification();
  const isRTL = lang === "ar";

  // ─── Form state ───
  const [type, setType] = useState<NotificationType>("promo");
  const [titleEn, setTitleEn] = useState("");
  const [titleAr, setTitleAr] = useState("");
  const [messageEn, setMessageEn] = useState("");
  const [messageAr, setMessageAr] = useState("");
  const [url, setUrl] = useState("");
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
  const [historyFilter, setHistoryFilter] = useState<NotificationType | "all">("all");

  // ─── Settings state ───
  const [settingCooldown, setSettingCooldown] = useState(DEFAULT_COOLDOWN);

  /**
   * ✅ ROOT FIX: the History tab now reads SERVER truth
   * (notifications table via admin.broadcastHistory) instead of a
   * localStorage list that claimed "sent/scheduled" without the backend
   * ever confirming anything. Broadcasts persist ~30 days server-side.
   */
  const broadcastHistory = trpc.admin.broadcastHistory.useQuery(undefined);

  const records = useMemo<BroadcastRecord[]>(
    () =>
      (broadcastHistory.data ?? [])
        .map(mapServerBroadcast)
        .filter((r): r is BroadcastRecord => r !== null),
    [broadcastHistory.data],
  );

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

    const validateTextField = (
      value: string,
      field: keyof FormErrors,
      labels: { required: string; tooShort: string; tooLong: string },
      min: number,
      max: number,
    ): void => {
      const trimmed = value.trim();
      if (!trimmed) {
        next[field] = labels.required;
        valid = false;
      } else if (trimmed.length < min) {
        next[field] = labels.tooShort;
        valid = false;
      } else if (value.length > max) {
        next[field] = labels.tooLong;
        valid = false;
      }
    };

    // English title
    validateTextField(titleEn, "titleEn", {
      required: isRTL ? "العنوان الإنجليزي مطلوب" : "English title is required",
      tooShort: isRTL ? `يجب أن يكون العنوان ${TITLE_MIN} أحرف على الأقل` : `Title must be at least ${TITLE_MIN} characters`,
      tooLong: isRTL ? `يجب ألا يتجاوز العنوان ${TITLE_MAX} حرفًا` : `Title must not exceed ${TITLE_MAX} characters`,
    }, TITLE_MIN, TITLE_MAX);

    // Arabic title
    validateTextField(titleAr, "titleAr", {
      required: isRTL ? "العنوان العربي مطلوب" : "Arabic title is required",
      tooShort: isRTL ? `يجب أن يكون العنوان ${TITLE_MIN} أحرف على الأقل` : `Title must be at least ${TITLE_MIN} characters`,
      tooLong: isRTL ? `يجب ألا يتجاوز العنوان ${TITLE_MAX} حرفًا` : `Title must not exceed ${TITLE_MAX} characters`,
    }, TITLE_MIN, TITLE_MAX);

    // English message
    validateTextField(messageEn, "messageEn", {
      required: isRTL ? "الرسالة الإنجليزية مطلوبة" : "English message is required",
      tooShort: isRTL ? `يجب أن تكون الرسالة ${MESSAGE_MIN} أحرف على الأقل` : `Message must be at least ${MESSAGE_MIN} characters`,
      tooLong: isRTL ? `يجب ألا تتجاوز الرسالة ${MESSAGE_MAX} حرفًا` : `Message must not exceed ${MESSAGE_MAX} characters`,
    }, MESSAGE_MIN, MESSAGE_MAX);

    // Arabic message
    validateTextField(messageAr, "messageAr", {
      required: isRTL ? "الرسالة العربية مطلوبة" : "Arabic message is required",
      tooShort: isRTL ? `يجب أن تكون الرسالة ${MESSAGE_MIN} أحرف على الأقل` : `Message must be at least ${MESSAGE_MIN} characters`,
      tooLong: isRTL ? `يجب ألا تتجاوز الرسالة ${MESSAGE_MAX} حرفًا` : `Message must not exceed ${MESSAGE_MAX} characters`,
    }, MESSAGE_MIN, MESSAGE_MAX);

    // Optional link — mirrors the server's z.refine exactly so the admin
    // never hits a server rejection the form could have caught locally.
    const trimmedUrl = url.trim();
    if (trimmedUrl) {
      if (trimmedUrl.length > URL_MAX) {
        next.url = isRTL
          ? `يجب ألا يتجاوز الرابط ${URL_MAX} حرفًا`
          : `Link must not exceed ${URL_MAX} characters`;
        valid = false;
      } else if (!isValidLinkUrl(trimmedUrl)) {
        next.url = isRTL
          ? "الرابط يجب أن يكون مسارًا داخليًا يبدأ بـ / أو رابط http(s)"
          : "Link must be a relative path starting with / or an http(s) URL";
        valid = false;
      }
    }

    setErrors(next);
    return valid;
  }, [titleEn, titleAr, messageEn, messageAr, url, isRTL]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Reset form
  // ═══════════════════════════════════════════════════════════════════════════

  const resetForm = useCallback(() => {
    setType("promo");
    setTitleEn("");
    setTitleAr("");
    setMessageEn("");
    setMessageAr("");
    setUrl("");
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
  // Send notification — HONEST flow: success only after the server confirms
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSend = useCallback(async () => { // NOSONAR — one honest send path: validate → await server → feedback
    if (cooldownRemaining > 0) return;
    if (!validate()) return;

    setIsSending(true);
    setSuccessMessage("");

    const trimmedUrl = url.trim();
    const payload = {
      type,
      title: isRTL ? titleAr.trim() : titleEn.trim(),
      message: isRTL ? messageAr.trim() : messageEn.trim(),
      url: trimmedUrl || undefined,
      titleAr: titleAr.trim(),
      titleEn: titleEn.trim(),
      messageAr: messageAr.trim(),
      messageEn: messageEn.trim(),
    };

    try {
      // ✅ ROOT FIX: the send is now genuinely awaited. The old panel fired
      // "تم الإرسال بنجاح" unconditionally — even when the mutation failed.
      await onSend?.(payload);

      // Server confirmed — only NOW is success shown anywhere.
      const cfg = NOTIFICATION_TYPE_CONFIG[type];
      showNotification({
        type: cfg.toastType,
        title: isRTL ? "تم الإرسال بنجاح" : "Notification Sent",
        message: isRTL
          ? `تم بث "${payload.titleAr}" لكل المستخدمين المسجلين`
          : `"${payload.titleEn}" broadcast to all registered users`,
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

      // Refresh the server-backed history so the row appears immediately.
      void broadcastHistory.refetch();

      // Reset form after short delay so user sees the success
      setTimeout(() => resetForm(), 2000);
    } catch (err) {
      showNotification({
        type: "info",
        title: isRTL ? "فشل إرسال الإشعار" : "Send failed",
        message: err instanceof Error && err.message
          ? err.message
          : isRTL
            ? "حدث خطأ غير متوقع — لم يتم الإرسال"
            : "Unexpected error — nothing was sent",
        duration: 6000,
      });
    } finally {
      setIsSending(false);
    }
  }, [
    cooldownRemaining,
    validate,
    type,
    titleEn,
    titleAr,
    messageEn,
    messageAr,
    url,
    isRTL,
    onSend,
    showNotification,
    settingCooldown,
    broadcastHistory,
    resetForm,
  ]);

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
  const filteredHistory =
    historyFilter === "all"
      ? records
      : records.filter((r) => r.type === historyFilter);
  const isOnCooldown = cooldownRemaining > 0;
  const isFormEmpty =
    !titleEn && !titleAr && !messageEn && !messageAr;
  const previewTitle = isRTL ? titleAr : titleEn;
  const previewMessage = isRTL ? messageAr : messageEn;

  const idleSendIcon = isOnCooldown ? (
    <Timer className={`h-4 w-4 ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
  ) : (
    <Send className={`h-4 w-4 ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
  );
  const idleSendLabel = isOnCooldown
    ? `${cooldownRemaining}s`
    : bilingual("إرسال الإشعار", "Send Notification", isRTL);
  const sendingLabel = isRTL ? "جاري الإرسال..." : "Sending...";
  const sendButtonLabel = isSending ? sendingLabel : idleSendLabel;

  const readyStatusBadge = (
    <Badge className="border-0 bg-[rgba(16,185,129,0.12)] text-[10px] text-[#10b981]">
      <Check className={`h-3 w-3 ${isRTL ? "ml-1" : "mr-1"}`} />
      {isRTL ? "جاهز" : "Ready"}
    </Badge>
  );
  const emptyStatusBadge = isFormEmpty ? (
    <Badge variant="outline" className="border-[#1e2d3d] text-[10px] text-[#64748b]">
      {isRTL ? "فارغ" : "Empty"}
    </Badge>
  ) : readyStatusBadge;
  const errorStatusBadge = Object.values(errors).some(Boolean) ? (
    <Badge className="border-0 bg-[rgba(248,113,113,0.12)] text-[10px] text-[#f87171]">
      <AlertCircle className={`h-3 w-3 ${isRTL ? "ml-1" : "mr-1"}`} />
      {isRTL ? "أخطاء" : "Errors"}
    </Badge>
  ) : emptyStatusBadge;
  const formStatusBadge = isOnCooldown ? (
    <Badge className="border-0 bg-[rgba(245,158,11,0.12)] text-[10px] text-[#f59e0b]">
      <Timer className={`h-3 w-3 ${isRTL ? "ml-1" : "mr-1"}`} />
      {isRTL ? "انتظار" : "Cooldown"}
    </Badge>
  ) : errorStatusBadge;

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
              ? "بث إشعارات حقيقية لكل المستخدمين — تسجيل من السيرفر"
              : "Broadcast real notifications to all users — server-backed log"}
          </p>
        </div>
        <Badge
          variant="outline"
          className="border-[rgba(6,182,212,0.25)] text-[12px] text-[#06b6d4]"
        >
          {records.length}{" "}
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
                      ? "النوع يُحفظ في الإشعار نفسه ويحدد شكله عند المستخدم"
                      : "The type is stored on the notification and shapes how users see it"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 pt-4 sm:grid-cols-3">
                  {NOTIFICATION_TYPES.map((nt) => {
                    const cfg = NOTIFICATION_TYPE_CONFIG[nt];
                    const isSelected = type === nt;
                    return (
                      <button
                        key={nt}
                        type="button"
                        onClick={() => setType(nt)}
                        data-testid={`notif-type-${nt}`}
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
                  })}
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
                    placeholder="أدخل العنوان بالعربية..."
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
                    placeholder="اكتب الرسالة بالعربية..."
                    dir="rtl"
                    rows={4}
                    className={`min-h-[100px] border-[#1e2d3d] bg-[#0d1420] text-[#e8f0fe] placeholder:text-[#475569] ${
                      errors.messageAr ? "border-[#f87171] focus-visible:border-[#f87171] focus-visible:ring-[#f87171]/30" : ""
                    }`}
                  />
                  <FieldError message={errors.messageAr} />
                </div>
              </div>

              {/* ── Optional click-through link ── */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[#94a3b8]">
                    {isRTL ? "رابط الإشعار (اختياري)" : "Notification Link (optional)"}
                  </Label>
                  <CharCounter
                    current={url.trim().length}
                    min={0}
                    max={URL_MAX}
                  />
                </div>
                <Input
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setErrors((prev) => ({ ...prev, url: undefined }));
                    setSuccessMessage("");
                  }}
                  placeholder={isRTL ? "/courses/etap أو https://..." : "/courses/etap or https://..."}
                  dir="ltr"
                  className={`border-[#1e2d3d] bg-[#0d1420] text-[#e8f0fe] placeholder:text-[#475569] ${
                    errors.url ? "border-[#f87171] focus-visible:border-[#f87171] focus-visible:ring-[#f87171]/30" : ""
                  }`}
                />
                <FieldError message={errors.url} />
                <p className="text-[11px] text-[#475569]">
                  {isRTL
                    ? "عند ضغط المستخدم على الإشعار يفتح هذا الرابط — مسار داخلي يبدأ بـ / أو رابط http(s)"
                    : "Clicking the notification opens this link — a relative path starting with / or an http(s) URL"}
                </p>
              </div>

              {/* ── Recipients (honest contract) ── */}
              <Card className="border-[#1e2d3d] bg-[#111827] py-4">
                <CardContent className="pt-0">
                  <div className="flex items-center gap-3 rounded-lg border border-[rgba(6,182,212,0.15)] bg-[rgba(6,182,212,0.05)] px-3 py-2.5">
                    <span className="text-[#06b6d4]">
                      <Users className="h-4 w-4" />
                    </span>
                    <span className="text-[12px] text-[#94a3b8]">
                      {isRTL ? "سيتم البث إلى: " : "Will broadcast to: "}
                      <span className="font-semibold text-[#06b6d4]">
                        {isRTL
                          ? "جميع المستخدمين المسجلين"
                          : "All registered users"}
                      </span>
                      <span className="ms-1 text-[#64748b]">
                        {isRTL
                          ? "— داخل التطبيق + Web Push + قناة تليجرام"
                          : "— in-app bell + Web Push + Telegram channel"}
                      </span>
                    </span>
                  </div>
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
                    data-testid="notif-send"
                    className="bg-[#06b6d4] text-[#070b12] hover:bg-[#22d3ee] disabled:opacity-50"
                  >
                    {isSending ? (
                      <Loader2 className={`h-4 w-4 animate-spin ${isRTL ? "ml-1.5" : "mr-1.5"}`} />
                    ) : idleSendIcon}
                    {sendButtonLabel}
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
                    {isRTL ? typeConfig.descriptionAr : typeConfig.descriptionEn}
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
                        <Users className="h-3 w-3" />
                        {isRTL
                          ? "جميع المستخدمين المسجلين"
                          : "All registered users"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[#64748b]">
                        {isRTL ? "التوقيت" : "Timing"}
                      </span>
                      <span className="flex items-center gap-1 text-[#10b981]">
                        <Clock className="h-3 w-3" />
                        {bilingual("فوري", "Immediate", isRTL)}
                      </span>
                    </div>

                    <div className="border-t border-[#1e2d3d] pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[#64748b]">
                          {isRTL ? "الحالة" : "Status"}
                        </span>
                        {formStatusBadge}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 2 — History (server truth)
        ═══════════════════════════════════════════════════════════════════ */}
        <TabsContent value="history" className="mt-6">
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[15px] font-semibold text-[#e8f0fe]">
                  {isRTL ? "سجل البث (من السيرفر)" : "Broadcast History (server)"}
                </h3>
                <p className="text-[12px] text-[#64748b]">
                  {isRTL
                    ? `${records.length} إشعار مُبث — يُحفظ على السيرفر حوالي 30 يومًا`
                    : `${records.length} broadcasts — stored server-side for ~30 days`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Filter */}
                <select
                  value={historyFilter}
                  onChange={(e) =>
                    setHistoryFilter(e.target.value as NotificationType | "all")
                  }
                  aria-label={isRTL ? "تصفية حسب النوع" : "Filter by type"}
                  className="h-9 w-[160px] rounded-md border border-[#1e2d3d] bg-[#111827] px-2 text-[12px] text-[#e8f0fe]"
                >
                  <option value="all">{isRTL ? "الكل" : "All Types"}</option>
                  {NOTIFICATION_TYPES.map((nt) => (
                    <option key={nt} value={nt}>
                      {isRTL
                        ? NOTIFICATION_TYPE_CONFIG[nt].labelAr
                        : NOTIFICATION_TYPE_CONFIG[nt].labelEn}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* List */}
            {broadcastHistory.isLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-[#1e2d3d] bg-[#070b12] py-16 text-[13px] text-[#94a3b8]">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isRTL ? "جاري تحميل السجل..." : "Loading history..."}
              </div>
            ) : broadcastHistory.isError ? (
              <div className="rounded-xl border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.05)]">
                <EmptyHistory lang={lang} error />
                <div className="flex justify-center pb-6">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void broadcastHistory.refetch()}
                    className="border-[#1e2d3d] text-[#94a3b8] hover:bg-[#1e2d3d]"
                  >
                    {isRTL ? "إعادة المحاولة" : "Retry"}
                  </Button>
                </div>
              </div>
            ) : filteredHistory.length === 0 ? (
              <EmptyHistory lang={lang} />
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-y-auto rounded-xl border border-[#1e2d3d] bg-[#070b12] p-2">
                {filteredHistory.map((record) => (
                  <HistoryRow key={record.id} record={record} lang={lang} />
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
                          const val = Number.parseInt(e.target.value, 10);
                          if (!Number.isNaN(val)) {
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
                      icon: <Gift className="h-4 w-4 text-[#f59e0b]" />,
                      labelEn: "Default Type",
                      labelAr: "النوع الافتراضي",
                      valueEn: "Promo / Announcement",
                      valueAr: "عرض / إعلان",
                    },
                    {
                      icon: <Users className="h-4 w-4 text-[#94a3b8]" />,
                      labelEn: "Default Recipients",
                      labelAr: "المستلمون الافتراضيون",
                      valueEn: "All registered users",
                      valueAr: "جميع المستخدمين المسجلين",
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
                  ].map((item) => (
                    <div
                      key={item.labelEn || item.labelAr}
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
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: isRTL ? "إجمالي المبثق (سيرفر)" : "Total Broadcasts (server)",
                      value: records.length,
                      color: "#10b981",
                    },
                    {
                      label: isRTL ? "فترة الانتظار" : "Cooldown",
                      value: `${settingCooldown}s`,
                      color: "#06b6d4",
                    },
                  ].map((stat) => (
                    <div
                      key={stat.label}
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
