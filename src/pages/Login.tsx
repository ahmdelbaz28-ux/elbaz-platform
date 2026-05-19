import { useState, useEffect, useCallback } from "react";
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

export default function Login() {
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");

  // Fetch Google Client ID from server health endpoint
  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then(r => r.json())
      .then(data => {
        if (data?.env?.GOOGLE_CLIENT_ID) {
          setGoogleClientId(data.env.GOOGLE_CLIENT_ID);
        }
      })
      .catch(() => { /* Google Sign-In optional */ });
  }, []);

  // Handle Google Sign-In response
  const handleGoogleCallback = useCallback(async (response: GoogleCredentialResponse) => {
    if (!response.credential) {
      console.error("[GoogleAuth] No credential in response");
      return;
    }

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
        trackPlatform("google_login_success");
        if (data.user?.id && data.user?.username) {
          identifyUser(data.user.id, data.user.username, {
            role: data.user.role || "user",
            loginMethod: "google",
          });
        }
        toast.success(lang === "ar" ? "تم تسجيل الدخول بنجاح" : "Logged in successfully");
        navigate("/", { replace: true });
      } else {
        const errMsg = data.error || (lang === "ar" ? "فشل تسجيل الدخول بجوجل" : "Google login failed");
        setError(errMsg);
        toast.error(errMsg);
      }
    } catch (err) {
      console.error("[GoogleAuth] Network error:", err);
      const errMsg = lang === "ar" ? "تعذر الاتصال بالخادم" : "Could not connect to server";
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setGoogleLoading(false);
    }
  }, [lang, navigate]);

  // Initialize Google Identity Services when clientId is available
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

  // Trigger Google Sign-In popup
  const handleGoogleSignIn = useCallback(() => {
    if (!window.google?.accounts?.id) {
      toast.error(lang === "ar" ? "جوجل غير متاح حالياً. حاول مرة أخرى." : "Google Sign-In not available yet. Please try again.");
      return;
    }
    window.google.accounts.id.prompt((response) => {
      if (response.error) {
        console.log("[GoogleAuth] User dismissed or error:", response.error);
        if (response.error !== "user_closed") {
          toast.error(lang === "ar" ? "حدث خطأ في تسجيل جوجل" : "Google Sign-In error occurred");
        }
      }
    });
  }, [lang]);

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      trackPlatform("login_success");
      if (data?.user?.id && data?.user?.username) {
        identifyUser(data.user.id, data.user.username, {
          role: data.user.role || "user",
        });
      }
      if (isNativePlatform() && data?.token) {
        setStoredToken(data.token);
      }
      toast.success(t("loginSuccess"));
      navigate("/", { replace: true });
    },
    onError: (err) => {
      trackPlatform("login_failed");
      let errorMsg = err.message;
      const errorCode = (err.data as { code?: string })?.code;
      if (errorCode === "TOO_MANY_REQUESTS") {
        errorMsg = lang === "ar"
          ? "محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى."
          : "Too many login attempts. Please wait a moment and try again.";
      } else if (errorCode === "UNAUTHORIZED") {
        errorMsg = lang === "ar"
          ? "اسم المستخدم أو كلمة المرور غير صحيح"
          : "Invalid username or password";
      } else {
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
      const msg = lang === "en" ? "Please fill in all fields" : "يرجى ملء جميع الحقول";
      setError(msg);
      toast.error(msg);
      return;
    }
    loginMutation.mutate({ username: username.trim(), password });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0e17] px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[rgba(6,182,212,0.15)]">
            <Zap className="h-6 w-6 text-[#06b6d4]" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-[#f0f4f8]">{t("welcomeBack")}</h1>
          <p className="mt-1 text-sm text-[#94a3b8]">{t("loginToContinue")}</p>
        </div>

        {/* Google Sign-In Button */}
        {googleClientId && (
          <div className="mb-4">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || loginMutation.isPending}
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
                ? (lang === "ar" ? "جارٍ تسجيل الدخول..." : "Signing in...")
                : (lang === "ar" ? "تسجيل الدخول بجوجل" : "Sign in with Google")
              }
            </button>
          </div>
        )}

        {/* Divider */}
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
            {error && (
              <div className="mb-4 rounded-lg bg-[rgba(244,63,94,0.1)] p-3 text-sm text-[#f43f5e]" role="alert">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <Label htmlFor="login-username" className="text-sm text-[#94a3b8]">{t("username")}</Label>
                <Input
                  id="login-username"
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("enterUsername")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4] focus:ring-[#06b6d4]"
                  autoComplete="username"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="login-password" className="text-sm text-[#94a3b8]">{t("password")}</Label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-[#06b6d4] transition-colors hover:text-[#22d3ee]"
                  >
                    {t("forgotPassword")}
                  </Link>
                </div>
                <div className="relative mt-1">
                  <Input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("enterPassword")}
                    className="border-[#1f2d44] bg-[#0a0e17] pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4] focus:ring-[#06b6d4]"
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
              disabled={loginMutation.isPending || googleLoading}
            >
              {loginMutation.isPending ? t("loading") : t("login")}
            </Button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-[#94a3b8]">
          {t("dontHaveAccount")}{" "}
          <Link to="/register" className="font-medium text-[#06b6d4] hover:underline">
            {t("register")}
          </Link>
        </p>

        {/* Demo credentials only shown in development */}
        {import.meta.env.DEV && (
          <div className="mt-6 rounded-lg border border-dashed border-[#1f2d44] bg-[#111827] p-4 text-center">
            <p className="text-xs text-[#64748b]">{lang === "en" ? "Demo credentials:" : "بيانات تجريبية:"}</p>
            <p className="mt-1 text-xs text-[#94a3b8]">admin / admin123</p>
            <p className="text-xs text-[#94a3b8]">demo / demo123</p>
          </div>
        )}
      </div>
    </div>
  );
}
