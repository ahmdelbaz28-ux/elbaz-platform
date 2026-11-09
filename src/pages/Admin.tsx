import { useEffect, useState, useRef, type CSSProperties } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { motion, AnimatePresence } from "framer-motion";
import "@/elite-animations.css";
import {
  LayoutDashboard, Users, BookOpen, Headphones, DollarSign, Phone, FileText, Palette, Tag, Megaphone, Bot, Bell,
  Plus, Pencil, Trash2, Save, Eye, Zap, TrendingUp, CheckCircle, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
  LogOut, ArrowUpRight, Shield, PlayCircle, Newspaper, X, Menu, MessageSquareText, ThumbsUp, ThumbsDown, Download,
  Youtube, Loader2, ListVideo,
  CalendarDays, ExternalLink, RefreshCw, ImageOff,
  FolderTree, ListChecks, UserPlus, UserMinus, RotateCcw, GraduationCap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { AiProvidersPanel } from "@/components/admin/AiProvidersPanel";
import AdminNotificationPanel from "@/components/AdminNotificationPanel";
import { extractYouTubeId, buildYouTubeThumbnailUrl } from "@/lib/youtube-url";
import { bilingual } from "@/lib/i18n";

interface SettingItem { id?: string; key: string; value: string; section: string; type?: string; }
interface ThemeItem { id: string; name: string; primaryColor: string; secondaryColor: string; accentColor: string; bgColor: string; textColor: string; cardBgColor: string; borderColor: string; isActive: boolean; createdAt: string; }

/** Rows of the channel's YouTube playlist for the lesson-import dialog.
 *  OWNER RULE: this list mirrors YouTube exactly — only videos that really
 *  exist there (server drops placeholders + verifies via oEmbed) and ONLY
 *  their exact YouTube titles; picking a row fills BOTH the link and the
 *  verbatim title, so a hand-invented name can never reach a lesson. */
function PlaylistImportList({ isRTL, onPick }: { readonly isRTL: boolean; readonly onPick: (picked: { watchUrl: string; title: string }) => void }) {
  const { data, isLoading, isError } = trpc.admin.youtubePlaylistVideos.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">{isRTL ? "جاري جلب البلايليست..." : "Fetching the playlist..."}</span>
      </div>
    );
  }

  if (isError || data?.error) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {isRTL ? "تعذّر جلب البلايليست — جرّب تاني بعد شوية" : "Couldn't fetch the playlist — try again shortly"}
      </p>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-text-muted">
        {isRTL ? "البلايليست فاضية أو مش متاحة حالياً" : "The playlist is empty or currently unavailable"}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {data && data.verified === false && (
        <p className="rounded-lg border border-amber-500/30 bg-[rgba(245,158,11,0.08)] px-3 py-2 text-[11px] leading-relaxed text-amber-400">
          {isRTL
            ? "تعذّر التحقق النهائي من يوتيوب الآن (شبكة) — القائمة من مصادر يوتيوب مباشرة وبدون الفيديوهات غير المتاحة، بس مش مؤكّدة 100%"
            : "Live YouTube verification unavailable right now — list comes straight from YouTube sources without unavailable videos, but is not 100% confirmed"}
        </p>
      )}
      <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
        {items.map((item: { videoId: string; title: string; watchUrl: string; thumbnailUrl: string }) => (
          <button
            key={item.videoId}
            type="button"
            dir={isRTL ? "rtl" : "ltr"}
            onClick={() => onPick({ watchUrl: item.watchUrl, title: item.title })}
            className="flex w-full items-center gap-3 rounded-lg border border-border bg-background p-2 text-start transition-colors hover:bg-[rgba(6,182,212,0.06)]"
          >
            <img
              src={item.thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-11 w-20 shrink-0 rounded-md object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-foreground">{item.title}</span>
              <span dir="ltr" className="block truncate font-mono text-[10px] text-text-muted">{item.videoId}</span>
            </span>
            <span className="shrink-0 rounded-md bg-[rgba(6,182,212,0.12)] px-2 py-1 text-[10px] font-bold text-[#22d3ee]">
              {isRTL ? "اختيار" : "Pick"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
interface PromoItem { id: string; code: string; discount: number; type: "percentage" | "fixed"; maxUses: number; usedCount: number; status: "active" | "expired" | "used_up"; validFrom: string; validUntil: string; createdAt: string; }
interface PromotionItem { id: string; titleEn: string; titleAr: string; subtitleEn: string; subtitleAr: string; discountText: string; ctaTextEn: string; ctaTextAr: string; ctaUrl: string; startDate: string; endDate: string; bgColor: string; textColor: string; buttonColor: string; position: "top" | "bottom"; showCountdown: boolean; isActive: boolean; createdAt: string; }
interface CourseItem { id: number; slug: string; titleEn: string; titleAr: string; descriptionEn: string | null; descriptionAr: string | null; shortDescEn?: string | null; shortDescAr?: string | null; thumbnailUrl: string | null; price: number; currency: string; isFeatured: boolean; isPublished: boolean; level: string; category: number | null; studentCount: number; createdAt: Date; updatedAt: Date; }
interface LessonItem { id: number; courseId: number; titleEn: string; titleAr: string; descriptionEn: string | null; descriptionAr: string | null; videoUrl: string | null; durationMinutes: number | null; sortOrder: number; isFree: boolean; isPublished: boolean; }
interface CategoryItem { id: number; slug: string; nameEn: string; nameAr: string; icon?: string; sortOrder?: number; }
interface ArticleRow { id: number; slug: string; titleAr: string; titleEn: string; excerptAr: string | null; excerptEn: string | null; contentAr: string; contentEn: string | null; coverImage: string | null; category: string; tags: string | null; authorName: string | null; isPublished: boolean; viewCount: number; readMinutes: number; sortOrder: number; publishedAt: Date | string | null; createdAt: Date; updatedAt: Date; }
const emptyArticleForm = { id: 0, slug: "", titleAr: "", titleEn: "", excerptAr: "", excerptEn: "", contentAr: "", coverImage: "", category: "كهرباء القوى", tags: "", isPublished: false };

const CMS_SECTIONS: Record<string, { labelEn: string; labelAr: string; keys: string[] }> = {
  hero: { labelEn: "Hero Section", labelAr: "قسم البطل", keys: ["titleEn", "titleAr", "subtitleEn", "subtitleAr", "ctaTextEn", "ctaTextAr", "backgroundImage"] },
  features: { labelEn: "Features Section", labelAr: "قسم المميزات", keys: ["feature1TitleEn", "feature1DescEn", "feature1Icon", "feature2TitleEn", "feature2DescEn", "feature2Icon", "feature3TitleEn", "feature3DescEn", "feature3Icon", "feature4TitleEn", "feature4DescEn", "feature4Icon"] },
  instructor: { labelEn: "Instructor Section", labelAr: "قسم المدرب", keys: ["name", "title", "bioEn", "bioAr", "avatarUrl"] },
  footer: { labelEn: "Footer", labelAr: "التذييل", keys: ["copyrightText", "facebookUrl", "instagramUrl", "youtubeUrl", "linkedinUrl"] },
  cta: { labelEn: "CTA Section", labelAr: "قسم الدعوة للإجراء", keys: ["titleEn", "titleAr", "subtitleEn", "subtitleAr"] },
};

function inferSettingType(key: string): "text" | "textarea" | "color" | "url" {
  const lk = key.toLowerCase();
  if (lk.includes("color")) return "color";
  if (lk.includes("url") || lk.includes("image") || lk.includes("avatar") || lk.includes("link")) return "url";
  if (lk.includes("bio") || lk.includes("desc") || lk.includes("subtitle")) return "textarea";
  return "text";
}

const SIDEBAR_ITEMS = [
  { id: "dashboard", icon: LayoutDashboard, labelEn: "Dashboard", labelAr: "لوحة التحكم" },
  { id: "users", icon: Users, labelEn: "Users", labelAr: "المستخدمين" },
  { id: "courses", icon: BookOpen, labelEn: "Courses", labelAr: "الكورسات" },
  { id: "articles", icon: Newspaper, labelEn: "Articles", labelAr: "المقالات" },
  { id: "tickets", icon: Headphones, labelEn: "Tickets", labelAr: "التذاكر" },
  { id: "payments", icon: DollarSign, labelEn: "Payments", labelAr: "المدفوعات" },
  { id: "ai", icon: Bot, labelEn: "AI Models", labelAr: "النماذج الذكية" },
  { id: "chatbot", icon: MessageSquareText, labelEn: "Chatbot", labelAr: "تقييمات الشات بوت" },
  { id: "contact", icon: Phone, labelEn: "Contact", labelAr: "التواصل" },
  { id: "cms", icon: FileText, labelEn: "CMS", labelAr: "المحتوى" },
  { id: "themes", icon: Palette, labelEn: "Themes", labelAr: "الثيمات" },
  { id: "promos", icon: Tag, labelEn: "Promo Codes", labelAr: "أكواد الخصم" },
  { id: "promotions", icon: Megaphone, labelEn: "Promotions", labelAr: "العروض" },
  { id: "notifications", icon: Bell, labelEn: "Notifications", labelAr: "الإشعارات" },
];

// Sidebar sections — grouped nav so 14 entries don't read as one flat wall.
const SIDEBAR_GROUPS: { labelAr: string; labelEn: string; ids: string[] }[] = [
  { labelAr: "عام", labelEn: "Overview", ids: ["dashboard"] },
  { labelAr: "الإدارة", labelEn: "Management", ids: ["users", "courses", "articles", "tickets", "payments"] },
  { labelAr: "المنصة", labelEn: "Platform", ids: ["ai", "chatbot", "contact", "cms", "themes"] },
  { labelAr: "التسويق", labelEn: "Marketing", ids: ["promos", "promotions", "notifications"] },
];

// Avatar colour cycle for the dashboard's newest-users list.
const AVATAR_COLORS = ["#06b6d4", "#10b981", "#f59e0b", "#8b5cf6", "#f43f5e", "#38bdf8"];

export default function Admin() { // NOSONAR — admin dashboard with many CMS/CMS-settings panels, user management, and conditional rendering; extraction would require prop-drilling 15+ hooks
  const { isAuthenticated, isAdmin, isLoading } = useAuth();
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Mobile: sidebar becomes an off-canvas drawer (slides from the side) instead of
  // a permanently visible column that squeezes the content on small screens.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Guards against accidental tab activation right after a drag-to-close gesture
  const adminDragGuard = useRef(false);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
      if (e.matches) setMobileSidebarOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Mobile drawer: lock body scroll + close on Escape
  useEffect(() => {
    if (isDesktop || !mobileSidebarOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileSidebarOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mobileSidebarOpen, isDesktop]);

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || !isAdmin)) navigate("/");
  }, [isLoading, isAuthenticated, isAdmin, navigate]);

  const utils = trpc.useUtils();
  const { data: stats } = trpc.admin.stats.useQuery(undefined, { enabled: !!isAdmin });
  const { data: analytics } = trpc.admin.analytics.useQuery(undefined, { enabled: !!isAdmin && activeTab === "dashboard" });
  // Also fetched on the dashboard tab — the overview's "Newest users" card reads it.
  const { data: usersData } = trpc.admin.users.useQuery(undefined, { enabled: !!isAdmin && (activeTab === "users" || activeTab === "dashboard") });
  const { data: coursesData } = trpc.admin.listCourses.useQuery(undefined, { enabled: !!isAdmin && activeTab === "courses" });
  const { data: allTickets } = trpc.admin.tickets.useQuery(undefined, { enabled: !!isAdmin && activeTab === "tickets" });
  const [feedbackRatingFilter, setFeedbackRatingFilter] = useState<"all" | "up" | "down">("all");
  const { data: chatbotFeedbackData, refetch: refetchChatbotFeedback } = trpc.admin.chatbotFeedback.useQuery(
    { limit: 100, rating: feedbackRatingFilter },
    { enabled: !!isAdmin && activeTab === "chatbot" }
  );
  // Also fetched on the dashboard tab — the overview's "Latest payments" card reads it.
  const { data: paymentsData } = trpc.admin.payments.useQuery(undefined, { enabled: !!isAdmin && (activeTab === "payments" || activeTab === "dashboard") });
  const { data: manualPayDetails, refetch: refetchManualPayDetails } = trpc.payment.manualDetails.useQuery(undefined, { enabled: !!isAdmin && activeTab === "payments" });
  const { data: paymobStatusAdmin } = trpc.payment.isConfigured.useQuery(undefined, { enabled: !!isAdmin && activeTab === "payments" });

  const updateTicket = trpc.admin.updateTicketStatus.useMutation({ onSuccess: () => { utils.admin.tickets.invalidate(); toast.success(lang === "en" ? "Ticket updated" : "تم تحديث التذكرة"); }, onError: (err) => toast.error(err.message) });
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const replyMutation = trpc.admin.replyTicket.useMutation({ onSuccess: () => { setReplyText(""); setReplyingTo(null); utils.admin.tickets.invalidate(); toast.success(lang === "en" ? "Reply sent" : "تم إرسال الرد"); }, onError: (err) => toast.error(err.message) });
  const updateUserRole = trpc.admin.updateUserRole.useMutation({ onSuccess: () => { utils.admin.users.invalidate(); toast.success(lang === "en" ? "Role updated" : "تم تحديث الدور"); }, onError: (err) => toast.error(err.message) });
  const updateCourse = trpc.admin.updateCourse.useMutation({ onSuccess: () => { utils.admin.listCourses.invalidate(); toast.success(lang === "en" ? "Course updated" : "تم تحديث الكورس"); }, onError: (err) => toast.error(err.message) });
  const { data: adminCategories } = trpc.course.categories.useQuery(undefined, { enabled: !!isAdmin && activeTab === "courses" });
  const createCourse = trpc.admin.createCourse.useMutation({ onSuccess: () => { utils.admin.listCourses.invalidate(); setShowCourseForm(false); toast.success(lang === "en" ? "Course created" : "تم إنشاء الكورس"); }, onError: (err) => toast.error(err.message) });
  const deleteCourse = trpc.admin.deleteCourse.useMutation({ onSuccess: () => { utils.admin.listCourses.invalidate(); toast.success(lang === "en" ? "Course deleted" : "تم حذف الكورس"); }, onError: (err) => toast.error(err.message) });
  // NOTE: lessonsCourse state must be declared BEFORE the listLessons useQuery below —
  // it previously lived after it, causing a TDZ ReferenceError that crashed the Admin page on every render.
  const [lessonsCourse, setLessonsCourse] = useState<CourseItem | null>(null);
  const { data: lessonsData } = trpc.admin.listLessons.useQuery({ courseId: lessonsCourse?.id ?? 0 }, { enabled: !!isAdmin && !!lessonsCourse });
  const createLesson = trpc.admin.createLesson.useMutation({ onSuccess: () => { utils.admin.listLessons.invalidate(); setShowLessonForm(false); toast.success(lang === "en" ? "Lesson added" : "تمت إضافة الدرس"); }, onError: (err) => toast.error(err.message) });
  const updateLesson = trpc.admin.updateLesson.useMutation({ onSuccess: () => { utils.admin.listLessons.invalidate(); setShowLessonForm(false); toast.success(lang === "en" ? "Lesson updated" : "تم تحديث الدرس"); }, onError: (err) => toast.error(err.message) });
  const deleteLesson = trpc.admin.deleteLesson.useMutation({ onSuccess: () => { utils.admin.listLessons.invalidate(); toast.success(lang === "en" ? "Lesson deleted" : "تم حذف الدرس"); }, onError: (err) => toast.error(err.message) });
  // OWNER RULE enforcement: lesson titles for YouTube videos must be the exact
  // title written on YouTube — this button pulls it live from YouTube (oEmbed)
  // and fills BOTH title fields verbatim, so no hand-invented title survives.
  const syncYouTubeTitle = trpc.admin.youtubeVideoTitle.useMutation({
    onSuccess: (data) => {
      const title = data.title;
      if (!title) {
        toast.error(isRTL ? "تعذّر جلب العنوان من يوتيوب — اتأكد إن الفيديو موجود ومتاح" : "Couldn't fetch the YouTube title — make sure the video exists and is available");
        return;
      }
      setLessonForm((f) => ({ ...f, titleAr: title, titleEn: title }));
      toast.success(isRTL ? "العنوان اتنسخ من يوتيوب حرفياً ✓" : "Title copied verbatim from YouTube ✓");
    },
    onError: (err) => toast.error(err.message),
  });
  // ── Full playlist control: reorder + bulk import ──
  const moveLesson = trpc.admin.moveLesson.useMutation({
    onSuccess: () => { utils.admin.listLessons.invalidate(); },
    onError: (err) => toast.error(err.message),
  });
  const importAllPlaylist = trpc.admin.importPlaylistVideos.useMutation({
    onSuccess: (res) => {
      utils.admin.listLessons.invalidate();
      if (res.created > 0) {
        toast.success(isRTL
          ? `اتضاف ${res.created} درس بعناوين يوتيوب الرسمية حرفياً ✓ (متخطّى ${res.skipped} موجود مسبقاً)`
          : `Imported ${res.created} lessons with exact YouTube titles ✓ (skipped ${res.skipped} already linked)`);
      } else {
        toast.info(isRTL ? "كل فيديوهات البلايليست مستوردة بالفعل — مفيش جديد" : "All playlist videos are already imported — nothing new");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  // ─── Playlist AUTO-SYNC engine (course mirrors the channel playlist) ───────
  // The watcher tick (15 min) applies the same oEmbed-verified import
  // automatically + re-titles drifted lessons + keeps the cover = first video.
  // This is the dashboard's control surface: status, manual sync, full-sync
  // cleanup, and the three policy toggles.
  const { data: ytSync, refetch: refetchYtSync } = trpc.admin.youtubeSyncStatus.useQuery(undefined, {
    enabled: !!isAdmin && activeTab === "courses",
    refetchInterval: 90_000, // stays honest while auto-import works in the background
  });
  const syncPlaylistNow = trpc.admin.syncPlaylistNow.useMutation({
    onSuccess: (summary) => {
      void refetchYtSync();
      utils.admin.listCourses.invalidate();
      utils.admin.listLessons.invalidate();
      if (summary.ok) {
        toast.success(
          lang === "en"
            ? `Synced: +${summary.added} added · ${summary.updated} retitled · ${summary.removed} removed${summary.coverUpdated ? " · cover updated" : ""}`
            : `تمت المزامنة: ${summary.added} إضافة · ${summary.updated} تحديث عنوان · ${summary.removed} حذف${summary.coverUpdated ? " · تحديث الغلاف" : ""}`,
        );
      } else {
        toast.error(summary.message ?? (lang === "en" ? "Playlist fetch failed — auto-retry runs every 15 min" : "فشل سحب البلاي ليست — الإعادة التلقائية كل 15 دقيقة"));
      }
    },
    onError: (err) => toast.error(err.message),
  });
  const updateSyncSettings = trpc.admin.updateYoutubeSyncSettings.useMutation({
    onSuccess: () => { void refetchYtSync(); toast.success(lang === "en" ? "Sync settings saved" : "تم حفظ إعدادات المزامنة"); },
    onError: (err) => toast.error(err.message),
  });
  const toggleSyncSetting = (key: "autoImport" | "autoImportFree" | "autoCover", value: boolean) => {
    if (!ytSync) return;
    updateSyncSettings.mutate({ [key]: value });
  };

  // ─── Categories manager (dashboard CRUD — previously SQL-only) ───
  const { data: adminCats, refetch: refetchAdminCats } = trpc.admin.adminCategories.useQuery(undefined, { enabled: !!isAdmin && activeTab === "courses" });
  const [showCats, setShowCats] = useState(false);
  interface CatItem { id: number; slug: string; nameEn: string; nameAr: string; icon: string; sortOrder: number; courseCount: number; }
  const [catForm, setCatForm] = useState<{ id?: number; slug: string; nameEn: string; nameAr: string; icon: string; sortOrder: number }>({ slug: "", nameEn: "", nameAr: "", icon: "book", sortOrder: 0 });
  const invalidateCatCaches = () => { void refetchAdminCats(); utils.course.categories.invalidate(); utils.admin.listCourses.invalidate(); };
  const createCategory = trpc.admin.createCategory.useMutation({ onSuccess: () => { invalidateCatCaches(); setShowCats(false); toast.success(lang === "en" ? "Category created" : "تم إنشاء التصنيف"); }, onError: (err) => toast.error(err.message) });
  const updateCategory = trpc.admin.updateCategory.useMutation({ onSuccess: () => { invalidateCatCaches(); setShowCats(false); toast.success(lang === "en" ? "Category updated" : "تم تحديث التصنيف"); }, onError: (err) => toast.error(err.message) });
  const deleteCategory = trpc.admin.deleteCategory.useMutation({ onSuccess: () => { invalidateCatCaches(); toast.success(lang === "en" ? "Category deleted" : "تم حذف التصنيف"); }, onError: (err) => toast.error(err.message) });
  const submitCatForm = () => {
    if (!catForm.nameEn.trim() || !catForm.nameAr.trim()) { toast.error(isRTL ? "الاسمان مطلوبان" : "Both names are required"); return; }
    if (catForm.id) {
      updateCategory.mutate({ id: catForm.id, nameEn: catForm.nameEn.trim(), nameAr: catForm.nameAr.trim(), icon: catForm.icon.trim() || "book", sortOrder: catForm.sortOrder });
    } else {
      const slug = catForm.slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!slug) { toast.error(isRTL ? "أدخل معرفاً لاتينياً صالحاً" : "Enter a valid latin slug"); return; }
      createCategory.mutate({ slug, nameEn: catForm.nameEn.trim(), nameAr: catForm.nameAr.trim(), icon: catForm.icon.trim() || "book", sortOrder: catForm.sortOrder });
    }
  };

  // ─── Quiz question bank (per lesson — previously no write path at all) ───
  const [quizLesson, setQuizLesson] = useState<LessonItem | null>(null);
  const { data: quizData, refetch: refetchQuiz } = trpc.admin.adminQuizByLesson.useQuery(
    { lessonId: quizLesson?.id ?? 0 },
    { enabled: !!isAdmin && !!quizLesson },
  );
  interface QuizItem { id: number; lessonId: number; questionEn: string; questionAr: string; optionsEn: string[] | null; optionsAr: string[] | null; correctIndex: number | null; points: number; sortOrder: number; }
  const [quizForm, setQuizForm] = useState<{ id?: number; questionAr: string; questionEn: string; optionsAr: string; optionsEn: string; correctIndex: number; points: number }>({ questionAr: "", questionEn: "", optionsAr: "", optionsEn: "", correctIndex: 0, points: 10 });
  const invalidateQuiz = () => { void refetchQuiz(); };
  const createQuizQuestion = trpc.admin.createQuizQuestion.useMutation({ onSuccess: () => { invalidateQuiz(); setShowQuizForm(false); toast.success(isRTL ? "تمت إضافة السؤال" : "Question added"); }, onError: (err) => toast.error(err.message) });
  const updateQuizQuestion = trpc.admin.updateQuizQuestion.useMutation({ onSuccess: () => { invalidateQuiz(); setShowQuizForm(false); toast.success(isRTL ? "تم تحديث السؤال" : "Question updated"); }, onError: (err) => toast.error(err.message) });
  const deleteQuizQuestion = trpc.admin.deleteQuizQuestion.useMutation({ onSuccess: () => { invalidateQuiz(); toast.success(isRTL ? "تم حذف السؤال" : "Question deleted"); }, onError: (err) => toast.error(err.message) });
  const [showQuizForm, setShowQuizForm] = useState(false);
  const openQuizForm = (q?: QuizItem) => {
    if (q) {
      setQuizForm({ id: q.id, questionAr: q.questionAr, questionEn: q.questionEn, optionsAr: (q.optionsAr ?? []).join("\n"), optionsEn: (q.optionsEn ?? []).join("\n"), correctIndex: q.correctIndex ?? 0, points: q.points });
    } else {
      setQuizForm({ questionAr: "", questionEn: "", optionsAr: "", optionsEn: "", correctIndex: 0, points: 10 });
    }
    setShowQuizForm(true);
  };
  const submitQuizForm = () => {
    const optionsAr = quizForm.optionsAr.split("\n").map((s) => s.trim()).filter(Boolean);
    const optionsEn = quizForm.optionsEn.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!quizForm.questionAr.trim() || !quizForm.questionEn.trim()) { toast.error(isRTL ? "نص السؤال مطلوب باللغتين" : "Both question texts are required"); return; }
    if (optionsAr.length < 2 || optionsEn.length < 2) { toast.error(isRTL ? "خياران على الأقل لكل لغة" : "At least 2 options per language"); return; }
    if (quizForm.correctIndex >= optionsAr.length) { toast.error(isRTL ? "الإجابة الصحيحة خارج نطاق الخيارات" : "Correct answer is out of range"); return; }
    const payload = { questionAr: quizForm.questionAr.trim(), questionEn: quizForm.questionEn.trim(), optionsAr, optionsEn, correctIndex: quizForm.correctIndex, points: quizForm.points };
    if (!quizLesson) return;
    if (quizForm.id) updateQuizQuestion.mutate({ id: quizForm.id, ...payload });
    else createQuizQuestion.mutate({ lessonId: quizLesson.id, ...payload });
  };

  // ─── Course roster (enrollments: list / grant / revoke / reactivate) ───
  const [rosterCourse, setRosterCourse] = useState<CourseItem | null>(null);
  const [rosterStatus, setRosterStatus] = useState<"all" | "active" | "completed" | "refunded" | "cancelled">("all");
  const [rosterSearch, setRosterSearch] = useState("");
  const { data: rosterData, refetch: refetchRoster } = trpc.admin.courseEnrollments.useQuery(
    { courseId: rosterCourse?.id ?? 0, status: rosterStatus, search: rosterSearch },
    { enabled: !!isAdmin && !!rosterCourse },
  );
  const { data: rosterCounts } = trpc.admin.enrollmentCounts.useQuery(
    { courseId: rosterCourse?.id ?? 0 },
    { enabled: !!isAdmin && !!rosterCourse },
  );
  interface RosterRow { id: number; userId: number; username: string; email: string; fullName: string | null; status: string; progress: string; isCompleted: boolean | null; enrolledAt: string | Date; completedAt: string | Date | null; }
  const invalidateRoster = () => { void refetchRoster(); utils.admin.enrollmentCounts.invalidate({ courseId: rosterCourse?.id ?? 0 }); utils.admin.listCourses.invalidate(); };
  const grantEnrollment = trpc.admin.grantEnrollment.useMutation({
    onSuccess: (res) => { invalidateRoster(); if (res.alreadyActive) toast.info(isRTL ? "الطالب مسجل فعلاً في هذا الكورس" : "Student is already active in this course"); else toast.success(isRTL ? "تم تسجيل الطالب في الكورس" : "Student enrolled"); },
    onError: (err) => toast.error(err.message),
  });
  const revokeEnrollment = trpc.admin.revokeEnrollment.useMutation({ onSuccess: () => { invalidateRoster(); toast.success(isRTL ? "تم سحب الوصول" : "Access revoked"); }, onError: (err) => toast.error(err.message) });
  const reactivateEnrollment = trpc.admin.reactivateEnrollment.useMutation({ onSuccess: () => { invalidateRoster(); toast.success(isRTL ? "تم تفعيل الوصول مجدداً" : "Access reactivated"); }, onError: (err) => toast.error(err.message) });
  const [grantQuery, setGrantQuery] = useState("");
  const { data: grantUsers } = trpc.admin.searchUsers.useQuery({ q: grantQuery }, { enabled: !!rosterCourse && grantQuery.trim().length >= 2 });

  // ── Subscribe-gate settings (siteSettings section "subscribeGate") ──
  const { data: subGateCfgData } = trpc.settings.getSection.useQuery(
    { section: "subscribeGate" },
    { enabled: !!isAdmin && activeTab === "courses" },
  );
  const [subGateForm, setSubGateForm] = useState({ enabled: true, channelUrl: "https://www.youtube.com/@AhmedElbazEng", days: 30 });
  const [subGateLoaded, setSubGateLoaded] = useState(false);
  useEffect(() => {
    if (subGateCfgData && !subGateLoaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubGateForm({
        enabled: subGateCfgData.enabled !== "false",
        channelUrl: subGateCfgData.channelUrl?.trim() || "https://www.youtube.com/@AhmedElbazEng",
        days: Math.max(1, Number.parseInt(subGateCfgData.days ?? "30", 10) || 30),
      });
      setSubGateLoaded(true);
    }
  }, [subGateCfgData, subGateLoaded]);
  const bulkUpsertSubGate = trpc.settings.bulkUpsert.useMutation({
    onSuccess: () => { utils.settings.getSection.invalidate(); toast.success(lang === "en" ? "Subscribe-gate settings saved" : "تم حفظ إعدادات بوابة الاشتراك"); },
    onError: (err) => toast.error(err.message),
  });
  const saveSubGate = () => {
    bulkUpsertSubGate.mutate({
      section: "subscribeGate",
      settings: [
        { key: "enabled", value: String(subGateForm.enabled), type: "text", sortOrder: 1 },
        { key: "channelUrl", value: subGateForm.channelUrl.trim(), type: "url", sortOrder: 2 },
        { key: "days", value: String(Math.max(1, Math.floor(subGateForm.days) || 30)), type: "number", sortOrder: 3 },
      ],
    });
  };
  // ── Articles (blog) management ──
  const { data: articlesData } = trpc.articles.adminList.useQuery(undefined, { enabled: !!isAdmin && activeTab === "articles" });
  const createArticle = trpc.articles.create.useMutation({ onSuccess: () => { utils.articles.adminList.invalidate(); setShowArticleForm(false); toast.success(lang === "en" ? "Article saved" : "تم حفظ المقال"); }, onError: (err) => toast.error(err.message) });
  const updateArticle = trpc.articles.update.useMutation({ onSuccess: () => { utils.articles.adminList.invalidate(); setShowArticleForm(false); toast.success(lang === "en" ? "Article updated" : "تم تحديث المقال"); }, onError: (err) => toast.error(err.message) });
  const toggleArticlePublish = trpc.articles.togglePublish.useMutation({ onSuccess: () => { utils.articles.adminList.invalidate(); toast.success(lang === "en" ? "Publish state updated" : "تم تحديث حالة النشر"); }, onError: (err) => toast.error(err.message) });
  const deleteArticle = trpc.articles.delete.useMutation({ onSuccess: () => { utils.articles.adminList.invalidate(); toast.success(lang === "en" ? "Article deleted" : "تم حذف المقال"); }, onError: (err) => toast.error(err.message) });

  // ✅ Manual payment approval (Vodafone Cash / InstaPay / bank transfer)
  const approveManualPayment = trpc.admin.approveManual.useMutation({ onSuccess: () => { utils.admin.payments.invalidate(); utils.admin.stats.invalidate(); toast.success(lang === "en" ? "Payment approved — course activated" : "تم اعتماد الدفع وتفعيل الكورس"); }, onError: (err) => toast.error(err.message) });
  const rejectManualPayment = trpc.admin.rejectManual.useMutation({ onSuccess: () => { utils.admin.payments.invalidate(); toast.success(lang === "en" ? "Payment rejected" : "تم رفض الدفع"); }, onError: (err) => toast.error(err.message) });
  const bulkUpsertPaymentSettings = trpc.settings.bulkUpsert.useMutation({ onSuccess: () => { utils.invalidate(); refetchManualPayDetails(); toast.success(lang === "en" ? "Payment details saved" : "تم حفظ تفاصيل الدفع اليدوي"); }, onError: (err) => toast.error(err.message) });
  const paymobSelfTest = trpc.admin.paymobSelfTest.useMutation({
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(lang === "en" ? "Paymob is reachable — intention created!" : "Paymob يستجيب — تم إنشاء نية دفع!");
        if (res.checkoutUrl) globalThis.open(res.checkoutUrl, "_blank", "noopener");
      } else {
        toast.error(`${lang === "en" ? "Self-test failed" : "فشل الاختبار"} (${res.stage}): ${res.message}`);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  /* ✅ Manual payment transfer details editor state (siteSettings section "payments") */
  const [paySettings, setPaySettings] = useState({
    vodafone_cash_number: "",
    instapay_handle: "",
    bank_transfer_details: "",
    notes_ar: "",
    notes_en: "",
    paymob_public_key: "",
    paymob_integration_card: "",
    paymob_integration_wallet: "",
  });
  const [paySettingsLoaded, setPaySettingsLoaded] = useState(false);
  useEffect(() => {
    if (manualPayDetails && !paySettingsLoaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaySettings({
        vodafone_cash_number: manualPayDetails.vodafoneCashNumber ?? "",
        instapay_handle: manualPayDetails.instapayHandle ?? "",
        bank_transfer_details: manualPayDetails.bankTransferDetails ?? "",
        notes_ar: manualPayDetails.notesAr ?? "",
        notes_en: manualPayDetails.notesEn ?? "",
        paymob_public_key: manualPayDetails.paymobPublicKey ?? "",
        paymob_integration_card: manualPayDetails.paymobIntegrationCard ?? "",
        paymob_integration_wallet: manualPayDetails.paymobIntegrationWallet ?? "",
      });
      setPaySettingsLoaded(true);
    }
  }, [manualPayDetails, paySettingsLoaded]);

  const savePaymentSettings = () => {
    bulkUpsertPaymentSettings.mutate({
      section: "payments",
      settings: [
        { key: "vodafone_cash_number", value: paySettings.vodafone_cash_number.trim(), type: "text", sortOrder: 1 },
        { key: "instapay_handle", value: paySettings.instapay_handle.trim(), type: "text", sortOrder: 2 },
        { key: "bank_transfer_details", value: paySettings.bank_transfer_details.trim(), type: "text", sortOrder: 3 },
        { key: "notes_ar", value: paySettings.notes_ar.trim(), type: "text", sortOrder: 4 },
        { key: "notes_en", value: paySettings.notes_en.trim(), type: "text", sortOrder: 5 },
        { key: "paymob_public_key", value: paySettings.paymob_public_key.trim(), type: "text", sortOrder: 6 },
        { key: "paymob_integration_card", value: paySettings.paymob_integration_card.trim(), type: "text", sortOrder: 7 },
        { key: "paymob_integration_wallet", value: paySettings.paymob_integration_wallet.trim(), type: "text", sortOrder: 8 },
      ],
    });
  };

  /* Course & lesson management state */
  const [showCourseForm, setShowCourseForm] = useState(false);
  // ── Articles form state ──
  const [showArticleForm, setShowArticleForm] = useState(false);
  const [articleForm, setArticleForm] = useState(emptyArticleForm);
  const [courseForm, setCourseForm] = useState({ slug: "", categoryId: 0, titleEn: "", titleAr: "", shortDescEn: "", shortDescAr: "", descriptionEn: "", descriptionAr: "", thumbnailUrl: "/course-etap.jpg", level: "beginner", isPremium: false, price: 0, isPublished: false, isFeatured: false });
  const [showLessonForm, setShowLessonForm] = useState(false);
  const [editingLesson, setEditingLesson] = useState<LessonItem | null>(null);
  const [lessonForm, setLessonForm] = useState({ titleEn: "", titleAr: "", descriptionEn: "", descriptionAr: "", videoUrl: "", durationMinutes: 30, isFree: false, isPublished: true });
  const [showPlaylistImport, setShowPlaylistImport] = useState(false);

  const openLessonForm = (lesson?: LessonItem) => {
    if (lesson) {
      setEditingLesson(lesson);
      setLessonForm({ titleEn: lesson.titleEn, titleAr: lesson.titleAr, descriptionEn: lesson.descriptionEn ?? "", descriptionAr: lesson.descriptionAr ?? "", videoUrl: lesson.videoUrl ?? "", durationMinutes: lesson.durationMinutes ?? 30, isFree: lesson.isFree, isPublished: lesson.isPublished });
    } else {
      setEditingLesson(null);
      setLessonForm({ titleEn: "", titleAr: "", descriptionEn: "", descriptionAr: "", videoUrl: "", durationMinutes: 30, isFree: false, isPublished: true });
    }
    setShowLessonForm(true);
  };

  const submitCourseForm = () => {
    if (!courseForm.slug.trim() || !courseForm.titleEn.trim() || !courseForm.titleAr.trim()) {
      toast.error(lang === "en" ? "Slug and titles are required" : "الـ slug والعناوين مطلوبة");
      return;
    }
    createCourse.mutate({
      slug: courseForm.slug.trim().toLowerCase(),
      categoryId: courseForm.categoryId || (adminCategories as unknown as CategoryItem[] | undefined)?.[0]?.id || 1,
      titleEn: courseForm.titleEn, titleAr: courseForm.titleAr,
      shortDescEn: courseForm.shortDescEn || undefined, shortDescAr: courseForm.shortDescAr || undefined,
      descriptionEn: courseForm.descriptionEn || undefined, descriptionAr: courseForm.descriptionAr || undefined,
      thumbnailUrl: courseForm.thumbnailUrl || undefined,
      level: courseForm.level as "beginner" | "intermediate" | "advanced",
      isPremium: courseForm.isPremium, price: courseForm.price,
      isPublished: courseForm.isPublished, isFeatured: courseForm.isFeatured,
    });
  };

  const submitLessonForm = () => {
    if (!lessonsCourse) return;
    if (!lessonForm.titleEn.trim() || !lessonForm.titleAr.trim()) {
      toast.error(lang === "en" ? "Lesson titles are required" : "عنوان الدرس مطلوب");
      return;
    }
    if (editingLesson) {
      updateLesson.mutate({ id: editingLesson.id, ...lessonForm, videoUrl: lessonForm.videoUrl || null });
    } else {
      createLesson.mutate({ courseId: lessonsCourse.id, ...lessonForm, videoUrl: lessonForm.videoUrl || undefined });
    }
  };

  /* CMS */
  const [cmsSection, setCmsSection] = useState("hero");
  const { data: cmsData, isLoading: cmsLoading } = trpc.settings.getSection.useQuery({ section: cmsSection }, { enabled: !!isAdmin && activeTab === "cms" });
  const [cmsValues, setCmsValues] = useState<Record<string, string>>({});
  const cmsSave = trpc.settings.bulkUpsert.useMutation({ onSuccess: () => { utils.settings.getSection.invalidate({ section: cmsSection }); toast.success(lang === "en" ? "Content saved" : "تم حفظ المحتوى"); }, onError: (err) => toast.error(err.message) });
  useEffect(() => {
    if (cmsData) {
      if (Array.isArray(cmsData)) { const map: Record<string, string> = {}; (cmsData as SettingItem[]).forEach((s) => { map[s.key] = s.value; });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCmsValues(map); }
      else setCmsValues(cmsData as Record<string, string>);
    }
  }, [cmsData]);
  const handleCmsSave = () => { cmsSave.mutate({ section: cmsSection, settings: Object.entries(cmsValues).map(([key, value]) => ({ key, value })) }); };

  /* Themes */
  const { data: themes, isLoading: themesLoading } = trpc.settings.listThemes.useQuery(undefined, { enabled: !!isAdmin && activeTab === "themes" });
  const seedThemes = trpc.settings.seedThemes.useMutation({ onSuccess: () => { utils.settings.listThemes.invalidate(); toast.success(lang === "en" ? "Themes seeded" : "تم تحميل الثيمات"); } });
  const createTheme = trpc.settings.createTheme.useMutation({ onSuccess: () => { utils.settings.listThemes.invalidate(); setThemeDialogOpen(false); toast.success(lang === "en" ? "Theme created" : "تم إنشاء الثيم"); }, onError: (err) => toast.error(err.message) });
  const activateTheme = trpc.settings.activateTheme.useMutation({ onSuccess: () => { utils.settings.listThemes.invalidate(); utils.settings.getActiveTheme.invalidate(); toast.success(lang === "en" ? "Theme activated" : "تم تفعيل الثيم"); }, onError: (err) => toast.error(err.message) });
  const updateTheme = trpc.settings.updateTheme.useMutation({ onSuccess: () => { utils.settings.listThemes.invalidate(); utils.settings.getActiveTheme.invalidate(); setThemeDialogOpen(false); toast.success(lang === "en" ? "Theme updated" : "تم تحديث الثيم"); }, onError: (err) => toast.error(err.message) });
  const deleteTheme = trpc.settings.deleteTheme.useMutation({ onSuccess: () => { utils.settings.listThemes.invalidate(); utils.settings.getActiveTheme.invalidate(); setDeleteConfirmId(null); toast.success(lang === "en" ? "Theme deleted" : "تم حذف الثيم"); }, onError: (err) => toast.error(err.message) });
  const [themeDialogOpen, setThemeDialogOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Partial<ThemeItem> | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const blankTheme: Partial<ThemeItem> = { name: "", primaryColor: "#06b6d4", secondaryColor: "#0e7490", accentColor: "#22d3ee", bgColor: "#0a0e17", textColor: "#f0f4f8", cardBgColor: "#111827", borderColor: "#1f2d44" };

  /* Promos */
  const { data: promoCodes } = trpc.promo.list.useQuery(undefined, { enabled: !!isAdmin && activeTab === "promos" });

  // 🔔 Manual broadcast — fires a real notification to every registered user.
  const sendBroadcast = trpc.admin.sendBroadcast.useMutation({
    onSuccess: () => toast.success(isRTL ? "تم بث الإشعار لكل المستخدمين ✅" : "Notification broadcast to all users ✅"),
    onError: (err) => toast.error(isRTL ? `فشل إرسال الإشعار: ${err.message}` : `Broadcast failed: ${err.message}`),
  });
  const createPromo = trpc.promo.create.useMutation({ onSuccess: () => { utils.promo.list.invalidate(); setShowPromoForm(false); toast.success(lang === "en" ? "Promo created" : "تم إنشاء الكود"); }, onError: (err) => toast.error(err.message) });
  const updatePromo = trpc.promo.update.useMutation({ onSuccess: () => { utils.promo.list.invalidate(); setShowPromoForm(false); toast.success(lang === "en" ? "Promo updated" : "تم تحديث الكود"); }, onError: (err) => toast.error(err.message) });
  const deletePromo = trpc.promo.delete.useMutation({ onSuccess: () => { utils.promo.list.invalidate(); toast.success(lang === "en" ? "Promo deleted" : "تم حذف الكود"); }, onError: (err) => toast.error(err.message) });
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [editingPromo, setEditingPromo] = useState<Partial<PromoItem> | null>(null);

  /* Promotions */
  const { data: promotions } = trpc.settings.listPromotions.useQuery(undefined, { enabled: !!isAdmin && activeTab === "promotions" });
  const createPromotion = trpc.settings.createPromotion.useMutation({ onSuccess: () => { utils.settings.listPromotions.invalidate(); setShowPromotionForm(false); toast.success(lang === "en" ? "Promotion created" : "تم إنشاء العرض"); }, onError: (err) => toast.error(err.message) });
  const updatePromotion = trpc.settings.updatePromotion.useMutation({ onSuccess: () => { utils.settings.listPromotions.invalidate(); setShowPromotionForm(false); toast.success(lang === "en" ? "Promotion updated" : "تم تحديث العرض"); }, onError: (err) => toast.error(err.message) });
  const deletePromotion = trpc.settings.deletePromotion.useMutation({ onSuccess: () => { utils.settings.listPromotions.invalidate(); toast.success(lang === "en" ? "Promotion deleted" : "تم حذف العرض"); }, onError: (err) => toast.error(err.message) });
  const [showPromotionForm, setShowPromotionForm] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Partial<PromotionItem> | null>(null);

  /* Contact */
  const { data: contactData, isLoading: contactLoading } = trpc.settings.getSection.useQuery({ section: "contact" }, { enabled: !!isAdmin && activeTab === "contact" });
  const [contactValues, setContactValues] = useState<Record<string, string>>({});
  const contactSave = trpc.settings.bulkUpsert.useMutation({ onSuccess: () => { utils.settings.getSection.invalidate({ section: "contact" }); utils.settings.getAll.invalidate(); toast.success(lang === "en" ? "Contact info saved" : "تم حفظ معلومات التواصل"); }, onError: (err) => toast.error(err.message) });
  useEffect(() => {
    if (contactData) {
      if (Array.isArray(contactData)) { const map: Record<string, string> = {}; (contactData as SettingItem[]).forEach((s) => { map[s.key] = s.value; });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContactValues(map); }
      else setContactValues(contactData as Record<string, string>);
    }
  }, [contactData]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleContactSave = () => { contactSave.mutate({ section: "contact", settings: Object.entries(contactValues).map(([key, value]) => ({ key, value, type: (key.includes("Url") ? "url" : "text") as any })) }); };

  const isRTL = lang === "ar";
  const allUsers = usersData?.items ?? [];
  const allPayments = paymentsData?.items ?? [];

  // ── Dashboard overview helpers ──
  // "Now" is captured once per mount (impure reads must not run on every render).
  const [nowMs] = useState(() => Date.now());
  const hourNow = new Date(nowMs).getHours();
  const dashGreeting = isRTL
    ? (hourNow < 12 ? "صباح الخير" : hourNow < 17 ? "طاب يومك" : "مساء الخير")
    : (hourNow < 12 ? "Good morning" : hourNow < 17 ? "Good afternoon" : "Good evening");
  const todayLabel = new Intl.DateTimeFormat(isRTL ? "ar-EG" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(nowMs));
  // 30-day revenue series: the API only returns days that had payments, so we
  // rebuild a dense 30-day axis and map the sparse amounts onto it.
  const revenueSeries = analytics?.revenueByDay ?? [];
  const revenue30dTotal = revenueSeries.reduce((sum, r) => sum + r.amount, 0);
  const chartMax = Math.max(...revenueSeries.map((r) => r.amount), 1);
  const revenueMap = new Map(revenueSeries.map((r) => [r.date, r.amount]));
  const DAY_MS = 86400000;
  const chartDays = Array.from({ length: 30 }, (_, i) => {
    const key = new Date(nowMs - (29 - i) * DAY_MS).toISOString().slice(0, 10);
    const amount = revenueMap.get(key) ?? 0;
    return { key, amount, pct: Math.max((amount / chartMax) * 100, 2), title: `${key} — ${Math.round(amount).toLocaleString("en-US")} EGP` };
  });
  const chartStartLabel = chartDays[0]?.key.slice(5) ?? "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allCourses = (coursesData as any)?.items ?? [];
  const allArticles = (articlesData?.items ?? []) as unknown as ArticleRow[];

  // Status badge colour lookup maps — replace multi-branch ternaries that
  // SonarCloud S3358 flags.
  const ticketStatusBadgeClass: Record<string, string> = {
    open: "bg-[rgba(16,185,129,0.15)] text-emerald-500",
    in_progress: "bg-accent-secondary/15 text-accent-secondary",
    resolved: "bg-[rgba(34,211,238,0.15)] text-[#22d3ee]",
  };
  const paymentStatusBadgeClass: Record<string, string> = {
    completed: "bg-[rgba(16,185,129,0.15)] text-emerald-500",
    pending: "bg-[rgba(245,158,11,0.15)] text-amber-500",
  };

  const sidebarWidth = isDesktop ? (sidebarCollapsed ? 64 : 240) : 264;
  const sidebarHidden = !isDesktop && !mobileSidebarOpen;

  if (isLoading) return <div className="flex min-h-screen items-center justify-center bg-background"><div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-[#06b6d4]" /></div>;
  if (!isAdmin) return null;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile backdrop (drawer mode only) */}
      <AnimatePresence>
        {!isDesktop && mobileSidebarOpen && (
          <motion.div
            key="admin-sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setMobileSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Sidebar — fixed column on desktop, slide-in drawer from the side on mobile */}
      <motion.aside
        initial={{ width: sidebarWidth, x: sidebarHidden ? "-100%" : 0 }}
        animate={{ width: sidebarWidth, x: sidebarHidden ? "-100%" : 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        drag={isDesktop ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.55, right: 0 }}
        onDragStart={() => { adminDragGuard.current = true; }}
        onDragEnd={(_, info) => {
          if (!isDesktop && (info.offset.x < -90 || info.velocity.x < -600)) setMobileSidebarOpen(false);
          globalThis.setTimeout(() => { adminDragGuard.current = false; }, 250);
        }}
        onClickCapture={(e) => {
          if (adminDragGuard.current) {
            e.preventDefault();
            e.stopPropagation();
            adminDragGuard.current = false;
          }
        }}
        className="admin-sidebar fixed left-0 top-0 z-50 h-screen flex flex-col shadow-2xl rounded-r-2xl lg:rounded-none lg:shadow-none"
        aria-label={isRTL ? "قائمة لوحة التحكم" : "Admin navigation"}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border p-4">
          {(!isDesktop || !sidebarCollapsed) ? (
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#06b6d4] to-[#0e7490] shadow-[0_0_18px_rgba(6,182,212,0.35)]">
                <Shield className="h-4 w-4 text-white" />
              </div>
              <div className="leading-tight">
                <p className="text-sm font-extrabold tracking-wide text-foreground">ELBAZ</p>
                <p className="text-[11px] text-text-muted">{t("adminPanel")}</p>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#06b6d4] to-[#0e7490] shadow-[0_0_18px_rgba(6,182,212,0.35)]">
              <Shield className="h-4 w-4 text-white" />
            </div>
          )}
          {isDesktop ? (
            <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? (isRTL ? "توسيع القائمة" : "Expand sidebar") : (isRTL ? "تصغير القائمة" : "Collapse sidebar")} className="rounded-lg p-1.5 hover:bg-[#1f2d44] text-text-muted transition-colors hover:text-foreground">
              {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          ) : (
            <button onClick={() => setMobileSidebarOpen(false)} aria-label={isRTL ? "إغلاق القائمة" : "Close menu"} className="rounded-lg p-1.5 hover:bg-[#1f2d44] text-text-muted transition-colors hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {SIDEBAR_GROUPS.map((group) => (
            <div key={group.labelEn}>
              {(!isDesktop || !sidebarCollapsed) && (
                <p className="admin-sidebar-label">{isRTL ? group.labelAr : group.labelEn}</p>
              )}
              {group.ids.map((id) => {
                const item = SIDEBAR_ITEMS.find((i) => i.id === id);
                if (!item) return null;
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                const expanded = !isDesktop || !sidebarCollapsed;
                const openTickets = stats?.openTickets ?? 0;
                return (
                  <motion.button
                    key={item.id}
                    whileHover={{ x: 4 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setActiveTab(item.id); if (!isDesktop) setMobileSidebarOpen(false); }}
                    title={isDesktop && sidebarCollapsed ? (isRTL ? item.labelAr : item.labelEn) : undefined}
                    className={`admin-sidebar-item w-full ${isActive ? "active" : ""}`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {expanded && <span>{isRTL ? item.labelAr : item.labelEn}</span>}
                    {item.id === "tickets" && openTickets > 0 && expanded && (
                      <span className="ms-auto rounded-full bg-[rgba(244,63,94,0.16)] px-1.5 py-0.5 text-[10px] font-bold text-[#fb7185]">
                        {openTickets > 99 ? "99+" : openTickets}
                      </span>
                    )}
                    {item.id === "tickets" && openTickets > 0 && !expanded && (
                      <span className="admin-nav-badge">{openTickets > 9 ? "9+" : openTickets}</span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <button onClick={() => { navigate("/"); if (!isDesktop) setMobileSidebarOpen(false); }} className="admin-sidebar-item w-full text-destructive hover:bg-[rgba(244,63,94,0.08)]">
            <LogOut className="h-4 w-4 shrink-0" />
            {(!isDesktop || !sidebarCollapsed) && <span>{isRTL ? "خروج" : "Exit Admin"}</span>}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 transition-all" style={{ marginLeft: isDesktop ? (sidebarCollapsed ? 64 : 240) : 0 }}>
        {/* Mobile top bar with hamburger to open the drawer */}
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-[rgba(10,14,23,0.9)] backdrop-blur-xl px-4 py-3 lg:hidden">
          <button
            data-testid="admin-mobile-menu"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label={isRTL ? "فتح قائمة التحكم" : "Open admin menu"}
            aria-expanded={mobileSidebarOpen}
            className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-white/5 hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-bold text-foreground">
            {(() => { const cur = SIDEBAR_ITEMS.find((i) => i.id === activeTab); return cur ? (isRTL ? cur.labelAr : cur.labelEn) : t("adminPanel"); })()}
          </span>
        </div>
        <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>

              {/* ═══════════════════ DASHBOARD ═══════════════════ */}
              {activeTab === "dashboard" && (
                <div className="space-y-6">
                  {/* Welcome hero band */}
                  <div className="admin-hero-band px-5 py-6 sm:px-7">
                    <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold text-[#22d3ee]">{dashGreeting}</p>
                        <h1 className="mt-1 text-2xl font-extrabold text-foreground sm:text-3xl">{isRTL ? "لوحة التحكم" : "Dashboard"}</h1>
                        <p className="mt-1.5 text-sm text-text-muted">{isRTL ? "نظرة عامة على أداء المنصة" : "Platform performance overview"}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[rgba(17,24,39,0.65)] px-3 py-1.5 text-xs text-text-muted">
                          <CalendarDays className="h-3.5 w-3.5 text-[#22d3ee]" />
                          {todayLabel}
                        </span>
                        <Button variant="outline" size="sm" onClick={() => navigate("/")} className="gap-1.5">
                          <ExternalLink className="h-3.5 w-3.5" />
                          {isRTL ? "عرض الموقع" : "View site"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {[
                      { icon: Users, label: t("totalUsers"), value: (stats?.totalUsers || 0).toLocaleString(isRTL ? "ar-EG" : "en-US"), color: "#06b6d4", change: analytics?.newUsers30d },
                      { icon: BookOpen, label: t("totalCourses"), value: (stats?.totalCourses || 0).toLocaleString(isRTL ? "ar-EG" : "en-US"), color: "#22d3ee" },
                      { icon: TrendingUp, label: t("totalEnrollments"), value: (stats?.totalEnrollments || 0).toLocaleString(isRTL ? "ar-EG" : "en-US"), color: "#10b981", change: analytics?.newEnrollments30d },
                      { icon: DollarSign, label: t("totalRevenue"), value: `${Math.round(stats?.totalRevenue || 0).toLocaleString("en-US")} EGP`, color: "#f59e0b", change: analytics?.revenue30d },
                      { icon: Headphones, label: t("openTickets"), value: (stats?.openTickets || 0).toLocaleString(isRTL ? "ar-EG" : "en-US"), color: "#f43f5e" },
                    ].map((stat) => (
                      <motion.div
                        key={stat.label}
                        whileHover={{ y: -4 }}
                        className="admin-stat-card p-5"
                        style={{ "--stat-accent": stat.color, "--stat-accent-rgb": hexToRgb(stat.color) } as CSSProperties}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `rgba(${hexToRgb(stat.color)}, 0.12)` }}>
                            <stat.icon className="h-5 w-5" style={{ color: stat.color }} />
                          </div>
                          {stat.change !== undefined && stat.change > 0 && (
                            <span className="flex items-center gap-0.5 rounded-full bg-[rgba(16,185,129,0.12)] px-2 py-0.5 text-[11px] font-semibold text-emerald-500">
                              <ArrowUpRight className="h-3 w-3" />+{Math.round(stat.change).toLocaleString("en-US")}
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-[1.65rem] font-extrabold leading-tight tracking-tight text-foreground">{stat.value}</p>
                        <p className="mt-1 text-xs text-text-muted">{stat.label}</p>
                      </motion.div>
                    ))}
                  </div>

                  {/* 30-day pulse: revenue chart + quick summary */}
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="admin-panel-card p-5 sm:p-6 lg:col-span-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-foreground">{isRTL ? "إيرادات آخر 30 يوماً" : "Revenue — last 30 days"}</h3>
                          <p className="mt-0.5 text-xs text-text-muted">{isRTL ? "المدفوعات المكتملة يوم بيوم" : "Completed payments, day by day"}</p>
                        </div>
                        <span className="rounded-full bg-[rgba(6,182,212,0.12)] px-3 py-1 text-xs font-bold text-[#22d3ee]">
                          {Math.round(analytics?.revenue30d ?? 0).toLocaleString("en-US")} EGP
                        </span>
                      </div>
                      <div className="relative mt-6">
                        <div className="flex h-36 items-end gap-1" dir="ltr" aria-hidden="true">
                          {chartDays.map((d) => (
                            <div key={d.key} className="flex h-full flex-1 flex-col justify-end" title={d.title}>
                              <div className="admin-chart-bar w-full" style={{ height: `${d.pct}%` }} />
                            </div>
                          ))}
                        </div>
                        {revenue30dTotal === 0 && (
                          <p className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-text-faint">
                            {isRTL ? "لا توجد مدفوعات مسجلة في آخر 30 يوماً" : "No recorded payments in the last 30 days"}
                          </p>
                        )}
                      </div>
                      <div className="mt-2 flex justify-between text-[10px] text-text-faint" dir="ltr">
                        <span>{chartStartLabel}</span>
                        <span>{isRTL ? "اليوم" : "Today"}</span>
                      </div>
                    </div>
                    <div className="admin-panel-card p-5 sm:p-6">
                      <h3 className="text-base font-semibold text-foreground">{isRTL ? "نبض آخر 30 يوماً" : "Last 30 days"}</h3>
                      <div className="mt-4 space-y-2.5">
                        {[
                          { icon: Users, label: isRTL ? "مستخدمون جدد" : "New users", value: (analytics?.newUsers30d ?? 0).toLocaleString(isRTL ? "ar-EG" : "en-US"), color: "#06b6d4" },
                          { icon: TrendingUp, label: isRTL ? "اشتراكات جديدة" : "New enrollments", value: (analytics?.newEnrollments30d ?? 0).toLocaleString(isRTL ? "ar-EG" : "en-US"), color: "#10b981" },
                          { icon: DollarSign, label: isRTL ? "الإيرادات" : "Revenue", value: `${Math.round(analytics?.revenue30d ?? 0).toLocaleString("en-US")} EGP`, color: "#f59e0b" },
                          { icon: PlayCircle, label: isRTL ? "إجمالي الدروس" : "Total lessons", value: (analytics?.totalLessons ?? 0).toLocaleString(isRTL ? "ar-EG" : "en-US"), color: "#8b5cf6" },
                        ].map((row) => (
                          <div key={row.label} className="flex items-center gap-3 rounded-xl border border-border/60 bg-[rgba(15,23,42,0.5)] px-3.5 py-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `rgba(${hexToRgb(row.color)}, 0.12)` }}>
                              <row.icon className="h-4 w-4" style={{ color: row.color }} />
                            </div>
                            <span className="flex-1 text-xs text-text-muted">{row.label}</span>
                            <span className="text-sm font-bold text-foreground">{row.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div>
                    <h3 className="mb-3 text-sm font-semibold text-text-secondary">{isRTL ? "إجراءات سريعة" : "Quick actions"}</h3>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {[
                        { icon: BookOpen, label: isRTL ? "إدارة الكورسات" : "Manage Courses", tab: "courses", color: "#06b6d4" },
                        { icon: Users, label: isRTL ? "إدارة المستخدمين" : "Manage Users", tab: "users", color: "#10b981" },
                        { icon: Newspaper, label: isRTL ? "المقالات" : "Articles", tab: "articles", color: "#f59e0b" },
                        { icon: Headphones, label: isRTL ? "التذاكر" : "Tickets", tab: "tickets", color: "#f43f5e" },
                        { icon: FileText, label: isRTL ? "تعديل المحتوى" : "Edit Content", tab: "cms", color: "#8b5cf6" },
                        { icon: Palette, label: isRTL ? "تخصيص الثيم" : "Customize Theme", tab: "themes", color: "#38bdf8" },
                      ].map((action) => (
                        <motion.button
                          key={action.tab}
                          whileHover={{ y: -3 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setActiveTab(action.tab)}
                          className="admin-quick-action group p-5 text-start"
                          style={{ "--stat-accent-rgb": hexToRgb(action.color) } as CSSProperties}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: `rgba(${hexToRgb(action.color)}, 0.12)` }}>
                              <action.icon className="h-5 w-5" style={{ color: action.color }} />
                            </div>
                            <ArrowUpRight className="qa-arrow h-4 w-4" style={{ color: action.color }} />
                          </div>
                          <p className="mt-4 text-sm font-semibold text-foreground">{action.label}</p>
                        </motion.button>
                      ))}
                    </div>
                  </div>

                  {/* Recent Activity: newest users + latest payments (real data) */}
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="admin-panel-card p-5 sm:p-6">
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-base font-semibold text-foreground">{isRTL ? "أحدث المستخدمين" : "Newest users"}</h3>
                        <button onClick={() => setActiveTab("users")} className="text-xs font-medium text-[#22d3ee] hover:underline">
                          {isRTL ? "عرض الكل" : "View all"}
                        </button>
                      </div>
                      <div className="space-y-1">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {allUsers.slice(0, 5).map((u: any) => (
                          <div key={u.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[rgba(15,23,42,0.6)]">
                            <div
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                              style={{ background: `rgba(${hexToRgb(AVATAR_COLORS[u.id % AVATAR_COLORS.length])}, 0.15)`, color: AVATAR_COLORS[u.id % AVATAR_COLORS.length] }}
                            >
                              {(u.name || u.username || "?").charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm text-foreground">{u.name || u.username}</p>
                              <p className="truncate text-xs text-text-faint">{u.email || "—"}</p>
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <Badge variant="outline" className="border-border text-[10px] text-text-faint">{u.role}</Badge>
                              <span className="text-[10px] text-text-faint">{u.createdAt ? new Date(u.createdAt).toLocaleDateString(isRTL ? "ar-EG" : "en-GB") : "—"}</span>
                            </div>
                          </div>
                        ))}
                        {allUsers.length === 0 && <p className="py-8 text-center text-sm text-text-faint">{isRTL ? "لا يوجد مستخدمون بعد" : "No users yet"}</p>}
                      </div>
                    </div>
                    <div className="admin-panel-card p-5 sm:p-6">
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-base font-semibold text-foreground">{isRTL ? "آخر المدفوعات" : "Latest payments"}</h3>
                        <button onClick={() => setActiveTab("payments")} className="text-xs font-medium text-[#22d3ee] hover:underline">
                          {isRTL ? "عرض الكل" : "View all"}
                        </button>
                      </div>
                      <div className="space-y-1">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {allPayments.slice(0, 5).map((p: any) => (
                          <div key={p.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[rgba(15,23,42,0.6)]">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(245,158,11,0.12)]">
                              <DollarSign className="h-4 w-4 text-[#f59e0b]" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-foreground">{Number(p.amount).toLocaleString("en-US")} {p.currency}</p>
                              <p className="truncate text-xs text-text-faint">{p.provider}{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleDateString(isRTL ? "ar-EG" : "en-GB")}` : ""}</p>
                            </div>
                            <Badge className={`border-0 text-[10px] ${paymentStatusBadgeClass[p.status] ?? "bg-[rgba(148,163,184,0.15)] text-text-muted"}`}>{p.status}</Badge>
                          </div>
                        ))}
                        {allPayments.length === 0 && <p className="py-8 text-center text-sm text-text-faint">{isRTL ? "لا توجد مدفوعات بعد" : "No payments yet"}</p>}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══════════════════ USERS ═══════════════════ */}
              {activeTab === "users" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h1 className="text-2xl font-bold text-foreground">{t("totalUsers")}</h1>
                      <p className="text-sm text-text-muted mt-1">{allUsers.length} {isRTL ? "مستخدم" : "users"}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border bg-primary overflow-hidden">
                    <table className="w-full text-start text-sm">
                      <thead>
                        <tr className="border-b border-border bg-[#0d1117]">
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "المستخدم" : "User"}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{t("email")}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{t("role")}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "تاريخ التسجيل" : "Joined"}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "إجراءات" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(allUsers || []).map((u: any) => (
                          <tr key={u.id} className="border-b border-border/50 hover:bg-[rgba(6,182,212,0.02)] transition-colors">
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(6,182,212,0.1)] text-xs font-bold text-accent-secondary">{(u.name || u.username || "?").charAt(0).toUpperCase()}</div>
                                <div>
                                  <p className="text-sm font-medium text-foreground">{u.name || u.username}</p>
                                  <p className="text-xs text-text-faint">@{u.username}</p>
                                </div>
                              </div>
                            </td>
                            <td className="p-4 text-text-muted">{u.email || "—"}</td>
                            <td className="p-4">
                              <Select value={u.role} onValueChange={(val) => updateUserRole.mutate({ userId: u.id, role: val as "user" | "admin" })}>
                                <SelectTrigger className="w-28 border-border bg-background text-foreground text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="border-border bg-primary">
                                  <SelectItem value="user" className="text-foreground">{isRTL ? "مستخدم" : "User"}</SelectItem>
                                  <SelectItem value="admin" className="text-foreground">{isRTL ? "أدمن" : "Admin"}</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-4 text-text-faint text-xs">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                            <td className="p-4">
                              <Badge variant="outline" className={`border-border text-xs ${u.role === "admin" ? "text-accent-secondary border-[#06b6d4]/30" : "text-text-muted"}`}>
                                {u.role === "admin" ? <Shield className="h-3 w-3 mr-1" /> : <Users className="h-3 w-3 mr-1" />}
                                {u.role}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ═══════════════════ COURSES ═══════════════════ */}
              {activeTab === "courses" && (
                <div className="space-y-6">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <h1 className="text-2xl font-bold text-foreground">{isRTL ? "إدارة الكورسات" : "Course Management"}</h1>
                      <p className="text-sm text-text-muted mt-1">{allCourses.length} {isRTL ? "كورس" : "courses"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => setShowCats(true)} className="border-border text-accent-secondary hover:bg-[rgba(6,182,212,0.06)]" data-testid="manage-categories">
                        <FolderTree className="h-4 w-4 mr-1" />{isRTL ? "التصنيفات" : "Categories"}
                      </Button>
                      <Button onClick={() => setShowCourseForm(true)} className="bg-[#06b6d4] text-background hover:bg-[#0891b2]">
                        <Plus className="h-4 w-4 mr-1" />{isRTL ? "كورس جديد" : "New Course"}
                      </Button>
                    </div>
                  </div>

                  {/* ═══ Subscribe-gate: require channel subscription before watching ═══ */}
                  <div className="rounded-xl border border-border bg-primary p-4" data-testid="subscribe-gate-settings">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Youtube className="h-5 w-5 text-[#ff5f57]" />
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">{isRTL ? "بوابة اشتراك القناة قبل المشاهدة" : "Channel-subscription gate before playback"}</h3>
                          <p className="text-xs text-text-muted">{isRTL ? "لوحة واحدة قبل أول فيديو تطلب اشتراك مجاني في القناة — مرة واحدة على الجهاز ولمدة تختارها، بدون إزعاج متكرر" : "One panel before the first video asks for a free channel subscription — once per device for a window you choose, never nagging"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={subGateForm.enabled} onCheckedChange={(v) => setSubGateForm((f) => ({ ...f, enabled: v }))} data-testid="subscribe-gate-enabled" />
                        <Label className="text-text-muted text-xs">{subGateForm.enabled ? (isRTL ? "مفعّلة" : "Enabled") : (isRTL ? "متوقفة" : "Disabled")}</Label>
                      </div>
                    </div>
                    {subGateForm.enabled && (
                      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-1 sm:col-span-2">
                          <Label className="text-text-muted text-xs">{isRTL ? "رابط القناة على يوتيوب" : "YouTube channel URL"}</Label>
                          <Input value={subGateForm.channelUrl} onChange={(e) => setSubGateForm((f) => ({ ...f, channelUrl: e.target.value }))} dir="ltr" placeholder="https://www.youtube.com/@AhmedElbazEng" className="border-border bg-background text-foreground" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-text-muted text-xs">{isRTL ? "مدة عدم الإزعاج (أيام)" : "Re-ask window (days)"}</Label>
                          <Input type="number" min={1} max={365} value={subGateForm.days} onChange={(e) => setSubGateForm((f) => ({ ...f, days: Number(e.target.value) }))} className="border-border bg-background text-foreground" />
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex justify-end">
                      <Button size="sm" onClick={saveSubGate} disabled={bulkUpsertSubGate.isPending} className="bg-[#06b6d4] text-background">
                        <Save className="h-3.5 w-3.5 mr-1" />{bulkUpsertSubGate.isPending ? (isRTL ? "جارٍ الحفظ..." : "Saving...") : (isRTL ? "حفظ الإعدادات" : "Save settings")}
                      </Button>
                    </div>
                  </div>

                  {/* ═══ YouTube playlist AUTO-SYNC — the course mirrors the channel ═══ */}
                  <div className="rounded-xl border border-border bg-primary p-5 space-y-4" data-testid="yt-sync-panel">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgba(244,63,94,0.12)]">
                          <Youtube className="h-5 w-5 text-[#ff5f57]" />
                        </div>
                        <div>
                          <h2 className="text-base font-semibold text-foreground">{isRTL ? "مزامنة بلاي ليست اليوتيوب" : "YouTube Playlist Sync"}</h2>
                          <p className="mt-0.5 text-xs text-text-muted">
                            {isRTL
                              ? "أي فيديو جديد على اليوتيوب يظهر هنا تلقائياً بنفس الاسم الحرفي خلال دقائق — والغلاف يتبع أول فيديو. العناوين من يوتيوب نفسه (oEmbed) — ممنوع أي عنوان مبتكر."
                              : "Any new YouTube video appears here automatically under its exact name within minutes — the cover follows the first video. Titles come from YouTube itself (oEmbed) — nothing invented."}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="bg-[#06b6d4] text-background hover:bg-[#0891b2]"
                          data-testid="yt-sync-now"
                          onClick={() => syncPlaylistNow.mutate({ replace: false })}
                          disabled={syncPlaylistNow.isPending}
                        >
                          {syncPlaylistNow.isPending
                            ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />{isRTL ? "جارٍ السحب..." : "Syncing…"}</>
                            : <><RefreshCw className="mr-1 h-3.5 w-3.5" />{isRTL ? "مزامنة الآن" : "Sync now"}</>}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-[rgba(244,63,94,0.4)] text-[#fb7185] hover:bg-[rgba(244,63,94,0.08)]"
                          data-testid="yt-sync-full"
                          onClick={() => {
                            if (window.confirm(
                              isRTL
                                ? "⚠️ المزامنة الكاملة تحذف أي درس في الكورس ليس فيديو حقيقياً من البلاي ليست (تقدم الفيديوهات الحقيقية يظل محفوظاً). متأكد؟"
                                : "⚠️ Full sync deletes any lesson that is not a real playlist video (progress for real videos is kept). Continue?",
                            )) {
                              syncPlaylistNow.mutate({ replace: true });
                            }
                          }}
                          disabled={syncPlaylistNow.isPending}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />{isRTL ? "مزامنة كاملة + تنظيف" : "Full sync + cleanup"}
                        </Button>
                      </div>
                    </div>

                    {/* Status row */}
                    {ytSync && (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-lg border border-border/70 bg-background p-3">
                          <p className="text-[10px] uppercase tracking-wider text-text-faint">{isRTL ? "آخر مزامنة" : "Last sync"}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">
                            {ytSync.state?.lastSuccessAt
                              ? new Date(ytSync.state.lastSuccessAt).toLocaleString(isRTL ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" })
                              : isRTL ? "لم تبدأ بعد" : "not yet"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-background p-3">
                          <p className="text-[10px] uppercase tracking-wider text-text-faint">{isRTL ? "فيديوهات البلاي ليست" : "Playlist videos"}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{ytSync.state?.videosFound ?? "—"}</p>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-background p-3">
                          <p className="text-[10px] uppercase tracking-wider text-text-faint">{isRTL ? "دروس حقيقية / إجمالي" : "Real lessons / total"}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{ytSync.youtubeLessonCount} / {ytSync.lessonCount}</p>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-background p-3">
                          <p className="text-[10px] uppercase tracking-wider text-text-faint">{isRTL ? "الغلاف الحالي" : "Current cover"}</p>
                          {ytSync.cover ? (
                            <img src={ytSync.cover} alt="cover" className="mt-1 h-10 w-16 rounded object-cover" onError={(e) => { e.currentTarget.style.opacity = "0.25"; }} />
                          ) : (
                            <p className="mt-1 flex items-center gap-1 text-sm text-text-muted"><ImageOff className="h-3.5 w-3.5" />{isRTL ? "بدون غلاف" : "no cover"}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {ytSync?.state?.lastError && (
                      <p className="text-xs text-amber-400/90">
                        ⚠️ {isRTL ? "آخر خطأ سحب: " : "Last fetch error: "}<span dir="ltr">{ytSync.state.lastError}</span>
                        {isRTL ? " — الإعادة التلقائية كل 15 دقيقة، والمحتوى الحالي محفوظ." : " — auto-retry every 15 min; current content is preserved."}
                      </p>
                    )}

                    {/* Playlist link */}
                    {ytSync?.playlistUrl && (
                      <p className="text-xs text-text-muted" dir="ltr">
                        <span className="inline-flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" />
                          <a href={ytSync.playlistUrl} target="_blank" rel="noreferrer" className="text-accent-secondary hover:underline">{ytSync.playlistUrl}</a>
                        </span>
                      </p>
                    )}

                    {/* Policy toggles */}
                    {ytSync && (
                      <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border/60 pt-3">
                        <div className="flex items-center gap-2">
                          <Switch checked={ytSync.settings.autoImport} onCheckedChange={(v) => toggleSyncSetting("autoImport", v)} data-testid="yt-auto-import" />
                          <Label className="text-xs text-text-muted">{isRTL ? "استيراد تلقائي للفيديوهات الجديدة (كل 15 دقيقة)" : "Auto-import new videos (every 15 min)"}</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch checked={ytSync.settings.autoImportFree} onCheckedChange={(v) => toggleSyncSetting("autoImportFree", v)} />
                          <Label className="text-xs text-text-muted">{isRTL ? "الفيديوهات المستوردة مجانية لأي مستخدم مسجل" : "Imported videos are free for signed-in users"}</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch checked={ytSync.settings.autoCover} onCheckedChange={(v) => toggleSyncSetting("autoCover", v)} />
                          <Label className="text-xs text-text-muted">{isRTL ? "الغلاف يتبع صورة أول فيديو في اليوتيوب" : "Cover follows the first video's thumbnail"}</Label>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {(allCourses || []).map((course: CourseItem) => (
                      <motion.div key={course.id} whileHover={{ y: -4 }} className="rounded-xl border border-border bg-primary overflow-hidden">
                        <div className="h-32 bg-background relative">
                          {course.thumbnailUrl ? (
                            <img src={course.thumbnailUrl} alt={lang === "en" ? course.titleEn : course.titleAr} className="w-full h-full object-cover" />
                          ) : (
                            <div className="flex items-center justify-center h-full"><BookOpen className="h-8 w-8 text-[#1f2d44]" /></div>
                          )}
                          <div className="absolute top-2 right-2 flex gap-1">
                            {course.isPublished && <Badge className="bg-[rgba(16,185,129,0.15)] text-emerald-500 text-[10px]">{isRTL ? "منشور" : "Published"}</Badge>}
                            {course.isFeatured && <Badge className="bg-[rgba(245,158,11,0.15)] text-amber-500 text-[10px]">{isRTL ? "مميز" : "Featured"}</Badge>}
                          </div>
                        </div>
                        <div className="p-4 space-y-3">
                          <h3 className="text-sm font-semibold text-foreground truncate">{lang === "en" ? course.titleEn : course.titleAr}</h3>
                          <div className="flex items-center justify-between text-xs text-text-muted">
                            <span>{course.price} {course.currency}</span>
                            <span>{course.studentCount} {isRTL ? "طالب" : "students"}</span>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" className="flex-1 text-xs text-accent-secondary hover:bg-[rgba(6,182,212,0.05)]" onClick={() => {
                              const newPublished = !course.isPublished;
                              updateCourse.mutate({ id: course.id, isPublished: newPublished });
                            }}>
                              <Eye className="h-3 w-3 mr-1" />
                              {course.isPublished ? bilingual("إخفاء", "Hide", isRTL) : bilingual("نشر", "Publish", isRTL)}
                            </Button>
                            <Button size="sm" variant="ghost" className="flex-1 text-xs text-amber-500 hover:bg-[rgba(245,158,11,0.05)]" onClick={() => {
                              updateCourse.mutate({ id: course.id, isFeatured: !course.isFeatured });
                            }}>
                              <Zap className="h-3 w-3 mr-1" />
                              {course.isFeatured ? bilingual("إزالة التميز", "Unfeature", isRTL) : bilingual("تمييز", "Feature", isRTL)}
                            </Button>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" className="flex-1 text-xs text-emerald-500 hover:bg-[rgba(16,185,129,0.05)]" onClick={() => setLessonsCourse(course)}>
                              <PlayCircle className="h-3 w-3 mr-1" />
                              {isRTL ? "الدروس" : "Lessons"}
                            </Button>
                            <Button size="sm" variant="ghost" className="flex-1 text-xs text-violet-400 hover:bg-[rgba(139,92,246,0.08)]" onClick={() => { setRosterCourse(course); setRosterStatus("all"); setRosterSearch(""); setGrantQuery(""); }} data-testid={`roster-${course.id}`}>
                              <GraduationCap className="h-3 w-3 mr-1" />
                              {isRTL ? "الطلاب" : "Students"}
                            </Button>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" className="flex-1 text-xs text-destructive hover:bg-[rgba(244,63,94,0.08)]" onClick={() => {
                              if (window.confirm(isRTL ? "⚠️ حذف الكورس سيحذف كل دروسه وتسجيلاته. متأكد؟" : "⚠️ Deleting this course removes all its lessons and enrollments. Continue?")) {
                                deleteCourse.mutate({ id: course.id });
                              }
                            }}>
                              <Trash2 className="h-3 w-3 mr-1" />
                              {isRTL ? "حذف" : "Delete"}
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* ═══════════════════ TICKETS ═══════════════════ */}
              {activeTab === "articles" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-bold text-foreground">{isRTL ? "إدارة المقالات" : "Manage Articles"}</h2>
                    <Button onClick={() => openArticleForm()} className="bg-[#06b6d4] text-background"><Plus className="h-4 w-4 mr-1" />{isRTL ? "مقال جديد" : "New Article"}</Button>
                  </div>
                  {allArticles.length === 0 && (
                    <p className="text-sm text-text-muted text-center py-10">{isRTL ? "لا توجد مقالات بعد — اضغط مقال جديد" : "No articles yet — click New Article"}</p>
                  )}
                  <div className="grid gap-3">
                    {allArticles.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-primary p-4">
                        <div className="flex-1 min-w-[200px]">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-foreground">{isRTL ? a.titleAr : a.titleEn}</p>
                            <Badge className={a.isPublished ? "bg-[rgba(16,185,129,0.15)] text-emerald-500 text-[10px]" : "bg-[rgba(245,158,11,0.15)] text-amber-500 text-[10px]"}>{a.isPublished ? (isRTL ? "منشور" : "Published") : (isRTL ? "مسودة" : "Draft")}</Badge>
                          </div>
                          <p className="text-xs text-text-muted mt-1" dir="ltr">/articles/{a.slug} · {a.category} · {a.viewCount} {isRTL ? "مشاهدة" : "views"}</p>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-8 text-xs text-accent-secondary" onClick={() => toggleArticlePublish.mutate({ id: a.id, isPublished: !a.isPublished })}>{a.isPublished ? (isRTL ? "إلغاء النشر" : "Unpublish") : (isRTL ? "نشر" : "Publish")}</Button>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-accent-secondary" onClick={() => openArticleForm(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => { if (window.confirm(isRTL ? "حذف هذا المقال؟" : "Delete this article?")) deleteArticle.mutate({ id: a.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {activeTab === "tickets" && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold text-foreground">{t("allTickets")}</h1>
                    <p className="text-sm text-text-muted mt-1">{(allTickets || []).length} {isRTL ? "تذكرة" : "tickets"}</p>
                  </div>
                  <div className="space-y-4">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(allTickets || []).map((ticket: any) => (
                      <motion.div key={ticket.id} whileHover={{ y: -2 }} className="rounded-xl border border-border bg-primary p-5">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className={`text-xs ${ticketStatusBadgeClass[ticket.status] ?? "bg-[#1a2233] text-text-faint"}`}>{ticket.status}</Badge>
                              <Badge variant="outline" className="border-border text-[10px] text-text-muted">{ticket.category}</Badge>
                              <span className="text-xs text-text-faint">{ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString() : ""}</span>
                            </div>
                            <h3 className="mt-2 font-medium text-foreground">{ticket.subject}</h3>
                            <p className="mt-1 text-sm text-text-muted line-clamp-2">{ticket.message}</p>
                          </div>
                          <div className="flex gap-2 ml-4">
                            {ticket.status === "open" && <Button size="sm" variant="ghost" onClick={() => updateTicket.mutate({ id: ticket.id, status: "in_progress" })} className="text-accent-secondary hover:bg-[rgba(6,182,212,0.05)]"><CheckCircle className="mr-1 h-4 w-4" />{isRTL ? "بدء" : "Start"}</Button>}
                            {ticket.status === "in_progress" && <Button size="sm" variant="ghost" onClick={() => updateTicket.mutate({ id: ticket.id, status: "resolved" })} className="text-emerald-500 hover:bg-[rgba(16,185,129,0.05)]"><CheckCircle className="mr-1 h-4 w-4" />{isRTL ? "حل" : "Resolve"}</Button>}
                          </div>
                        </div>
                        <div className="mt-3">
                          {replyingTo === ticket.id ? (
                            <div className="flex gap-2">
                              <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder={isRTL ? "اكتب رداً..." : "Write a reply..."} className="flex-1 border-border bg-background text-foreground" />
                              <Button size="sm" onClick={() => replyMutation.mutate({ ticketId: ticket.id, message: replyText })} disabled={!replyText.trim()} className="bg-[#06b6d4] text-background">{t("send")}</Button>
                              <Button size="sm" variant="ghost" onClick={() => setReplyingTo(null)} className="text-text-muted">{t("cancel")}</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setReplyingTo(ticket.id)} className="text-xs text-accent-secondary hover:bg-[rgba(6,182,212,0.05)]">{isRTL ? "رد" : "Reply"}</Button>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* ═══════════════════ PAYMENTS ═══════════════════ */}
              {activeTab === "payments" && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold text-foreground">{isRTL ? "سجل المدفوعات" : "Payment History"}</h1>
                    <p className="text-sm text-text-muted mt-1">{allPayments.length} {isRTL ? "معاملة" : "transactions"}</p>
                  </div>

                  {/* ✅ Payment gateway status + manual transfer details editor */}
                  <div className="rounded-xl border border-border bg-primary p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-foreground">{isRTL ? "إعدادات وسائل الدفع" : "Payment Methods Setup"}</h2>
                        <p className="text-sm text-text-muted mt-1">
                          {isRTL ? "اضبط تفاصيل التحويل اليدوي التي سيراها الطلاب في صفحة الكورس" : "Configure the manual transfer details students will see on the course page"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge className={`text-xs ${paymobStatusAdmin?.configured ? "bg-[rgba(16,185,129,0.15)] text-emerald-400" : "bg-[rgba(245,158,11,0.15)] text-amber-400"}`}>
                          {isRTL ? "بوابة إلكترونية: " : "Electronic gateway: "}
                          {paymobStatusAdmin?.configured
                            ? `${isRTL ? "مفعّلة" : "configured"}${paymobStatusAdmin.mode ? ` (${paymobStatusAdmin.mode})` : ""}`
                            : isRTL ? "غير مكتملة" : "incomplete"}
                        </Badge>
                        <Badge className={`text-xs ${manualPayDetails?.enabled ? "bg-[rgba(16,185,129,0.15)] text-emerald-400" : "bg-[rgba(244,63,94,0.15)] text-destructive"}`}>
                          {isRTL ? "تحويل يدوي: " : "Manual transfer: "}
                          {manualPayDetails?.enabled ? (isRTL ? "مفعّل" : "enabled") : (isRTL ? "معطّل (أدخل التفاصيل بالأسفل)" : "disabled (fill details below)")}
                        </Badge>
                      </div>
                    </div>
                    {paymobStatusAdmin && !paymobStatusAdmin.configured && (
                      <p className="text-xs text-amber-400/90" dir="ltr">
                        {isRTL ? "الناقص: " : "Missing: "}{(paymobStatusAdmin.missing ?? []).join(" · ")}
                      </p>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label className="text-sm text-text-muted">{isRTL ? "رقم فودافون كاش" : "Vodafone Cash number"}</Label>
                        <Input value={paySettings.vodafone_cash_number} onChange={(e) => setPaySettings((p) => ({ ...p, vodafone_cash_number: e.target.value }))} placeholder="01001234567" className="border-border bg-background text-foreground" dir="ltr" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-sm text-text-muted">{isRTL ? "عنوان InstaPay (رقم/رابط)" : "InstaPay handle (number/link)"}</Label>
                        <Input value={paySettings.instapay_handle} onChange={(e) => setPaySettings((p) => ({ ...p, instapay_handle: e.target.value }))} placeholder="01001234567 أو https://ipn.example/..." className="border-border bg-background text-foreground" dir="ltr" />
                      </div>
                      <div className="grid gap-1.5 sm:col-span-2">
                        <Label className="text-sm text-text-muted">{isRTL ? "تفاصيل التحويل البنكي (اسم البنك / رقم الحساب / IBAN)" : "Bank transfer details (bank / account number / IBAN)"}</Label>
                        <Textarea value={paySettings.bank_transfer_details} onChange={(e) => setPaySettings((p) => ({ ...p, bank_transfer_details: e.target.value }))} placeholder={isRTL ? "مثال: بنك مصر — حساب 1234567890 — IBAN EG12..." : "e.g. Banque Misr — account 1234567890 — IBAN EG12..."} rows={2} className="border-border bg-background text-foreground" dir="ltr" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-sm text-text-muted">{isRTL ? "ملاحظات للطالب (عربي)" : "Student notes (Arabic)"}</Label>
                        <Input value={paySettings.notes_ar} onChange={(e) => setPaySettings((p) => ({ ...p, notes_ar: e.target.value }))} placeholder={isRTL ? "مثال: التحويل باسم شخصي فقط" : ""} className="border-border bg-background text-foreground" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-sm text-text-muted">{isRTL ? "ملاحظات للطالب (إنجليزي)" : "Student notes (English)"}</Label>
                        <Input value={paySettings.notes_en} onChange={(e) => setPaySettings((p) => ({ ...p, notes_en: e.target.value }))} placeholder={isRTL ? "" : "e.g. personal transfers only"} className="border-border bg-background text-foreground" dir="ltr" />
                      </div>
                      {/* ── Paymob electronic gateway (Intention API) ── */}
                      <div className="sm:col-span-2 pt-3 border-t border-border/60">
                        <h3 className="text-sm font-semibold text-foreground">
                          {isRTL ? "بوابة Paymob الإلكترونية (بطاقة / محفظة)" : "Paymob electronic gateway (card / wallet)"}
                        </h3>
                        <p className="text-xs text-text-muted mt-1" dir="ltr">
                          {isRTL
                            ? "من لوحة Paymob: Settings → API Keys → Public Key، و Settings → Payment Integrations → معرّفات Test لكل وسيلة."
                            : "From the Paymob dashboard: Settings → API Keys → Public Key, and Settings → Payment Integrations → the Test ID per method."}
                        </p>
                      </div>
                      <div className="grid gap-1.5 sm:col-span-2">
                        <Label className="text-sm text-text-muted">{isRTL ? "المفتاح العام (Public Key)" : "Public Key"}</Label>
                        <Input value={paySettings.paymob_public_key} onChange={(e) => setPaySettings((p) => ({ ...p, paymob_public_key: e.target.value }))} placeholder="pk_test_… / egy_pk_test_…" className="border-border bg-background text-foreground font-mono text-xs" dir="ltr" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-sm text-text-muted">{isRTL ? "معرّف تكامل البطاقات (Test)" : "Card Integration ID (Test)"}</Label>
                        <Input value={paySettings.paymob_integration_card} onChange={(e) => setPaySettings((p) => ({ ...p, paymob_integration_card: e.target.value }))} placeholder="1234567" className="border-border bg-background text-foreground font-mono text-xs" dir="ltr" />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-sm text-text-muted">{isRTL ? "معرّف تكامل المحافظ (Test)" : "Wallet Integration ID (Test)"}</Label>
                        <Input value={paySettings.paymob_integration_wallet} onChange={(e) => setPaySettings((p) => ({ ...p, paymob_integration_wallet: e.target.value }))} placeholder="1234568" className="border-border bg-background text-foreground font-mono text-xs" dir="ltr" />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        className="bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#0a0e17] hover:from-[#22d3ee] hover:to-[#06b6d4]"
                        onClick={savePaymentSettings}
                        disabled={bulkUpsertPaymentSettings.isPending}
                      >
                        {bulkUpsertPaymentSettings.isPending ? (isRTL ? "جاري الحفظ..." : "Saving...") : (isRTL ? "حفظ تفاصيل الدفع" : "Save payment details")}
                      </Button>
                      <Button
                        variant="outline"
                        className="border-border text-foreground hover:bg-background"
                        onClick={() => paymobSelfTest.mutate()}
                        disabled={paymobSelfTest.isPending}
                      >
                        {paymobSelfTest.isPending ? (isRTL ? "جاري الاختبار..." : "Testing…") : (isRTL ? "اختبار الاتصال بـ Paymob" : "Test Paymob connection")}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-primary overflow-hidden">
                    <table className="w-full text-start text-sm">
                      <thead>
                        <tr className="border-b border-border bg-[#0d1117]">
                          <th className="p-4 text-text-muted text-start font-medium">ID</th>
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "المبلغ" : "Amount"}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "الطريقة" : "Method"}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "المصدر" : "Provider"}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{t("status")}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "التاريخ" : "Date"}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "إجراء" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(allPayments || []).map((p: any) => {
                          const meta = (p.metadata ?? {}) as { reference?: string | null; rejectReason?: string | null };
                          const isPendingManual = p.provider === "manual" && p.status === "pending";
                          return (
                          <tr key={p.id} className="border-b border-border/50 hover:bg-[rgba(6,182,212,0.02)] transition-colors">
                            <td className="p-4 text-foreground font-mono text-xs">#{p.id}</td>
                            <td className="p-4 font-semibold text-accent-secondary">{p.amount} {p.currency}</td>
                            <td className="p-4 text-text-muted">
                              {p.paymentMethod}
                              {(p.phoneNumber || meta.reference) && (
                                <span className="block text-xs text-text-faint" dir="ltr">
                                  {p.phoneNumber}{p.phoneNumber && meta.reference ? " · " : ""}{meta.reference}
                                </span>
                              )}
                            </td>
                            <td className="p-4">
                              <Badge variant="outline" className={`text-[10px] ${p.provider === "manual" ? "border-[rgba(245,158,11,0.4)] text-amber-400" : "border-border text-text-faint"}`}>{p.provider}</Badge>
                            </td>
                            <td className="p-4">
                              <Badge className={`text-xs ${paymentStatusBadgeClass[p.status] ?? "bg-[rgba(244,63,94,0.15)] text-destructive"}`}>{p.status}</Badge>
                              {meta.rejectReason && <span className="block text-xs text-destructive mt-1">{meta.rejectReason}</span>}
                            </td>
                            <td className="p-4 text-text-faint text-xs">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}</td>
                            <td className="p-4">
                              {isPendingManual ? (
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="bg-[rgba(16,185,129,0.15)] text-emerald-400 hover:bg-[rgba(16,185,129,0.25)]"
                                    onClick={() => approveManualPayment.mutate({ paymentId: p.id })}
                                    disabled={approveManualPayment.isPending}
                                  >
                                    {isRTL ? "اعتماد" : "Approve"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-[rgba(244,63,94,0.4)] text-destructive hover:bg-[rgba(244,63,94,0.1)]"
                                    onClick={() => rejectManualPayment.mutate({ paymentId: p.id })}
                                    disabled={rejectManualPayment.isPending}
                                  >
                                    {isRTL ? "رفض" : "Reject"}
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-text-faint text-xs">—</span>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ═══════════════════ CONTACT ═══════════════════ */}
              {activeTab === "ai" && <AiProvidersPanel />}

              {activeTab === "contact" && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold text-foreground">{isRTL ? "معلومات التواصل" : "Contact Information"}</h1>
                    <p className="text-sm text-text-muted mt-1">{isRTL ? "تحديث معلومات الاتصال وروابط التواصل الاجتماعي" : "Update contact info and social media links"}</p>
                  </div>
                  {contactLoading ? <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-[#06b6d4]" /></div> : (
                    <div className="rounded-xl border border-border bg-primary p-6 space-y-8">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label className="text-sm text-text-muted">{isRTL ? "رقم واتساب" : "WhatsApp Number"}</Label>
                          <Input value={contactValues.whatsappNumber || ""} onChange={(e) => setContactValues((p) => ({ ...p, whatsappNumber: e.target.value }))} placeholder="201061857305" className="border-border bg-background text-foreground" dir="ltr" />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-sm text-text-muted">{isRTL ? "رقم الهاتف" : "Phone Number"}</Label>
                          <Input value={contactValues.phone || ""} onChange={(e) => setContactValues((p) => ({ ...p, phone: e.target.value }))} placeholder="01061857305" className="border-border bg-background text-foreground" dir="ltr" />
                        </div>
                      </div>
                      <div className="grid gap-1.5 sm:max-w-md">
                        <Label className="text-sm text-text-muted">{isRTL ? "البريد الإلكتروني" : "Email Address"}</Label>
                        <Input value={contactValues.email || ""} onChange={(e) => setContactValues((p) => ({ ...p, email: e.target.value }))} placeholder="contact@example.com" className="border-border bg-background text-foreground" dir="ltr" />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {(["youtubeUrl", "linkedinUrl", "facebookUrl", "instagramUrl", "tiktokUrl", "twitterUrl", "telegramUrl"] as const).map((key) => (
                          <div key={key} className="grid gap-1.5">
                            <Label className="text-sm text-text-muted">{key.replaceAll("Url", "").charAt(0).toUpperCase() + key.replaceAll("Url", "").slice(1)}</Label>
                            <Input value={contactValues[key] || ""} onChange={(e) => setContactValues((p) => ({ ...p, [key]: e.target.value }))} placeholder="https://..." className="border-border bg-background text-foreground" dir="ltr" />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-end pt-4 border-t border-border">
                        <Button onClick={handleContactSave} disabled={contactSave.isPending} className="bg-[#06b6d4] text-background hover:bg-[#22d3ee]">
                          {contactSave.isPending ? <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-[#0a0e17] border-t-transparent" /> : <Save className="mr-2 h-4 w-4" />}
                          {isRTL ? "حفظ التغييرات" : "Save Changes"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ═══════════════════ CMS ═══════════════════ */}
              {activeTab === "cms" && (
                <div className="space-y-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h1 className="text-2xl font-bold text-foreground">{isRTL ? "إدارة المحتوى" : "Content Management"}</h1>
                      <p className="text-sm text-text-muted mt-1">{isRTL ? "تعديل نصوص ومحتوى صفحات الموقع" : "Edit texts and content across the site"}</p>
                    </div>
                    <Select value={cmsSection} onValueChange={setCmsSection}>
                      <SelectTrigger className="w-full border-border bg-background text-foreground sm:w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-border bg-primary">
                        {Object.entries(CMS_SECTIONS).map(([key, sec]) => (
                          <SelectItem key={key} value={key} className="text-foreground focus:bg-[#1f2d44]">{isRTL ? sec.labelAr : sec.labelEn}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {cmsLoading ? <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-[#06b6d4]" /></div> : (
                    <div className="rounded-xl border border-border bg-primary p-6 space-y-4">
                      {CMS_SECTIONS[cmsSection]?.keys.map((key) => {
                        const type = inferSettingType(key);
                        const label = key.replaceAll(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
                        const textInputDir = key.endsWith("Ar") ? "rtl" : "ltr";
                        const textInputElement = type === "textarea" ? (
                          <Textarea value={cmsValues[key] || ""} onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))} className="min-h-24 border-border bg-background text-foreground" dir={textInputDir} />
                        ) : (
                          <Input value={cmsValues[key] || ""} onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))} className="border-border bg-background text-foreground" dir={textInputDir} />
                        );
                        return (
                          <div key={key} className="grid gap-1.5">
                            <div className="flex items-center gap-2">
                              <Label className="text-sm text-text-muted">{label}</Label>
                              <Badge variant="outline" className="border-border text-[10px] text-text-faint">{type}</Badge>
                            </div>
                            {type === "color" ? (
                              <div className="flex items-center gap-3">
                                <input type="color" value={cmsValues[key] || "#000000"} onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))} className="h-10 w-14 cursor-pointer rounded border border-border bg-background" />
                                <Input value={cmsValues[key] || ""} onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))} className="flex-1 border-border bg-background text-foreground" dir="ltr" />
                              </div>
                            ) : textInputElement}
                          </div>
                        );
                      })}
                      <div className="flex justify-end pt-4 border-t border-border">
                        <Button onClick={handleCmsSave} disabled={cmsSave.isPending} className="bg-[#06b6d4] text-background hover:bg-[#22d3ee]">
                          {cmsSave.isPending ? <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-[#0a0e17] border-t-transparent" /> : <Save className="mr-2 h-4 w-4" />}
                          {isRTL ? "حفظ التغييرات" : "Save Changes"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ═══════════════════ THEMES ═══════════════════ */}
              {activeTab === "themes" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h1 className="text-2xl font-bold text-foreground">{isRTL ? "الثيمات" : "Themes"}</h1>
                      <p className="text-sm text-text-muted mt-1">{isRTL ? "تخصيص مظهر الموقع" : "Customize site appearance"}</p>
                    </div>
                    <div className="flex gap-2">
                      {(!themes || themes.length === 0) && <Button onClick={() => seedThemes.mutate()} variant="outline" className="border-border hover:bg-[#1f2d44]" disabled={seedThemes.isPending}>{isRTL ? "تحميل الثيمات الافتراضية" : "Load Default Themes"}</Button>}
                      <Button onClick={() => { setEditingTheme({ ...blankTheme }); setThemeDialogOpen(true); }} className="bg-[#06b6d4] text-background hover:bg-[#22d3ee]"><Plus className="mr-2 h-4 w-4" />{isRTL ? "إنشاء ثيم" : "Create Theme"}</Button>
                    </div>
                  </div>
                  {themesLoading ? <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-[#06b6d4]" /></div> : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {(themes as ThemeItem[] | undefined)?.map((theme) => (
                        <motion.div key={theme.id} whileHover={{ y: -4 }} className="rounded-xl border border-border bg-primary overflow-hidden">
                          <div className="flex h-16">
                            <div className="flex-1" style={{ backgroundColor: theme.primaryColor }} />
                            <div className="flex-1" style={{ backgroundColor: theme.secondaryColor }} />
                            <div className="flex-1" style={{ backgroundColor: theme.accentColor }} />
                            <div className="flex-1" style={{ backgroundColor: theme.cardBgColor }} />
                            <div className="flex-1" style={{ backgroundColor: theme.borderColor }} />
                          </div>
                          <div className="p-4">
                            <div className="flex items-center justify-between">
                              <h3 className="font-medium text-foreground">{theme.name}</h3>
                              {theme.isActive && <Badge className="bg-[rgba(16,185,129,0.15)] text-emerald-500 border-[#10b981]/30"><Zap className="mr-1 h-3 w-3" />{isRTL ? "نشط" : "Active"}</Badge>}
                            </div>
                            <div className="mt-3 flex gap-2">
                              <Button size="sm" variant="ghost" onClick={() => openEditTheme(theme)} className="flex-1 border border-border text-text-muted hover:bg-[#1f2d44] hover:text-foreground"><Pencil className="mr-1 h-3 w-3" />{isRTL ? "تعديل" : "Edit"}</Button>
                              {!theme.isActive && <Button size="sm" variant="ghost" onClick={() => activateTheme.mutate({ id: Number(theme.id) })} className="border border-[#06b6d4]/30 text-accent-secondary hover:bg-[rgba(6,182,212,0.1)]"><Zap className="h-3 w-3" /></Button>}
                              {!theme.isActive && <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmId(theme.id)} className="border border-[#f43f5e]/30 text-destructive hover:bg-[rgba(244,63,94,0.1)]"><Trash2 className="h-3 w-3" /></Button>}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ═══════════════════ PROMO CODES ═══════════════════ */}
              {activeTab === "promos" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h1 className="text-2xl font-bold text-foreground">{isRTL ? "أكواد الخصم" : "Promo Codes"}</h1>
                      <p className="text-sm text-text-muted mt-1">{(promoCodes || []).length} {isRTL ? "كود" : "codes"}</p>
                    </div>
                    <Button onClick={() => { setEditingPromo({ code: "", discount: 10, type: "percentage", maxUses: 100, status: "active", validFrom: "", validUntil: "" }); setShowPromoForm(true); }} className="bg-[#06b6d4] text-background hover:bg-[#22d3ee]"><Plus className="mr-2 h-4 w-4" />{isRTL ? "إنشاء كود" : "Create Code"}</Button>
                  </div>
                  <div className="rounded-xl border border-border bg-primary overflow-hidden">
                    <table className="w-full text-start text-sm">
                      <thead>
                        <tr className="border-b border-border bg-[#0d1117]">
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "الكود" : "Code"}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "الخصم" : "Discount"}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "الاستخدامات" : "Uses"}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{t("status")}</th>
                          <th className="p-4 text-text-muted text-start font-medium">{isRTL ? "إجراءات" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {(promoCodes || []).map((p: any) => (
                          <tr key={p.id} className="border-b border-border/50 hover:bg-[rgba(6,182,212,0.02)] transition-colors">
                            <td className="p-4 font-mono text-sm text-accent-secondary">{p.code}</td>
                            <td className="p-4 text-foreground">{p.discount}{p.type === "percentage" ? "%" : " EGP"}</td>
                            <td className="p-4 text-text-muted">{p.usedCount}/{p.maxUses}</td>
                            <td className="p-4"><Badge className={`text-xs ${p.status === "active" ? "bg-[rgba(16,185,129,0.15)] text-emerald-500" : "bg-[#1a2233] text-text-faint"}`}>{p.status}</Badge></td>
                            <td className="p-4">
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" onClick={() => { setEditingPromo(p); setShowPromoForm(true); }} className="text-accent-secondary hover:bg-[rgba(6,182,212,0.05)]"><Pencil className="h-3 w-3" /></Button>
                                <Button size="sm" variant="ghost" onClick={() => { if (confirm(isRTL ? "هل أنت متأكد؟" : "Are you sure?")) deletePromo.mutate({ id: p.id }); }} className="text-destructive hover:bg-[rgba(244,63,94,0.05)]"><Trash2 className="h-3 w-3" /></Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ═══════════════════ PROMOTIONS ═══════════════════ */}
              {activeTab === "promotions" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h1 className="text-2xl font-bold text-foreground">{isRTL ? "العروض الترويجية" : "Promotions"}</h1>
                      <p className="text-sm text-text-muted mt-1">{(promotions || []).length} {isRTL ? "عرض" : "promotions"}</p>
                    </div>
                    <Button onClick={() => { setEditingPromotion({ titleEn: "", titleAr: "", subtitleEn: "", subtitleAr: "", discountText: "", ctaTextEn: "", ctaTextAr: "", ctaUrl: "", startDate: "", endDate: "", bgColor: "#06b6d4", textColor: "#ffffff", buttonColor: "#0a0e17", position: "top", showCountdown: true, isActive: true }); setShowPromotionForm(true); }} className="bg-[#06b6d4] text-background hover:bg-[#22d3ee]"><Plus className="mr-2 h-4 w-4" />{isRTL ? "إنشاء عرض" : "Create Promotion"}</Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {(promotions || []).map((p: any) => (
                      <motion.div key={p.id} whileHover={{ y: -4 }} className="rounded-xl border border-border bg-primary p-5">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold text-foreground">{lang === "en" ? p.titleEn : p.titleAr}</h3>
                            <p className="text-sm text-text-muted mt-1">{lang === "en" ? p.subtitleEn : p.subtitleAr}</p>
                          </div>
                          <Badge className={p.isActive ? "bg-[rgba(16,185,129,0.15)] text-emerald-500" : "bg-[#1a2233] text-text-faint"}>{p.isActive ? bilingual("نشط", "Active", isRTL) : bilingual("غير نشط", "Inactive", isRTL)}</Badge>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setEditingPromotion(p); setShowPromotionForm(true); }} className="text-accent-secondary hover:bg-[rgba(6,182,212,0.05)]"><Pencil className="mr-1 h-3 w-3" />{isRTL ? "تعديل" : "Edit"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => { if (confirm(isRTL ? "هل أنت متأكد؟" : "Are you sure?")) deletePromotion.mutate({ id: p.id }); }} className="text-destructive hover:bg-[rgba(244,63,94,0.05)]"><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* ═══════════════════ NOTIFICATIONS (manual broadcast) ═══════════════════ */}
              {activeTab === "notifications" && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold text-foreground">{isRTL ? "الإشعارات" : "Notifications"}</h1>
                    <p className="text-sm text-text-muted mt-1">
                      {isRTL
                        ? "ابعت إشعار يدوي لكل المستخدمين المسجلين — بيظهر فورًا في جرس المنصة عند الكل"
                        : "Broadcast a notification to every registered user's bell in real time"}
                    </p>
                  </div>
                  <AdminNotificationPanel
                    onSend={(n) => {
                      sendBroadcast.mutate({
                        type: "promo",
                        title: n.titleAr || n.title,
                        message: n.messageAr || n.message,
                        titleEn: n.titleEn || undefined,
                        messageEn: n.messageEn || undefined,
                      });
                    }}
                  />
                </div>
              )}

              {/* ═══════════════════ CHATBOT (👍/👎 feedback review) ═══════════════════ */}
              {activeTab === "chatbot" && (() => {
                const fbStats = chatbotFeedbackData?.stats ?? { up: 0, down: 0, total: 0 };
                const fbItems = chatbotFeedbackData?.items ?? [];
                const satisfaction = fbStats.total > 0 ? Math.round((fbStats.up / fbStats.total) * 100) : null;
                const exportFeedback = () => {
                  // Export as eval fixtures — failing conversations feed the
                  // next prompt-iteration test suite (live-chatbot-eval).
                  const blob = new Blob([JSON.stringify(fbItems, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `chatbot-feedback-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                };
                return (
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h1 className="text-2xl font-bold text-foreground">{isRTL ? "تقييمات الشات بوت" : "Chatbot Feedback"}</h1>
                        <p className="text-sm text-text-muted mt-1">
                          {isRTL
                            ? "كل 👍/👎 من المستخدمين الحقيقيين — التقييمات السلبية هي وقود الجولة القادمة من تطوير البرومبت"
                            : "Every 👍/👎 from real users — downvotes fuel the next prompt iteration"}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={exportFeedback} disabled={fbItems.length === 0}>
                        <Download className="h-4 w-4 me-1.5" />
                        {isRTL ? "تحميل كقصص اختبار" : "Export as eval fixtures"}
                      </Button>
                    </div>

                    {/* Stats cards */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-xl border border-border bg-primary p-4">
                        <div className="flex items-center gap-2 text-emerald-400"><ThumbsUp className="h-4 w-4" /><span className="text-xs text-text-muted">{isRTL ? "مفيد" : "Helpful"}</span></div>
                        <p className="mt-1 text-2xl font-bold text-foreground">{fbStats.up}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-primary p-4">
                        <div className="flex items-center gap-2 text-red-400"><ThumbsDown className="h-4 w-4" /><span className="text-xs text-text-muted">{isRTL ? "مش دقيق" : "Not accurate"}</span></div>
                        <p className="mt-1 text-2xl font-bold text-foreground">{fbStats.down}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-primary p-4">
                        <p className="text-xs text-text-muted">{isRTL ? "إجمالي التقييمات" : "Total votes"}</p>
                        <p className="mt-1 text-2xl font-bold text-foreground">{fbStats.total}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-primary p-4">
                        <p className="text-xs text-text-muted">{isRTL ? "نسبة الرضا" : "Satisfaction"}</p>
                        <p className="mt-1 text-2xl font-bold text-foreground">{satisfaction === null ? "—" : `${satisfaction}%`}</p>
                      </div>
                    </div>

                    {/* Filter row */}
                    <div className="flex items-center gap-2">
                      {(["all", "up", "down"] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setFeedbackRatingFilter(r)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            feedbackRatingFilter === r
                              ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                              : "text-text-muted border border-border hover:text-foreground"
                          }`}
                        >
                          {r === "all" ? (isRTL ? "الكل" : "All") : r === "up" ? `👍 ${isRTL ? "مفيد" : "Up"}` : `👎 ${isRTL ? "مش دقيق" : "Down"}`}
                        </button>
                      ))}
                      <Button variant="ghost" size="sm" className="ms-auto" onClick={() => refetchChatbotFeedback()}>
                        {isRTL ? "تحديث" : "Refresh"}
                      </Button>
                    </div>

                    {/* Feedback list */}
                    {fbItems.length === 0 ? (
                      <div className="rounded-xl border border-border bg-primary p-10 text-center text-sm text-text-muted">
                        {isRTL ? "لسه مفيش تقييمات — أول ما المستخدمين يقيّموا ردود البوت هتظهر هنا" : "No votes yet — user ratings will appear here"}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {fbItems.map((fb) => (
                          <div key={fb.id} className="rounded-xl border border-border bg-primary p-4">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className={fb.rating === "up" ? "text-emerald-400" : "text-red-400"}>
                                {fb.rating === "up" ? "👍" : "👎"}
                              </span>
                              <Badge variant="outline">{fb.source === "telegram" ? "Telegram" : "Web"}</Badge>
                              {fb.mode && <Badge variant="outline">{fb.mode}</Badge>}
                              <Badge variant="outline">{fb.language === "en" ? "EN" : "AR"}</Badge>
                              {fb.model && <span className="text-text-muted">{fb.model}</span>}
                              <span className="ms-auto text-text-muted">{new Date(fb.createdAt).toLocaleString(isRTL ? "ar-EG" : "en-GB")}</span>
                            </div>
                            <p className="mt-2 text-sm text-foreground"><span className="text-text-muted">{isRTL ? "السؤال: " : "Q: "}</span>{fb.question}</p>
                            <p className="mt-1 line-clamp-3 text-xs text-text-muted"><span>{isRTL ? "الرد: " : "A: "}</span>{fb.answer}</p>
                            {fb.comment && (
                              <p className="mt-2 rounded-lg bg-amber-400/10 border border-amber-400/20 px-3 py-1.5 text-xs text-amber-300">💬 {fb.comment}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* ═══════════════════ DIALOGS ═══════════════════ */}

      {/* Theme Dialog */}
      <Dialog open={themeDialogOpen} onOpenChange={setThemeDialogOpen}>
        <DialogContent className="border-border bg-primary sm:max-w-2xl">
          <DialogHeader><DialogTitle className="text-foreground">{editingTheme?.id ? bilingual("تعديل الثيم", "Edit Theme", isRTL) : bilingual("إنشاء ثيم جديد", "Create New Theme", isRTL)}</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="grid gap-1.5">
              <Label className="text-text-muted">{isRTL ? "اسم الثيم" : "Theme Name"}</Label>
              <Input value={editingTheme?.name || ""} onChange={(e) => setEditingTheme((prev) => (prev ? { ...prev, name: e.target.value } : prev))} className="border-border bg-background text-foreground" />
            </div>
            {(["primaryColor", "secondaryColor", "accentColor", "bgColor", "textColor", "cardBgColor", "borderColor"] as const).map((field) => (
              <div key={field} className="grid gap-1.5">
                <Label className="text-text-muted">{field.replaceAll(/([A-Z])/g, " $1")}</Label>
                <div className="flex items-center gap-3">
                  <input type="color" value={editingTheme?.[field] || "#000000"} onChange={(e) => setEditingTheme((prev) => (prev ? { ...prev, [field]: e.target.value } : prev))} className="h-10 w-14 cursor-pointer rounded border border-border bg-background" />
                  <Input value={editingTheme?.[field] || ""} onChange={(e) => setEditingTheme((prev) => (prev ? { ...prev, [field]: e.target.value } : prev))} className="flex-1 border-border bg-background text-foreground" dir="ltr" />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setThemeDialogOpen(false)} className="border-border text-text-muted">{isRTL ? "إلغاء" : "Cancel"}</Button>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Button onClick={() => { if (editingTheme?.id) updateTheme.mutate(editingTheme as any); else createTheme.mutate(editingTheme as any); }} className="bg-[#06b6d4] text-background">{isRTL ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Theme Confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="border-border bg-primary sm:max-w-md">
          <DialogHeader><DialogTitle className="text-foreground">{isRTL ? "حذف الثيم" : "Delete Theme"}</DialogTitle><DialogDescription className="text-text-muted">{isRTL ? "هل أنت متأكد من حذف هذا الثيم؟" : "Are you sure you want to delete this theme?"}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)} className="border-border text-text-muted">{isRTL ? "إلغاء" : "Cancel"}</Button>
            <Button variant="destructive" onClick={() => deleteTheme.mutate({ id: Number(deleteConfirmId) })} className="bg-[#f43f5e] text-white">{isRTL ? "حذف" : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Promo Form Dialog */}
      <Dialog open={showPromoForm} onOpenChange={setShowPromoForm}>
        <DialogContent className="border-border bg-primary sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-foreground">{editingPromo?.id ? bilingual("تعديل الكود", "Edit Promo", isRTL) : bilingual("إنشاء كود جديد", "Create Promo", isRTL)}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-1.5"><Label className="text-text-muted">{isRTL ? "الكود" : "Code"}</Label><Input value={editingPromo?.code || ""} onChange={(e) => setEditingPromo((p) => (p ? { ...p, code: e.target.value } : p))} className="border-border bg-background text-foreground" dir="ltr" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5"><Label className="text-text-muted">{isRTL ? "الخصم" : "Discount"}</Label><Input type="number" value={editingPromo?.discount || 0} onChange={(e) => setEditingPromo((p) => (p ? { ...p, discount: Number(e.target.value) } : p))} className="border-border bg-background text-foreground" /></div>
              <div className="grid gap-1.5"><Label className="text-text-muted">{isRTL ? "النوع" : "Type"}</Label><Select value={editingPromo?.type || "percentage"} onValueChange={(v) => setEditingPromo((p) => (p ? { ...p, type: v as "percentage" | "fixed" } : p))}><SelectTrigger className="border-border bg-background text-foreground"><SelectValue /></SelectTrigger><SelectContent className="border-border bg-primary"><SelectItem value="percentage" className="text-foreground">{isRTL ? "نسبة مئوية" : "Percentage"}</SelectItem><SelectItem value="fixed" className="text-foreground">{isRTL ? "مبلغ ثابت" : "Fixed"}</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid gap-1.5"><Label className="text-text-muted">{isRTL ? "الحد الأقصى للاستخدامات" : "Max Uses"}</Label><Input type="number" value={editingPromo?.maxUses || 100} onChange={(e) => setEditingPromo((p) => (p ? { ...p, maxUses: Number(e.target.value) } : p))} className="border-border bg-background text-foreground" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPromoForm(false)} className="border-border text-text-muted">{isRTL ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => { if (editingPromo?.id) updatePromo.mutate({ id: Number(editingPromo.id), code: editingPromo.code!, discount: editingPromo.discount!, type: editingPromo.type!, maxUses: editingPromo.maxUses!, expiresAt: editingPromo.validUntil || undefined, validFrom: editingPromo.validFrom || undefined, isActive: editingPromo.status === "active" }); else createPromo.mutate({ code: editingPromo!.code!, discount: editingPromo!.discount!, type: editingPromo!.type!, maxUses: editingPromo!.maxUses!, expiresAt: editingPromo!.validUntil || undefined, validFrom: editingPromo!.validFrom || undefined }); }} className="bg-[#06b6d4] text-background">{isRTL ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Promotion Form Dialog */}
      <Dialog open={showPromotionForm} onOpenChange={setShowPromotionForm}>
        <DialogContent className="border-border bg-primary sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-foreground">{editingPromotion?.id ? bilingual("تعديل العرض", "Edit Promotion", isRTL) : bilingual("إنشاء عرض جديد", "Create Promotion", isRTL)}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-1.5"><Label className="text-text-muted">{isRTL ? "العنوان (إنجليزي)" : "Title (English)"}</Label><Input value={editingPromotion?.titleEn || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, titleEn: e.target.value } : p))} className="border-border bg-background text-foreground" dir="ltr" /></div>
            <div className="grid gap-1.5"><Label className="text-text-muted">{isRTL ? "العنوان (عربي)" : "Title (Arabic)"}</Label><Input value={editingPromotion?.titleAr || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, titleAr: e.target.value } : p))} className="border-border bg-background text-foreground" dir="rtl" /></div>
            <div className="grid gap-1.5"><Label className="text-text-muted">{isRTL ? "الوصف (إنجليزي)" : "Subtitle (English)"}</Label><Input value={editingPromotion?.subtitleEn || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, subtitleEn: e.target.value } : p))} className="border-border bg-background text-foreground" dir="ltr" /></div>
            <div className="grid gap-1.5"><Label className="text-text-muted">{isRTL ? "نص الخصم" : "Discount Text"}</Label><Input value={editingPromotion?.discountText || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, discountText: e.target.value } : p))} className="border-border bg-background text-foreground" dir="ltr" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5"><Label className="text-text-muted">{isRTL ? "تاريخ البداية" : "Start Date"}</Label><Input type="date" value={editingPromotion?.startDate || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, startDate: e.target.value } : p))} className="border-border bg-background text-foreground" /></div>
              <div className="grid gap-1.5"><Label className="text-text-muted">{isRTL ? "تاريخ النهاية" : "End Date"}</Label><Input type="date" value={editingPromotion?.endDate || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, endDate: e.target.value } : p))} className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="flex items-center gap-3"><Switch checked={editingPromotion?.showCountdown ?? true} onCheckedChange={(v) => setEditingPromotion((p) => (p ? { ...p, showCountdown: v } : p))} /><Label className="text-text-muted">{isRTL ? "إظهار العد التنازلي" : "Show Countdown"}</Label></div>
            <div className="flex items-center gap-3"><Switch checked={editingPromotion?.isActive ?? true} onCheckedChange={(v) => setEditingPromotion((p) => (p ? { ...p, isActive: v } : p))} /><Label className="text-text-muted">{isRTL ? "نشط" : "Active"}</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPromotionForm(false)} className="border-border text-text-muted">{isRTL ? "إلغاء" : "Cancel"}</Button>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Button onClick={() => { if (editingPromotion?.id) updatePromotion.mutate(editingPromotion as any); else createPromotion.mutate({ ...editingPromotion!, startsAt: editingPromotion!.startDate, endsAt: editingPromotion!.endDate } as any); }} className="bg-[#06b6d4] text-background">{isRTL ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ NEW COURSE DIALOG ═══════════════ */}
      <Dialog open={showCourseForm} onOpenChange={setShowCourseForm}>
        <DialogContent className="bg-[#0d1420] border-border max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">{isRTL ? "إنشاء كورس جديد" : "Create New Course"}</DialogTitle>
            <DialogDescription className="text-text-muted">{isRTL ? "أضف كورساً جديداً ثم أضف دروسه من زر الدروس" : "Create a course, then add lessons via the Lessons button"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-text-muted">{isRTL ? "الـ Slug (رابط)" : "Slug (URL)"}</Label>
                <Input value={courseForm.slug} onChange={(e) => setCourseForm((f) => ({ ...f, slug: e.target.value }))} placeholder="etap-basics" className="border-border bg-background text-foreground" />
              </div>
              <div className="space-y-1">
                <Label className="text-text-muted">{isRTL ? "التصنيف" : "Category"}</Label>
                <Select value={courseForm.categoryId ? String(courseForm.categoryId) : undefined} onValueChange={(v) => setCourseForm((f) => ({ ...f, categoryId: Number(v) }))}>
                  <SelectTrigger className="border-border bg-background text-foreground"><SelectValue placeholder={isRTL ? "اختر" : "Select"} /></SelectTrigger>
                  <SelectContent>
                    {((adminCategories as unknown as CategoryItem[] | undefined) ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{lang === "en" ? c.nameEn : c.nameAr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (إنجليزي)" : "Title (EN)"}</Label><Input value={courseForm.titleEn} onChange={(e) => setCourseForm((f) => ({ ...f, titleEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (عربي)" : "Title (AR)"}</Label><Input value={courseForm.titleAr} onChange={(e) => setCourseForm((f) => ({ ...f, titleAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "وصف قصير (إنجليزي)" : "Short desc (EN)"}</Label><Input value={courseForm.shortDescEn} onChange={(e) => setCourseForm((f) => ({ ...f, shortDescEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "وصف قصير (عربي)" : "Short desc (AR)"}</Label><Input value={courseForm.shortDescAr} onChange={(e) => setCourseForm((f) => ({ ...f, shortDescAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الوصف الكامل (إنجليزي)" : "Full description (EN)"}</Label><Textarea rows={3} value={courseForm.descriptionEn} onChange={(e) => setCourseForm((f) => ({ ...f, descriptionEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
            <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الوصف الكامل (عربي)" : "Full description (AR)"}</Label><Textarea rows={3} value={courseForm.descriptionAr} onChange={(e) => setCourseForm((f) => ({ ...f, descriptionAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "السعر (EGP)" : "Price (EGP)"}</Label><Input type="number" min={0} value={courseForm.price} onChange={(e) => setCourseForm((f) => ({ ...f, price: Number(e.target.value) }))} className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1">
                <Label className="text-text-muted">{isRTL ? "المستوى" : "Level"}</Label>
                <Select value={courseForm.level} onValueChange={(v) => setCourseForm((f) => ({ ...f, level: v }))}>
                  <SelectTrigger className="border-border bg-background text-foreground"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">{isRTL ? "مبتدئ" : "Beginner"}</SelectItem>
                    <SelectItem value="intermediate">{isRTL ? "متوسط" : "Intermediate"}</SelectItem>
                    <SelectItem value="advanced">{isRTL ? "متقدم" : "Advanced"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "رابط الصورة" : "Thumbnail URL"}</Label><Input value={courseForm.thumbnailUrl} onChange={(e) => setCourseForm((f) => ({ ...f, thumbnailUrl: e.target.value }))} placeholder="/course-etap.jpg" className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2"><Switch checked={courseForm.isPremium} onCheckedChange={(v) => setCourseForm((f) => ({ ...f, isPremium: v }))} /><Label className="text-text-muted">{isRTL ? "مدفوع" : "Premium"}</Label></div>
              <div className="flex items-center gap-2"><Switch checked={courseForm.isPublished} onCheckedChange={(v) => setCourseForm((f) => ({ ...f, isPublished: v }))} /><Label className="text-text-muted">{isRTL ? "منشور" : "Published"}</Label></div>
              <div className="flex items-center gap-2"><Switch checked={courseForm.isFeatured} onCheckedChange={(v) => setCourseForm((f) => ({ ...f, isFeatured: v }))} /><Label className="text-text-muted">{isRTL ? "مميز" : "Featured"}</Label></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCourseForm(false)} className="border-border text-text-muted">{isRTL ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={submitCourseForm} disabled={createCourse.isPending} className="bg-[#06b6d4] text-background">{createCourse.isPending ? (isRTL ? "جارٍ الإنشاء..." : "Creating...") : (isRTL ? "إنشاء" : "Create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ LESSONS MANAGER DIALOG ═══════════════ */}
      <Dialog open={!!lessonsCourse} onOpenChange={(open) => { if (!open) setLessonsCourse(null); }}>
        <DialogContent className="bg-[#0d1420] border-border max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">{isRTL ? `دروس: ${lessonsCourse?.titleAr ?? ""}` : `Lessons: ${lessonsCourse?.titleEn ?? ""}`}</DialogTitle>
            <DialogDescription className="text-text-muted">{(lessonsData?.items as LessonItem[] | undefined)?.length ?? 0} {isRTL ? "درس — الفيديو رابط يوتيوب من البلايليست (يُبث جوه الموقع) أو مفتاح R2" : "lessons — each video is a YouTube playlist link (streams in-site) or an R2 key"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {((lessonsData?.items as LessonItem[] | undefined) ?? []).length === 0 && (
              <p className="text-sm text-text-muted text-center py-6">{isRTL ? "لا توجد دروس بعد — اضغط إضافة درس" : "No lessons yet — click Add Lesson"}</p>
            )}
            {((lessonsData?.items as LessonItem[] | undefined) ?? []).map((lesson, idx) => {
              const lessonYtId = extractYouTubeId(lesson.videoUrl);
              return (
              <div key={lesson.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                <span className="w-6 h-6 shrink-0 rounded-full bg-[#1f2d44] text-accent-secondary text-xs flex items-center justify-center">{idx + 1}</span>
                {lessonYtId && (
                  <img
                    src={buildYouTubeThumbnailUrl(lessonYtId, "mq")}
                    alt=""
                    loading="lazy"
                    className="h-10 w-[72px] shrink-0 rounded-md object-cover border border-border"
                    onError={(e) => { e.currentTarget.style.opacity = "0.2"; }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{lang === "en" ? lesson.titleEn : lesson.titleAr}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                    {lessonYtId ? (
                      <span className="inline-flex items-center gap-1 rounded bg-[rgba(255,59,48,0.14)] px-1.5 py-0.5 text-[10px] font-semibold text-[#ff6b6b]">
                        <Youtube className="h-3 w-3" />{isRTL ? "يوتيوب" : "YouTube"}
                      </span>
                    ) : lesson.videoUrl ? (
                      <span className="inline-flex items-center gap-1 rounded bg-[rgba(6,182,212,0.14)] px-1.5 py-0.5 text-[10px] font-semibold text-accent-secondary">
                        <Shield className="h-3 w-3" />{isRTL ? "R2 / رابط" : "R2 / link"}
                      </span>
                    ) : (
                      <span>{isRTL ? "بدون فيديو" : "no video"}</span>
                    )}
                    <span>{lesson.durationMinutes ?? 0} min</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  {lesson.isFree && <Badge className="bg-[rgba(16,185,129,0.15)] text-emerald-500 text-[10px]">{isRTL ? "مجاني" : "Free"}</Badge>}
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-text-muted" aria-label={isRTL ? "تحريك لأعلى" : "Move up"} disabled={idx === 0 || moveLesson.isPending} onClick={() => moveLesson.mutate({ id: lesson.id, direction: "up" })} data-testid={`lesson-move-up-${lesson.id}`}><ChevronUp className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-text-muted" aria-label={isRTL ? "تحريك لأسفل" : "Move down"} disabled={idx === (((lessonsData?.items as LessonItem[] | undefined) ?? []).length - 1) || moveLesson.isPending} onClick={() => moveLesson.mutate({ id: lesson.id, direction: "down" })} data-testid={`lesson-move-down-${lesson.id}`}><ChevronDown className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-accent-secondary" title={isRTL ? "بنك أسئلة الاختبار" : "Quiz question bank"} aria-label={isRTL ? "بنك أسئلة الاختبار" : "Quiz question bank"} onClick={() => { setQuizLesson(lesson); setShowQuizForm(false); }} data-testid={`lesson-quiz-${lesson.id}`}><ListChecks className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-accent-secondary" onClick={() => openLessonForm(lesson)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => { if (window.confirm(isRTL ? "حذف هذا الدرس؟" : "Delete this lesson?")) deleteLesson.mutate({ id: lesson.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              );
            })}
                <div className="flex flex-wrap items-center gap-2 py-2">
                  <Button variant="outline" className="flex-1 border-dashed border-border text-accent-secondary hover:bg-[rgba(6,182,212,0.05)] min-h-11" onClick={() => openLessonForm()}>
                    <Plus className="h-4 w-4 mr-1" />{isRTL ? "إضافة درس" : "Add Lesson"}
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 border-[rgba(255,59,48,0.35)] text-[#ff5f57] hover:bg-[rgba(255,59,48,0.08)] min-h-11"
                    onClick={() => { if (lessonsCourse) importAllPlaylist.mutate({ courseId: lessonsCourse.id }); }}
                    disabled={importAllPlaylist.isPending}
                    data-testid="import-all-playlist"
                  >
                    {importAllPlaylist.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ListVideo className="h-4 w-4 mr-1" />}
                    {importAllPlaylist.isPending
                      ? (isRTL ? "جارٍ الاستيراد..." : "Importing...")
                      : (isRTL ? "استيراد كل فيديوهات البلايليست" : "Import ALL playlist videos")}
                  </Button>
                </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ LESSON FORM DIALOG ═══════════════ */}
      <Dialog open={showLessonForm} onOpenChange={setShowLessonForm}>
        <DialogContent className="bg-[#0d1420] border-border max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">{editingLesson ? (isRTL ? "تعديل الدرس" : "Edit Lesson") : (isRTL ? "درس جديد" : "New Lesson")}</DialogTitle>
            <DialogDescription className="text-text-muted">{isRTL ? "رابط يوتيوب من بلايليست القناة (يُبث جوه الموقع) أو مفتاح R2 مثل etap/lesson01.mp4" : "A YouTube playlist link (streams in-site) or an R2 key like etap/lesson01.mp4"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (إنجليزي)" : "Title (EN)"}</Label><Input value={lessonForm.titleEn} onChange={(e) => setLessonForm((f) => ({ ...f, titleEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (عربي)" : "Title (AR)"}</Label><Input value={lessonForm.titleAr} onChange={(e) => setLessonForm((f) => ({ ...f, titleAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الوصف (إنجليزي)" : "Description (EN)"}</Label><Textarea rows={2} value={lessonForm.descriptionEn} onChange={(e) => setLessonForm((f) => ({ ...f, descriptionEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الوصف (عربي)" : "Description (AR)"}</Label><Textarea rows={2} value={lessonForm.descriptionAr} onChange={(e) => setLessonForm((f) => ({ ...f, descriptionAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-text-muted">{isRTL ? "رابط الفيديو" : "Video URL"}</Label>
                <button
                  type="button"
                  onClick={() => setShowPlaylistImport(true)}
                  className="inline-flex items-center gap-1 rounded-md bg-[rgba(255,59,48,0.08)] px-2 py-1 text-[11px] font-semibold text-[#ff5f57] transition-colors hover:bg-[rgba(255,59,48,0.16)]"
                >
                  <Youtube className="h-3.5 w-3.5" />
                  {isRTL ? "استيراد من بلايليست اليوتيوب" : "Import from YouTube playlist"}
                </button>
              </div>
              <Input value={lessonForm.videoUrl} onChange={(e) => setLessonForm((f) => ({ ...f, videoUrl: e.target.value }))} placeholder={isRTL ? "https://www.youtube.com/watch?v=... أو etap/lesson01.mp4" : "https://www.youtube.com/watch?v=... or etap/lesson01.mp4"} dir={extractYouTubeId(lessonForm.videoUrl) ? "ltr" : undefined} className="border-border bg-background text-foreground" />
              {extractYouTubeId(lessonForm.videoUrl) ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1 text-[11px] font-medium text-[#22d3ee]">
                    <Youtube className="h-3 w-3" />
                    {isRTL ? "يوتيوب ✓ — هيُبث جوه الموقع من البلايليست بدون تحميل على السيرفر" : "YouTube ✓ — streams inside the site from the playlist, nothing hosted here"}
                  </p>
                  <button
                    type="button"
                    onClick={() => syncYouTubeTitle.mutate({ url: lessonForm.videoUrl })}
                    disabled={syncYouTubeTitle.isPending}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-[rgba(34,211,238,0.1)] px-2 py-1 text-[11px] font-semibold text-[#22d3ee] transition-colors hover:bg-[rgba(34,211,238,0.2)] disabled:opacity-50"
                  >
                    <Youtube className="h-3 w-3" />
                    {syncYouTubeTitle.isPending
                      ? (isRTL ? "جاري الجلب..." : "Fetching...")
                      : (isRTL ? "استخدم عنوان اليوتيوب الرسمي" : "Use official YouTube title")}
                  </button>
                </div>
              ) : lessonForm.videoUrl.trim() ? (
                <p className="text-[11px] text-text-muted">{isRTL ? "رابط مباشر / مفتاح R2 — هيُبث من مشغل المنصة المحمي" : "Direct link / R2 key — plays in the protected self-hosted player"}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "المدة (دقائق)" : "Duration (min)"}</Label><Input type="number" min={0} max={1440} value={lessonForm.durationMinutes} onChange={(e) => setLessonForm((f) => ({ ...f, durationMinutes: Number(e.target.value) }))} className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2"><Switch checked={lessonForm.isFree} onCheckedChange={(v) => setLessonForm((f) => ({ ...f, isFree: v }))} /><Label className="text-text-muted">{isRTL ? "معاينة مجانية" : "Free preview"}</Label></div>
              <div className="flex items-center gap-2"><Switch checked={lessonForm.isPublished} onCheckedChange={(v) => setLessonForm((f) => ({ ...f, isPublished: v }))} /><Label className="text-text-muted">{isRTL ? "منشور" : "Published"}</Label></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLessonForm(false)} className="border-border text-text-muted">{isRTL ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={submitLessonForm} disabled={createLesson.isPending || updateLesson.isPending} className="bg-[#06b6d4] text-background">{isRTL ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ YOUTUBE PLAYLIST IMPORT DIALOG ═══════════════ */}
      {/* One-click lesson → playlist-video binding: lists the channel's
          playlist (the same multi-source pipeline the notification watcher
          uses), and fills the lesson form with the chosen watch link. */}
      <Dialog open={showPlaylistImport} onOpenChange={setShowPlaylistImport}>
        <DialogContent className="bg-[#0d1420] border-border max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <Youtube className="h-4 w-4 text-[#ff5f57]" />
              {isRTL ? "فيديوهات بلايليست القناة" : "Channel playlist videos"}
            </DialogTitle>
            <DialogDescription className="text-text-muted">
              {isRTL
                ? "قائمة حية من بلايليست القناة — نفس الفيديوهات الموجودة فعلاً على يوتيوب ونفس عناوينها حرفياً. اختار فيديو والرابط والعنوان بيتملّوا لوحدهم"
                : "Live view of the channel playlist — exactly the videos that exist on YouTube with their exact titles. Pick one and both the link and the title auto-fill"}
            </DialogDescription>
          </DialogHeader>
          <PlaylistImportList
            isRTL={isRTL}
            onPick={({ watchUrl, title }) => {
              setLessonForm((f) => ({ ...f, videoUrl: watchUrl, titleAr: title, titleEn: title }));
              setShowPlaylistImport(false);
              toast.success(isRTL ? "الفيديو اتحط بعنوانه الرسمي من يوتيوب حرفياً — اضغط حفظ" : "Video set with its exact YouTube title — press Save");
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPlaylistImport(false)} className="border-border text-text-muted">{isRTL ? "إغلاق" : "Close"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ═══════════════ ARTICLE FORM DIALOG ═══════════════ */}
      <Dialog open={showArticleForm} onOpenChange={setShowArticleForm}>
        <DialogContent className="bg-[#0d1420] border-border max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">{articleForm.id ? (isRTL ? "تعديل المقال" : "Edit Article") : (isRTL ? "مقال جديد" : "New Article")}</DialogTitle>
            <DialogDescription className="text-text-muted">{isRTL ? "المحتوى نصي — فقرات بأسطر فارغة، ## للعناوين الفرعية، - للقوائم" : "Plain text — blank-line paragraphs, ## subheadings, - list items"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (عربي)" : "Title (AR)"}</Label><Input value={articleForm.titleAr} onChange={(e) => setArticleForm((f) => ({ ...f, titleAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (إنجليزي)" : "Title (EN)"}</Label><Input value={articleForm.titleEn} onChange={(e) => setArticleForm((f) => ({ ...f, titleEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الـ Slug (اختياري)" : "Slug (optional)"}</Label><Input value={articleForm.slug} onChange={(e) => setArticleForm((f) => ({ ...f, slug: e.target.value }))} placeholder="etap-guide" dir="ltr" className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الفئة" : "Category"}</Label><Input value={articleForm.category} onChange={(e) => setArticleForm((f) => ({ ...f, category: e.target.value }))} className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "المقتطف (عربي)" : "Excerpt (AR)"}</Label><Textarea rows={2} value={articleForm.excerptAr} onChange={(e) => setArticleForm((f) => ({ ...f, excerptAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "المقتطف (إنجليزي)" : "Excerpt (EN)"}</Label><Textarea rows={2} value={articleForm.excerptEn} onChange={(e) => setArticleForm((f) => ({ ...f, excerptEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الوسوم (فاصلة بينها)" : "Tags (comma-separated)"}</Label><Input value={articleForm.tags} onChange={(e) => setArticleForm((f) => ({ ...f, tags: e.target.value }))} placeholder="ETAP, تحليل أنظمة" className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "رابط صورة الغلاف" : "Cover image URL"}</Label><Input value={articleForm.coverImage} onChange={(e) => setArticleForm((f) => ({ ...f, coverImage: e.target.value }))} placeholder="/course-etap.jpg" dir="ltr" className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "المحتوى (عربي)" : "Content (AR)"}</Label><Textarea rows={12} value={articleForm.contentAr} onChange={(e) => setArticleForm((f) => ({ ...f, contentAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground leading-relaxed" /></div>
            <div className="flex items-center gap-6 pt-1">
              <div className="flex items-center gap-2"><Switch checked={articleForm.isPublished} onCheckedChange={(v) => setArticleForm((f) => ({ ...f, isPublished: v }))} /><Label className="text-text-muted">{isRTL ? "نشر" : "Published"}</Label></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowArticleForm(false)} className="border-border text-text-muted">{isRTL ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={submitArticleForm} disabled={createArticle.isPending || updateArticle.isPending} className="bg-[#06b6d4] text-background">{isRTL ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ CATEGORIES MANAGER DIALOG ═══════════════ */}
      <Dialog open={showCats} onOpenChange={setShowCats}>
        <DialogContent className="bg-[#0d1420] border-border max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="categories-dialog">
          <DialogHeader>
            <DialogTitle className="text-foreground">{isRTL ? "إدارة التصنيفات" : "Manage Categories"}</DialogTitle>
            <DialogDescription className="text-text-muted">{isRTL ? "التصنيفات تظهر في صفحة الكورسات والفلاتر — لا يمكن حذف تصنيف فيه كورسات" : "Categories appear on the courses page and filters — a category with courses cannot be deleted"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {((adminCats?.items as CatItem[] | undefined) ?? []).length === 0 && (
              <p className="text-sm text-text-muted text-center py-4">{isRTL ? "لا توجد تصنيفات بعد" : "No categories yet"}</p>
            )}
            {((adminCats?.items as CatItem[] | undefined) ?? []).map((cat) => (
              <div key={cat.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3" data-testid={`category-row-${cat.id}`}>
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.12)]"><FolderTree className="h-4 w-4 text-accent-secondary" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{isRTL ? cat.nameAr : cat.nameEn} <span className="text-text-faint" dir="ltr">/{cat.slug}</span></p>
                  <p className="text-xs text-text-muted">{cat.courseCount} {isRTL ? "كورس" : "courses"} · {isRTL ? "ترتيب" : "order"} {cat.sortOrder}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-accent-secondary" aria-label={isRTL ? "تعديل" : "Edit"} onClick={() => { setCatForm({ id: cat.id, slug: cat.slug, nameEn: cat.nameEn, nameAr: cat.nameAr, icon: cat.icon, sortOrder: cat.sortOrder }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" aria-label={isRTL ? "حذف" : "Delete"} disabled={cat.courseCount > 0 || deleteCategory.isPending} onClick={() => { if (window.confirm(isRTL ? `حذف التصنيف «${cat.nameAr}»؟` : `Delete category "${cat.nameEn}"?`)) deleteCategory.mutate({ id: cat.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full border-dashed border-border text-accent-secondary hover:bg-[rgba(6,182,212,0.05)] min-h-11" onClick={() => setCatForm({ slug: "", nameEn: "", nameAr: "", icon: "book", sortOrder: 0 })} data-testid="add-category">
              <Plus className="h-4 w-4 mr-1" />{isRTL ? "تصنيف جديد" : "New Category"}
            </Button>
          </div>
          <div className="grid gap-3 border-t border-border pt-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label className="text-text-muted text-xs">{isRTL ? "الاسم (عربي)" : "Name (AR)"}</Label><Input value={catForm.nameAr} onChange={(e) => setCatForm((f) => ({ ...f, nameAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" data-testid="category-name-ar" /></div>
              <div className="space-y-1"><Label className="text-text-muted text-xs">{isRTL ? "الاسم (إنجليزي)" : "Name (EN)"}</Label><Input value={catForm.nameEn} onChange={(e) => setCatForm((f) => ({ ...f, nameEn: e.target.value }))} className="border-border bg-background text-foreground" data-testid="category-name-en" /></div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label className="text-text-muted text-xs">{isRTL ? "المعرف (slug)" : "Slug"}</Label><Input value={catForm.slug} onChange={(e) => setCatForm((f) => ({ ...f, slug: e.target.value }))} placeholder="power-systems" dir="ltr" disabled={!!catForm.id} className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted text-xs">{isRTL ? "الأيقونة" : "Icon"}</Label><Input value={catForm.icon} onChange={(e) => setCatForm((f) => ({ ...f, icon: e.target.value }))} dir="ltr" className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted text-xs">{isRTL ? "الترتيب" : "Sort order"}</Label><Input type="number" value={catForm.sortOrder} onChange={(e) => setCatForm((f) => ({ ...f, sortOrder: Number(e.target.value) || 0 }))} className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="flex justify-end gap-2">
              {catForm.id && <Button variant="outline" className="border-border text-text-muted" onClick={() => setCatForm({ slug: "", nameEn: "", nameAr: "", icon: "book", sortOrder: 0 })}>{isRTL ? "جديد" : "New"}</Button>}
              <Button onClick={submitCatForm} disabled={createCategory.isPending || updateCategory.isPending} className="bg-[#06b6d4] text-background" data-testid="save-category">
                <Save className="h-3.5 w-3.5 mr-1" />{catForm.id ? (isRTL ? "حفظ التعديل" : "Save changes") : (isRTL ? "إنشاء" : "Create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ QUIZ QUESTION BANK DIALOG ═══════════════ */}
      <Dialog open={!!quizLesson} onOpenChange={(open) => { if (!open) { setQuizLesson(null); setShowQuizForm(false); } }}>
        <DialogContent className="bg-[#0d1420] border-border max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="quiz-dialog">
          <DialogHeader>
            <DialogTitle className="text-foreground">{isRTL ? `أسئلة اختبار: ${quizLesson?.titleAr ?? ""}` : `Quiz: ${quizLesson?.titleEn ?? ""}`}</DialogTitle>
            <DialogDescription className="text-text-muted">
              {isRTL
                ? "الشهادة تشترط معدلاً ≥70% — أضف أسئلة بخيارات صحيحة واضحة. الإجابة الصحيحة تُخبَّر للطالب أبداً."
                : "Certificates require a ≥70% average — add clear questions. The correct answer is never sent to students."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {((quizData?.items as QuizItem[] | undefined) ?? []).length === 0 && (
              <p className="text-sm text-text-muted text-center py-4" data-testid="quiz-empty">{isRTL ? "لا توجد أسئلة بعد — أضف أول سؤال" : "No questions yet — add the first one"}</p>
            )}
            {((quizData?.items as QuizItem[] | undefined) ?? []).map((q, i) => (
              <div key={q.id} className="rounded-lg border border-border bg-background p-3" data-testid={`quiz-row-${q.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{i + 1}. {isRTL ? q.questionAr : q.questionEn}</p>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-accent-secondary" aria-label={isRTL ? "تعديل" : "Edit"} onClick={() => openQuizForm(q)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" aria-label={isRTL ? "حذف" : "Delete"} onClick={() => { if (window.confirm(isRTL ? "حذف هذا السؤال؟" : "Delete this question?")) deleteQuizQuestion.mutate({ id: q.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(isRTL ? (q.optionsAr ?? []) : (q.optionsEn ?? [])).map((opt, oi) => (
                    <span key={oi} className={`rounded px-2 py-0.5 text-[11px] ${oi === q.correctIndex ? "bg-[rgba(16,185,129,0.15)] text-emerald-500 font-semibold" : "bg-[rgba(31,45,68,0.6)] text-text-muted"}`}>
                      {oi === q.correctIndex ? "✓ " : ""}{opt}
                    </span>
                  ))}
                  <span className="rounded bg-[rgba(245,158,11,0.12)] px-2 py-0.5 text-[10px] text-amber-500">{q.points} {isRTL ? "نقطة" : "pts"}</span>
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full border-dashed border-border text-accent-secondary hover:bg-[rgba(6,182,212,0.05)] min-h-11" onClick={() => openQuizForm()} data-testid="add-quiz-question">
              <Plus className="h-4 w-4 mr-1" />{isRTL ? "سؤال جديد" : "New Question"}
            </Button>
          </div>
          {showQuizForm && (
            <div className="grid gap-3 border-t border-border pt-3" data-testid="quiz-form">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label className="text-text-muted text-xs">{isRTL ? "السؤال (عربي)" : "Question (AR)"}</Label><Textarea rows={2} value={quizForm.questionAr} onChange={(e) => setQuizForm((f) => ({ ...f, questionAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" data-testid="quiz-question-ar" /></div>
                <div className="space-y-1"><Label className="text-text-muted text-xs">{isRTL ? "السؤال (إنجليزي)" : "Question (EN)"}</Label><Textarea rows={2} value={quizForm.questionEn} onChange={(e) => setQuizForm((f) => ({ ...f, questionEn: e.target.value }))} className="border-border bg-background text-foreground" data-testid="quiz-question-en" /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1"><Label className="text-text-muted text-xs">{isRTL ? "الخيارات العربية (خيار في كل سطر)" : "Arabic options (one per line)"}</Label><Textarea rows={4} value={quizForm.optionsAr} onChange={(e) => setQuizForm((f) => ({ ...f, optionsAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" data-testid="quiz-options-ar" /></div>
                <div className="space-y-1"><Label className="text-text-muted text-xs">{isRTL ? "الخيارات الإنجليزية (خيار في كل سطر)" : "English options (one per line)"}</Label><Textarea rows={4} value={quizForm.optionsEn} onChange={(e) => setQuizForm((f) => ({ ...f, optionsEn: e.target.value }))} className="border-border bg-background text-foreground" data-testid="quiz-options-en" /></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-text-muted text-xs">{isRTL ? "رقم الإجابة الصحيحة" : "Correct option index"}</Label>
                  <Select value={String(quizForm.correctIndex)} onValueChange={(v) => setQuizForm((f) => ({ ...f, correctIndex: Number(v) }))}>
                    <SelectTrigger className="border-border bg-background text-foreground" data-testid="quiz-correct-index"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[0, 1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{isRTL ? `الخيار ${n + 1}` : `Option ${n + 1}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label className="text-text-muted text-xs">{isRTL ? "النقاط" : "Points"}</Label><Input type="number" min={1} max={100} value={quizForm.points} onChange={(e) => setQuizForm((f) => ({ ...f, points: Number(e.target.value) || 10 }))} className="border-border bg-background text-foreground" /></div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" className="border-border text-text-muted" onClick={() => setShowQuizForm(false)}>{isRTL ? "إلغاء" : "Cancel"}</Button>
                <Button onClick={submitQuizForm} disabled={createQuizQuestion.isPending || updateQuizQuestion.isPending} className="bg-[#06b6d4] text-background" data-testid="save-quiz-question">
                  <Save className="h-3.5 w-3.5 mr-1" />{quizForm.id ? (isRTL ? "حفظ التعديل" : "Save changes") : (isRTL ? "إضافة السؤال" : "Add question")}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══════════════ COURSE ROSTER (ENROLLMENTS) DIALOG ═══════════════ */}
      <Dialog open={!!rosterCourse} onOpenChange={(open) => { if (!open) setRosterCourse(null); }}>
        <DialogContent className="bg-[#0d1420] border-border max-w-3xl max-h-[85vh] overflow-y-auto" data-testid="roster-dialog">
          <DialogHeader>
            <DialogTitle className="text-foreground">{isRTL ? `طلاب: ${rosterCourse?.titleAr ?? ""}` : `Students: ${rosterCourse?.titleEn ?? ""}`}</DialogTitle>
            <DialogDescription className="text-text-muted">{isRTL ? "منح وصول يدوياً لمن دفع خارج المنصة، أو اسحب الوصول — كل شيء يُحدَّث فوراً" : "Grant access manually (e.g. paid off-platform) or revoke it — everything updates instantly"}</DialogDescription>
          </DialogHeader>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-1.5 py-1" data-testid="roster-filters">
            {(["all", "active", "completed", "refunded", "cancelled"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setRosterStatus(s)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${rosterStatus === s ? "bg-[#06b6d4] text-background" : "border border-border text-text-muted hover:bg-[rgba(6,182,212,0.06)]"}`}
                data-testid={`roster-filter-${s}`}
              >
                {s === "all" ? (isRTL ? "الكل" : "All")
                  : s === "active" ? (isRTL ? "نشط" : "Active")
                  : s === "completed" ? (isRTL ? "مكتمل" : "Completed")
                  : s === "refunded" ? (isRTL ? "مسترد" : "Refunded")
                  : (isRTL ? "ملغى" : "Cancelled")}
                {rosterCounts && typeof rosterCounts[s] === "number" ? ` (${rosterCounts[s]})` : ""}
              </button>
            ))}
          </div>

          {/* Manual grant */}
          <div className="rounded-lg border border-border bg-background p-3 space-y-2" data-testid="grant-box">
            <div className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-emerald-500" />
              <p className="text-sm font-medium text-foreground">{isRTL ? "منح وصول يدوي" : "Manual grant"}</p>
            </div>
            <Input value={grantQuery} onChange={(e) => setGrantQuery(e.target.value)} placeholder={isRTL ? "ابحث بالبريد أو اسم المستخدم (حرفان على الأقل)..." : "Search by email or username (min 2 chars)..."} className="border-border bg-primary text-foreground" data-testid="grant-search" />
            {grantQuery.trim().length >= 2 && ((grantUsers?.items as { id: number; username: string; email: string; fullName: string | null }[] | undefined) ?? []).length > 0 && (
              <div className="grid gap-1 max-h-40 overflow-y-auto">
                {((grantUsers?.items as { id: number; username: string; email: string; fullName: string | null }[] | undefined) ?? []).map((u) => (
                  <button
                    key={u.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-start hover:bg-[rgba(6,182,212,0.06)]"
                    onClick={() => { if (rosterCourse) grantEnrollment.mutate({ courseId: rosterCourse.id, userId: u.id }); }}
                    data-testid={`grant-user-${u.id}`}
                  >
                    <span className="text-sm text-foreground truncate">{u.fullName || u.username} <span className="text-text-faint" dir="ltr">({u.email})</span></span>
                    <span className="text-xs font-semibold text-emerald-500">{isRTL ? "تسجيل" : "Enroll"}</span>
                  </button>
                ))}
              </div>
            )}
            {grantQuery.trim().length >= 2 && ((grantUsers?.items as unknown[] | undefined) ?? []).length === 0 && (
              <p className="text-xs text-text-faint">{isRTL ? "لا نتائج مطابقة" : "No matching users"}</p>
            )}
          </div>

          {/* Roster list */}
          <div className="space-y-2" data-testid="roster-list">
            <Input value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} placeholder={isRTL ? "تصفية القائمة الحالية..." : "Filter current list..."} className="border-border bg-background text-foreground" />
            {((rosterData?.items as RosterRow[] | undefined) ?? []).length === 0 && (
              <p className="text-sm text-text-muted text-center py-4" data-testid="roster-empty">{isRTL ? "لا يوجد طلاب مطابقون" : "No matching students"}</p>
            )}
            {((rosterData?.items as RosterRow[] | undefined) ?? []).map((row) => (
              <div key={row.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3" data-testid={`roster-row-${row.id}`}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[rgba(139,92,246,0.14)] text-sm font-bold text-violet-400">{(row.fullName || row.username || "?").charAt(0).toUpperCase()}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{row.fullName || row.username}</p>
                  <p className="text-xs text-text-muted truncate" dir="ltr">{row.email} · {Math.round(Number(row.progress))}% {isRTL ? "تقدم" : "progress"}</p>
                </div>
                <Badge className={`text-[10px] ${row.status === "active" ? "bg-[rgba(16,185,129,0.15)] text-emerald-500" : row.status === "completed" ? "bg-[rgba(6,182,212,0.15)] text-accent-secondary" : "bg-[rgba(244,63,94,0.12)] text-destructive"}`}>
                  {row.status === "active" ? (isRTL ? "نشط" : "Active") : row.status === "completed" ? (isRTL ? "مكتمل" : "Completed") : row.status === "refunded" ? (isRTL ? "مسترد" : "Refunded") : (isRTL ? "ملغى" : "Cancelled")}
                </Badge>
                <div className="flex gap-1">
                  {row.status !== "active" ? (
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-emerald-500" title={isRTL ? "إعادة تفعيل" : "Reactivate"} aria-label={isRTL ? "إعادة تفعيل" : "Reactivate"} onClick={() => reactivateEnrollment.mutate({ enrollmentId: row.id })} data-testid={`reactivate-${row.id}`}><RotateCcw className="h-3.5 w-3.5" /></Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" title={isRTL ? "سحب الوصول" : "Revoke access"} aria-label={isRTL ? "سحب الوصول" : "Revoke access"} onClick={() => { if (window.confirm(isRTL ? `سحب وصول ${row.fullName || row.username} من هذا الكورس؟` : `Revoke ${row.fullName || row.username}'s access to this course?`)) revokeEnrollment.mutate({ enrollmentId: row.id }); }} data-testid={`revoke-${row.id}`}><UserMinus className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  function openArticleForm(a?: ArticleRow) {
    setArticleForm(a ? { id: a.id, slug: a.slug, titleAr: a.titleAr, titleEn: a.titleEn, excerptAr: a.excerptAr ?? "", excerptEn: a.excerptEn ?? "", contentAr: a.contentAr, coverImage: a.coverImage ?? "", category: a.category, tags: a.tags ?? "", isPublished: a.isPublished } : { ...emptyArticleForm });
    setShowArticleForm(true);
  }

  function submitArticleForm() {
    if (!articleForm.titleAr.trim() || !articleForm.titleEn.trim() || !articleForm.contentAr.trim()) {
      toast.error(isRTL ? "العنوانان والمحتوى العربي مطلوبة" : "Both titles and Arabic content are required");
      return;
    }
    const payload = { titleAr: articleForm.titleAr.trim(), titleEn: articleForm.titleEn.trim(), excerptAr: articleForm.excerptAr || undefined, excerptEn: articleForm.excerptEn || undefined, contentAr: articleForm.contentAr, coverImage: articleForm.coverImage || undefined, category: articleForm.category.trim() || "general", tags: articleForm.tags || undefined, isPublished: articleForm.isPublished, sortOrder: 0 };
    if (articleForm.id) updateArticle.mutate({ id: articleForm.id, ...payload });
    else createArticle.mutate({ slug: articleForm.slug || undefined, ...payload });
  }

  function openEditTheme(theme: ThemeItem) { setEditingTheme({ ...theme }); setThemeDialogOpen(true); }
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${Number.parseInt(result[1], 16)}, ${Number.parseInt(result[2], 16)}, ${Number.parseInt(result[3], 16)}` : "6, 182, 212";
}
