import { useState, useEffect, useCallback } from "react";
import { initiateGoogleOAuth } from "@/lib/google-auth";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import { Zap, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackPlatform, identifyUser } from "@/lib/clarity";
import { isNativePlatform, setStoredToken } from "@/lib/auth-storage";

// ─── Google Identity Types ───
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

export default function Register() {
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");

  // Fetch Google Client ID from public env vars.
  // 🔧 ROOT CAUSE FIX: Read from window.__ENV__ (injected by server into HTML)
  // FIRST, before falling back to /api/health fetch. The fetch was being blocked
  // by Cloudflare Bot Management on some browsers, causing the Google Sign-Up
  // button to never render (same fix as Login.tsx).
  useEffect(() => {
    // 1. Synchronous: read from injected window.__ENV__
    const injected = (window as any).__ENV__ as Record<string, string> | undefined;
    if (injected?.GOOGLE_CLIENT_ID) {
      setGoogleClientId(injected.GOOGLE_CLIENT_ID);
      return; // ✅ Got it — no need to fetch
    }

    // 2. Fallback: fetch /api/health (may be blocked by Cloudflare Bot Management)
    console.warn("[GoogleAuth] window.__ENV__ not found, falling back to /api/health fetch");
    fetch("/api/health", { cache: "no-store" })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (data?.env?.GOOGLE_CLIENT_ID) setGoogleClientId(data.env.GOOGLE_CLIENT_ID);
      })
      .catch((err) => {
        console.warn("[GoogleAuth] Could not fetch /api/health:", err.message);
      });
  }, []);

  const handleGoogleCallback = useCallback(async (response: GoogleCredentialResponse) => {
    if (!response.credential) return;
    setGoogleLoading(true);
    setError("");
    try {
      const res = await fetch("/api/google-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: response.credential }),
      });
      const data = await res.json();
      if (data.success && data.user) {
        trackPlatform("google_register_success");
        identifyUser(data.user.id, data.user.username, { role: "user", loginMethod: "google" });
        toast.success(lang === "ar" ? "تم إنشاء الحساب بنجاح" : "Account created successfully");
        navigate("/", { replace: true });
      } else {
        setError(data.error || (lang === "ar" ? "فشل تسجيل الدخول بجوجل" : "Google sign-in failed"));
        toast.error(data.error || "Google sign-in failed");
      }
    } catch {
      const errMsg = lang === "ar" ? "تعذر الاتصال بالخادم" : "Could not connect to server";
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setGoogleLoading(false);
    }
  }, [lang, navigate]);

  useEffect(() => {
    if (!googleClientId) return;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const waitForGoogle = () => {
      if (disposed) return;
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleGoogleCallback,
          auto_select: false,
          cancel_on_tap_outside: true,
        });
      } else {
        // Load GIS script on demand if not already loaded
        if (!document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
          // Use the __loadGsi helper from index.html if available
          if (typeof (window as any).__loadGsi === 'function') {
            (window as any).__loadGsi();
          } else {
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client';
            s.async = true;
            s.defer = true;
            s.crossOrigin = 'anonymous';
            document.head.appendChild(s);
          }
          // Wait for script to load
          retryTimer = setTimeout(waitForGoogle, 500);
        } else {
          retryTimer = setTimeout(waitForGoogle, 200);
        }
      }
    };
    waitForGoogle();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [googleClientId, handleGoogleCallback]);

  const handleGoogleSignIn = useCallback(() => {
    setGoogleLoading(true);
    setError("");

    setTimeout(() => {
      if (!googleClientId) {
        setGoogleLoading(false);
        const errMsg = lang === "ar"
          ? "تعذر بدء التسجيل بجوجل. أعد تحميل الصفحة وحاول مرة أخرى."
          : "Could not start Google sign-up. Please reload the page and try again.";
        setError(errMsg);
        toast.error(errMsg);
        return;
      }

      try {
        initiateGoogleOAuth(googleClientId);
      } catch (err) {
        console.error("[GoogleAuth] Failed to redirect:", err);
        setGoogleLoading(false);
        const errMsg = lang === "ar"
          ? "تعذر بدء التسجيل بجوجل. حاول مرة أخرى."
          : "Could not start Google sign-up. Please try again.";
        setError(errMsg);
        toast.error(errMsg);
      }
    }, 50);
  }, [lang, googleClientId]);

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: (data) => {
      trackPlatform("register_success");
      if (data?.user?.id && data?.user?.username) {
        identifyUser(data.user.id, data.user.username, {
          role: "user",
          isNewUser: true,
        });
      }
      if (isNativePlatform() && data?.token) {
        setStoredToken(data.token);
      }
      toast.success(t("registerSuccess"));
      navigate("/", { replace: true });
    },
    onError: (err) => {
      trackPlatform("register_failed");
      let errorMsg = err.message;
      const errorCode = (err.data as { code?: string })?.code;
      if (errorCode === "TOO_MANY_REQUESTS") {
        errorMsg = lang === "ar"
          ? "محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى."
          : "Too many attempts. Please wait a moment and try again.";
      } else if (errorCode === "CONFLICT") {
        errorMsg = lang === "ar"
          ? "اسم المستخدم أو البريد الإلكتروني مسجل مسبقاً"
          : "Username or email already exists";
      } else if (errorCode === "BAD_REQUEST") {
        // Parse the raw Zod message to show specific, user-friendly errors
        const msg = err.message || "";
        if (msg.includes("Username must be at least 3 characters") || msg.includes("too_small") && msg.includes("username")) {
          errorMsg = lang === "ar"
            ? "اسم المستخدم يجب أن يكون 3 أحرف على الأقل"
            : "Username must be at least 3 characters";
        } else if (msg.includes("Username too long") || msg.includes("too_big") && msg.includes("username")) {
          errorMsg = lang === "ar"
            ? "اسم المستخدم طويل جداً (الحد الأقصى 30 حرف)"
            : "Username is too long (maximum 30 characters)";
        } else if (msg.includes("Username can only contain") || msg.includes("invalid_format") && msg.includes("username")) {
          errorMsg = lang === "ar"
            ? "اسم المستخدم يحتوي على حروف غير مسموحة. استخدم حروف (إنجليزية/عربية) وأرقام وشرطة سفلية (_) فقط"
            : "Username contains invalid characters. Use English/Arabic letters, numbers, and underscores (_) only";
        } else if (msg.includes("Password must be at least 8 characters") || msg.includes("too_small") && msg.includes("password")) {
          errorMsg = lang === "ar"
            ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل"
            : "Password must be at least 8 characters";
        } else if (msg.includes("Password must contain") || msg.includes("invalid_format") && msg.includes("password")) {
          errorMsg = lang === "ar"
            ? "كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم على الأقل"
            : "Password must contain at least one uppercase letter, one lowercase letter, and one number";
        } else if (msg.includes("Invalid email") || msg.includes("email")) {
          errorMsg = lang === "ar"
            ? "بريد إلكتروني غير صالح"
            : "Invalid email address";
        } else {
          errorMsg = lang === "ar"
            ? "بيانات غير صالحة. تحقق من الحقول وحاول مرة أخرى."
            : "Invalid data. Please check the fields and try again.";
        }
      } else {
        // Fallback for any other error (INTERNAL_SERVER_ERROR, etc.)
        errorMsg = lang === "ar"
          ? "حدث خطأ في النظام. يرجى المحاولة مرة أخرى لاحقاً."
          : "A system error occurred. Please try again later.";
      }
      setError(errorMsg);
      toast.error(errorMsg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password.trim()) {
      const msg = lang === "en" ? "Username and password are required" : "اسم المستخدم وكلمة المرور مطلوبان";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (password !== confirmPassword) {
      const msg = lang === "en" ? "Passwords do not match" : "كلمات المرور غير متطابقة";
      setError(msg);
      toast.error(msg);
      return;
    }
    // === Username validation (must match backend Zod schema) ===
    if (username.trim().length < 3) {
      const msg = lang === "en" ? "Username must be at least 3 characters" : "اسم المستخدم يجب أن يكون 3 أحرف على الأقل";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (username.trim().length > 30) {
      const msg = lang === "en" ? "Username is too long (max 30 characters)" : "اسم المستخدم طويل جداً (الحد الأقصى 30 حرف)";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!/^[a-zA-Z0-9_\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+$/.test(username.trim())) {
      const msg = lang === "en"
        ? "Username can only contain letters (English/Arabic), numbers, and underscores (_)"
        : "اسم المستخدم يمكن أن يحتوي فقط على حروف (إنجليزية/عربية)، أرقام، وشرطة سفلية (_)";
      setError(msg);
      toast.error(msg);
      return;
    }
    // === Email validation (if provided) ===
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      const msg = lang === "en" ? "Invalid email format" : "صيغة البريد الإلكتروني غير صحيحة";
      setError(msg);
      toast.error(msg);
      return;
    }
    // === Password validation (must match backend: min 8, max 100, uppercase, lowercase, digit) ===
    if (password.length < 8) {
      const msg = lang === "en" ? "Password must be at least 8 characters" : "كلمة المرور يجب أن تكون 8 أحرف على الأقل";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      const msg = lang === "en"
        ? "Password must contain at least one uppercase letter, one lowercase letter, and one number"
        : "كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم على الأقل";
      setError(msg);
      toast.error(msg);
      return;
    }
    registerMutation.mutate({
      username: username.trim(),
      password,
      name: name.trim() || undefined,
      email: email.trim() || undefined,
    });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0e17] px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[rgba(6,182,212,0.15)]">
            <Zap className="h-6 w-6 text-[#06b6d4]" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-[#f0f4f8]">{t("joinPlatform")}</h1>
          <p className="mt-1 text-sm text-[#94a3b8]">{t("startLearning")}</p>
        </div>

        {/* Google Sign-In Button */}
        {googleClientId && (
          <div className="mb-4">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || registerMutation.isPending}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-[#1f2d44] bg-[#111827] px-4 py-3 text-sm font-medium text-[#f0f4f8] transition-all duration-200 hover:border-[#4285f4]/50 hover:bg-[#1a1a2e] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {googleLoading ? (
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#4285f4] border-t-transparent" />
              ) : (
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              )}
              {googleLoading
                ? (lang === "ar" ? "جارٍ التسجيل..." : "Signing up...")
                : (lang === "ar" ? "التسجيل بجوجل" : "Sign up with Google")
              }
            </button>
          </div>
        )}

        {googleClientId && (
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#1f2d44]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#0a0e17] px-3 text-[#64748b]">
                {lang === "ar" ? "أو" : "or"}
              </span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
            {error && (
              <div className="mb-4 rounded-lg bg-[rgba(244,63,94,0.1)] p-3 text-sm text-[#f43f5e]" role="alert">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <Label htmlFor="register-username" className="text-sm text-[#94a3b8]">{t("username")} *</Label>
                <Input
                  id="register-username"
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={lang === "ar" ? "مثال: ahmed_elbaz" : "e.g. ahmed_elbaz"}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <Label htmlFor="register-name" className="text-sm text-[#94a3b8]">{t("name")}</Label>
                <Input
                  id="register-name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("enterName")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                  autoComplete="name"
                />
              </div>
              <div>
                <Label htmlFor="register-email" className="text-sm text-[#94a3b8]">{t("email")}</Label>
                <Input
                  id="register-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("enterEmail")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                  autoComplete="email"
                />
              </div>
              <div>
                <Label htmlFor="register-password" className="text-sm text-[#94a3b8]">{t("password")} *</Label>
                <div className="relative mt-1">
                  <Input
                    id="register-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("enterPassword")}
                    className="border-[#1f2d44] bg-[#0a0e17] pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8]"
                    aria-label={showPassword ? (lang === "ar" ? "إخفاء كلمة المرور" : "Hide password") : (lang === "ar" ? "إظهار كلمة المرور" : "Show password")}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label htmlFor="register-confirm-password" className="text-sm text-[#94a3b8]">{t("confirmPassword")} *</Label>
                <div className="relative mt-1">
                  <Input
                    id="register-confirm-password"
                    name="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={t("enterPassword")}
                    className="border-[#1f2d44] bg-[#0a0e17] pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8]"
                    aria-label={showPassword ? (lang === "ar" ? "إخفاء كلمة المرور" : "Hide password") : (lang === "ar" ? "إظهار كلمة المرور" : "Show password")}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              className="glow-btn mt-6 w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] font-semibold text-[#0a0e17]"
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? t("loading") : t("createAccount")}
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-[#94a3b8]">
          {t("alreadyHaveAccount")}{" "}
          <Link to="/login" className="font-medium text-[#06b6d4] hover:underline">
            {t("login")}
          </Link>
        </p>
      </div>
    </div>
  );
}
