import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { motion, AnimatePresence } from "framer-motion";
import "@/elite-animations.css";
import {
  LayoutDashboard, Users, BookOpen, Headphones, DollarSign, Phone, FileText, Palette, Tag, Megaphone,
  Plus, Pencil, Trash2, Save, Eye, Zap, TrendingUp, CheckCircle, ChevronLeft, ChevronRight,
  LogOut, ArrowUpRight, Shield, PlayCircle, Newspaper,
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
import { bilingual } from "@/lib/i18n";

interface SettingItem { id?: string; key: string; value: string; section: string; type?: string; }
interface ThemeItem { id: string; name: string; primaryColor: string; secondaryColor: string; accentColor: string; bgColor: string; textColor: string; cardBgColor: string; borderColor: string; isActive: boolean; createdAt: string; }
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
  { id: "contact", icon: Phone, labelEn: "Contact", labelAr: "التواصل" },
  { id: "cms", icon: FileText, labelEn: "CMS", labelAr: "المحتوى" },
  { id: "themes", icon: Palette, labelEn: "Themes", labelAr: "الثيمات" },
  { id: "promos", icon: Tag, labelEn: "Promo Codes", labelAr: "أكواد الخصم" },
  { id: "promotions", icon: Megaphone, labelEn: "Promotions", labelAr: "العروض" },
];

