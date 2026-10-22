/**
 * ADMIN — AI PROVIDERS PANEL (dynamic multi-provider chatbot router)
 *
 * Lets the admin:
 *   • add ANY OpenAI-compatible provider (name + baseUrl + API key) — the
 *     key is sent once, stored server-side, and only ever shown masked;
 *   • auto-discover the free models each key can use (GET {baseUrl}/models)
 *     classified Chat vs Vision with routing tiers;
 *   • test connectivity per provider (tiny completion against the best model);
 *   • toggle provider/model availability, adjust priority and tiers;
 *   • watch the live router health (breaker cooldowns + recent events).
 *
 * Failover guarantee (server side): the chatbot walks providers by priority
 * then models by tier, cooling down rate-limited/dead candidates and hopping
 * to the next one — a provider dying never stops the chat while any other
 * configured provider still answers.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import {
  Bot, Plus, Pencil, Trash2, RefreshCw, PlugZap, Radar, CheckCircle2, XCircle,
  AlertTriangle, Eye, MessageSquare, Image as ImageIcon, Sparkles, Cpu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

interface CatalogEntry { slug: string; displayName: string; baseUrl: string; hint: string; }
interface ModelRow {
  id: number; modelId: string; supportsChat: boolean; supportsVision: boolean; isFree: boolean;
  enabled: boolean; tier: number; status: string; failCount: number; latencyMs: number | null; lastSuccessAt: string | null;
}
interface ProviderRow {
  id: number; slug: string; displayName: string; baseUrl: string; apiKeyMasked: string; hasKey: boolean;
  priority: number; enabled: boolean; status: string; lastError: string | null; lastCheckedAt: string | null; models: ModelRow[];
}
interface RouterEvent { ts: number; provider: string; model: string; kind: string; detail: string; }

const emptyForm = { id: 0, displayName: "", catalogSlug: "groq", baseUrl: "", apiKey: "", priority: 50, enabled: true };

function statusBadgeClass(status: string): string {
  switch (status) {
    case "healthy": return "bg-[rgba(16,185,129,0.15)] text-emerald-500";
    case "ok": return "bg-[rgba(16,185,129,0.15)] text-emerald-500";
    case "degraded": return "bg-[rgba(245,158,11,0.15)] text-amber-500";
    case "limited": return "bg-[rgba(245,158,11,0.15)] text-amber-500";
    case "dead": return "bg-[rgba(244,63,94,0.15)] text-rose-500";
    default: return "bg-[#1a2233] text-text-faint";
  }
}

export function AiProvidersPanel() {
  const { lang } = useTranslation();
  const isRTL = lang === "ar";
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.admin.aiProviders.useQuery();
  const { data: health } = trpc.admin.aiRouterHealth.useQuery();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [discovering, setDiscovering] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);

  const invalidateAll = () => {
    utils.admin.aiProviders.invalidate();
    utils.admin.aiRouterHealth.invalidate();
  };

  const saveProvider = trpc.admin.aiProviderSave.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      setShowForm(false);
      const d = res.discovery;
      if (d?.ok) {
        toast.success(isRTL
          ? `تم الحفظ واكتشاف ${d.found} نموذج (${d.vision} يدعم الصور، ${d.free} مجاني)`
          : `Saved — discovered ${d.found} models (${d.vision} vision, ${d.free} free)`);
      } else if (d?.error) {
        toast.warning(isRTL ? `تم الحفظ لكن فشل فحص النماذج: ${d.error}` : `Saved, but discovery failed: ${d.error}`);
      } else {
        toast.success(isRTL ? "تم الحفظ" : "Saved");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteProvider = trpc.admin.aiProviderDelete.useMutation({
    onSuccess: () => { invalidateAll(); toast.success(isRTL ? "تم حذف المزود" : "Provider deleted"); },
    onError: (err) => toast.error(err.message),
  });

  const toggleProvider = trpc.admin.aiProviderToggle.useMutation({
    onSuccess: () => invalidateAll(),
    onError: (err) => toast.error(err.message),
  });

  const discoverProvider = trpc.admin.aiProviderDiscover.useMutation({
    onSuccess: (res) => {
      setDiscovering(null);
      invalidateAll();
      if (res.ok) {
        toast.success(isRTL
          ? `اكتُشف ${res.found} نموذج — ${res.vision} للصور و ${res.free} مجاني`
          : `Discovered ${res.found} models — ${res.vision} vision, ${res.free} free`);
      } else {
        toast.error(res.error || (isRTL ? "فشل الفحص" : "Discovery failed"));
      }
    },
    onError: (err) => { setDiscovering(null); toast.error(err.message); },
  });

  const discoverAll = trpc.admin.aiProviderDiscoverAll.useMutation({
    onSuccess: () => { invalidateAll(); toast.success(isRTL ? "تم فحص جميع المزودين" : "All providers re-scanned"); },
    onError: (err) => toast.error(err.message),
  });

  const testProvider = trpc.admin.aiProviderTest.useMutation({
    onSuccess: (res) => {
      setTesting(null);
      invalidateAll();
      if (res.ok) toast.success(isRTL ? `يعمل ✓ ${res.model} — ${res.latencyMs}ms` : `Working ✓ ${res.model} — ${res.latencyMs}ms`);
      else toast.error(res.error || (isRTL ? "فشل الاختبار" : "Test failed"));
    },
    onError: (err) => { setTesting(null); toast.error(err.message); },
  });

  const updateModel = trpc.admin.aiModelUpdate.useMutation({
    onSuccess: () => invalidateAll(),
    onError: (err) => toast.error(err.message),
  });

  const providers = useMemo(() => (data?.providers || []) as unknown as ProviderRow[], [data]);
  const catalog: CatalogEntry[] = (data?.catalog || []) as unknown as CatalogEntry[];

  const stats = useMemo(() => {
    const allModels = providers.flatMap((p) => p.models);
    return {
      providers: providers.length,
      healthy: providers.filter((p) => p.status === "healthy" && p.enabled).length,
      models: allModels.length,
      vision: allModels.filter((m) => m.supportsVision && m.enabled).length,
    };
  }, [providers]);

  function openCreate() {
    setForm({ ...emptyForm });
    setShowForm(true);
  }

  function openEdit(p: ProviderRow) {
    setForm({ id: p.id, displayName: p.displayName, catalogSlug: "custom", baseUrl: p.baseUrl, apiKey: "", priority: p.priority, enabled: p.enabled });
    setShowForm(true);
  }

  function pickCatalog(slug: string) {
    const entry = catalog.find((c) => c.slug === slug);
    setForm((f) => ({
      ...f,
      catalogSlug: slug,
      displayName: entry && entry.slug !== "custom" ? entry.displayName : f.displayName,
      baseUrl: entry?.baseUrl ? entry.baseUrl : f.baseUrl,
    }));
  }

  const catalogHint = catalog.find((c) => c.slug === form.catalogSlug)?.hint;

  return (
    <div className="space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      {/* ── Header + stats ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Bot className="h-6 w-6 text-[#06b6d4]" />
            {isRTL ? "النماذج الذكية (AI Router)" : "AI Models (AI Router)"}
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {isRTL
              ? "أضف أي مزود متوافق مع OpenAI بمفتاحه — النظام يكتشف النماذج المجانية تلقائياً ويحوّل بينها وبين المزودين عند نفاد الكوتة"
              : "Add any OpenAI-compatible provider with its key — free models are auto-discovered and traffic fails over across models & providers automatically"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => discoverAll.mutate()} disabled={discoverAll.isPending} className="text-accent-secondary hover:bg-[rgba(6,182,212,0.05)]">
            <Radar className="h-4 w-4 mr-1" />{isRTL ? "فحص الكل" : "Re-scan all"}
          </Button>
          <Button onClick={openCreate} className="bg-[#06b6d4] text-background hover:bg-[#22d3ee]">
            <Plus className="mr-2 h-4 w-4" />{isRTL ? "إضافة مزود" : "Add Provider"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: isRTL ? "المزودون" : "Providers", value: stats.providers, icon: Bot },
          { label: isRTL ? "صحيح الآن" : "Healthy now", value: stats.healthy, icon: CheckCircle2 },
          { label: isRTL ? "النماذج المكتشفة" : "Discovered models", value: stats.models, icon: Cpu },
          { label: isRTL ? "نماذج الرؤية (صور)" : "Vision models", value: stats.vision, icon: ImageIcon },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-primary p-4">
            <div className="flex items-center gap-2 text-text-muted text-xs mb-1"><s.icon className="h-3.5 w-3.5" />{s.label}</div>
            <div className="text-2xl font-bold text-foreground">{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Providers ── */}
      {isLoading && <div className="text-text-muted text-sm py-8 text-center">{isRTL ? "جارٍ التحميل…" : "Loading…"}</div>}

      {!isLoading && providers.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-text-muted">
          {isRTL
            ? "لا يوجد مزودون بعد — أضف أول مزود (مثل Groq أو OpenRouter) بمفتاح API ليبدأ الشات بوت بالعمل عليه"
            : "No providers yet — add your first provider (e.g. Groq or OpenRouter) with its API key"}
        </div>
      )}

      <div className="space-y-4">
        {providers.map((p) => (
          <div key={p.id} className={`rounded-xl border border-border bg-primary overflow-hidden ${!p.enabled ? "opacity-60" : ""}`}>
            <div className="p-4 flex flex-wrap items-center gap-3 justify-between border-b border-border/60">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-foreground">{p.displayName}</span>
                  <Badge className={`text-xs ${statusBadgeClass(p.status)}`}>{p.status}</Badge>
                  <Badge className="text-xs bg-[#1a2233] text-text-faint">#{p.priority}</Badge>
                  <span className="text-xs text-text-muted font-mono">{p.apiKeyMasked || "—"}</span>
                </div>
                <div className="text-xs text-text-muted mt-1 truncate font-mono">{p.baseUrl}</div>
                {p.lastError && <div className="text-xs text-rose-400 mt-1 truncate max-w-xl" title={p.lastError}>{p.lastError}</div>}
              </div>
              <div className="flex items-center gap-1.5">
                <Switch checked={p.enabled} onCheckedChange={(v) => toggleProvider.mutate({ id: p.id, enabled: v })} aria-label="toggle provider" />
                <Button size="sm" variant="ghost" title={isRTL ? "اختبار الاتصال" : "Test"} onClick={() => { setTesting(p.id); testProvider.mutate({ id: p.id }); }} disabled={testing === p.id} className="text-emerald-500 hover:bg-[rgba(16,185,129,0.06)]">
                  {testing === p.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="ghost" title={isRTL ? "فحص النماذج" : "Discover models"} onClick={() => { setDiscovering(p.id); discoverProvider.mutate({ id: p.id }); }} disabled={discovering === p.id} className="text-accent-secondary hover:bg-[rgba(6,182,212,0.05)]">
                  {discovering === p.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="ghost" title={isRTL ? "تعديل" : "Edit"} onClick={() => openEdit(p)} className="text-accent-secondary hover:bg-[rgba(6,182,212,0.05)]"><Pencil className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="ghost" title={isRTL ? "حذف" : "Delete"} onClick={() => { if (confirm(isRTL ? `حذف ${p.displayName} وكل نماذجه؟` : `Delete ${p.displayName} and all its models?`)) deleteProvider.mutate({ id: p.id }); }} className="text-destructive hover:bg-[rgba(244,63,94,0.05)]"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>

            {p.models.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-[#0d1117]">
                      <th className="p-2.5 text-text-muted text-start font-medium text-xs">{isRTL ? "النموذج" : "Model"}</th>
                      <th className="p-2.5 text-text-muted text-start font-medium text-xs">{isRTL ? "القدرات" : "Capabilities"}</th>
                      <th className="p-2.5 text-text-muted text-start font-medium text-xs">{isRTL ? "الفئة" : "Tier"}</th>
                      <th className="p-2.5 text-text-muted text-start font-medium text-xs">{isRTL ? "الحالة" : "Status"}</th>
                      <th className="p-2.5 text-text-muted text-start font-medium text-xs">{isRTL ? "الاستجابة" : "Latency"}</th>
                      <th className="p-2.5 text-text-muted text-start font-medium text-xs">{isRTL ? "تشغيل" : "On"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.models.map((m) => (
                      <tr key={m.id} className="border-b border-border/40 last:border-0 hover:bg-[rgba(6,182,212,0.02)] transition-colors">
                        <td className="p-2.5 font-mono text-xs text-foreground max-w-[340px] truncate" title={m.modelId}>{m.modelId}</td>
                        <td className="p-2.5">
                          <div className="flex gap-1">
                            {m.supportsChat && <Badge className="text-[10px] bg-[rgba(6,182,212,0.12)] text-cyan-400"><MessageSquare className="h-2.5 w-2.5 mr-0.5" />{isRTL ? "شات" : "Chat"}</Badge>}
                            {m.supportsVision && <Badge className="text-[10px] bg-[rgba(168,85,247,0.15)] text-purple-400"><ImageIcon className="h-2.5 w-2.5 mr-0.5" />{isRTL ? "صور" : "Vision"}</Badge>}
                            {m.isFree && <Badge className="text-[10px] bg-[rgba(16,185,129,0.12)] text-emerald-500"><Sparkles className="h-2.5 w-2.5 mr-0.5" />{isRTL ? "مجاني" : "Free"}</Badge>}
                          </div>
                        </td>
                        <td className="p-2.5">
                          <Select value={String(m.tier)} onValueChange={(v) => updateModel.mutate({ id: m.id, tier: Number(v) })}>
                            <SelectTrigger className="h-7 w-[72px] text-xs border-border bg-background text-foreground"><SelectValue /></SelectTrigger>
                            <SelectContent className="border-border bg-primary">
                              <SelectItem value="1" className="text-foreground text-xs">{isRTL ? "1 قوي" : "1 Strong"}</SelectItem>
                              <SelectItem value="2" className="text-foreground text-xs">{isRTL ? "2 متوسط" : "2 Mid"}</SelectItem>
                              <SelectItem value="3" className="text-foreground text-xs">{isRTL ? "3 سريع" : "3 Fast"}</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2.5"><Badge className={`text-[10px] ${statusBadgeClass(m.status)}`}>{m.status}{m.failCount > 0 ? ` (${m.failCount})` : ""}</Badge></td>
                        <td className="p-2.5 text-xs text-text-muted">{m.latencyMs != null ? `${m.latencyMs}ms` : "—"}</td>
                        <td className="p-2.5">
                          <Switch checked={m.enabled} onCheckedChange={(v) => updateModel.mutate({ id: m.id, enabled: v })} aria-label={`toggle ${m.modelId}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {p.enabled && p.models.length === 0 && (
              <div className="p-3 text-xs text-text-muted flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                {isRTL ? "لا نماذج مكتشفة — اضغط زر الفحص (الرادار) لاكتشاف نماذج هذا المفتاح تلقائياً" : "No models discovered — hit the radar button to auto-discover this key's models"}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── Live router events ── */}
      {health && health.events.length > 0 && (
        <div className="rounded-xl border border-border bg-primary p-4">
          <h2 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2"><Eye className="h-4 w-4 text-[#06b6d4]" />{isRTL ? "أحداث الموجّه الحية" : "Live router events"}</h2>
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {(health.events as RouterEvent[]).map((e, i) => (
              <div key={`${e.ts}-${i}`} className="text-xs flex items-center gap-2 flex-wrap">
                <span className="text-text-faint font-mono">{new Date(e.ts).toLocaleTimeString()}</span>
                {e.kind === "success"
                  ? <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  : e.kind === "rate_limited" ? <AlertTriangle className="h-3 w-3 text-amber-500" />
                  : <XCircle className="h-3 w-3 text-rose-500" />}
                <span className="font-mono text-text-muted">{e.provider}/{e.model}</span>
                <span className="text-text-faint truncate max-w-[380px]">{e.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Add / Edit dialog ── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="border-border bg-primary text-foreground max-w-lg" dir={isRTL ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{form.id ? (isRTL ? "تعديل المزود" : "Edit Provider") : (isRTL ? "إضافة مزود AI" : "Add AI Provider")}</DialogTitle>
            <DialogDescription className="text-text-muted text-xs">
              {isRTL
                ? "أدخل مفتاح API — سيتصل السيرفر بالمزود تلقائياً ويكتشف النماذج المجانية التي يدعمها ويصنفها (شات / رؤية)"
                : "Enter the API key — the server connects to the provider, auto-discovers its free models and classifies them (chat / vision)"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label className="text-text-muted">{isRTL ? "نوع المزود" : "Provider type"}</Label>
              <Select value={form.catalogSlug} onValueChange={pickCatalog} disabled={!!form.id}>
                <SelectTrigger className="border-border bg-background text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="border-border bg-primary max-h-64">
                  {catalog.map((c) => (
                    <SelectItem key={c.slug} value={c.slug} className="text-foreground">{c.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {catalogHint && <p className="text-[11px] text-text-faint">{catalogHint}</p>}
            </div>

            <div className="space-y-1.5">
              <Label className="text-text-muted">{isRTL ? "الاسم المعروض" : "Display name"}</Label>
              <Input value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} className="border-border bg-background text-foreground" placeholder={isRTL ? "مثال: Groq" : "e.g. Groq"} />
            </div>

            <div className="space-y-1.5">
              <Label className="text-text-muted">{isRTL ? "رابط الـ API (متوافق OpenAI)" : "API base URL (OpenAI-compatible)"}</Label>
              <Input value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} className="border-border bg-background text-foreground font-mono text-xs" placeholder="https://api.groq.com/openai/v1" dir="ltr" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-text-muted">API Key</Label>
              <Input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                className="border-border bg-background text-foreground font-mono text-xs"
                placeholder={form.id ? (isRTL ? "اتركه فارغاً للإبقاء على المفتاح الحالي" : "Leave empty to keep current key") : "gsk_… / sk-or-…"}
                dir="ltr"
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-text-muted">{isRTL ? "الأولوية (1 يُجرب أولاً)" : "Priority (1 tried first)"}</Label>
                <Input type="number" min={1} max={999} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: Number(e.target.value) || 50 }))} className="border-border bg-background text-foreground" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-text-muted">{isRTL ? "الحالة" : "Enabled"}</Label>
                <div className="flex items-center h-9">
                  <Switch checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowForm(false)} className="text-text-muted">{isRTL ? "إلغاء" : "Cancel"}</Button>
            <Button
              onClick={() => {
                if (!form.displayName.trim()) { toast.error(isRTL ? "الاسم مطلوب" : "Name is required"); return; }
                if (!form.baseUrl.trim().startsWith("http")) { toast.error(isRTL ? "رابط API غير صالح" : "Invalid base URL"); return; }
                if (!form.id && !form.apiKey.trim()) { toast.error(isRTL ? "مفتاح API مطلوب" : "API key is required"); return; }
                saveProvider.mutate({
                  id: form.id || undefined,
                  displayName: form.displayName.trim(),
                  baseUrl: form.baseUrl.trim(),
                  apiKey: form.apiKey.trim() || undefined,
                  priority: form.priority,
                  enabled: form.enabled,
                });
              }}
              disabled={saveProvider.isPending}
              className="bg-[#06b6d4] text-background hover:bg-[#22d3ee]"
            >
              {saveProvider.isPending && <RefreshCw className="h-4 w-4 mr-1 animate-spin" />}
              {form.id ? (isRTL ? "حفظ" : "Save") : (isRTL ? "إضافة وفحص" : "Add & Discover")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
