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
  LogOut, ArrowUpRight, Shield,
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

interface SettingItem { id?: string; key: string; value: string; section: string; type?: string; }
interface ThemeItem { id: string; name: string; primaryColor: string; secondaryColor: string; accentColor: string; bgColor: string; textColor: string; cardBgColor: string; borderColor: string; isActive: boolean; createdAt: string; }
interface PromoItem { id: string; code: string; discount: number; type: "percentage" | "fixed"; maxUses: number; usedCount: number; status: "active" | "expired" | "used_up"; validFrom: string; validUntil: string; createdAt: string; }
interface PromotionItem { id: string; titleEn: string; titleAr: string; subtitleEn: string; subtitleAr: string; discountText: string; ctaTextEn: string; ctaTextAr: string; ctaUrl: string; startDate: string; endDate: string; bgColor: string; textColor: string; buttonColor: string; position: "top" | "bottom"; showCountdown: boolean; isActive: boolean; createdAt: string; }
interface CourseItem { id: number; slug: string; titleEn: string; titleAr: string; descriptionEn: string | null; descriptionAr: string | null; thumbnailUrl: string | null; price: number; currency: string; isFeatured: boolean; isPublished: boolean; level: string; category: number | null; studentCount: number; createdAt: Date; updatedAt: Date; }

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
  { id: "tickets", icon: Headphones, labelEn: "Tickets", labelAr: "التذاكر" },
  { id: "payments", icon: DollarSign, labelEn: "Payments", labelAr: "المدفوعات" },
  { id: "contact", icon: Phone, labelEn: "Contact", labelAr: "التواصل" },
  { id: "cms", icon: FileText, labelEn: "CMS", labelAr: "المحتوى" },
  { id: "themes", icon: Palette, labelEn: "Themes", labelAr: "الثيمات" },
  { id: "promos", icon: Tag, labelEn: "Promo Codes", labelAr: "أكواد الخصم" },
  { id: "promotions", icon: Megaphone, labelEn: "Promotions", labelAr: "العروض" },
];

