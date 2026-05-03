import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import { Zap, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      localStorage.setItem("auth_token", data.token);
      toast.success(t("registerSuccess"));
      window.location.href = "/";
    },
    onError: (err) => {
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
    // ✅ FIX: Must match backend validation (min 8 chars)
    if (password.length < 8) {
      const msg = lang === "en" ? "Password must be at least 8 characters" : "كلمة المرور يجب أن تكون 8 أحرف على الأقل";
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
              <div className="mb-4 rounded-lg bg-[rgba(244,63,94,0.1)] p-3 text-sm text-[#f43f5e]">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <Label className="text-sm text-[#94a3b8]">{t("username")} *</Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("enterUsername")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                />
              </div>
              <div>
                <Label className="text-sm text-[#94a3b8]">{t("name")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("enterName")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                />
              </div>
              <div>
                <Label className="text-sm text-[#94a3b8]">{t("email")}</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("enterEmail")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                />
              </div>
              <div>
                <Label className="text-sm text-[#94a3b8]">{t("password")} *</Label>
                <div className="relative mt-1">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t("enterPassword")}
                    className="border-[#1f2d44] bg-[#0a0e17] pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <Label className="text-sm text-[#94a3b8]">{t("confirmPassword")} *</Label>
                <Input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t("enterPassword")}
                  className="mt-1 border-[#1f2d44] bg-[#0a0e17] text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4]"
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
