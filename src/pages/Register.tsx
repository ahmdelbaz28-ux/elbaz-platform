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
import { isNativePlatform, setStoredToken } from "@/lib/auth-storage";

export default function Register() {
  const { t, lang } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: (data) => {
      // Token is now set as HttpOnly cookie by the server
      trackPlatform("register_success");
      // Identify new user in Clarity for session recording filtering
      if (data?.user?.id && data?.user?.username) {
        identifyUser(data.user.id, data.user.username, {
          role: "user",
          isNewUser: true,
        });
      }
      // On native platforms, store the JWT token for Authorization header
      if (isNativePlatform() && data?.token) {
        setStoredToken(data.token);
      }
      toast.success(t("registerSuccess"));
      window.location.href = "/";
    },
    onError: (err) => {
      trackPlatform("register_failed");
      setError(err.message);
      toast.error(err.message);
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
    // Must match backend validation (min 8 chars, uppercase, lowercase, digit)
    if (password.length < 8) {
      const msg = lang === "en" ? "Password must be at least 8 characters" : "كلمة المرور يجب أن تكون 8 أحرف على الأقل";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      const msg = lang === "en" ? "Password must contain at least one uppercase letter, one lowercase letter, and one number" : "كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم على الأقل";
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
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("enterUsername")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                  autoComplete="username"
                />
              </div>
              <div>
                <Label htmlFor="register-name" className="text-sm text-[#94a3b8]">{t("name")}</Label>
                <Input
                  id="register-name"
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
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("enterPassword")}
                    className="border-[#1f2d44] bg-[#0a0e17] pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                    autoComplete="new-password"
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
                <Input
                  id="register-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t("enterPassword")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                  autoComplete="new-password"
                />
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
