/**
 * BYOK SETTINGS PANEL — the chatbot's "own model" menu (bring-your-own-key).
 *
 * Product contract: the platform chatbot runs on owner-managed models by
 * default; this panel lets a logged-in user optionally register their own
 * OpenAI-compatible provider (baseUrl + API key + model). When saved and
 * enabled, the server tries the user's endpoint first and falls back to the
 * platform models on ANY failure — the user's setup can never reduce
 * availability.
 *
 * Security: the key is write-only — the GET endpoint returns only a ••••last4
 * preview; the panel never displays or re-fills a stored key.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, PlugZap, Trash2, XCircle } from "lucide-react";

const API_BASE = globalThis.Capacitor?.isNativePlatform()
  ? (import.meta.env.VITE_API_URL || "https://ahmedelbaz.qzz.io")
  : "";

interface CatalogEntry {
  id: string;
  labelAr: string;
  labelEn: string;
  baseUrl: string;
  exampleModels: string[];
}

interface SavedConfig {
  configured: boolean;
  provider: string;
  baseUrl: string;
  modelId: string;
  keyPreview: string | null;
  enabled: boolean;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  lastTestedAt: string | null;
}

type Lang = "ar" | "en";

interface Props {
  lang: Lang;
  onClose: () => void;
  /** Notifies the parent whether a custom model is currently active (badge). */
  onActiveChange?: (active: boolean) => void;
}

