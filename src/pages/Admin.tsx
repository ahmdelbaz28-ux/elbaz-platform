import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import {
  Users,
  BookOpen,
  TrendingUp,
  Headphones,
  DollarSign,
  Shield,
  CheckCircle,
  FileText,
  Palette,
  Tag,
  Megaphone,
  Plus,
  Pencil,
  Trash2,
  Save,
  Eye,
  X,
  Copy,
  Zap,
} from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

/* ──────────────────────── types ──────────────────────── */

interface SettingItem {
  id?: string;
  key: string;
  value: string;
  section: string;
  type?: string;
}

interface ThemeItem {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  bgColor: string;
  textColor: string;
  cardBgColor: string;
  borderColor: string;
  isActive: boolean;
  createdAt: string;
}

interface PromoItem {
  id: string;
  code: string;
  discount: number;
  type: "percentage" | "fixed";
  maxUses: number;
  usedCount: number;
  status: "active" | "expired" | "used_up";
  expiresAt: string;
  createdAt: string;
}

interface PromotionItem {
  id: string;
  titleEn: string;
  titleAr: string;
  subtitleEn: string;
  subtitleAr: string;
  discountText: string;
  ctaTextEn: string;
  ctaTextAr: string;
  ctaUrl: string;
  startDate: string;
  endDate: string;
  bgColor: string;
  textColor: string;
  buttonColor: string;
  position: "top" | "bottom";
  showCountdown: boolean;
  isActive: boolean;
  createdAt: string;
}

/* ──────────────────────── CMS section keys ──────────────────────── */

const CMS_SECTIONS: Record<string, { labelEn: string; labelAr: string; keys: string[] }> = {
  hero: {
    labelEn: "Hero Section",
    labelAr: "قسم البطل",
    keys: ["titleEn", "titleAr", "subtitleEn", "subtitleAr", "ctaTextEn", "ctaTextAr", "backgroundImage"],
  },
  features: {
    labelEn: "Features Section",
    labelAr: "قسم المميزات",
    keys: [
      "feature1TitleEn", "feature1DescEn", "feature1Icon",
      "feature2TitleEn", "feature2DescEn", "feature2Icon",
      "feature3TitleEn", "feature3DescEn", "feature3Icon",
      "feature4TitleEn", "feature4DescEn", "feature4Icon",
    ],
  },
  instructor: {
    labelEn: "Instructor Section",
    labelAr: "قسم المدرب",
    keys: ["name", "title", "bioEn", "bioAr", "avatarUrl"],
  },
  footer: {
    labelEn: "Footer",
    labelAr: "التذييل",
    keys: ["copyrightText", "facebookUrl", "instagramUrl", "youtubeUrl", "linkedinUrl"],
  },
  cta: {
    labelEn: "CTA Section",
    labelAr: "قسم الدعوة للإجراء",
    keys: ["titleEn", "titleAr", "subtitleEn", "subtitleAr"],
  },
};

function inferSettingType(key: string): "text" | "textarea" | "color" | "url" {
  const lk = key.toLowerCase();
  if (lk.includes("color")) return "color";
  if (lk.includes("url") || lk.includes("image") || lk.includes("avatar") || lk.includes("link")) return "url";
  if (lk.includes("bio") || lk.includes("desc") || lk.includes("subtitle")) return "textarea";
  return "text";
}

/* ──────────────────────── Main Component ──────────────────────── */