export default function Admin() {
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

  const updateTicket = trpc.admin.updateTicketStatus.useMutation({ onSuccess: () => { utils.admin.tickets.invalidate(); toast.success(lang === "en" ? "Ticket updated" : "تم تحديث التذكرة"); }, onError: (err) => toast.error(err.message) });
  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const replyMutation = trpc.admin.replyTicket.useMutation({ onSuccess: () => { setReplyText(""); setReplyingTo(null); utils.admin.tickets.invalidate(); toast.success(lang === "en" ? "Reply sent" : "تم إرسال الرد"); }, onError: (err) => toast.error(err.message) });
  const updateUserRole = trpc.admin.updateUserRole.useMutation({ onSuccess: () => { utils.admin.users.invalidate(); toast.success(lang === "en" ? "Role updated" : "تم تحديث الدور"); }, onError: (err) => toast.error(err.message) });
  const updateCourse = trpc.admin.updateCourse.useMutation({ onSuccess: () => { utils.admin.listCourses.invalidate(); toast.success(lang === "en" ? "Course updated" : "تم تحديث الكورس"); }, onError: (err) => toast.error(err.message) });

  /* CMS */
  const [cmsSection, setCmsSection] = useState("hero");
  const { data: cmsData, isLoading: cmsLoading } = trpc.settings.getSection.useQuery({ section: cmsSection }, { enabled: !!isAdmin && activeTab === "cms" });
  const [cmsValues, setCmsValues] = useState<Record<string, string>>({});
  const cmsSave = trpc.settings.bulkUpsert.useMutation({ onSuccess: () => { utils.settings.getSection.invalidate({ section: cmsSection }); toast.success(lang === "en" ? "Content saved" : "تم حفظ المحتوى"); }, onError: (err) => toast.error(err.message) });
  useEffect(() => {
    if (cmsData) {
      if (Array.isArray(cmsData)) { const map: Record<string, string> = {}; (cmsData as SettingItem[]).forEach((s) => { map[s.key] = s.value; }); setCmsValues(map); }
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
      if (Array.isArray(contactData)) { const map: Record<string, string> = {}; (contactData as SettingItem[]).forEach((s) => { map[s.key] = s.value; }); setContactValues(map); }
      else setContactValues(contactData as Record<string, string>);
    }
  }, [contactData]);
  const handleContactSave = () => { contactSave.mutate({ section: "contact", settings: Object.entries(contactValues).map(([key, value]) => ({ key, value, type: (key.includes("Url") ? "url" : "text") as any })) }); };

  const isRTL = lang === "ar";
  const allUsers = usersData?.items ?? [];
  const allPayments = paymentsData?.items ?? [];
  const allCourses = (coursesData as any)?.items ?? [];

  if (isLoading) return <div className="flex min-h-screen items-center justify-center bg-[#0a0e17]"><div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" /></div>;
  if (!isAdmin) return null;

  return (
    <div className="flex min-h-screen bg-[#0a0e17]">
      {/* Sidebar */}
      <motion.aside initial={{ width: sidebarCollapsed ? 64 : 240 }} animate={{ width: sidebarCollapsed ? 64 : 240 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="admin-sidebar fixed left-0 top-0 z-50 h-screen flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[#1f2d44]">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-[#06b6d4]" />
              <span className="text-sm font-bold text-[#f0f4f8]">{t("adminPanel")}</span>
            </div>
          )}
          <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="p-1.5 rounded-lg hover:bg-[#1f2d44] text-[#94a3b8] transition-colors">
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
        <div className="p-3 border-t border-[#1f2d44]">
          <button onClick={() => navigate("/")} className="admin-sidebar-item w-full text-[#f43f5e] hover:bg-[rgba(244,63,94,0.08)]">
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
                    <h1 className="text-2xl font-bold text-[#f0f4f8]">{isRTL ? "لوحة التحكم" : "Dashboard"}</h1>
                    <p className="text-sm text-[#94a3b8] mt-1">{isRTL ? "نظرة عامة على أداء المنصة" : "Platform performance overview"}</p>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                    {[
                      { icon: Users, label: t("totalUsers"), value: stats?.totalUsers || 0, color: "#06b6d4", change: analytics?.newUsers30d },
                      { icon: BookOpen, label: t("totalCourses"), value: stats?.totalCourses || 0, color: "#22d3ee" },
                      { icon: TrendingUp, label: t("totalEnrollments"), value: stats?.totalEnrollments || 0, color: "#10b981", change: analytics?.newEnrollments30d },
                      { icon: DollarSign, label: t("totalRevenue"), value: `${stats?.totalRevenue || 0} EGP`, color: "#f59e0b", change: analytics?.revenue30d },
                      { icon: Headphones, label: t("openTickets"), value: stats?.openTickets || 0, color: "#f43f5e" },
                    ].map((stat, i) => (
                      <motion.div key={i} whileHover={{ y: -4 }} className="admin-stat-card p-5">
                        <div className="flex items-center justify-between">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: `rgba(${hexToRgb(stat.color)}, 0.1)` }}>
                            <stat.icon className="h-5 w-5" style={{ color: stat.color }} />
                          </div>
                          {stat.change !== undefined && stat.change > 0 && (
                            <span className="flex items-center gap-0.5 text-xs font-medium text-[#10b981]">
                              <ArrowUpRight className="h-3 w-3" />+{stat.change}
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-2xl font-bold text-[#f0f4f8]">{stat.value}</p>
                        <p className="mt-1 text-xs text-[#94a3b8]">{stat.label}</p>
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
                    ].map((action, i) => (
                      <motion.button key={i} whileHover={{ y: -4, scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setActiveTab(action.tab)} className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6 text-start hover:border-[rgba(6,182,212,0.3)] transition-all">
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg mb-4" style={{ background: `rgba(${hexToRgb(action.color)}, 0.1)` }}>
                          <action.icon className="h-6 w-6" style={{ color: action.color }} />
                        </div>
                        <p className="text-sm font-semibold text-[#f0f4f8]">{action.label}</p>
                      </motion.button>
                    ))}
                  </div>

                  {/* Recent Activity */}
                  <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
                    <h3 className="text-lg font-semibold text-[#f0f4f8] mb-4">{isRTL ? "النشاط الأخير" : "Recent Activity"}</h3>
                    <div className="space-y-3">
                      {allUsers.slice(0, 5).map((u: any) => (
                        <div key={u.id} className="flex items-center gap-3 py-2 border-b border-[#1f2d44]/50 last:border-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(6,182,212,0.1)] text-xs font-bold text-[#06b6d4]">{(u.name || u.username || "?").charAt(0).toUpperCase()}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#f0f4f8] truncate">{u.name || u.username}</p>
                            <p className="text-xs text-[#64748b]">{u.email || "—"}</p>
                          </div>
                          <Badge variant="outline" className="border-[#1f2d44] text-[10px] text-[#64748b]">{u.role}</Badge>
                        </div>
                      ))}
                      {allUsers.length === 0 && <p className="text-sm text-[#64748b] text-center py-8">{isRTL ? "لا يوجد نشاط بعد" : "No activity yet"}</p>}
                    </div>
                  </div>
                </div>
              )}

              {/* ═══════════════════ USERS ═══════════════════ */}
              {activeTab === "users" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h1 className="text-2xl font-bold text-[#f0f4f8]">{t("totalUsers")}</h1>
                      <p className="text-sm text-[#94a3b8] mt-1">{allUsers.length} {isRTL ? "مستخدم" : "users"}</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-[#1f2d44] bg-[#111827] overflow-hidden">
                    <table className="w-full text-start text-sm">
                      <thead>
                        <tr className="border-b border-[#1f2d44] bg-[#0d1117]">
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{isRTL ? "المستخدم" : "User"}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{t("email")}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{t("role")}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{isRTL ? "تاريخ التسجيل" : "Joined"}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{isRTL ? "إجراءات" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(allUsers || []).map((u: any) => (
                          <tr key={u.id} className="border-b border-[#1f2d44]/50 hover:bg-[rgba(6,182,212,0.02)] transition-colors">
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgba(6,182,212,0.1)] text-xs font-bold text-[#06b6d4]">{(u.name || u.username || "?").charAt(0).toUpperCase()}</div>
                                <div>
                                  <p className="text-sm font-medium text-[#f0f4f8]">{u.name || u.username}</p>
                                  <p className="text-xs text-[#64748b]">@{u.username}</p>
                                </div>
                              </div>
                            </td>
                            <td className="p-4 text-[#94a3b8]">{u.email || "—"}</td>
                            <td className="p-4">
                              <Select value={u.role} onValueChange={(val) => updateUserRole.mutate({ userId: u.id, role: val as "user" | "admin" })}>
                                <SelectTrigger className="w-28 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="border-[#1f2d44] bg-[#111827]">
                                  <SelectItem value="user" className="text-[#f0f4f8]">{isRTL ? "مستخدم" : "User"}</SelectItem>
                                  <SelectItem value="admin" className="text-[#f0f4f8]">{isRTL ? "أدمن" : "Admin"}</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="p-4 text-[#64748b] text-xs">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                            <td className="p-4">
                              <Badge variant="outline" className={`border-[#1f2d44] text-xs ${u.role === "admin" ? "text-[#06b6d4] border-[#06b6d4]/30" : "text-[#94a3b8]"}`}>
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
                  <div>
                    <h1 className="text-2xl font-bold text-[#f0f4f8]">{isRTL ? "إدارة الكورسات" : "Course Management"}</h1>
                    <p className="text-sm text-[#94a3b8] mt-1">{allCourses.length} {isRTL ? "كورس" : "courses"}</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {(allCourses || []).map((course: CourseItem) => (
                      <motion.div key={course.id} whileHover={{ y: -4 }} className="rounded-xl border border-[#1f2d44] bg-[#111827] overflow-hidden">
                        <div className="h-32 bg-[#0a0e17] relative">
                          {course.thumbnailUrl ? (
                            <img src={course.thumbnailUrl} alt={lang === "en" ? course.titleEn : course.titleAr} className="w-full h-full object-cover" />
                          ) : (
                            <div className="flex items-center justify-center h-full"><BookOpen className="h-8 w-8 text-[#1f2d44]" /></div>
                          )}
                          <div className="absolute top-2 right-2 flex gap-1">
                            {course.isPublished && <Badge className="bg-[rgba(16,185,129,0.15)] text-[#10b981] text-[10px]">{isRTL ? "منشور" : "Published"}</Badge>}
                            {course.isFeatured && <Badge className="bg-[rgba(245,158,11,0.15)] text-[#f59e0b] text-[10px]">{isRTL ? "مميز" : "Featured"}</Badge>}
                          </div>
                        </div>
                        <div className="p-4 space-y-3">
                          <h3 className="text-sm font-semibold text-[#f0f4f8] truncate">{lang === "en" ? course.titleEn : course.titleAr}</h3>
                          <div className="flex items-center justify-between text-xs text-[#94a3b8]">
                            <span>{course.price} {course.currency}</span>
                            <span>{course.studentCount} {isRTL ? "طالب" : "students"}</span>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" className="flex-1 text-xs text-[#06b6d4] hover:bg-[rgba(6,182,212,0.05)]" onClick={() => {
                              const newPublished = !course.isPublished;
                              updateCourse.mutate({ id: course.id, isPublished: newPublished });
                            }}>
                              <Eye className="h-3 w-3 mr-1" />
                              {course.isPublished ? (isRTL ? "إخفاء" : "Hide") : (isRTL ? "نشر" : "Publish")}
                            </Button>
                            <Button size="sm" variant="ghost" className="flex-1 text-xs text-[#f59e0b] hover:bg-[rgba(245,158,11,0.05)]" onClick={() => {
                              updateCourse.mutate({ id: course.id, isFeatured: !course.isFeatured });
                            }}>
                              <Zap className="h-3 w-3 mr-1" />
                              {course.isFeatured ? (isRTL ? "إزالة التميز" : "Unfeature") : (isRTL ? "تمييز" : "Feature")}
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* ═══════════════════ TICKETS ═══════════════════ */}
              {activeTab === "tickets" && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold text-[#f0f4f8]">{t("allTickets")}</h1>
                    <p className="text-sm text-[#94a3b8] mt-1">{(allTickets || []).length} {isRTL ? "تذكرة" : "tickets"}</p>
                  </div>
                  <div className="space-y-4">
                    {(allTickets || []).map((ticket: any) => (
                      <motion.div key={ticket.id} whileHover={{ y: -2 }} className="rounded-xl border border-[#1f2d44] bg-[#111827] p-5">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className={`text-xs ${ticket.status === "open" ? "bg-[rgba(16,185,129,0.15)] text-[#10b981]" : ticket.status === "in_progress" ? "bg-[rgba(6,182,212,0.15)] text-[#06b6d4]" : ticket.status === "resolved" ? "bg-[rgba(34,211,238,0.15)] text-[#22d3ee]" : "bg-[#1a2233] text-[#64748b]"}`}>{ticket.status}</Badge>
                              <Badge variant="outline" className="border-[#1f2d44] text-[10px] text-[#94a3b8]">{ticket.category}</Badge>
                              <span className="text-xs text-[#64748b]">{ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString() : ""}</span>
                            </div>
                            <h3 className="mt-2 font-medium text-[#f0f4f8]">{ticket.subject}</h3>
                            <p className="mt-1 text-sm text-[#94a3b8] line-clamp-2">{ticket.message}</p>
                          </div>
                          <div className="flex gap-2 ml-4">
                            {ticket.status === "open" && <Button size="sm" variant="ghost" onClick={() => updateTicket.mutate({ id: ticket.id, status: "in_progress" })} className="text-[#06b6d4] hover:bg-[rgba(6,182,212,0.05)]"><CheckCircle className="mr-1 h-4 w-4" />{isRTL ? "بدء" : "Start"}</Button>}
                            {ticket.status === "in_progress" && <Button size="sm" variant="ghost" onClick={() => updateTicket.mutate({ id: ticket.id, status: "resolved" })} className="text-[#10b981] hover:bg-[rgba(16,185,129,0.05)]"><CheckCircle className="mr-1 h-4 w-4" />{isRTL ? "حل" : "Resolve"}</Button>}
                          </div>
                        </div>
                        <div className="mt-3">
                          {replyingTo === ticket.id ? (
                            <div className="flex gap-2">
                              <Input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder={isRTL ? "اكتب رداً..." : "Write a reply..."} className="flex-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" />
                              <Button size="sm" onClick={() => replyMutation.mutate({ ticketId: ticket.id, message: replyText })} disabled={!replyText.trim()} className="bg-[#06b6d4] text-[#0a0e17]">{t("send")}</Button>
                              <Button size="sm" variant="ghost" onClick={() => setReplyingTo(null)} className="text-[#94a3b8]">{t("cancel")}</Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setReplyingTo(ticket.id)} className="text-xs text-[#06b6d4] hover:bg-[rgba(6,182,212,0.05)]">{isRTL ? "رد" : "Reply"}</Button>
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
                    <h1 className="text-2xl font-bold text-[#f0f4f8]">{isRTL ? "سجل المدفوعات" : "Payment History"}</h1>
                    <p className="text-sm text-[#94a3b8] mt-1">{allPayments.length} {isRTL ? "معاملة" : "transactions"}</p>
                  </div>
                  <div className="rounded-xl border border-[#1f2d44] bg-[#111827] overflow-hidden">
                    <table className="w-full text-start text-sm">
                      <thead>
                        <tr className="border-b border-[#1f2d44] bg-[#0d1117]">
                          <th className="p-4 text-[#94a3b8] text-start font-medium">ID</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{isRTL ? "المبلغ" : "Amount"}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{isRTL ? "الطريقة" : "Method"}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{t("status")}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{isRTL ? "التاريخ" : "Date"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(allPayments || []).map((p: any) => (
                          <tr key={p.id} className="border-b border-[#1f2d44]/50 hover:bg-[rgba(6,182,212,0.02)] transition-colors">
                            <td className="p-4 text-[#f0f4f8] font-mono text-xs">#{p.id}</td>
                            <td className="p-4 font-semibold text-[#06b6d4]">{p.amount} {p.currency}</td>
                            <td className="p-4 text-[#94a3b8]">{p.paymentMethod}</td>
                            <td className="p-4"><Badge className={`text-xs ${p.status === "completed" ? "bg-[rgba(16,185,129,0.15)] text-[#10b981]" : p.status === "pending" ? "bg-[rgba(245,158,11,0.15)] text-[#f59e0b]" : "bg-[rgba(244,63,94,0.15)] text-[#f43f5e]"}`}>{p.status}</Badge></td>
                            <td className="p-4 text-[#64748b] text-xs">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ═══════════════════ CONTACT ═══════════════════ */}
              {activeTab === "contact" && (
                <div className="space-y-6">
                  <div>
                    <h1 className="text-2xl font-bold text-[#f0f4f8]">{isRTL ? "معلومات التواصل" : "Contact Information"}</h1>
                    <p className="text-sm text-[#94a3b8] mt-1">{isRTL ? "تحديث معلومات الاتصال وروابط التواصل الاجتماعي" : "Update contact info and social media links"}</p>
                  </div>
                  {contactLoading ? <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" /></div> : (
                    <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6 space-y-8">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label className="text-sm text-[#94a3b8]">{isRTL ? "رقم واتساب" : "WhatsApp Number"}</Label>
                          <Input value={contactValues.whatsappNumber || ""} onChange={(e) => setContactValues((p) => ({ ...p, whatsappNumber: e.target.value }))} placeholder="201061857305" className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="ltr" />
                        </div>
                        <div className="grid gap-1.5">
                          <Label className="text-sm text-[#94a3b8]">{isRTL ? "رقم الهاتف" : "Phone Number"}</Label>
                          <Input value={contactValues.phone || ""} onChange={(e) => setContactValues((p) => ({ ...p, phone: e.target.value }))} placeholder="01061857305" className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="ltr" />
                        </div>
                      </div>
                      <div className="grid gap-1.5 sm:max-w-md">
                        <Label className="text-sm text-[#94a3b8]">{isRTL ? "البريد الإلكتروني" : "Email Address"}</Label>
                        <Input value={contactValues.email || ""} onChange={(e) => setContactValues((p) => ({ ...p, email: e.target.value }))} placeholder="contact@example.com" className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="ltr" />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {(["youtubeUrl", "linkedinUrl", "facebookUrl", "instagramUrl", "tiktokUrl", "twitterUrl"] as const).map((key) => (
                          <div key={key} className="grid gap-1.5">
                            <Label className="text-sm text-[#94a3b8]">{key.replace("Url", "").charAt(0).toUpperCase() + key.replace("Url", "").slice(1)}</Label>
                            <Input value={contactValues[key] || ""} onChange={(e) => setContactValues((p) => ({ ...p, [key]: e.target.value }))} placeholder="https://..." className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="ltr" />
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-end pt-4 border-t border-[#1f2d44]">
                        <Button onClick={handleContactSave} disabled={contactSave.isPending} className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]">
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
                      <h1 className="text-2xl font-bold text-[#f0f4f8]">{isRTL ? "إدارة المحتوى" : "Content Management"}</h1>
                      <p className="text-sm text-[#94a3b8] mt-1">{isRTL ? "تعديل نصوص ومحتوى صفحات الموقع" : "Edit texts and content across the site"}</p>
                    </div>
                    <Select value={cmsSection} onValueChange={setCmsSection}>
                      <SelectTrigger className="w-full border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] sm:w-64">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-[#1f2d44] bg-[#111827]">
                        {Object.entries(CMS_SECTIONS).map(([key, sec]) => (
                          <SelectItem key={key} value={key} className="text-[#f0f4f8] focus:bg-[#1f2d44]">{isRTL ? sec.labelAr : sec.labelEn}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {cmsLoading ? <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" /></div> : (
                    <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6 space-y-4">
                      {CMS_SECTIONS[cmsSection]?.keys.map((key) => {
                        const type = inferSettingType(key);
                        const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
                        return (
                          <div key={key} className="grid gap-1.5">
                            <div className="flex items-center gap-2">
                              <Label className="text-sm text-[#94a3b8]">{label}</Label>
                              <Badge variant="outline" className="border-[#1f2d44] text-[10px] text-[#64748b]">{type}</Badge>
                            </div>
                            {type === "color" ? (
                              <div className="flex items-center gap-3">
                                <input type="color" value={cmsValues[key] || "#000000"} onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))} className="h-10 w-14 cursor-pointer rounded border border-[#1f2d44] bg-[#0a0e17]" />
                                <Input value={cmsValues[key] || ""} onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))} className="flex-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="ltr" />
                              </div>
                            ) : type === "textarea" ? (
                              <Textarea value={cmsValues[key] || ""} onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))} className="min-h-24 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir={key.endsWith("Ar") ? "rtl" : "ltr"} />
                            ) : (
                              <Input value={cmsValues[key] || ""} onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir={key.endsWith("Ar") ? "rtl" : "ltr"} />
                            )}
                          </div>
                        );
                      })}
                      <div className="flex justify-end pt-4 border-t border-[#1f2d44]">
                        <Button onClick={handleCmsSave} disabled={cmsSave.isPending} className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]">
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
                      <h1 className="text-2xl font-bold text-[#f0f4f8]">{isRTL ? "الثيمات" : "Themes"}</h1>
                      <p className="text-sm text-[#94a3b8] mt-1">{isRTL ? "تخصيص مظهر الموقع" : "Customize site appearance"}</p>
                    </div>
                    <div className="flex gap-2">
                      {(!themes || themes.length === 0) && <Button onClick={() => seedThemes.mutate()} variant="outline" className="border-[#1f2d44] hover:bg-[#1f2d44]" disabled={seedThemes.isPending}>{isRTL ? "تحميل الثيمات الافتراضية" : "Load Default Themes"}</Button>}
                      <Button onClick={() => { setEditingTheme({ ...blankTheme }); setThemeDialogOpen(true); }} className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]"><Plus className="mr-2 h-4 w-4" />{isRTL ? "إنشاء ثيم" : "Create Theme"}</Button>
                    </div>
                  </div>
                  {themesLoading ? <div className="flex justify-center py-12"><div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" /></div> : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {(themes as ThemeItem[] | undefined)?.map((theme) => (
                        <motion.div key={theme.id} whileHover={{ y: -4 }} className="rounded-xl border border-[#1f2d44] bg-[#111827] overflow-hidden">
                          <div className="flex h-16">
                            <div className="flex-1" style={{ backgroundColor: theme.primaryColor }} />
                            <div className="flex-1" style={{ backgroundColor: theme.secondaryColor }} />
                            <div className="flex-1" style={{ backgroundColor: theme.accentColor }} />
                            <div className="flex-1" style={{ backgroundColor: theme.cardBgColor }} />
                            <div className="flex-1" style={{ backgroundColor: theme.borderColor }} />
                          </div>
                          <div className="p-4">
                            <div className="flex items-center justify-between">
                              <h3 className="font-medium text-[#f0f4f8]">{theme.name}</h3>
                              {theme.isActive && <Badge className="bg-[rgba(16,185,129,0.15)] text-[#10b981] border-[#10b981]/30"><Zap className="mr-1 h-3 w-3" />{isRTL ? "نشط" : "Active"}</Badge>}
                            </div>
                            <div className="mt-3 flex gap-2">
                              <Button size="sm" variant="ghost" onClick={() => openEditTheme(theme)} className="flex-1 border border-[#1f2d44] text-[#94a3b8] hover:bg-[#1f2d44] hover:text-[#f0f4f8]"><Pencil className="mr-1 h-3 w-3" />{isRTL ? "تعديل" : "Edit"}</Button>
                              {!theme.isActive && <Button size="sm" variant="ghost" onClick={() => activateTheme.mutate({ id: Number(theme.id) })} className="border border-[#06b6d4]/30 text-[#06b6d4] hover:bg-[rgba(6,182,212,0.1)]"><Zap className="h-3 w-3" /></Button>}
                              {!theme.isActive && <Button size="sm" variant="ghost" onClick={() => setDeleteConfirmId(theme.id)} className="border border-[#f43f5e]/30 text-[#f43f5e] hover:bg-[rgba(244,63,94,0.1)]"><Trash2 className="h-3 w-3" /></Button>}
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
                      <h1 className="text-2xl font-bold text-[#f0f4f8]">{isRTL ? "أكواد الخصم" : "Promo Codes"}</h1>
                      <p className="text-sm text-[#94a3b8] mt-1">{(promoCodes || []).length} {isRTL ? "كود" : "codes"}</p>
                    </div>
                    <Button onClick={() => { setEditingPromo({ code: "", discount: 10, type: "percentage", maxUses: 100, status: "active", validFrom: "", validUntil: "" }); setShowPromoForm(true); }} className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]"><Plus className="mr-2 h-4 w-4" />{isRTL ? "إنشاء كود" : "Create Code"}</Button>
                  </div>
                  <div className="rounded-xl border border-[#1f2d44] bg-[#111827] overflow-hidden">
                    <table className="w-full text-start text-sm">
                      <thead>
                        <tr className="border-b border-[#1f2d44] bg-[#0d1117]">
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{isRTL ? "الكود" : "Code"}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{isRTL ? "الخصم" : "Discount"}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{isRTL ? "الاستخدامات" : "Uses"}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{t("status")}</th>
                          <th className="p-4 text-[#94a3b8] text-start font-medium">{isRTL ? "إجراءات" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(promoCodes || []).map((p: any) => (
                          <tr key={p.id} className="border-b border-[#1f2d44]/50 hover:bg-[rgba(6,182,212,0.02)] transition-colors">
                            <td className="p-4 font-mono text-sm text-[#06b6d4]">{p.code}</td>
                            <td className="p-4 text-[#f0f4f8]">{p.discount}{p.type === "percentage" ? "%" : " EGP"}</td>
                            <td className="p-4 text-[#94a3b8]">{p.usedCount}/{p.maxUses}</td>
                            <td className="p-4"><Badge className={`text-xs ${p.status === "active" ? "bg-[rgba(16,185,129,0.15)] text-[#10b981]" : "bg-[#1a2233] text-[#64748b]"}`}>{p.status}</Badge></td>
                            <td className="p-4">
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" onClick={() => { setEditingPromo(p); setShowPromoForm(true); }} className="text-[#06b6d4] hover:bg-[rgba(6,182,212,0.05)]"><Pencil className="h-3 w-3" /></Button>
                                <Button size="sm" variant="ghost" onClick={() => { if (confirm(isRTL ? "هل أنت متأكد؟" : "Are you sure?")) deletePromo.mutate({ id: p.id }); }} className="text-[#f43f5e] hover:bg-[rgba(244,63,94,0.05)]"><Trash2 className="h-3 w-3" /></Button>
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
                      <h1 className="text-2xl font-bold text-[#f0f4f8]">{isRTL ? "العروض الترويجية" : "Promotions"}</h1>
                      <p className="text-sm text-[#94a3b8] mt-1">{(promotions || []).length} {isRTL ? "عرض" : "promotions"}</p>
                    </div>
                    <Button onClick={() => { setEditingPromotion({ titleEn: "", titleAr: "", subtitleEn: "", subtitleAr: "", discountText: "", ctaTextEn: "", ctaTextAr: "", ctaUrl: "", startDate: "", endDate: "", bgColor: "#06b6d4", textColor: "#ffffff", buttonColor: "#0a0e17", position: "top", showCountdown: true, isActive: true }); setShowPromotionForm(true); }} className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]"><Plus className="mr-2 h-4 w-4" />{isRTL ? "إنشاء عرض" : "Create Promotion"}</Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(promotions || []).map((p: any) => (
                      <motion.div key={p.id} whileHover={{ y: -4 }} className="rounded-xl border border-[#1f2d44] bg-[#111827] p-5">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold text-[#f0f4f8]">{lang === "en" ? p.titleEn : p.titleAr}</h3>
                            <p className="text-sm text-[#94a3b8] mt-1">{lang === "en" ? p.subtitleEn : p.subtitleAr}</p>
                          </div>
                          <Badge className={p.isActive ? "bg-[rgba(16,185,129,0.15)] text-[#10b981]" : "bg-[#1a2233] text-[#64748b]"}>{p.isActive ? (isRTL ? "نشط" : "Active") : (isRTL ? "غير نشط" : "Inactive")}</Badge>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => { setEditingPromotion(p); setShowPromotionForm(true); }} className="text-[#06b6d4] hover:bg-[rgba(6,182,212,0.05)]"><Pencil className="mr-1 h-3 w-3" />{isRTL ? "تعديل" : "Edit"}</Button>
                          <Button size="sm" variant="ghost" onClick={() => { if (confirm(isRTL ? "هل أنت متأكد؟" : "Are you sure?")) deletePromotion.mutate({ id: p.id }); }} className="text-[#f43f5e] hover:bg-[rgba(244,63,94,0.05)]"><Trash2 className="h-3 w-3" /></Button>
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
        <DialogContent className="border-[#1f2d44] bg-[#111827] sm:max-w-2xl">
          <DialogHeader><DialogTitle className="text-[#f0f4f8]">{editingTheme?.id ? (isRTL ? "تعديل الثيم" : "Edit Theme") : (isRTL ? "إنشاء ثيم جديد" : "Create New Theme")}</DialogTitle></DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="grid gap-1.5">
              <Label className="text-[#94a3b8]">{isRTL ? "اسم الثيم" : "Theme Name"}</Label>
              <Input value={editingTheme?.name || ""} onChange={(e) => setEditingTheme((prev) => (prev ? { ...prev, name: e.target.value } : prev))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" />
            </div>
            {(["primaryColor", "secondaryColor", "accentColor", "bgColor", "textColor", "cardBgColor", "borderColor"] as const).map((field) => (
              <div key={field} className="grid gap-1.5">
                <Label className="text-[#94a3b8]">{field.replace(/([A-Z])/g, " $1")}</Label>
                <div className="flex items-center gap-3">
                  <input type="color" value={editingTheme?.[field] || "#000000"} onChange={(e) => setEditingTheme((prev) => (prev ? { ...prev, [field]: e.target.value } : prev))} className="h-10 w-14 cursor-pointer rounded border border-[#1f2d44] bg-[#0a0e17]" />
                  <Input value={editingTheme?.[field] || ""} onChange={(e) => setEditingTheme((prev) => (prev ? { ...prev, [field]: e.target.value } : prev))} className="flex-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="ltr" />
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setThemeDialogOpen(false)} className="border-[#1f2d44] text-[#94a3b8]">{isRTL ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => { if (editingTheme?.id) updateTheme.mutate(editingTheme as any); else createTheme.mutate(editingTheme as any); }} className="bg-[#06b6d4] text-[#0a0e17]">{isRTL ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Theme Confirmation */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent className="border-[#1f2d44] bg-[#111827] sm:max-w-md">
          <DialogHeader><DialogTitle className="text-[#f0f4f8]">{isRTL ? "حذف الثيم" : "Delete Theme"}</DialogTitle><DialogDescription className="text-[#94a3b8]">{isRTL ? "هل أنت متأكد من حذف هذا الثيم؟" : "Are you sure you want to delete this theme?"}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)} className="border-[#1f2d44] text-[#94a3b8]">{isRTL ? "إلغاء" : "Cancel"}</Button>
            <Button variant="destructive" onClick={() => deleteTheme.mutate({ id: Number(deleteConfirmId) })} className="bg-[#f43f5e] text-white">{isRTL ? "حذف" : "Delete"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Promo Form Dialog */}
      <Dialog open={showPromoForm} onOpenChange={setShowPromoForm}>
        <DialogContent className="border-[#1f2d44] bg-[#111827] sm:max-w-lg">
          <DialogHeader><DialogTitle className="text-[#f0f4f8]">{editingPromo?.id ? (isRTL ? "تعديل الكود" : "Edit Promo") : (isRTL ? "إنشاء كود جديد" : "Create Promo")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-1.5"><Label className="text-[#94a3b8]">{isRTL ? "الكود" : "Code"}</Label><Input value={editingPromo?.code || ""} onChange={(e) => setEditingPromo((p) => (p ? { ...p, code: e.target.value } : p))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="ltr" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5"><Label className="text-[#94a3b8]">{isRTL ? "الخصم" : "Discount"}</Label><Input type="number" value={editingPromo?.discount || 0} onChange={(e) => setEditingPromo((p) => (p ? { ...p, discount: Number(e.target.value) } : p))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" /></div>
              <div className="grid gap-1.5"><Label className="text-[#94a3b8]">{isRTL ? "النوع" : "Type"}</Label><Select value={editingPromo?.type || "percentage"} onValueChange={(v) => setEditingPromo((p) => (p ? { ...p, type: v as "percentage" | "fixed" } : p))}><SelectTrigger className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"><SelectValue /></SelectTrigger><SelectContent className="border-[#1f2d44] bg-[#111827]"><SelectItem value="percentage" className="text-[#f0f4f8]">{isRTL ? "نسبة مئوية" : "Percentage"}</SelectItem><SelectItem value="fixed" className="text-[#f0f4f8]">{isRTL ? "مبلغ ثابت" : "Fixed"}</SelectItem></SelectContent></Select></div>
            </div>
            <div className="grid gap-1.5"><Label className="text-[#94a3b8]">{isRTL ? "الحد الأقصى للاستخدامات" : "Max Uses"}</Label><Input type="number" value={editingPromo?.maxUses || 100} onChange={(e) => setEditingPromo((p) => (p ? { ...p, maxUses: Number(e.target.value) } : p))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPromoForm(false)} className="border-[#1f2d44] text-[#94a3b8]">{isRTL ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => { if (editingPromo?.id) updatePromo.mutate({ id: Number(editingPromo.id), code: editingPromo.code!, discount: editingPromo.discount!, type: editingPromo.type!, maxUses: editingPromo.maxUses!, expiresAt: editingPromo.validUntil || undefined, validFrom: editingPromo.validFrom || undefined, isActive: editingPromo.status === "active" }); else createPromo.mutate({ code: editingPromo!.code!, discount: editingPromo!.discount!, type: editingPromo!.type!, maxUses: editingPromo!.maxUses!, expiresAt: editingPromo!.validUntil || undefined, validFrom: editingPromo!.validFrom || undefined }); }} className="bg-[#06b6d4] text-[#0a0e17]">{isRTL ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Promotion Form Dialog */}
      <Dialog open={showPromotionForm} onOpenChange={setShowPromotionForm}>
        <DialogContent className="border-[#1f2d44] bg-[#111827] sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-[#f0f4f8]">{editingPromotion?.id ? (isRTL ? "تعديل العرض" : "Edit Promotion") : (isRTL ? "إنشاء عرض جديد" : "Create Promotion")}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-1.5"><Label className="text-[#94a3b8]">{isRTL ? "العنوان (إنجليزي)" : "Title (English)"}</Label><Input value={editingPromotion?.titleEn || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, titleEn: e.target.value } : p))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="ltr" /></div>
            <div className="grid gap-1.5"><Label className="text-[#94a3b8]">{isRTL ? "العنوان (عربي)" : "Title (Arabic)"}</Label><Input value={editingPromotion?.titleAr || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, titleAr: e.target.value } : p))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="rtl" /></div>
            <div className="grid gap-1.5"><Label className="text-[#94a3b8]">{isRTL ? "الوصف (إنجليزي)" : "Subtitle (English)"}</Label><Input value={editingPromotion?.subtitleEn || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, subtitleEn: e.target.value } : p))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="ltr" /></div>
            <div className="grid gap-1.5"><Label className="text-[#94a3b8]">{isRTL ? "نص الخصم" : "Discount Text"}</Label><Input value={editingPromotion?.discountText || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, discountText: e.target.value } : p))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" dir="ltr" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5"><Label className="text-[#94a3b8]">{isRTL ? "تاريخ البداية" : "Start Date"}</Label><Input type="date" value={editingPromotion?.startDate || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, startDate: e.target.value } : p))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" /></div>
              <div className="grid gap-1.5"><Label className="text-[#94a3b8]">{isRTL ? "تاريخ النهاية" : "End Date"}</Label><Input type="date" value={editingPromotion?.endDate || ""} onChange={(e) => setEditingPromotion((p) => (p ? { ...p, endDate: e.target.value } : p))} className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]" /></div>
            </div>
            <div className="flex items-center gap-3"><Switch checked={editingPromotion?.showCountdown ?? true} onCheckedChange={(v) => setEditingPromotion((p) => (p ? { ...p, showCountdown: v } : p))} /><Label className="text-[#94a3b8]">{isRTL ? "إظهار العد التنازلي" : "Show Countdown"}</Label></div>
            <div className="flex items-center gap-3"><Switch checked={editingPromotion?.isActive ?? true} onCheckedChange={(v) => setEditingPromotion((p) => (p ? { ...p, isActive: v } : p))} /><Label className="text-[#94a3b8]">{isRTL ? "نشط" : "Active"}</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPromotionForm(false)} className="border-[#1f2d44] text-[#94a3b8]">{isRTL ? "إلغاء" : "Cancel"}</Button>
            <Button onClick={() => { if (editingPromotion?.id) updatePromotion.mutate(editingPromotion as any); else createPromotion.mutate({ ...editingPromotion!, startsAt: editingPromotion!.startDate, endsAt: editingPromotion!.endDate } as any); }} className="bg-[#06b6d4] text-[#0a0e17]">{isRTL ? "حفظ" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function openEditTheme(theme: ThemeItem) { setEditingTheme({ ...theme }); setThemeDialogOpen(true); }
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : "6, 182, 212";
}
