import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Gift, Hourglass, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { fetchPublicEnv } from "@/lib/google-env";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/hooks/useTranslation";
import { isNativePlatform, setStoredToken } from "@/lib/auth-storage";
import { identifyUser, trackPlatform } from "@/lib/clarity";
import { initiateGoogleOAuth } from "@/lib/google-auth";
import { bilingualByLang } from "@/lib/i18n";
import { hasPasswordStrengthChars, isValidEmail } from "@/lib/validation";
import { trpc } from "@/providers/trpc";

interface GoogleCredentialResponse {
  credential?: string;
  select_by?: string;
  error?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          prompt: (callback?: (response: GoogleCredentialResponse) => void) => void;
          renderButton: (parent: HTMLElement, config: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

interface BadRequestRule {
  readonly matchers: readonly (string | RegExp)[];
  readonly ar: string;
  readonly en: string;
}

const BAD_REQUEST_RULES: readonly BadRequestRule[] = [
  { matchers: ["Username must be at least 3 characters", /too_small.*username|username.*too_small/], ar: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل", en: "Username must be at least 3 characters" },
  { matchers: ["Username too long", /too_big.*username|username.*too_big/], ar: "اسم المستخدم طويل جداً (الحد الأقصى 30 حرف)", en: "Username is too long (maximum 30 characters)" },
  { matchers: ["Username can only contain", /invalid_format.*username|username.*invalid_format/], ar: "اسم المستخدم يحتوي على حروف غير مسموحة. استخدم حروف (إنجليزية/عربية) وأرقام وشرطة سفلية (_) فقط", en: "Username contains invalid characters. Use English/Arabic letters, numbers, and underscores (_) only" },
  { matchers: ["Password must be at least 8 characters", /too_small.*password|password.*too_small/], ar: "كلمة المرور يجب أن تكون 8 أحرف على الأقل", en: "Password must be at least 8 characters" },
  { matchers: ["Password must contain", /invalid_format.*password|password.*invalid_format/], ar: "كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم على الأقل", en: "Password must contain at least one uppercase letter, one lowercase letter, and a number" },
  { matchers: ["Invalid email", "email"], ar: "بريد إلكتروني غير صالح", en: "Invalid email address" },
];

function msgMatchesAny(msg: string, matchers: readonly (string | RegExp)[]): boolean {
  return matchers.some((m) => (typeof m === "string" ? msg.includes(m) : m.test(msg)));
}

function describeBadRequestMessage(msg: string, lang: "ar" | "en"): string {
  for (const rule of BAD_REQUEST_RULES) {
    if (msgMatchesAny(msg, rule.matchers)) return lang === "ar" ? rule.ar : rule.en;
  }
  return lang === "ar" ? "بيانات غير صالحة. تحقق من الحقول وحاول مرة أخرى." : "Invalid data. Please check the fields and try again.";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function describeRegistrationError(err: any, lang: "ar" | "en"): string {
  const errorCode = (err.data as { code?: string })?.code;
  if (errorCode === "TOO_MANY_REQUESTS") return lang === "ar" ? "محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى." : "Too many attempts. Please wait a moment and try again.";
  if (errorCode === "CONFLICT") return lang === "ar" ? "اسم المستخدم أو البريد الإلكتروني مسجل مسبقاً" : "Username or email already exists";
  if (errorCode === "BAD_REQUEST") return describeBadRequestMessage(err.message || "", lang);
  return lang === "ar" ? "حدث خطأ في النظام. يرجى المحاولة مرة أخرى لاحقاً." : "A system error occurred. Please try again later.";
}

type UiLang = "ar" | "en";

// ✅ Sonar S3776 + S3358 + S6819 remediation (2026-11-26): the approval panel,
// the Google button/divider, the referral banner, the eye toggles and the GIS
// registration callback moved to pure module-scope helpers — Register() and
// validateRegistrationForm stay under the cognitive-complexity budget and no
// nested ternary remains. Behavior unchanged (same copy, same order, same
// sentinels).

function RegisterPendingApprovalPanel({ lang }: { lang: UiLang }) {
  return (
    <output className="block rounded-2xl border border-amber-400/30 bg-amber-400/10 p-6" data-testid="register-pending-panel">
      <div className="flex items-start gap-3">
        <Hourglass className="mt-0.5 h-6 w-6 shrink-0 text-amber-300" />
        <div>
          <h2 className="text-lg font-bold text-amber-200">
            {lang === "ar" ? "أهلاً بك في منصة المهندس أحمد الباز! 🌟" : "Welcome to Eng. Ahmed Elbaz's platform! 🌟"}
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-amber-100/90">
            {lang === "ar"
              ? "شكراً لتسجيلك! تم استلام طلب انضمامك بنجاح وهو الآن بانتظار المراجعة. المهندس أحمد الباز سيراجع طلبك وسيتم الموافقة عليه في أقرب وقت إن شاء الله — وسنبلغك فور التفعيل، وبعدها تستطيع تسجيل الدخول مباشرة والبدء في التعلم."
              : "Thank you for signing up! Your join request has been received and is now awaiting review. Eng. Ahmed Elbaz will review it and approve it as soon as possible — you'll be notified once it's activated, and then you can sign in and start learning right away."}
          </p>
          <p className="mt-3 rounded-lg bg-amber-400/10 p-3 text-[12.5px] leading-relaxed text-amber-200/80">
            {lang === "ar"
              ? "يمكنك الآن إغلاق هذه الصفحة بأمان — حاول تسجيل الدخول بعد وصول إشعار الموافقة."
              : "You can safely close this page now — try signing in after you receive the approval notification."}
          </p>
        </div>
      </div>
    </output>
  );
}

function GoogleSignUpButton({ onClick, loading, disabled, lang }: { onClick: () => void; loading: boolean; disabled: boolean; lang: UiLang }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-primary px-4 py-3 text-sm font-medium text-foreground transition-all duration-200 hover:border-accent-secondary/60 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50">
      {loading ? <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-secondary border-t-transparent" /> : (
        <svg className="h-5 w-5" viewBox="0 0 24 24" role="img" aria-hidden="true">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
      )}
      {loading ? bilingualByLang("جارٍ التسجيل...", "Signing up...", lang) : bilingualByLang("التسجيل بجوجل", "Sign up with Google", lang)}
    </button>
  );
}

function GoogleOrDivider({ lang }: { lang: UiLang }) {
  return (
    <div className="relative my-4">
      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
      <div className="relative flex justify-center text-xs"><span className="bg-background px-3 text-text-muted">{lang === "ar" ? "أو" : "or"}</span></div>
    </div>
  );
}

function ReferralWelcomeBanner({ lang }: { lang: UiLang }) {
  return (
    <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
      <Gift className="h-4 w-4 shrink-0 text-emerald-500" />
      <p className="text-xs text-emerald-500">
        {lang === "ar"
          ? `أنت مدعوم من صديق لك 🎁 خصم ترحيبي ${5}% مستنيك بعد إنشاء الحساب في صفحة ملفك الشخصي.`
          : `You were invited by a friend 🎁 a ${5}% welcome coupon awaits in your profile after signing up.`}
      </p>
    </div>
  );
}

function PasswordVisibilityToggle({ show, onToggle, lang }: { show: boolean; onToggle: () => void; lang: UiLang }) {
  return (
    <button type="button" onClick={onToggle} className="absolute end-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary" aria-label={show ? bilingualByLang("إخفاء كلمة المرور", "Hide password", lang) : bilingualByLang("إظهار كلمة المرور", "Show password", lang)}>
      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

/** ✅ Sonar S3776: the GIS registration callback lives at module scope — the
 *  component keeps only a thin useCallback wrapper (stable deps). */
async function runGoogleRegisterCallback(
  response: GoogleCredentialResponse,
  deps: {
    lang: UiLang;
    navigate: (to: string, opts?: { replace: boolean }) => void;
    queryClient: { clear: () => void };
    setGoogleLoading: (v: boolean) => void;
    setError: (v: string) => void;
    setPendingApproval: (v: boolean) => void;
  },
): Promise<void> {
  const { lang, navigate, queryClient } = deps;
  if (!response.credential) return;
  deps.setGoogleLoading(true); deps.setError("");
  try {
    const res = await fetch("/api/google-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: response.credential }) });
    const data = await res.json();
    if (data.success && data.user) {
      trackPlatform("google_register_success");
      // ✅ SECURITY FIX (audit run-1, auth.google-login.query-cache-purge-missing):
      // a Google sign-up that establishes a NEW identity must not inherit the
      // previous account's cached private queries (persisted + in-memory).
      try { localStorage.removeItem("ELBAZ_QUERY_CACHE"); } catch { /* ignore */ }
      queryClient.clear();
      identifyUser(data.user.id, data.user.username, { role: "user", loginMethod: "google" });
      toast.success(lang === "ar" ? "تم إنشاء الحساب بنجاح" : "Account created successfully");
      navigate("/", { replace: true });
    } else {
      // ✅ ADMIN APPROVAL GATE: the GIS flow creates the account as pending
      // and returns approval_pending (403, no session) — show the same
      // respectful panel as the local path.
      if (data.error === "approval_pending") {
        deps.setPendingApproval(true);
        return;
      }
      const errMsg = data.error || (lang === "ar" ? "فشل تسجيل الدخول بجوجل" : "Google sign-in failed");
      deps.setError(errMsg); toast.error(errMsg);
    }
  } catch {
    const errMsg = lang === "ar" ? "تعذر الاتصال بالخادم" : "Could not connect to server";
    deps.setError(errMsg); toast.error(errMsg);
  } finally { deps.setGoogleLoading(false); }
}

export default function Register() {
  const { t, lang } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  // ✅ ADMIN APPROVAL GATE (owner directive, 2026-11-24): after a successful
  // registration the account is PENDING the owner's approval — the form is
  // replaced by the respectful welcome panel (in the user's language) and NO
  // session is established (the server issues no cookies/token either).
  const [pendingApproval, setPendingApproval] = useState(false);

  // ── Referral capture: /register?ref=CODE ──
  // Persisted to localStorage so the code survives the Google-OAuth round
  // trip and any intra-page navigation, then consumed on submit.
  const refCodeFromUrl = searchParams.get("ref")?.trim().slice(0, 24) || "";
  useEffect(() => {
    if (refCodeFromUrl) {
      try { localStorage.setItem("elbaz_ref", refCodeFromUrl); } catch { /* private mode */ }
    }
  }, [refCodeFromUrl]);
  // ✅ PERF (react-best-practices js-* / rerender-*): the stored referral code
  // used to be re-read from localStorage inside an IIFE on EVERY render (every
  // keystroke of the form). It is now a useMemo keyed on `refCodeFromUrl`:
  // keystrokes never re-read storage (the key is stable while typing), and a
  // re-read happens exactly when the URL param changes — including the strip
  // case, where the capture effect below has just written the captured code.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refCodeFromUrl is an intentional re-read trigger (not a real dependency) — when ?ref=CODE is stripped in-place, the capture effect has already persisted it and this re-read picks it up
  const storedRefCode = useMemo(() => {
    try { return localStorage.getItem("elbaz_ref") || ""; } catch { return ""; }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refCodeFromUrl is an intentional re-read trigger: when ?ref=CODE is stripped in-place, the capture effect below has already persisted it and this re-read picks it up
  }, [refCodeFromUrl]);

  const refCode = refCodeFromUrl || storedRefCode;

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const injected = (globalThis as any).__ENV__ as Record<string, string> | undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (injected?.GOOGLE_CLIENT_ID) { setGoogleClientId(injected.GOOGLE_CLIENT_ID); return; }
    // ✅ FIX (pre-launch audit): the fallback previously hit /api/health and
    // read `data.env.GOOGLE_CLIENT_ID` — /api/health never exposes env keys,
    // so the Google sign-up button silently vanished on the register page
    // whenever the build-time __ENV__ injection was absent. The dedicated
    // public-env endpoint is /api/env (same source Login.tsx already uses).
    console.warn("[GoogleAuth] globalThis.__ENV__ not found, falling back to /api/env fetch");
    // ✅ PERF (client-fetch dedupe): shared module-scope cache — revisiting
    // this page (or switching Login ↔ Register) no longer re-fetches /api/env.
    // ✅ Sonar S9383: rejection is explicit — without /api/env the Google
    // button simply doesn't render; nothing further to recover here.
    fetchPublicEnv()
      .then(data => { if (data?.GOOGLE_CLIENT_ID) setGoogleClientId(data.GOOGLE_CLIENT_ID); })
      .catch(() => { /* /api/env unreachable — Google sign-up button stays hidden */ });
  }, []);

  // ✅ Sonar S3776: thin wrapper — the full GIS callback lives at module scope.
  const handleGoogleCallback = useCallback(
    (response: GoogleCredentialResponse) => runGoogleRegisterCallback(response, { lang, navigate, queryClient, setGoogleLoading, setError, setPendingApproval }),
    [lang, navigate, queryClient],
  );

  useEffect(() => {
    if (!googleClientId) return;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const waitForGoogle = () => {
      if (disposed) return;
      if (globalThis.google?.accounts?.id) {
        globalThis.google.accounts.id.initialize({ client_id: googleClientId, callback: handleGoogleCallback, auto_select: false, cancel_on_tap_outside: true });
      } else if (!document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (typeof (globalThis as any).__loadGsi === 'function') (globalThis as any).__loadGsi();
        else {
          const s = document.createElement('script');
          s.src = 'https://accounts.google.com/gsi/client';
          s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
          document.head.appendChild(s);
        }
        retryTimer = setTimeout(waitForGoogle, 500);
      } else { retryTimer = setTimeout(waitForGoogle, 200); }
    };
    waitForGoogle();
    return () => { disposed = true; if (retryTimer) clearTimeout(retryTimer); };
  }, [googleClientId, handleGoogleCallback]);

  const handleGoogleSignIn = useCallback(() => {
    setGoogleLoading(true); setError("");
    setTimeout(() => {
      if (!googleClientId) {
        setGoogleLoading(false);
        const errMsg = lang === "ar" ? "تعذر بدء التسجيل بجوجل. أعد تحميل الصفحة وحاول مرة أخرى." : "Could not start Google sign-up. Please reload the page and try again.";
        setError(errMsg); toast.error(errMsg); return;
      }
      try { initiateGoogleOAuth(googleClientId); }
      catch (err) {
        console.error("[GoogleAuth] Failed to redirect:", err);
        setGoogleLoading(false);
        const errMsg = lang === "ar" ? "تعذر بدء التسجيل بجوجل. حاول مرة أخرى." : "Could not start Google sign-up. Please try again.";
        setError(errMsg); toast.error(errMsg);
      }
    }, 50);
  }, [lang, googleClientId]);

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: (data) => {
      trackPlatform("register_success");
      try { localStorage.removeItem("elbaz_ref"); } catch { /* ignore */ }
      // ✅ ADMIN APPROVAL GATE (owner directive, 2026-11-24): the account was
      // created but is pending the owner's approval — no session was issued
      // server-side. Show the respectful welcome panel INSTEAD of entering
      // the platform (the old flow navigated straight to "/").
      if (data?.pendingApproval) {
        setPendingApproval(true);
        toast.success(lang === "ar"
          ? "تم استلام طلب انضمامك بنجاح — بانتظار موافقة المهندس أحمد الباز"
          : "Your join request was received — awaiting Eng. Ahmed Elbaz's approval");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      // Legacy/no-gate path (should not occur while the gate is deployed —
      // kept as a safe fallback so a session is never silently dropped).
      try { localStorage.removeItem("ELBAZ_QUERY_CACHE"); } catch { /* ignore */ }
      queryClient.clear();
      if (data?.user?.id && data?.user?.username) identifyUser(data.user.id, data.user.username, { role: "user", isNewUser: true });
      if (isNativePlatform() && data?.token) setStoredToken(data.token);
      // ✅ Sonar S3358: flat branches instead of a nested ternary.
      if (refCode) {
        toast.success(lang === "ar"
          ? "تم إنشاء الحساب — خصم الترحيب بتاعك مستنيك في ملفك الشخصي 🎁"
          : "Account created — your welcome coupon is waiting in your profile 🎁");
      } else {
        toast.success(t("registerSuccess"));
      }
      navigate("/", { replace: true });
    },
    onError: (err) => {
      trackPlatform("register_failed");
      const errorMsg = describeRegistrationError(err, lang);
      setError(errorMsg); toast.error(errorMsg);
    },
  });

  const failValidation = (msg: string): boolean => { setError(msg); toast.error(msg); return false; };

  const validateRegistrationForm = (): boolean => {
    const u = username.trim();
    const e = email.trim();
    // ✅ Sonar S3776 (25 → 6): data-driven checks, first failure wins — same
    // order and the exact same copy as the previous if-chain. Conditions are
    // pure, so eager evaluation is safe.
    const checks: readonly { valid: boolean; ar: string; en: string }[] = [
      { valid: Boolean(u) && Boolean(password), ar: "اسم المستخدم وكلمة المرور مطلوبان", en: "Username and password are required" },
      { valid: password === confirmPassword, ar: "كلمات المرور غير متطابقة", en: "Passwords do not match" },
      { valid: u.length >= 3, ar: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل", en: "Username must be at least 3 characters" },
      { valid: u.length <= 30, ar: "اسم المستخدم طويل جداً (الحد الأقصى 30 حرف)", en: "Username is too long (max 30 characters)" },
      { valid: /^[a-zA-Z0-9_\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+$/.test(u), ar: "اسم المستخدم يمكن أن يحتوي فقط على حروف (إنجليزية/عربية)، أرقام، وشرطة سفلية (_)", en: "Username can only contain letters (English/Arabic), numbers, and underscores (_)" },
      { valid: !e || isValidEmail(e), ar: "صيغة البريد الإلكتروني غير صحيحة", en: "Invalid email format" },
      { valid: password.length >= 8, ar: "كلمة المرور يجب أن تكون 8 أحرف على الأقل", en: "Password must be at least 8 characters" },
      { valid: hasPasswordStrengthChars(password), ar: "كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم على الأقل", en: "Password must contain at least one uppercase letter, one lowercase letter, and a number" },
    ];
    for (const check of checks) {
      if (!check.valid) {
        return failValidation(lang === "ar" ? check.ar : check.en);
      }
    }
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (!validateRegistrationForm()) return;
    registerMutation.mutate({ username: username.trim(), password, name: name.trim() || undefined, email: email.trim() || undefined, refCode: refCode || undefined });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-accent-secondary/10">
            <Zap className="h-6 w-6 text-accent-secondary" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-foreground">{t("joinPlatform")}</h1>
          <p className="mt-1 text-sm text-text-muted">{t("startLearning")}</p>
        </div>

        {/* ✅ ADMIN APPROVAL GATE — the respectful welcome panel replaces the
            form once the request is in (owner's exact copy, user's language).
            Extracted to a module component — Sonar S3776/S6819. */}
        {pendingApproval ? (
          <RegisterPendingApprovalPanel lang={lang} />
        ) : (
        <>

        {googleClientId && (
          <div className="mb-4">
            <GoogleSignUpButton onClick={handleGoogleSignIn} loading={googleLoading} disabled={googleLoading || registerMutation.isPending} lang={lang} />
          </div>
        )}

        {googleClientId && <GoogleOrDivider lang={lang} />}

        {/* Referral welcome — the invited friend sees this before signing up. */}
        {refCode && <ReferralWelcomeBanner lang={lang} />}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl border border-border bg-primary p-6">
            {error && <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</div>}

            <div className="space-y-4">
              <div>
                <Label htmlFor="register-username" className="text-sm text-text-muted">{t("username")} *</Label>
                <Input id="register-username" name="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={lang === "ar" ? "مثال: ahmed_elbaz" : "e.g. ahmed_elbaz"} className="mt-1 border-border bg-background text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary" autoComplete="username" required />
              </div>
              <div>
                <Label htmlFor="register-name" className="text-sm text-text-muted">{t("name")}</Label>
                <Input id="register-name" name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("enterName")} className="mt-1 border-border bg-background text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary" autoComplete="name" />
              </div>
              <div>
                <Label htmlFor="register-email" className="text-sm text-text-muted">{t("email")}</Label>
                <Input id="register-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("enterEmail")} className="mt-1 border-border bg-background text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary" autoComplete="email" />
              </div>
              <div>
                <Label htmlFor="register-password" className="text-sm text-text-muted">{t("password")} *</Label>
                <div className="relative mt-1">
                  <Input id="register-password" name="password" type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("enterPassword")} className="border-border bg-background pe-10 text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary" autoComplete="new-password" required />
                  <PasswordVisibilityToggle show={showPassword} onToggle={() => setShowPassword((v) => !v)} lang={lang} />
                </div>
              </div>
              <div>
                <Label htmlFor="register-confirm-password" className="text-sm text-text-muted">{t("confirmPassword")} *</Label>
                <div className="relative mt-1">
                  <Input id="register-confirm-password" name="confirmPassword" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t("enterPassword")} className="border-border bg-background pe-10 text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary" autoComplete="new-password" required />
                  <PasswordVisibilityToggle show={showPassword} onToggle={() => setShowPassword((v) => !v)} lang={lang} />
                </div>
              </div>
            </div>

            <Button type="submit" className="glow-btn mt-6 w-full bg-gradient-to-r from-accent-secondary to-accent-secondary/80 font-semibold text-background" disabled={registerMutation.isPending}>
              {registerMutation.isPending ? t("loading") : t("createAccount")}
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-text-muted">
          {t("alreadyHaveAccount")}{" "}
          <Link to="/login" className="font-medium text-accent-secondary hover:underline">{t("login")}</Link>
        </p>
        </>
        )}
      </div>
    </div>
  );
}
