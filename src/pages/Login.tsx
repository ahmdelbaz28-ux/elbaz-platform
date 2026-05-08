import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import { Zap, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackPlatform, identifyUser } from "@/lib/clarity";

export default function Login() {
  const { t, lang } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      // Token is now set as HttpOnly cookie by the server
      trackPlatform("login_success");
      // Identify user in Clarity for session recording filtering
      if (data?.user?.id && data?.user?.username) {
        identifyUser(data.user.id, data.user.username, {
          role: data.user.role || "user",
        });
      }
      toast.success(t("loginSuccess"));
      window.location.href = "/";
    },
    onError: (err) => {
      trackPlatform("login_failed");
      setError(err.message);
      toast.error(err.message);
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
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("enterUsername")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4] focus:ring-[#06b6d4]"
                  autoComplete="username"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-[#94a3b8]">{t("password")}</Label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-[#06b6d4] transition-colors hover:text-[#22d3ee]"
                  >
                    {t("forgotPassword")}
                  </Link>
                </div>
                <div className="relative mt-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("enterPassword")}
                    className="border-[#1f2d44] bg-[#0a0e17] pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4] focus:ring-[#06b6d4]"
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
              disabled={loginMutation.isPending}
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

        {/* ✅ SECURITY FIX: Demo credentials only shown in development */}
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
