import { useState, useEffect } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { Shield, ChevronDown, ChevronUp, Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import { grantConsent, revokeConsent } from "@/lib/clarity";

const COOKIE_KEY = "elbaz_cookie_consent";

interface CookiePreferences {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
}

const DEFAULT_PREFS: CookiePreferences = {
  necessary: true,
  analytics: false,
  marketing: false,
};

function getStoredConsent(): CookiePreferences | null {
  try {
    const raw = localStorage.getItem(COOKIE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveConsent(prefs: CookiePreferences) {
  localStorage.setItem(COOKIE_KEY, JSON.stringify(prefs));
}

export default function CookieConsent() {
  const { lang } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [prefs, setPrefs] = useState<CookiePreferences>({ ...DEFAULT_PREFS });
  const [justAccepted, setJustAccepted] = useState(false);

  useEffect(() => {
    // Show cookie banner on ALL pages (including login/register — GDPR requires consent everywhere)
    if (!getStoredConsent()) {
      // Small delay for smooth entrance
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }

    // On mount: if user previously consented to analytics, grant Clarity consent
    const stored = getStoredConsent();
    if (stored?.analytics) {
      grantConsent();
    } else if (stored) {
      revokeConsent();
    }
  }, []);

  const handleAcceptAll = () => {
    const allAccepted: CookiePreferences = {
      necessary: true,
      analytics: true,
      marketing: true,
    };
    saveConsent(allAccepted);
    grantConsent();
    setJustAccepted(true);
    setTimeout(() => setVisible(false), 400);
  };

  const handleAcceptNecessary = () => {
    saveConsent(DEFAULT_PREFS);
    revokeConsent();
    setJustAccepted(true);
    setTimeout(() => setVisible(false), 400);
  };

  const handleSavePreferences = () => {
    saveConsent(prefs);
    // Grant or revoke consent based on analytics preference
    if (prefs.analytics) {
      grantConsent();
    } else {
      revokeConsent();
    }
    setJustAccepted(true);
    setTimeout(() => setVisible(false), 400);
  };

  const togglePref = (key: "analytics" | "marketing") => {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-end sm:items-center justify-center transition-all duration-400 ${
        visible && !justAccepted
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      }`}
    >
      {/* Backdrop */}
      <div
        data-testid="cookie-consent-backdrop"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleAcceptNecessary}
      />

      {/* Banner */}
      <div data-testid="cookie-consent-banner" className="cookie-consent-banner relative mx-3 mb-20 sm:mb-0 w-full max-w-lg rounded-2xl border border-[#1e2d3d] bg-[#0d1420] shadow-[0_24px_64px_rgba(0,0,0,0.6)]">
        {/* Top glow line */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-1/2 bg-gradient-to-r from-transparent via-[#06b6d4] to-transparent" />

        <div className="p-5">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(6,182,212,0.1)]">
              <Cookie className="h-5 w-5 text-[#06b6d4]" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-[#f0f4f8]">
                {lang === "en" ? "We value your privacy" : "نحترم خصوصيتك"}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[#94a3b8]">
                {lang === "en"
                  ? "We use cookies to enhance your browsing experience, serve personalized content, and analyze our traffic. You can choose which cookies to allow."
                  : "نستخدم ملفات تعريف الارتباط لتحسين تجربتك، عرض محتوى مخصص، وتحليل زياراتنا. يمكنك اختيار ملفات تعريف الارتباط المسموح بها."}
              </p>
            </div>
          </div>

          {/* Expandable Details */}
          {showDetails && (
            <div className="mt-4 space-y-3 border-t border-[#1e2d3d] pt-4">
              {/* Necessary — always on */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[rgba(6,182,212,0.15)]">
                  <Shield className="h-3 w-3 text-[#06b6d4]" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-[#f0f4f8]">
                      {lang === "en" ? "Essential Cookies" : "ملفات تعريف الارتباط الأساسية"}
                    </span>
                    <span className="rounded bg-[rgba(6,182,212,0.15)] px-2 py-0.5 text-[10px] font-medium text-[#06b6d4]">
                      {lang === "en" ? "Always active" : "نشطة دائماً"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#64748b]">
                    {lang === "en"
                      ? "Required for the website to function properly. Includes authentication, security, and page navigation."
                      : "مطلوبة لعمل الموقع بشكل صحيح. تشمل المصادقة والأمان والتنقل بين الصفحات."}
                  </p>
                </div>
              </div>

              {/* Analytics toggle */}
              <div className="flex items-start gap-3">
                <button
                  onClick={() => togglePref("analytics")}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${
                    prefs.analytics
                      ? "border-[#06b6d4] bg-[#06b6d4]"
                      : "border-[#1e2d3d] bg-transparent"
                  }`}
                >
                  {prefs.analytics && (
                    <svg className="h-3 w-3 text-[#0a0e17]" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <div className="flex-1">
                  <span className="text-sm font-medium text-[#f0f4f8]">
                    {lang === "en" ? "Analytics Cookies" : "ملفات التحليلات"}
                  </span>
                  <p className="mt-1 text-xs text-[#64748b]">
                    {lang === "en"
                      ? "Help us understand how visitors interact with our website to improve performance and content."
                      : "تساعدنا في فهم كيفية تفاعل الزوار مع الموقع لتحسين الأداء والمحتوى."}
                  </p>
                </div>
              </div>

              {/* Marketing toggle */}
              <div className="flex items-start gap-3">
                <button
                  onClick={() => togglePref("marketing")}
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${
                    prefs.marketing
                      ? "border-[#06b6d4] bg-[#06b6d4]"
                      : "border-[#1e2d3d] bg-transparent"
                  }`}
                >
                  {prefs.marketing && (
                    <svg className="h-3 w-3 text-[#0a0e17]" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <div className="flex-1">
                  <span className="text-sm font-medium text-[#f0f4f8]">
                    {lang === "en" ? "Marketing Cookies" : "ملفات التسويق"}
                  </span>
                  <p className="mt-1 text-xs text-[#64748b]">
                    {lang === "en"
                      ? "Used to deliver relevant advertisements and track campaign effectiveness."
                      : "تستخدم لعرض إعلانات ذات صلة وتتبع فعالية الحملات التسويقية."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-xs text-[#64748b] transition-colors hover:text-[#94a3b8]"
            >
              {showDetails ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showDetails
                ? (lang === "en" ? "Less details" : "أقل تفاصيلاً")
                : (lang === "en" ? "Customize preferences" : "تخصيص التفضيلات")}
            </button>

            <div className="flex gap-2">
              <Button
                data-testid="cookie-accept-essential"
                onClick={handleAcceptNecessary}
                variant="ghost"
                size="sm"
                className="h-9 border border-[#1e2d3d] text-[13px] text-[#94a3b8] hover:border-[#2d3f52] hover:text-[#e8f0fe]"
              >
                {lang === "en" ? "Essential only" : "الأساسية فقط"}
              </Button>

              {showDetails && (
                <Button
                  onClick={handleSavePreferences}
                  variant="outline"
                  size="sm"
                  className="h-9 border-[#06b6d4] text-[13px] text-[#06b6d4] hover:bg-[rgba(6,182,212,0.1)]"
                >
                  {lang === "en" ? "Save preferences" : "حفظ التفضيلات"}
                </Button>
              )}

              <Button
                data-testid="cookie-accept-all"
                onClick={handleAcceptAll}
                size="sm"
                className="h-9 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[13px] font-semibold text-[#0a0e17] hover:shadow-[0_0_20px_rgba(6,182,212,0.3)]"
              >
                {lang === "en" ? "Accept all" : "قبول الكل"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