export default function ByokSettingsPanel({ lang, onClose, onActiveChange }: Props) {
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [config, setConfig] = useState<SavedConfig | null>(null);

  // Form state
  const [provider, setProvider] = useState("openrouter");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/user-ai-provider`);
      if (res.status === 401) {
        toast(t("سجّل الدخول أولاً لاستخدام النموذج الخاص", "Please log in to use a custom model"), { duration: 2500 });
        onClose();
        return;
      }
      const data = await res.json() as { success: boolean; config: SavedConfig | null; catalog?: CatalogEntry[] };
      setCatalog(data.catalog ?? []);
      const saved = data.config;
      setConfig(saved);
      if (saved) {
        setProvider(saved.provider);
        setBaseUrl(saved.baseUrl);
        setModelId(saved.modelId);
        setEnabled(saved.enabled);
        // NOTE: the stored key is never returned — apiKey stays empty until
        // the user types a new one (overwrite-on-save semantics).
      }
      onActiveChange?.(!!saved && saved.enabled);
    } catch {
      toast(t("تعذر تحميل الإعدادات — تحقق من الاتصال", "Couldn't load settings — check your connection"), { duration: 2500 });
    } finally {
      setLoading(false);
    }
  }, [lang, onClose, onActiveChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedCatalog = catalog.find((p) => p.id === provider);

  function pickProvider(id: string) {
    setProvider(id);
    setTestResult(null);
    const entry = catalog.find((p) => p.id === id);
    // Prefill the default API root; "custom" leaves it to the user.
    if (entry?.baseUrl) setBaseUrl(entry.baseUrl);
    if (!entry?.baseUrl) setBaseUrl("");
    // Suggest the first example model when the field is untouched/empty.
    if (entry?.exampleModels.length && (!modelId || catalog.some((p) => p.exampleModels.includes(modelId)))) {
      setModelId(entry.exampleModels[0]);
    }
  }

  async function handleTest() {
    if (!baseUrl.trim() || !modelId.trim()) {
      toast(t("أدخل عنوان المزود واسم النموذج أولاً", "Enter the provider URL and model name first"), { duration: 2500 });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const hasNewKey = apiKey.trim().length >= 8;
      const res = await fetch(`${API_BASE}/api/user-ai-provider/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: hasNewKey
          ? JSON.stringify({ baseUrl: baseUrl.trim(), modelId: modelId.trim(), apiKey: apiKey.trim() })
          : undefined,
      });
      const data = await res.json() as { success: boolean; test?: { ok: boolean; latencyMs: number; error?: string }; error?: string };
      if (!data.success || !data.test) {
        setTestResult({ ok: false, message: data.error ?? t("فشل الاختبار", "Test failed") });
        return;
      }
      if (data.test.ok) {
        setTestResult({ ok: true, message: t(`الاتصال يعمل — استجابة خلال ${data.test.latencyMs}ms`, `Connected — responded in ${data.test.latencyMs}ms`) });
      } else {
        setTestResult({ ok: false, message: data.test.error ?? t("فشل الاختبار", "Test failed") });
      }
    } catch {
      setTestResult({ ok: false, message: t("تعذر الاتصال بالخادم", "Couldn't reach the server") });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    // Key semantics: REQUIRED for the first save; optional afterwards
    // (omit → keep the stored key — the write-only contract).
    if (!baseUrl.trim() || !modelId.trim() || (!config && apiKey.trim().length < 8)) {
      toast(config
        ? t("أكمل: عنوان المزود + اسم النموذج", "Complete: provider URL + model name")
        : t("أكمل: عنوان المزود + اسم النموذج + مفتاح API (8 أحرف على الأقل)", "Complete: provider URL + model name + API key (at least 8 chars)"),
        { duration: 3000 });
      return;
    }
    setSaving(true);
    try {
      const hasNewKey = apiKey.trim().length >= 8;
      const res = await fetch(`${API_BASE}/api/user-ai-provider`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          baseUrl: baseUrl.trim(),
          modelId: modelId.trim(),
          ...(hasNewKey ? { apiKey: apiKey.trim() } : {}),
          enabled,
        }),
      });
      const data = await res.json() as { success: boolean; config?: SavedConfig; error?: string };
      if (!data.success) {
        toast(data.error ?? t("تعذر الحفظ", "Couldn't save"), { duration: 3000 });
        return;
      }
      setConfig(data.config ?? null);
      setApiKey(""); // write-only contract: clear the field after save
      onActiveChange?.(!!data.config && data.config.enabled);
      toast(t("تم الحفظ — المساعد سيعتمد نموذجك أولاً ثم نماذج المنصة عند الفشل", "Saved — the assistant will use your model first, then platform models on failure"), { duration: 3500 });
    } catch {
      toast(t("تعذر الحفظ — تحقق من الاتصال", "Couldn't save — check your connection"), { duration: 2500 });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/api/user-ai-provider`, { method: "DELETE" });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) {
        toast(data.error ?? t("تعذر الحذف", "Couldn't delete"), { duration: 2500 });
        return;
      }
      setConfig(null);
      setApiKey("");
      setTestResult(null);
      onActiveChange?.(false);
      toast(t("تم الحذف — ستعمل المنصة بنماذجها الأساسية", "Deleted — the platform models are back in charge"), { duration: 3000 });
    } catch {
      toast(t("تعذر الحذف — تحقق من الاتصال", "Couldn't delete — check your connection"), { duration: 2500 });
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    try {
      const res = await fetch(`${API_BASE}/api/user-ai-provider`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) {
        setEnabled(!next);
        toast(data.error ?? t("تعذر التحديث", "Couldn't update"), { duration: 2500 });
        return;
      }
      onActiveChange?.(next);
    } catch {
      setEnabled(!next);
      toast(t("تعذر التحديث — تحقق من الاتصال", "Couldn't update — check your connection"), { duration: 2500 });
    }
  }

  const inputCls =
    "w-full rounded-lg border border-[#1e2d3d] bg-[#0d1520] px-3 py-2 text-[13px] text-slate-100 placeholder:text-slate-500 outline-none transition-colors focus:border-cyan-500/60";
  const labelCls = "mb-1.5 block text-[12px] font-medium text-slate-300";

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#0a1019]">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain bg-[#0a1019] px-4 py-3" dir={lang === "ar" ? "rtl" : "ltr"}>
      {/* ── Panel header ── */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-cyan-400" />
          <h3 className="text-[13px] font-semibold text-white">
            {t("النموذج الخاص بك", "Your own model")}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-cyan-400/10 hover:text-cyan-300"
          title={t("رجوع إلى المحادثة", "Back to chat")}
        >
          {lang === "ar" ? <ArrowRight className="h-4 w-4" /> : <ArrowRight className="h-4 w-4 rotate-180" />}
        </button>
      </div>

      {/* ── Explanation ── */}
      <p className="mb-3 rounded-lg bg-[#0d1520] p-3 text-[12px] leading-relaxed text-slate-300">
        {t(
          "المنصة تعمل بنماذجها الأساسية تلقائياً. إن أردت نموذجاً معيناً لا توفره المنصة، أدخل هنا المزود والنموذج ومفتاح API الخاص بك — سيجرّب المساعد نموذجك أولاً، وعند أي فشل يعود تلقائياً إلى نماذج المنصة.",
          "The platform runs on its own models automatically. If you want a specific model the platform doesn't offer, enter your provider, model and API key here — the assistant tries your model first and automatically falls back to platform models on any failure."
        )}
      </p>

      {/* ── Saved-config status ── */}
      {config && (
        <div className="mb-3 rounded-lg border border-[#1e2d3d] bg-[#0d1520] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-slate-200">
              {t("محفوظ حالياً:", "Currently saved:")}{" "}
              <span className="font-mono text-cyan-300">{config.modelId}</span>
              <span className="text-slate-400"> · {config.keyPreview}</span>
            </p>
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
              <input type="checkbox" checked={config.enabled} onChange={handleToggle} className="accent-cyan-500" />
              {t("مفعّل", "Active")}
            </label>
          </div>
          {config.lastTestOk !== null && (
            <p className={"mt-1.5 text-[11px] " + (config.lastTestOk ? "text-emerald-400" : "text-amber-400")}>
              {config.lastTestOk
                ? t("آخر اختبار: ناجح", "Last test: passed")
                : `${t("آخر اختبار: فاشل", "Last test: failed")} — ${config.lastTestError ?? ""}`}
            </p>
          )}
        </div>
      )}

      {/* ── Form ── */}
      <div className="space-y-3">
        <div>
          <label className={labelCls}>{t("المزود", "Provider")}</label>
          <select value={provider} onChange={(e) => pickProvider(e.target.value)} className={inputCls}>
            {catalog.length > 0 ? (
              catalog.map((p) => (
                <option key={p.id} value={p.id} className="bg-[#0d1520]">
                  {lang === "ar" ? p.labelAr : p.labelEn}
                </option>
              ))
            ) : (
              <option value="openrouter">OpenRouter</option>
            )}
          </select>
        </div>

        <div>
          <label className={labelCls}>
            {t("عنوان المزود (API root)", "Provider URL (API root)")}
            {selectedCatalog?.baseUrl && <span className="text-slate-500"> — {t("معبأ تلقائياً", "prefilled")}</span>}
          </label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null); }}
            placeholder="https://openrouter.ai/api/v1"
            className={inputCls}
            dir="ltr"
            spellCheck={false}
          />
        </div>

        <div>
          <label className={labelCls}>{t("اسم النموذج", "Model name")}</label>
          <input
            type="text"
            value={modelId}
            onChange={(e) => { setModelId(e.target.value); setTestResult(null); }}
            placeholder={selectedCatalog?.exampleModels[0] ?? "model-id"}
            list="byok-model-examples"
            className={inputCls}
            dir="ltr"
            spellCheck={false}
          />
          {selectedCatalog && selectedCatalog.exampleModels.length > 0 && (
            <datalist id="byok-model-examples">
              {selectedCatalog.exampleModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
        </div>

        <div>
          <label className={labelCls}>
            {t("مفتاح API", "API key")}
            {config && <span className="text-slate-500"> — {t("اتركه فارغاً للإبقاء على المفتاح المحفوظ", "leave empty to keep the stored key")}</span>}
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
              placeholder="sk-..."
              autoComplete="off"
              className={inputCls + " pe-10"}
              dir="ltr"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-500 transition-colors hover:text-cyan-300"
              title={showKey ? t("إخفاء", "Hide") : t("إظهار", "Show")}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {t("يُشفَّر المفتاح ولا يُعاد عرضه أبداً — يظهر آخر 4 خانات فقط", "The key is encrypted and never shown again — only its last 4 characters appear")}
          </p>
        </div>

        {testResult && (
          <div
            className={
              "flex items-start gap-2 rounded-lg p-2.5 text-[12px] " +
              (testResult.ok
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-amber-500/10 text-amber-300")
            }
          >
            {testResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="break-words">{testResult.message}</span>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={handleTest}
            disabled={testing || !baseUrl.trim() || !modelId.trim()}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-500/40 px-3 py-2 text-[12px] font-medium text-cyan-300 transition-colors hover:bg-cyan-500/10 disabled:opacity-40"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
            {testing ? t("جارٍ الاختبار...", "Testing...") : t("اختبر الاتصال", "Test connection")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {saving ? t("جارٍ الحفظ...", "Saving...") : t("حفظ", "Save")}
          </button>
          {config && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {t("حذف", "Delete")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