export default function Admin() { // NOSONAR — admin dashboard with many CMS/CMS-settings panels, user management, and conditional rendering; extraction would require prop-drilling 15+ hooks
  const { isAuthenticated, isAdmin, isLoading } = useAuth();
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || !isAdmin)) navigate("/");
  }, [isLoading, isAuthenticated, isAdmin, navigate]);

  const utils = trpc.useUtils();
  const { data: stats } = trpc.admin.stats.useQuery(undefined, { enabled: !!isAdmin });
  const { data: analytics } = trpc.admin.analytics.useQuery(undefined, { enabled: !!isAdmin && activeTab === "dashboard" });
  const { data: usersData } = trpc.admin.users.useQuery(undefined, { enabled: !!isAdmin && activeTab === "users" });
  const { data: coursesData } = trpc.admin.listCourses.useQuery(undefined, { enabled: !!isAdmin && activeTab === "courses" });
  const { data: allTickets } = trpc.admin.tickets.useQuery(undefined, { enabled: !!isAdmin && activeTab === "tickets" });
  const { data: paymentsData } = trpc.admin.payments.useQuery(undefined, { enabled: !!isAdmin && activeTab === "payments" });
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

  if (isLoading) return <div className="flex min-h-screen items-center justify-center bg-background"><div className="h-10 w-10 animate-spin rounded-full border-4 border-border border-t-[#06b6d4]" /></div>;
  if (!isAdmin) return null;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <motion.aside initial={{ width: sidebarCollapsed ? 64 : 240 }} animate={{ width: sidebarCollapsed ? 64 : 240 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="admin-sidebar fixed left-0 top-0 z-50 h-screen flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-accent-secondary" />
              <span className="text-sm font-bold text-foreground">{t("adminPanel")}</span>
            </div>
          )}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-1.5 rounded-lg hover:bg-[#1f2d44] text-text-muted transition-colors">
            {sidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {SIDEBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <motion.button key={item.id} whileHover={{ x: 4 }} whileTap={{ scale: 0.98 }} onClick={() => setActiveTab(item.id)} className={`admin-sidebar-item w-full ${isActive ? "active" : ""}`}>
                <Icon className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && <span>{isRTL ? item.labelAr : item.labelEn}</span>}
              </motion.button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border">
          <button onClick={() => navigate("/")} className="admin-sidebar-item w-full text-destructive hover:bg-[rgba(244,63,94,0.08)]">
            <LogOut className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span>{isRTL ? "خروج" : "Exit Admin"}</span>}
          </button>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 ml-[240px] transition-all" style={{ marginLeft: sidebarCollapsed ? 64 : 240 }}>
        <div className="p-6 lg:p-8">
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>

              {/* ═══════════════════ DASHBOARD ═══════════════════ */}
              {activeTab === "dashboard" && (
                <div className="space-y-8">
                  <div>
                    <h1 className="text-2xl font-bold text-foreground">{isRTL ? "لوحة التحكم" : "Dashboard"}</h1>
                    <p className="text-sm text-text-muted mt-1">{isRTL ? "نظرة عامة على أداء المنصة" : "Platform performance overview"}</p>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {[
                      { icon: Users, label: t("totalUsers"), value: stats?.totalUsers || 0, color: "#06b6d4", change: analytics?.newUsers30d },
                      { icon: BookOpen, label: t("totalCourses"), value: stats?.totalCourses || 0, color: "#22d3ee" },
                      { icon: TrendingUp, label: t("totalEnrollments"), value: stats?.totalEnrollments || 0, color: "#10b981", change: analytics?.newEnrollments30d },
                      { icon: DollarSign, label: t("totalRevenue"), value: `${stats?.totalRevenue || 0} EGP`, color: "#f59e0b", change: analytics?.revenue30d },
                      { icon: Headphones, label: t("openTickets"), value: stats?.openTickets || 0, color: "#f43f5e" },
                    ].map((stat) => (
                      <motion.div key={stat.label} whileHover={{ y: -4 }} className="admin-stat-card p-5">
                        <div className="flex items-center justify-between">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: `rgba(${hexToRgb(stat.color)}, 0.1)` }}>
                            <stat.icon className="h-5 w-5" style={{ color: stat.color }} />
                          </div>
                          {stat.change !== undefined && stat.change > 0 && (
                            <span className="flex items-center gap-0.5 text-xs font-medium text-emerald-500">
                              <ArrowUpRight className="h-3 w-3" />+{stat.change}
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-2xl font-bold text-foreground">{stat.value}</p>
                        <p className="mt-1 text-xs text-text-muted">{stat.label}</p>
                      </motion.div>
                    ))}
                  </div>

                  {/* Quick Actions */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {[
                      { icon: BookOpen, label: isRTL ? "إدارة الكورسات" : "Manage Courses", tab: "courses", color: "#06b6d4" },
                      { icon: Users, label: isRTL ? "إدارة المستخدمين" : "Manage Users", tab: "users", color: "#10b981" },
                      { icon: FileText, label: isRTL ? "تعديل المحتوى" : "Edit Content", tab: "cms", color: "#f59e0b" },
                      { icon: Palette, label: isRTL ? "تخصيص الثيم" : "Customize Theme", tab: "themes", color: "#8b5cf6" },
                    ].map((action) => (
                      <motion.button key={action.tab} whileHover={{ y: -4, scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setActiveTab(action.tab)} className="rounded-xl border border-border bg-primary p-6 text-start hover:border-[rgba(6,182,212,0.3)] transition-all">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg mb-4" style={{ background: `rgba(${hexToRgb(action.color)}, 0.1)` }}>
                          <action.icon className="h-6 w-6" style={{ color: action.color }} />
                        </div>
                        <p className="text-sm font-semibold text-foreground">{action.label}</p>
                      </motion.button>
                    ))}
                  </div>

                  {/* Recent Activity */}
                  <div className="rounded-xl border border-border bg-primary p-6">
                    <h3 className="text-lg font-semibold text-foreground mb-4">{isRTL ? "النشاط الأخير" : "Recent Activity"}</h3>
                    <div className="space-y-3">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {allUsers.slice(0, 5).map((u: any) => (
                        <div key={u.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(6,182,212,0.1)] text-xs font-bold text-accent-secondary">{(u.name || u.username || "?").charAt(0).toUpperCase()}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground truncate">{u.name || u.username}</p>
                            <p className="text-xs text-text-faint">{u.email || "—"}</p>
                          </div>
                          <Badge variant="outline" className="border-border text-[10px] text-text-faint">{u.role}</Badge>
                        </div>
                      ))}
                      {allUsers.length === 0 && <p className="text-sm text-text-faint text-center py-8">{isRTL ? "لا يوجد نشاط بعد" : "No activity yet"}</p>}
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
                    <Button onClick={() => setShowCourseForm(true)} className="bg-[#06b6d4] text-background hover:bg-[#0891b2]">
                      <Plus className="h-4 w-4 mr-1" />{isRTL ? "كورس جديد" : "New Course"}
                    </Button>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-text-muted">{isRTL ? "الـ Slug (رابط)" : "Slug (URL)"}</Label>
                <Input value={courseForm.slug} onChange={(e) => setCourseForm((f) => ({ ...f, slug: e.target.value }))} placeholder="etap-basics" className="border-border bg-background text-foreground" />
              </div>
              <div className="space-y-1">
                <Label className="text-text-muted">{isRTL ? "التصنيف" : "Category"}</Label>
                <Select value={courseForm.categoryId ? String(courseForm.categoryId) : undefined} onValueChange={(v) => setCourseForm((f) => ({ ...f, categoryId: Number(v) }))}>
                  <SelectTrigger className="border-border bg-background text-foreground"><SelectValue placeholder={isRTL ? "اختر" : "Select"} /></SelectTrigger>
                  <SelectContent>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {((adminCategories as unknown as CategoryItem[] | undefined) ?? []).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{lang === "en" ? c.nameEn : c.nameAr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (إنجليزي)" : "Title (EN)"}</Label><Input value={courseForm.titleEn} onChange={(e) => setCourseForm((f) => ({ ...f, titleEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (عربي)" : "Title (AR)"}</Label><Input value={courseForm.titleAr} onChange={(e) => setCourseForm((f) => ({ ...f, titleAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "وصف قصير (إنجليزي)" : "Short desc (EN)"}</Label><Input value={courseForm.shortDescEn} onChange={(e) => setCourseForm((f) => ({ ...f, shortDescEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "وصف قصير (عربي)" : "Short desc (AR)"}</Label><Input value={courseForm.shortDescAr} onChange={(e) => setCourseForm((f) => ({ ...f, shortDescAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الوصف الكامل (إنجليزي)" : "Full description (EN)"}</Label><Textarea rows={3} value={courseForm.descriptionEn} onChange={(e) => setCourseForm((f) => ({ ...f, descriptionEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
            <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الوصف الكامل (عربي)" : "Full description (AR)"}</Label><Textarea rows={3} value={courseForm.descriptionAr} onChange={(e) => setCourseForm((f) => ({ ...f, descriptionAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
            <div className="grid grid-cols-3 gap-3">
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
            <DialogDescription className="text-text-muted">{(lessonsData?.items as LessonItem[] | undefined)?.length ?? 0} {isRTL ? "درس — أضف رابط الفيديو (R2 أو URL خارجي) لكل درس" : "lessons — add a video URL (R2 key or external URL) per lesson"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {((lessonsData?.items as LessonItem[] | undefined) ?? []).length === 0 && (
              <p className="text-sm text-text-muted text-center py-6">{isRTL ? "لا توجد دروس بعد — اضغط إضافة درس" : "No lessons yet — click Add Lesson"}</p>
            )}
            {((lessonsData?.items as LessonItem[] | undefined) ?? []).map((lesson, idx) => (
              <div key={lesson.id} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                <span className="w-6 h-6 shrink-0 rounded-full bg-[#1f2d44] text-accent-secondary text-xs flex items-center justify-center">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{lang === "en" ? lesson.titleEn : lesson.titleAr}</p>
                  <p className="text-xs text-text-muted truncate">{lesson.durationMinutes ?? 0} min · {lesson.videoUrl ? (isRTL ? "فيديو ✔" : "video ✔") : (isRTL ? "بدون فيديو" : "no video")}</p>
                </div>
                <div className="flex gap-1">
                  {lesson.isFree && <Badge className="bg-[rgba(16,185,129,0.15)] text-emerald-500 text-[10px]">{isRTL ? "مجاني" : "Free"}</Badge>}
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-accent-secondary" onClick={() => openLessonForm(lesson)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => { if (window.confirm(isRTL ? "حذف هذا الدرس؟" : "Delete this lesson?")) deleteLesson.mutate({ id: lesson.id }); }}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full border-dashed border-border text-accent-secondary hover:bg-[rgba(6,182,212,0.05)]" onClick={() => openLessonForm()}>
              <Plus className="h-4 w-4 mr-1" />{isRTL ? "إضافة درس" : "Add Lesson"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══════════════ LESSON FORM DIALOG ═══════════════ */}
      <Dialog open={showLessonForm} onOpenChange={setShowLessonForm}>
        <DialogContent className="bg-[#0d1420] border-border max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">{editingLesson ? (isRTL ? "تعديل الدرس" : "Edit Lesson") : (isRTL ? "درس جديد" : "New Lesson")}</DialogTitle>
            <DialogDescription className="text-text-muted">{isRTL ? "رابط الفيديو: مفتاح R2 (مثل etap/lesson01.mp4) أو رابط مباشر" : "Video URL: an R2 object key (e.g. etap/lesson01.mp4) or a direct URL"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (إنجليزي)" : "Title (EN)"}</Label><Input value={lessonForm.titleEn} onChange={(e) => setLessonForm((f) => ({ ...f, titleEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (عربي)" : "Title (AR)"}</Label><Input value={lessonForm.titleAr} onChange={(e) => setLessonForm((f) => ({ ...f, titleAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الوصف (إنجليزي)" : "Description (EN)"}</Label><Textarea rows={2} value={lessonForm.descriptionEn} onChange={(e) => setLessonForm((f) => ({ ...f, descriptionEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الوصف (عربي)" : "Description (AR)"}</Label><Textarea rows={2} value={lessonForm.descriptionAr} onChange={(e) => setLessonForm((f) => ({ ...f, descriptionAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "رابط الفيديو" : "Video URL"}</Label><Input value={lessonForm.videoUrl} onChange={(e) => setLessonForm((f) => ({ ...f, videoUrl: e.target.value }))} placeholder="etap/lesson01.mp4" className="border-border bg-background text-foreground" /></div>
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
      {/* ═══════════════ ARTICLE FORM DIALOG ═══════════════ */}
      <Dialog open={showArticleForm} onOpenChange={setShowArticleForm}>
        <DialogContent className="bg-[#0d1420] border-border max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">{articleForm.id ? (isRTL ? "تعديل المقال" : "Edit Article") : (isRTL ? "مقال جديد" : "New Article")}</DialogTitle>
            <DialogDescription className="text-text-muted">{isRTL ? "المحتوى نصي — فقرات بأسطر فارغة، ## للعناوين الفرعية، - للقوائم" : "Plain text — blank-line paragraphs, ## subheadings, - list items"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (عربي)" : "Title (AR)"}</Label><Input value={articleForm.titleAr} onChange={(e) => setArticleForm((f) => ({ ...f, titleAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "العنوان (إنجليزي)" : "Title (EN)"}</Label><Input value={articleForm.titleEn} onChange={(e) => setArticleForm((f) => ({ ...f, titleEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الـ Slug (اختياري)" : "Slug (optional)"}</Label><Input value={articleForm.slug} onChange={(e) => setArticleForm((f) => ({ ...f, slug: e.target.value }))} placeholder="etap-guide" dir="ltr" className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "الفئة" : "Category"}</Label><Input value={articleForm.category} onChange={(e) => setArticleForm((f) => ({ ...f, category: e.target.value }))} className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "المقتطف (عربي)" : "Excerpt (AR)"}</Label><Textarea rows={2} value={articleForm.excerptAr} onChange={(e) => setArticleForm((f) => ({ ...f, excerptAr: e.target.value }))} dir="rtl" className="border-border bg-background text-foreground" /></div>
              <div className="space-y-1"><Label className="text-text-muted">{isRTL ? "المقتطف (إنجليزي)" : "Excerpt (EN)"}</Label><Textarea rows={2} value={articleForm.excerptEn} onChange={(e) => setArticleForm((f) => ({ ...f, excerptEn: e.target.value }))} className="border-border bg-background text-foreground" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
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