export default function Admin() {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();
  const { t, lang } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && (!isAuthenticated || !isAdmin)) {
      navigate("/");
    }
  }, [isLoading, isAuthenticated, isAdmin, navigate]);

  const utils = trpc.useUtils();

  /* ─── existing queries ─── */
  const { data: stats } = trpc.admin.stats.useQuery(undefined, { enabled: !!isAdmin });
  const { data: allUsers } = trpc.admin.users.useQuery(undefined, { enabled: !!isAdmin });
  const { data: allTickets } = trpc.admin.tickets.useQuery(undefined, { enabled: !!isAdmin });
  const { data: allPayments } = trpc.admin.payments.useQuery(undefined, { enabled: !!isAdmin });

  const updateTicket = trpc.admin.updateTicketStatus.useMutation({
    onSuccess: () => utils.admin.tickets.invalidate(),
    onError: (err) => console.warn("[Admin] updateTicket failed:", err.message),
  });

  const [replyText, setReplyText] = useState("");
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const replyMutation = trpc.admin.replyTicket.useMutation({
    onSuccess: () => {
      setReplyText("");
      setReplyingTo(null);
      utils.admin.tickets.invalidate();
    },
  });

  /* ─── CMS state ─── */
  const [cmsSection, setCmsSection] = useState("hero");
  const { data: cmsData, isLoading: cmsLoading } = trpc.settings.getSection.useQuery(
    { section: cmsSection },
    { enabled: !!isAdmin },
  );
  const [cmsValues, setCmsValues] = useState<Record<string, string>>({});
  const cmsSave = trpc.settings.bulkUpsert.useMutation({
    onSuccess: () => utils.settings.getSection.invalidate({ section: cmsSection }),
    onError: (err) => console.warn("[Admin] cmsSave failed:", err.message),
  });

  useEffect(() => {
    if (cmsData) {
      // getSection returns Record<string, string> (an object), not an array
      // Backend already returns { key: value } format, so use directly
      if (Array.isArray(cmsData)) {
        // Fallback: if it's an array of SettingItems, convert to map
        const map: Record<string, string> = {};
        (cmsData as SettingItem[]).forEach((s) => {
          map[s.key] = s.value;
        });
        setCmsValues(map);
      } else {
        // Normal case: it's already Record<string, string>
        setCmsValues(cmsData as Record<string, string>);
      }
    }
  }, [cmsData]);

  const handleCmsSave = () => {
    const settings = Object.entries(cmsValues).map(([key, value]) => ({ key, value }));
    cmsSave.mutate({ section: cmsSection, settings });
  };

  /* ─── Themes state ─── */
  const { data: themes, isLoading: themesLoading } = trpc.settings.listThemes.useQuery(undefined, { enabled: !!isAdmin });
  const { data: activeTheme } = trpc.settings.getActiveTheme.useQuery(undefined, { enabled: !!isAdmin });
  const createTheme = trpc.settings.createTheme.useMutation({
    onSuccess: () => utils.settings.listThemes.invalidate(),
    onError: (err) => console.warn("[Admin] createTheme failed:", err.message),
  });
  const activateTheme = trpc.settings.activateTheme.useMutation({
    onSuccess: () => {
      utils.settings.listThemes.invalidate();
      utils.settings.getActiveTheme.invalidate();
    },
  });
  const updateTheme = trpc.settings.updateTheme.useMutation({
    onSuccess: () => {
      utils.settings.listThemes.invalidate();
      utils.settings.getActiveTheme.invalidate();
      setThemeDialogOpen(false);
      setEditingTheme(null);
    },
  });
  const deleteTheme = trpc.settings.deleteTheme.useMutation({
    onSuccess: () => {
      utils.settings.listThemes.invalidate();
      utils.settings.getActiveTheme.invalidate();
      setDeleteConfirmId(null);
    },
  });

  const [themeDialogOpen, setThemeDialogOpen] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Partial<ThemeItem> | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [previewTheme, setPreviewTheme] = useState<Partial<ThemeItem> | null>(null);

  const blankTheme: Partial<ThemeItem> = {
    name: "",
    primaryColor: "#06b6d4",
    secondaryColor: "#0e7490",
    accentColor: "#22d3ee",
    bgColor: "#0a0e17",
    textColor: "#f0f4f8",
    cardBgColor: "#111827",
    borderColor: "#1f2d44",
  };

  const openCreateTheme = () => {
    setEditingTheme({ ...blankTheme });
    setThemeDialogOpen(true);
  };

  const openEditTheme = (theme: ThemeItem) => {
    setEditingTheme({ ...theme });
    setThemeDialogOpen(true);
  };

  const handleThemeFieldChange = (field: string, value: string) => {
    setEditingTheme((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleSaveTheme = () => {
    if (!editingTheme?.name) return;
    if (editingTheme.id) {
      updateTheme.mutate(editingTheme as any);
    } else {
      createTheme.mutate(editingTheme as any);
    }
  };

  /* ─── Promo Codes state ─── */
  const { data: promoCodes, isLoading: promosLoading } = trpc.promo.list.useQuery(undefined, { enabled: !!isAdmin });
  const createPromo = trpc.promo.create.useMutation({
    onSuccess: () => utils.promo.list.invalidate(),
  });
  const updatePromo = trpc.promo.update.useMutation({
    onSuccess: () => utils.promo.list.invalidate(),
    onError: (err) => console.warn("[Admin] updatePromo failed:", err.message),
  });
  const deletePromo = trpc.promo.delete.useMutation({
    onSuccess: () => utils.promo.list.invalidate(),
    onError: (err) => console.warn("[Admin] deletePromo failed:", err.message),
  });

  const [showPromoForm, setShowPromoForm] = useState(false);
  const [editingPromo, setEditingPromo] = useState<Partial<PromoItem> | null>(null);
  const [deletePromoId, setDeletePromoId] = useState<string | null>(null);

  const blankPromo: Partial<PromoItem> = {
    code: "",
    discount: 10,
    type: "percentage",
    maxUses: 100,
    status: "active",
    expiresAt: "",
  };

  const openCreatePromo = () => {
    setEditingPromo({ ...blankPromo });
    setShowPromoForm(true);
  };

  const openEditPromo = (promo: PromoItem) => {
    setEditingPromo({ ...promo });
    setShowPromoForm(true);
  };

  const handleSavePromo = () => {
    if (!editingPromo?.code) return;
    if (editingPromo.id) {
      updatePromo.mutate(editingPromo as any);
    } else {
      createPromo.mutate(editingPromo as any);
    }
    setShowPromoForm(false);
    setEditingPromo(null);
  };

  /* ─── Promotions state ─── */
  const { data: promotions, isLoading: promotionsLoading } = trpc.settings.listPromotions.useQuery(undefined, { enabled: !!isAdmin });
  const createPromotion = trpc.settings.createPromotion.useMutation({
    onSuccess: () => utils.settings.listPromotions.invalidate(),
    onError: (err) => console.warn("[Admin] createPromotion failed:", err.message),
  });
  const updatePromotion = trpc.settings.updatePromotion.useMutation({
    onSuccess: () => utils.settings.listPromotions.invalidate(),
    onError: (err) => console.warn("[Admin] updatePromotion failed:", err.message),
  });
  const deletePromotion = trpc.settings.deletePromotion.useMutation({
    onSuccess: () => utils.settings.listPromotions.invalidate(),
    onError: (err) => console.warn("[Admin] deletePromotion failed:", err.message),
  });

  const [showPromotionForm, setShowPromotionForm] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Partial<PromotionItem> | null>(null);
  const [deletePromotionId, setDeletePromotionId] = useState<string | null>(null);

  const blankPromotion: Partial<PromotionItem> = {
    titleEn: "",
    titleAr: "",
    subtitleEn: "",
    subtitleAr: "",
    discountText: "",
    ctaTextEn: "",
    ctaTextAr: "",
    ctaUrl: "",
    startDate: "",
    endDate: "",
    bgColor: "#06b6d4",
    textColor: "#ffffff",
    buttonColor: "#0a0e17",
    position: "top",
    showCountdown: true,
    isActive: true,
  };

  const openCreatePromotion = () => {
    setEditingPromotion({ ...blankPromotion });
    setShowPromotionForm(true);
  };

  const openEditPromotion = (promo: PromotionItem) => {
    setEditingPromotion({ ...promo });
    setShowPromotionForm(true);
  };

  const handleSavePromotion = () => {
    if (!editingPromotion?.titleEn && !editingPromotion?.titleAr) return;
    if (editingPromotion.id) {
      updatePromotion.mutate(editingPromotion as any);
    } else {
      createPromotion.mutate(editingPromotion as any);
    }
    setShowPromotionForm(false);
    setEditingPromotion(null);
  };

  /* ─── shared helpers ─── */
  const isRTL = lang === "ar";

  const renderLoader = () => (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" />
    </div>
  );

  /* ─── page guards ─── */
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e17]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="min-h-screen bg-[#0a0e17] pt-24">
      <div className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
        <div className="mb-8">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-[#06b6d4]" />
            <h1 className="text-2xl font-bold text-[#f0f4f8]">{t("adminPanel")}</h1>
          </div>
        </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { icon: <Users className="h-5 w-5" />, label: t("totalUsers"), value: stats?.totalUsers || 0, color: "#06b6d4" },
            { icon: <BookOpen className="h-5 w-5" />, label: t("totalCourses"), value: stats?.totalCourses || 0, color: "#22d3ee" },
            { icon: <TrendingUp className="h-5 w-5" />, label: t("totalEnrollments"), value: stats?.totalEnrollments || 0, color: "#10b981" },
            { icon: <DollarSign className="h-5 w-5" />, label: t("totalRevenue"), value: `$${stats?.totalRevenue || 0}`, color: "#f59e0b" },
            { icon: <Headphones className="h-5 w-5" />, label: t("openTickets"), value: stats?.openTickets || 0, color: "#f43f5e" },
          ].map((stat, i) => (
            <div key={i} className="rounded-xl border border-[#1f2d44] bg-[#111827] p-5">
              <div className="flex items-center gap-2" style={{ color: stat.color }}>{stat.icon}</div>
              <p className="mt-2 text-2xl font-bold text-[#f0f4f8]">{stat.value}</p>
              <p className="mt-1 text-xs text-[#94a3b8]">{stat.label}</p>
            </div>
          ))}
        </div>

        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="flex-wrap border border-[#1f2d44] bg-[#111827]">
            <TabsTrigger value="users" className="data-[state=active]:bg-[#06b6d4] data-[state=active]:text-[#0a0e17]">
              <Users className="mr-2 h-4 w-4" /> {t("totalUsers")}
            </TabsTrigger>
            <TabsTrigger value="tickets" className="data-[state=active]:bg-[#06b6d4] data-[state=active]:text-[#0a0e17]">
              <Headphones className="mr-2 h-4 w-4" /> {t("allTickets")}
            </TabsTrigger>
            <TabsTrigger value="payments" className="data-[state=active]:bg-[#06b6d4] data-[state=active]:text-[#0a0e17]">
              <DollarSign className="mr-2 h-4 w-4" /> {isRTL ? "المدفوعات" : "Payments"}
            </TabsTrigger>
            <TabsTrigger value="cms" className="data-[state=active]:bg-[#06b6d4] data-[state=active]:text-[#0a0e17]">
              <FileText className="mr-2 h-4 w-4" /> {isRTL ? "إدارة المحتوى" : "CMS"}
            </TabsTrigger>
            <TabsTrigger value="themes" className="data-[state=active]:bg-[#06b6d4] data-[state=active]:text-[#0a0e17]">
              <Palette className="mr-2 h-4 w-4" /> {isRTL ? "الثيمات" : "Themes"}
            </TabsTrigger>
            <TabsTrigger value="promos" className="data-[state=active]:bg-[#06b6d4] data-[state=active]:text-[#0a0e17]">
              <Tag className="mr-2 h-4 w-4" /> {isRTL ? "أكواد الخصم" : "Promo Codes"}
            </TabsTrigger>
            <TabsTrigger value="promotions" className="data-[state=active]:bg-[#06b6d4] data-[state=active]:text-[#0a0e17]">
              <Megaphone className="mr-2 h-4 w-4" /> {isRTL ? "العروض الترويجية" : "Promotions"}
            </TabsTrigger>
          </TabsList>

          {/* ═══════════════════ Users ═══════════════════ */}
          <TabsContent value="users">
            <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
              <h2 className="mb-4 text-lg font-semibold text-[#f0f4f8]">{t("totalUsers")}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-[#1f2d44]">
                      <th className="pb-3 text-[#94a3b8]">{t("username")}</th>
                      <th className="pb-3 text-[#94a3b8]">{t("name")}</th>
                      <th className="pb-3 text-[#94a3b8]">{t("email")}</th>
                      <th className="pb-3 text-[#94a3b8]">{t("role")}</th>
                      <th className="pb-3 text-[#94a3b8]">{isRTL ? "تاريخ التسجيل" : "Joined"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allUsers?.map((u) => (
                      <tr key={u.id} className="border-b border-[#1f2d44]/50">
                        <td className="py-3 text-[#f0f4f8]">{u.username}</td>
                        <td className="py-3 text-[#94a3b8]">{u.name || "—"}</td>
                        <td className="py-3 text-[#94a3b8]">{u.email || "—"}</td>
                        <td className="py-3">
                          <span className={`rounded px-2 py-0.5 text-xs ${
                            u.role === "admin" ? "bg-[rgba(6,182,212,0.15)] text-[#06b6d4]" : "bg-[#1a2233] text-[#94a3b8]"
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="py-3 text-[#64748b]">
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ═══════════════════ Tickets ═══════════════════ */}
          <TabsContent value="tickets">
            <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
              <h2 className="mb-4 text-lg font-semibold text-[#f0f4f8]">{t("allTickets")}</h2>
              <div className="space-y-4">
                {allTickets?.map((ticket) => (
                  <div key={ticket.id} className="rounded-lg border border-[#1f2d44] bg-[#0a0e17] p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-2 py-0.5 text-xs ${
                            ticket.status === "open" ? "bg-[rgba(16,185,129,0.15)] text-[#10b981]" :
                            ticket.status === "in_progress" ? "bg-[rgba(6,182,212,0.15)] text-[#06b6d4]" :
                            ticket.status === "resolved" ? "bg-[rgba(6,182,212,0.15)] text-[#22d3ee]" :
                            "bg-[#1a2233] text-[#64748b]"
                          }`}>
                            {ticket.status}
                          </span>
                          <span className="rounded bg-[#1a2233] px-2 py-0.5 text-xs text-[#94a3b8]">
                            {ticket.category}
                          </span>
                        </div>
                        <h3 className="mt-2 font-medium text-[#f0f4f8]">{ticket.subject}</h3>
                        <p className="mt-1 text-sm text-[#94a3b8]">{ticket.message}</p>
                      </div>
                      <div className="ml-4 flex gap-2">
                        {ticket.status === "open" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateTicket.mutate({ id: ticket.id, status: "in_progress" })}
                            className="text-[#06b6d4] hover:bg-[rgba(6,182,212,0.05)]"
                          >
                            <CheckCircle className="mr-1 h-4 w-4" />
                            {isRTL ? "بدء" : "Start"}
                          </Button>
                        )}
                        {ticket.status === "in_progress" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateTicket.mutate({ id: ticket.id, status: "resolved" })}
                            className="text-[#10b981] hover:bg-[rgba(16,185,129,0.05)]"
                          >
                            <CheckCircle className="mr-1 h-4 w-4" />
                            {isRTL ? "حل" : "Resolve"}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Reply section */}
                    <div className="mt-3">
                      {replyingTo === ticket.id ? (
                        <div className="flex gap-2">
                          <Input
                            value={replyText}
                            onChange={(e) => setReplyText(e.target.value)}
                            placeholder={isRTL ? "اكتب رداً..." : "Write a reply..."}
                            className="flex-1 border-[#1f2d44] bg-[#111827] text-[#f0f4f8]"
                          />
                          <Button
                            size="sm"
                            onClick={() => replyMutation.mutate({ ticketId: ticket.id, message: replyText })}
                            disabled={!replyText.trim()}
                            className="bg-[#06b6d4] text-[#0a0e17]"
                          >
                            {t("send")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setReplyingTo(null)}
                            className="text-[#94a3b8]"
                          >
                            {t("cancel")}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setReplyingTo(ticket.id)}
                          className="text-xs text-[#06b6d4] hover:bg-[rgba(6,182,212,0.05)]"
                        >
                          {isRTL ? "رد" : "Reply"}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* ═══════════════════ Payments ═══════════════════ */}
          <TabsContent value="payments">
            <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
              <h2 className="mb-4 text-lg font-semibold text-[#f0f4f8]">
                {isRTL ? "سجل المدفوعات" : "Payment History"}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-[#1f2d44]">
                      <th className="pb-3 text-[#94a3b8]">ID</th>
                      <th className="pb-3 text-[#94a3b8]">{isRTL ? "المبلغ" : "Amount"}</th>
                      <th className="pb-3 text-[#94a3b8]">{isRTL ? "الطريقة" : "Method"}</th>
                      <th className="pb-3 text-[#94a3b8]">{t("status")}</th>
                      <th className="pb-3 text-[#94a3b8]">{isRTL ? "التاريخ" : "Date"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allPayments?.map((p) => (
                      <tr key={p.id} className="border-b border-[#1f2d44]/50">
                        <td className="py-3 text-[#f0f4f8]">#{p.id}</td>
                        <td className="py-3 font-semibold text-[#06b6d4]">
                          {p.amount} {p.currency}
                        </td>
                        <td className="py-3 text-[#94a3b8]">{p.paymentMethod}</td>
                        <td className="py-3">
                          <span className={`rounded px-2 py-0.5 text-xs ${
                            p.status === "completed" ? "bg-[rgba(16,185,129,0.15)] text-[#10b981]" :
                            p.status === "pending" ? "bg-[rgba(245,158,11,0.15)] text-[#f59e0b]" :
                            "bg-[rgba(244,63,94,0.15)] text-[#f43f5e]"
                          }`}>
                            {p.status}
                          </span>
                        </td>
                        <td className="py-3 text-[#64748b]">
                          {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ═══════════════════ CMS ═══════════════════ */}
          <TabsContent value="cms">
            <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-[#f0f4f8]">
                  {isRTL ? "إدارة المحتوى" : "Content Management"}
                </h2>
                <Select value={cmsSection} onValueChange={setCmsSection}>
                  <SelectTrigger className="w-full border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-[#1f2d44] bg-[#111827]">
                    {Object.entries(CMS_SECTIONS).map(([key, sec]) => (
                      <SelectItem key={key} value={key} className="text-[#f0f4f8] focus:bg-[#1f2d44]">
                        {isRTL ? sec.labelAr : sec.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {cmsLoading ? renderLoader() : (
                <div className="space-y-4">
                  {CMS_SECTIONS[cmsSection]?.keys.map((key) => {
                    const type = inferSettingType(key);
                    const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
                    return (
                      <div key={key} className="grid gap-1.5">
                        <div className="flex items-center gap-2">
                          <Label className="text-sm text-[#94a3b8]">{label}</Label>
                          <Badge variant="outline" className="border-[#1f2d44] text-[10px] text-[#64748b]">
                            {type}
                          </Badge>
                        </div>
                        {type === "color" ? (
                          <div className="flex items-center gap-3">
                            <input
                              type="color"
                              value={cmsValues[key] || "#000000"}
                              onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))}
                              className="h-10 w-14 cursor-pointer rounded border border-[#1f2d44] bg-[#0a0e17]"
                            />
                            <Input
                              value={cmsValues[key] || ""}
                              onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))}
                              className="flex-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                              dir="ltr"
                            />
                          </div>
                        ) : type === "textarea" ? (
                          <Textarea
                            value={cmsValues[key] || ""}
                            onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))}
                            className="min-h-24 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                            dir={key.endsWith("Ar") ? "rtl" : "ltr"}
                          />
                        ) : type === "url" ? (
                          <Input
                            value={cmsValues[key] || ""}
                            onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))}
                            placeholder={isRTL ? "أدخل رابط URL..." : "Enter URL..."}
                            className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                            dir="ltr"
                          />
                        ) : (
                          <Input
                            value={cmsValues[key] || ""}
                            onChange={(e) => setCmsValues((p) => ({ ...p, [key]: e.target.value }))}
                            className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                            dir={key.endsWith("Ar") ? "rtl" : "ltr"}
                          />
                        )}
                      </div>
                    );
                  })}

                  <div className="flex justify-end pt-4">
                    <Button
                      onClick={handleCmsSave}
                      disabled={cmsSave.isPending}
                      className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]"
                    >
                      {cmsSave.isPending ? (
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-[#0a0e17] border-t-transparent" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      {isRTL ? "حفظ التغييرات" : "Save Changes"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ═══════════════════ Themes ═══════════════════ */}
          <TabsContent value="themes">
            <div className="space-y-6">
              {/* Header + create button */}
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#f0f4f8]">
                  {isRTL ? "الثيمات" : "Themes"}
                </h2>
                <Button
                  onClick={openCreateTheme}
                  className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {isRTL ? "إنشاء ثيم" : "Create Theme"}
                </Button>
              </div>

              {/* Theme grid */}
              {themesLoading ? renderLoader() : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(themes as ThemeItem[] | undefined)?.map((theme) => (
                    <div
                      key={theme.id}
                      className="rounded-xl border border-[#1f2d44] bg-[#111827] overflow-hidden"
                    >
                      {/* Color swatches */}
                      <div className="flex h-16">
                        <div className="flex-1" style={{ backgroundColor: theme.primaryColor }} title="Primary" />
                        <div className="flex-1" style={{ backgroundColor: theme.secondaryColor }} title="Secondary" />
                        <div className="flex-1" style={{ backgroundColor: theme.accentColor }} title="Accent" />
                        <div className="flex-1" style={{ backgroundColor: theme.cardBgColor }} title="Card BG" />
                        <div className="flex-1" style={{ backgroundColor: theme.borderColor }} title="Border" />
                      </div>
                      <div className="p-4">
                        <div className="flex items-center justify-between">
                          <h3 className="font-medium text-[#f0f4f8]">{theme.name}</h3>
                          {theme.isActive && (
                            <Badge className="bg-[rgba(16,185,129,0.15)] text-[#10b981] border-[#10b981]/30">
                              <Zap className="mr-1 h-3 w-3" />
                              {isRTL ? "نشط" : "Active"}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPreviewTheme(theme)}
                            className="flex-1 border border-[#1f2d44] text-[#94a3b8] hover:bg-[#1f2d44] hover:text-[#f0f4f8]"
                          >
                            <Eye className="mr-1 h-3 w-3" />
                            {isRTL ? "معاينة" : "Preview"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditTheme(theme)}
                            className="flex-1 border border-[#1f2d44] text-[#94a3b8] hover:bg-[#1f2d44] hover:text-[#f0f4f8]"
                          >
                            <Pencil className="mr-1 h-3 w-3" />
                            {isRTL ? "تعديل" : "Edit"}
                          </Button>
                          {!theme.isActive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => activateTheme.mutate({ id: theme.id })}
                              className="border border-[#06b6d4]/30 text-[#06b6d4] hover:bg-[rgba(6,182,212,0.1)]"
                            >
                              <Zap className="h-3 w-3" />
                            </Button>
                          )}
                          {!theme.isActive && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteConfirmId(theme.id)}
                              className="border border-[#f43f5e]/30 text-[#f43f5e] hover:bg-[rgba(244,63,94,0.1)]"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Preview section */}
              {previewTheme && (
                <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-[#f0f4f8]">
                      {isRTL ? "معاينة الثيم" : "Theme Preview"} — {previewTheme.name}
                    </h3>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPreviewTheme(null)}
                      className="text-[#94a3b8] hover:text-[#f0f4f8]"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div
                    className="rounded-lg p-6 transition-colors"
                    style={{
                      backgroundColor: previewTheme.bgColor,
                      borderColor: previewTheme.borderColor,
                      borderWidth: 1,
                    }}
                  >
                    <div
                      className="rounded-lg p-4"
                      style={{ backgroundColor: previewTheme.cardBgColor, borderColor: previewTheme.borderColor, borderWidth: 1 }}
                    >
                      <h4 style={{ color: previewTheme.primaryColor }} className="text-xl font-bold">
                        {isRTL ? "عنوان تجريبي" : "Sample Title"}
                      </h4>
                      <p style={{ color: previewTheme.textColor }} className="mt-2 text-sm opacity-80">
                        {isRTL ? "هذا نص تجريبي لمعاينة الثيم" : "This is sample text for theme preview"}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <span
                          className="rounded px-3 py-1 text-sm font-medium"
                          style={{ backgroundColor: previewTheme.primaryColor, color: previewTheme.bgColor }}
                        >
                          {isRTL ? "زر أساسي" : "Primary"}
                        </span>
                        <span
                          className="rounded px-3 py-1 text-sm font-medium"
                          style={{ backgroundColor: previewTheme.secondaryColor, color: "#ffffff" }}
                        >
                          {isRTL ? "زر ثانوي" : "Secondary"}
                        </span>
                        <span
                          className="rounded px-3 py-1 text-sm font-medium"
                          style={{ backgroundColor: previewTheme.accentColor, color: "#0a0e17" }}
                        >
                          {isRTL ? "تمييز" : "Accent"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Theme create/edit dialog */}
            <Dialog open={themeDialogOpen} onOpenChange={setThemeDialogOpen}>
              <DialogContent className="border-[#1f2d44] bg-[#111827] sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="text-[#f0f4f8]">
                    {editingTheme?.id
                      ? (isRTL ? "تعديل الثيم" : "Edit Theme")
                      : (isRTL ? "إنشاء ثيم جديد" : "Create New Theme")
                    }
                  </DialogTitle>
                  <DialogDescription className="text-[#94a3b8]">
                    {isRTL ? "تخصيص ألوان الثيم" : "Customize the theme colors"}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                  <div className="grid gap-1.5">
                    <Label className="text-[#94a3b8]">{isRTL ? "اسم الثيم" : "Theme Name"}</Label>
                    <Input
                      value={editingTheme?.name || ""}
                      onChange={(e) => handleThemeFieldChange("name", e.target.value)}
                      className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                    />
                  </div>
                  {([
                    ["primaryColor", isRTL ? "اللون الأساسي" : "Primary Color"],
                    ["secondaryColor", isRTL ? "اللون الثانوي" : "Secondary Color"],
                    ["accentColor", isRTL ? "لون التمييز" : "Accent Color"],
                    ["bgColor", isRTL ? "لون الخلفية" : "Background Color"],
                    ["textColor", isRTL ? "لون النص" : "Text Color"],
                    ["cardBgColor", isRTL ? "لون خلفية البطاقة" : "Card Background"],
                    ["borderColor", isRTL ? "لون الحدود" : "Border Color"],
                  ] as const).map(([field, label]) => (
                    <div key={field} className="grid gap-1.5">
                      <Label className="text-[#94a3b8]">{label}</Label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={editingTheme?.[field] || "#000000"}
                          onChange={(e) => handleThemeFieldChange(field, e.target.value)}
                          className="h-10 w-14 cursor-pointer rounded border border-[#1f2d44] bg-[#0a0e17]"
                        />
                        <Input
                          value={editingTheme?.[field] || ""}
                          onChange={(e) => handleThemeFieldChange(field, e.target.value)}
                          className="flex-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                          dir="ltr"
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setThemeDialogOpen(false)}
                    className="text-[#94a3b8]"
                  >
                    {t("cancel")}
                  </Button>
                  <Button
                    onClick={handleSaveTheme}
                    disabled={!editingTheme?.name || createTheme.isPending || updateTheme.isPending}
                    className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]"
                  >
                    {(createTheme.isPending || updateTheme.isPending) ? (
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-[#0a0e17] border-t-transparent" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    {t("save")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Delete confirmation dialog */}
            <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
              <DialogContent className="border-[#1f2d44] bg-[#111827] sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-[#f0f4f8]">
                    {isRTL ? "حذف الثيم؟" : "Delete Theme?"}
                  </DialogTitle>
                  <DialogDescription className="text-[#94a3b8]">
                    {isRTL ? "هل أنت متأكد من حذف هذا الثيم؟ لا يمكن التراجع عن هذا الإجراء." : "Are you sure you want to delete this theme? This action cannot be undone."}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setDeleteConfirmId(null)} className="text-[#94a3b8]">
                    {t("cancel")}
                  </Button>
                  <Button
                    onClick={() => deleteConfirmId && deleteTheme.mutate({ id: deleteConfirmId })}
                    disabled={deleteTheme.isPending}
                    className="bg-[#f43f5e] text-white hover:bg-[#e11d48]"
                  >
                    {deleteTheme.isPending ? (
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    {isRTL ? "حذف" : "Delete"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* ═══════════════════ Promo Codes ═══════════════════ */}
          <TabsContent value="promos">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#f0f4f8]">
                  {isRTL ? "أكواد الخصم" : "Promo Codes"}
                </h2>
                <Button
                  onClick={openCreatePromo}
                  className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {isRTL ? "إنشاء كود خصم" : "Create Promo Code"}
                </Button>
              </div>

              {/* Create/edit form */}
              {showPromoForm && editingPromo && (
                <div className="rounded-xl border border-[#06b6d4]/30 bg-[#111827] p-6">
                  <h3 className="mb-4 font-medium text-[#f0f4f8]">
                    {editingPromo.id
                      ? (isRTL ? "تعديل كود الخصم" : "Edit Promo Code")
                      : (isRTL ? "كود خصم جديد" : "New Promo Code")
                    }
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="grid gap-1.5">
                      <Label className="text-[#94a3b8]">{isRTL ? "الكود" : "Code"}</Label>
                      <Input
                        value={editingPromo.code || ""}
                        onChange={(e) => setEditingPromo((p) => p ? { ...p, code: e.target.value.toUpperCase() } : p)}
                        className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                        placeholder="SAVE20"
                        dir="ltr"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-[#94a3b8]">{isRTL ? "الخصم" : "Discount"}</Label>
                      <Input
                        type="number"
                        value={editingPromo.discount || 0}
                        onChange={(e) => setEditingPromo((p) => p ? { ...p, discount: Number(e.target.value) } : p)}
                        className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                        dir="ltr"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-[#94a3b8]">{isRTL ? "النوع" : "Type"}</Label>
                      <Select
                        value={editingPromo.type || "percentage"}
                        onValueChange={(v) => setEditingPromo((p) => p ? { ...p, type: v as "percentage" | "fixed" } : p)}
                      >
                        <SelectTrigger className="w-full border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-[#1f2d44] bg-[#111827]">
                          <SelectItem value="percentage" className="text-[#f0f4f8]">% {isRTL ? "نسبة مئوية" : "Percentage"}</SelectItem>
                          <SelectItem value="fixed" className="text-[#f0f4f8]">$ {isRTL ? "مبلغ ثابت" : "Fixed Amount"}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-[#94a3b8]">{isRTL ? "الحد الأقصى للاستخدام" : "Max Uses"}</Label>
                      <Input
                        type="number"
                        value={editingPromo.maxUses || 0}
                        onChange={(e) => setEditingPromo((p) => p ? { ...p, maxUses: Number(e.target.value) } : p)}
                        className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                        dir="ltr"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-[#94a3b8]">{isRTL ? "تاريخ الانتهاء" : "Expires At"}</Label>
                      <Input
                        type="date"
                        value={editingPromo.expiresAt ? editingPromo.expiresAt.split("T")[0] : ""}
                        onChange={(e) => setEditingPromo((p) => p ? { ...p, expiresAt: e.target.value } : p)}
                        className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                        dir="ltr"
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex gap-2 justify-end">
                    <Button variant="ghost" onClick={() => { setShowPromoForm(false); setEditingPromo(null); }} className="text-[#94a3b8]">
                      {t("cancel")}
                    </Button>
                    <Button
                      onClick={handleSavePromo}
                      disabled={!editingPromo.code || createPromo.isPending || updatePromo.isPending}
                      className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]"
                    >
                      {(createPromo.isPending || updatePromo.isPending) ? (
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-[#0a0e17] border-t-transparent" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      {t("save")}
                    </Button>
                  </div>
                </div>
              )}

              {/* Promo table */}
              <div className="rounded-xl border border-[#1f2d44] bg-[#111827] overflow-hidden">
                {promosLoading ? renderLoader() : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-start text-sm">
                      <thead>
                        <tr className="border-b border-[#1f2d44]">
                          <th className="p-4 text-[#94a3b8]">{isRTL ? "الكود" : "Code"}</th>
                          <th className="p-4 text-[#94a3b8]">{isRTL ? "الخصم" : "Discount"}</th>
                          <th className="p-4 text-[#94a3b8]">{isRTL ? "النوع" : "Type"}</th>
                          <th className="p-4 text-[#94a3b8]">{isRTL ? "الاستخدام" : "Uses"}</th>
                          <th className="p-4 text-[#94a3b8]">{t("status")}</th>
                          <th className="p-4 text-[#94a3b8]">{isRTL ? "الإجراءات" : "Actions"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(promoCodes as PromoItem[] | undefined)?.map((promo) => (
                          <tr key={promo.id} className="border-b border-[#1f2d44]/50 hover:bg-[#0a0e17]/50">
                            <td className="p-4">
                              <div className="flex items-center gap-2">
                                <code className="rounded bg-[#1a2233] px-2 py-1 text-sm font-mono text-[#06b6d4]" dir="ltr">
                                  {promo.code}
                                </code>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => navigator.clipboard.writeText(promo.code)}
                                  className="h-6 w-6 p-0 text-[#94a3b8] hover:text-[#f0f4f8]"
                                >
                                  <Copy className="h-3 w-3" />
                                </Button>
                              </div>
                            </td>
                            <td className="p-4 font-semibold text-[#f0f4f8]" dir="ltr">
                              {promo.type === "percentage" ? `${promo.discount}%` : `$${promo.discount}`}
                            </td>
                            <td className="p-4 text-[#94a3b8]">
                              {promo.type === "percentage"
                                ? (isRTL ? "نسبة مئوية" : "Percentage")
                                : (isRTL ? "مبلغ ثابت" : "Fixed")
                              }
                            </td>
                            <td className="p-4 text-[#94a3b8]" dir="ltr">
                              {promo.usedCount} / {promo.maxUses}
                            </td>
                            <td className="p-4">
                              <Badge className={
                                promo.status === "active"
                                  ? "bg-[rgba(16,185,129,0.15)] text-[#10b981] border-[#10b981]/30"
                                  : promo.status === "expired"
                                  ? "bg-[rgba(244,63,94,0.15)] text-[#f43f5e] border-[#f43f5e]/30"
                                  : "bg-[rgba(245,158,11,0.15)] text-[#f59e0b] border-[#f59e0b]/30"
                              }>
                                {promo.status === "active"
                                  ? (isRTL ? "نشط" : "Active")
                                  : promo.status === "expired"
                                  ? (isRTL ? "منتهي" : "Expired")
                                  : (isRTL ? "مستخدم" : "Used Up")
                                }
                              </Badge>
                            </td>
                            <td className="p-4">
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEditPromo(promo)}
                                  className="h-8 text-[#94a3b8] hover:text-[#06b6d4]"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDeletePromoId(promo.id)}
                                  className="h-8 text-[#94a3b8] hover:text-[#f43f5e]"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Delete promo confirmation */}
              <Dialog open={!!deletePromoId} onOpenChange={() => setDeletePromoId(null)}>
                <DialogContent className="border-[#1f2d44] bg-[#111827] sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-[#f0f4f8]">
                      {isRTL ? "حذف كود الخصم؟" : "Delete Promo Code?"}
                    </DialogTitle>
                    <DialogDescription className="text-[#94a3b8]">
                      {isRTL ? "هل أنت متأكد من حذف هذا الكود؟" : "Are you sure you want to delete this promo code?"}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setDeletePromoId(null)} className="text-[#94a3b8]">
                      {t("cancel")}
                    </Button>
                    <Button
                      onClick={() => deletePromoId && deletePromo.mutate({ id: deletePromoId })}
                      disabled={deletePromo.isPending}
                      className="bg-[#f43f5e] text-white hover:bg-[#e11d48]"
                    >
                      {isRTL ? "حذف" : "Delete"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </TabsContent>

          {/* ═══════════════════ Promotions ═══════════════════ */}
          <TabsContent value="promotions">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#f0f4f8]">
                  {isRTL ? "العروض الترويجية" : "Promotions"}
                </h2>
                <Button
                  onClick={openCreatePromotion}
                  className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {isRTL ? "إنشاء عرض" : "Create Promotion"}
                </Button>
              </div>

              {/* Create/edit form */}
              {showPromotionForm && editingPromotion && (
                <div className="rounded-xl border border-[#06b6d4]/30 bg-[#111827] p-6">
                  <h3 className="mb-4 font-medium text-[#f0f4f8]">
                    {editingPromotion.id
                      ? (isRTL ? "تعديل العرض" : "Edit Promotion")
                      : (isRTL ? "عرض جديد" : "New Promotion")
                    }
                  </h3>
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "العنوان (إنجليزي)" : "Title (English)"}</Label>
                        <Input
                          value={editingPromotion.titleEn || ""}
                          onChange={(e) => setEditingPromotion((p) => p ? { ...p, titleEn: e.target.value } : p)}
                          className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                          dir="ltr"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "العنوان (عربي)" : "Title (Arabic)"}</Label>
                        <Input
                          value={editingPromotion.titleAr || ""}
                          onChange={(e) => setEditingPromotion((p) => p ? { ...p, titleAr: e.target.value } : p)}
                          className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                          dir="rtl"
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "العنوان الفرعي (إنجليزي)" : "Subtitle (English)"}</Label>
                        <Input
                          value={editingPromotion.subtitleEn || ""}
                          onChange={(e) => setEditingPromotion((p) => p ? { ...p, subtitleEn: e.target.value } : p)}
                          className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                          dir="ltr"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "العنوان الفرعي (عربي)" : "Subtitle (Arabic)"}</Label>
                        <Input
                          value={editingPromotion.subtitleAr || ""}
                          onChange={(e) => setEditingPromotion((p) => p ? { ...p, subtitleAr: e.target.value } : p)}
                          className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                          dir="rtl"
                        />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-[#94a3b8]">{isRTL ? "نص الخصم" : "Discount Text"}</Label>
                      <Input
                        value={editingPromotion.discountText || ""}
                        onChange={(e) => setEditingPromotion((p) => p ? { ...p, discountText: e.target.value } : p)}
                        className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                        placeholder="50% OFF"
                        dir="ltr"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "نص الزر (إنجليزي)" : "CTA Text (English)"}</Label>
                        <Input
                          value={editingPromotion.ctaTextEn || ""}
                          onChange={(e) => setEditingPromotion((p) => p ? { ...p, ctaTextEn: e.target.value } : p)}
                          className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                          dir="ltr"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "نص الزر (عربي)" : "CTA Text (Arabic)"}</Label>
                        <Input
                          value={editingPromotion.ctaTextAr || ""}
                          onChange={(e) => setEditingPromotion((p) => p ? { ...p, ctaTextAr: e.target.value } : p)}
                          className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                          dir="rtl"
                        />
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <Label className="text-[#94a3b8]">{isRTL ? "رابط الزر" : "CTA URL"}</Label>
                      <Input
                        value={editingPromotion.ctaUrl || ""}
                        onChange={(e) => setEditingPromotion((p) => p ? { ...p, ctaUrl: e.target.value } : p)}
                        className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                        placeholder="/courses"
                        dir="ltr"
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "تاريخ البدء" : "Start Date"}</Label>
                        <Input
                          type="date"
                          value={editingPromotion.startDate ? editingPromotion.startDate.split("T")[0] : ""}
                          onChange={(e) => setEditingPromotion((p) => p ? { ...p, startDate: e.target.value } : p)}
                          className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                          dir="ltr"
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "تاريخ الانتهاء" : "End Date"}</Label>
                        <Input
                          type="date"
                          value={editingPromotion.endDate ? editingPromotion.endDate.split("T")[0] : ""}
                          onChange={(e) => setEditingPromotion((p) => p ? { ...p, endDate: e.target.value } : p)}
                          className="border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                          dir="ltr"
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "لون الخلفية" : "BG Color"}</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={editingPromotion.bgColor || "#06b6d4"}
                            onChange={(e) => setEditingPromotion((p) => p ? { ...p, bgColor: e.target.value } : p)}
                            className="h-9 w-12 cursor-pointer rounded border border-[#1f2d44] bg-[#0a0e17]"
                          />
                          <Input
                            value={editingPromotion.bgColor || ""}
                            onChange={(e) => setEditingPromotion((p) => p ? { ...p, bgColor: e.target.value } : p)}
                            className="flex-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                            dir="ltr"
                          />
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "لون النص" : "Text Color"}</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={editingPromotion.textColor || "#ffffff"}
                            onChange={(e) => setEditingPromotion((p) => p ? { ...p, textColor: e.target.value } : p)}
                            className="h-9 w-12 cursor-pointer rounded border border-[#1f2d44] bg-[#0a0e17]"
                          />
                          <Input
                            value={editingPromotion.textColor || ""}
                            onChange={(e) => setEditingPromotion((p) => p ? { ...p, textColor: e.target.value } : p)}
                            className="flex-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                            dir="ltr"
                          />
                        </div>
                      </div>
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "لون الزر" : "Button Color"}</Label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            value={editingPromotion.buttonColor || "#0a0e17"}
                            onChange={(e) => setEditingPromotion((p) => p ? { ...p, buttonColor: e.target.value } : p)}
                            className="h-9 w-12 cursor-pointer rounded border border-[#1f2d44] bg-[#0a0e17]"
                          />
                          <Input
                            value={editingPromotion.buttonColor || ""}
                            onChange={(e) => setEditingPromotion((p) => p ? { ...p, buttonColor: e.target.value } : p)}
                            className="flex-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]"
                            dir="ltr"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="grid gap-1.5">
                        <Label className="text-[#94a3b8]">{isRTL ? "الموضع" : "Position"}</Label>
                        <Select
                          value={editingPromotion.position || "top"}
                          onValueChange={(v) => setEditingPromotion((p) => p ? { ...p, position: v as "top" | "bottom" } : p)}
                        >
                          <SelectTrigger className="w-full border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="border-[#1f2d44] bg-[#111827]">
                            <SelectItem value="top" className="text-[#f0f4f8]">{isRTL ? "أعلى الصفحة" : "Top"}</SelectItem>
                            <SelectItem value="bottom" className="text-[#f0f4f8]">{isRTL ? "أسفل الصفحة" : "Bottom"}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-end gap-2 sm:col-span-2">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={editingPromotion.showCountdown ?? true}
                            onCheckedChange={(v) => setEditingPromotion((p) => p ? { ...p, showCountdown: v } : p)}
                          />
                          <Label className="text-[#94a3b8]">{isRTL ? "إظهار العد التنازلي" : "Show Countdown"}</Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={editingPromotion.isActive ?? true}
                            onCheckedChange={(v) => setEditingPromotion((p) => p ? { ...p, isActive: v } : p)}
                          />
                          <Label className="text-[#94a3b8]">{isRTL ? "نشط" : "Active"}</Label>
                        </div>
                      </div>
                    </div>

                    {/* Inline preview */}
                    <div className="grid gap-1.5">
                      <Label className="text-[#94a3b8]">{isRTL ? "معاينة" : "Preview"}</Label>
                      <div
                        className="rounded-lg p-4 text-center"
                        style={{
                          backgroundColor: editingPromotion.bgColor || "#06b6d4",
                          color: editingPromotion.textColor || "#ffffff",
                        }}
                      >
                        <p className="text-lg font-bold">
                          {isRTL ? (editingPromotion.titleAr || "عنوان العرض") : (editingPromotion.titleEn || "Promotion Title")}
                        </p>
                        <p className="mt-1 text-sm opacity-80">
                          {isRTL ? (editingPromotion.subtitleAr || "وصف العرض") : (editingPromotion.subtitleEn || "Promotion subtitle")}
                        </p>
                        {editingPromotion.discountText && (
                          <p className="mt-2 text-2xl font-extrabold">{editingPromotion.discountText}</p>
                        )}
                        <span
                          className="mt-3 inline-block rounded-full px-4 py-1.5 text-sm font-semibold"
                          style={{
                            backgroundColor: editingPromotion.buttonColor || "#0a0e17",
                            color: editingPromotion.bgColor || "#06b6d4",
                          }}
                        >
                          {isRTL ? (editingPromotion.ctaTextAr || "انقر هنا") : (editingPromotion.ctaTextEn || "Click Here")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2 justify-end">
                    <Button
                      variant="ghost"
                      onClick={() => { setShowPromotionForm(false); setEditingPromotion(null); }}
                      className="text-[#94a3b8]"
                    >
                      {t("cancel")}
                    </Button>
                    <Button
                      onClick={handleSavePromotion}
                      disabled={(!editingPromotion.titleEn && !editingPromotion.titleAr) || createPromotion.isPending || updatePromotion.isPending}
                      className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#22d3ee]"
                    >
                      {(createPromotion.isPending || updatePromotion.isPending) ? (
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-[#0a0e17] border-t-transparent" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      {t("save")}
                    </Button>
                  </div>
                </div>
              )}

              {/* Promotions list */}
              {promotionsLoading ? renderLoader() : (
                <div className="space-y-4">
                  {(promotions as PromotionItem[] | undefined)?.map((promo) => (
                    <div key={promo.id} className="rounded-xl border border-[#1f2d44] overflow-hidden">
                      {/* Banner preview */}
                      <div
                        className="p-4 text-center"
                        style={{
                          backgroundColor: promo.bgColor || "#06b6d4",
                          color: promo.textColor || "#ffffff",
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 text-start">
                            <p className="text-lg font-bold" dir={isRTL ? "rtl" : "ltr"}>
                              {isRTL ? promo.titleAr : promo.titleEn}
                            </p>
                            <p className="text-sm opacity-80" dir={isRTL ? "rtl" : "ltr"}>
                              {isRTL ? promo.subtitleAr : promo.subtitleEn}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            {promo.discountText && (
                              <span className="text-xl font-extrabold">{promo.discountText}</span>
                            )}
                            <span
                              className="rounded-full px-3 py-1 text-sm font-semibold"
                              style={{
                                backgroundColor: promo.buttonColor || "#0a0e17",
                                color: promo.bgColor || "#06b6d4",
                              }}
                            >
                              {isRTL ? promo.ctaTextAr : promo.ctaTextEn}
                            </span>
                            <Badge className={
                              promo.isActive
                                ? "bg-[rgba(16,185,129,0.15)] text-[#10b981] border-[#10b981]/30"
                                : "bg-[rgba(244,63,94,0.15)] text-[#f43f5e] border-[#f43f5e]/30"
                            }>
                              {promo.isActive ? (isRTL ? "نشط" : "Active") : (isRTL ? "غير نشط" : "Inactive")}
                            </Badge>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => openEditPromotion(promo)}
                              className="h-8 hover:bg-white/10"
                              style={{ color: promo.textColor || "#ffffff" }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeletePromotionId(promo.id)}
                              className="h-8 hover:bg-white/10"
                              style={{ color: promo.textColor || "#ffffff" }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-center gap-4 text-xs opacity-60" dir="ltr">
                          <span>{promo.position}: {promo.position}</span>
                          <span>{promo.showCountdown ? "⏱" : "—"} countdown</span>
                          {promo.startDate && <span>From: {promo.startDate.split("T")[0]}</span>}
                          {promo.endDate && <span>To: {promo.endDate.split("T")[0]}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Delete promotion confirmation */}
              <Dialog open={!!deletePromotionId} onOpenChange={() => setDeletePromotionId(null)}>
                <DialogContent className="border-[#1f2d44] bg-[#111827] sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle className="text-[#f0f4f8]">
                      {isRTL ? "حذف العرض الترويجي؟" : "Delete Promotion?"}
                    </DialogTitle>
                    <DialogDescription className="text-[#94a3b8]">
                      {isRTL ? "هل أنت متأكد من حذف هذا العرض؟" : "Are you sure you want to delete this promotion?"}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setDeletePromotionId(null)} className="text-[#94a3b8]">
                      {t("cancel")}
                    </Button>
                    <Button
                      onClick={() => deletePromotionId && deletePromotion.mutate({ id: deletePromotionId })}
                      disabled={deletePromotion.isPending}
                      className="bg-[#f43f5e] text-white hover:bg-[#e11d48]"
                    >
                      {isRTL ? "حذف" : "Delete"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
