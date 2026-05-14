import { useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import {
  KeyRound,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  AlertTriangle,
  ArrowLeft,
  Lock,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackPlatform } from "@/lib/clarity";

type ResetState = "form" | "submitting" | "success" | "error" | "invalid";

export default function ResetPassword() {
  const { lang } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get("token");
  const uid = searchParams.get("uid");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState(!token || !uid ? (lang === "ar" ? "رابط إعادة التعيين غير مكتمل. يرجى التأكد من نسخ الرابط كاملاً من البريد الإلكتروني." : "Invalid reset link. Please make sure you copied the full link from the email.") : "");
  const [state, setState] = useState<ResetState>(!token || !uid ? "invalid" : "form");

  const resetMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setState("success");
        trackPlatform("password_reset_success");
        toast.success(data.message);
      }
    },
    onError: (err) => {
      trackPlatform("password_reset_error");
      const msg = err.message?.toLowerCase() || "";

      if (
        msg.includes("invalid") ||
        msg.includes("expired") ||
        msg.includes("غير صالح") ||
        msg.includes("منتهي")
      ) {
        setState("invalid");
        setError(err.message);
      } else {
        setError(err.message);
        toast.error(err.message);
      }
    },
  });

  // Render directly relies on initial state if no token/uid is provided

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setState("form");

    // Client-side validation
    if (!newPassword.trim()) {
      const msg =
        lang === "ar"
          ? "يرجى إدخال كلمة المرور الجديدة"
          : "Please enter a new password";
      setError(msg);
      toast.error(msg);
      return;
    }

    if (newPassword.length < 8) {
      const msg =
        lang === "ar"
          ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل"
          : "Password must be at least 8 characters";
      setError(msg);
      toast.error(msg);
      return;
    }

    if (
      !/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)
    ) {
      const msg =
        lang === "ar"
          ? "كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم على الأقل"
          : "Password must contain at least one uppercase letter, one lowercase letter, and one number";
      setError(msg);
      toast.error(msg);
      return;
    }

    if (newPassword !== confirmPassword) {
      const msg =
        lang === "ar"
          ? "كلمات المرور غير متطابقة"
          : "Passwords do not match";
      setError(msg);
      toast.error(msg);
      return;
    }

    if (!token || !uid) {
      setState("invalid");
      return;
    }

    setState("submitting");
    resetMutation.mutate({
      userId: parseInt(uid, 10),
      token,
      newPassword,
    });
  };

  // Password strength indicator
  const getPasswordStrength = (pw: string) => {
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^a-zA-Z0-9]/.test(pw)) score++;
    return score;
  };

  const strength = getPasswordStrength(newPassword);

  const strengthLabel =
    lang === "ar"
      ? ["", "ضعيفة جداً", "ضعيفة", "متوسطة", "قوية", "قوية جداً"]
      : ["", "Very Weak", "Weak", "Fair", "Strong", "Very Strong"];

  const strengthColor =
    strength <= 1
      ? "#f43f5e"
      : strength === 2
        ? "#f97316"
        : strength === 3
          ? "#f59e0b"
          : "#10b981";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0e17] px-4">
      <div className="w-full max-w-md">
        {/* ── Form State ── */}
        {(state === "form" || state === "submitting") && (
          <>
            {/* Back link */}
            <Link
              to="/login"
              className="mb-6 inline-flex items-center gap-2 text-sm text-[#94a3b8] transition-colors hover:text-[#06b6d4]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {lang === "ar" ? "العودة لتسجيل الدخول" : "Back to login"}
            </Link>

            {/* Header */}
            <div className="mb-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(6,182,212,0.1)]">
                <Lock className="h-8 w-8 text-[#06b6d4]" />
              </div>
              <h1 className="mt-5 text-2xl font-bold text-[#f0f4f8]">
                {lang === "ar"
                  ? "إنشاء كلمة مرور جديدة"
                  : "Create New Password"}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[#94a3b8]">
                {lang === "ar"
                  ? "أدخل كلمة المرور الجديدة لحسابك. تأكد من اختيار كلمة مرور قوية لم تكن تستخدمها من قبل."
                  : "Enter a new password for your account. Make sure to choose a strong password you haven't used before."}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
                {error && (
                  <div
                    className="mb-4 rounded-lg bg-[rgba(244,63,94,0.1)] p-3 text-sm text-[#f43f5e]"
                    role="alert"
                  >
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  {/* New Password */}
                  <div>
                    <Label
                      htmlFor="new-password"
                      className="text-sm text-[#94a3b8]"
                    >
                      {lang === "ar"
                        ? "كلمة المرور الجديدة"
                        : "New Password"}
                    </Label>
                    <div className="relative mt-1">
                      <Input
                        id="new-password"
                        name="newPassword"
                        type={showPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => {
                          setNewPassword(e.target.value);
                          if (error) setError("");
                        }}
                        placeholder={
                          lang === "ar"
                            ? "أدخل كلمة المرور الجديدة"
                            : "Enter new password"
                        }
                        className="border-[#1f2d44] bg-[#0a0e17] pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4] focus:ring-[#06b6d4]"
                        autoComplete="new-password"
                        disabled={state === "submitting"}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8]"
                        aria-label={
                          showPassword
                            ? lang === "ar"
                              ? "إخفاء كلمة المرور"
                              : "Hide password"
                            : lang === "ar"
                              ? "إظهار كلمة المرور"
                              : "Show password"
                        }
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    {/* Password strength bar */}
                    {newPassword.length > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[#64748b]">
                            {lang === "ar"
                              ? "قوة كلمة المرور"
                              : "Password strength"}
                          </span>
                          <span
                            className="text-xs font-medium"
                            style={{ color: strengthColor }}
                          >
                            {strength > 0 ? strengthLabel[strength] : ""}
                          </span>
                        </div>
                        <div className="mt-1 flex gap-1">
                          {[1, 2, 3, 4].map((level) => (
                            <div
                              key={level}
                              className="h-1 flex-1 rounded-full transition-colors duration-300"
                              style={{
                                backgroundColor:
                                  strength >= level
                                    ? strengthColor
                                    : "#1f2d44",
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Confirm Password */}
                  <div>
                    <Label
                      htmlFor="confirm-password"
                      className="text-sm text-[#94a3b8]"
                    >
                      {lang === "ar"
                        ? "تأكيد كلمة المرور"
                        : "Confirm Password"}
                    </Label>
                    <div className="relative mt-1">
                      <Input
                        id="confirm-password"
                        name="confirmPassword"
                        type={showConfirm ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          if (error) setError("");
                        }}
                        placeholder={
                          lang === "ar"
                            ? "أعد إدخال كلمة المرور"
                            : "Re-enter password"
                        }
                        className={`border-[#1f2d44] bg-[#0a0e17] pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4] focus:ring-[#06b6d4] ${
                          confirmPassword.length > 0 &&
                          newPassword !== confirmPassword
                            ? "border-[#f43f5e] focus:border-[#f43f5e]"
                            : ""
                        }`}
                        autoComplete="new-password"
                        disabled={state === "submitting"}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirm(!showConfirm)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8]"
                        aria-label={
                          showConfirm
                            ? lang === "ar"
                              ? "إخفاء كلمة المرور"
                              : "Hide password"
                            : lang === "ar"
                              ? "إظهار كلمة المرور"
                              : "Show password"
                        }
                      >
                        {showConfirm ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    {confirmPassword.length > 0 &&
                      newPassword !== confirmPassword && (
                        <p className="mt-1 text-xs text-[#f43f5e]">
                          {lang === "ar"
                            ? "كلمات المرور غير متطابقة"
                            : "Passwords do not match"}
                        </p>
                      )}
                    {confirmPassword.length > 0 &&
                      newPassword === confirmPassword &&
                      newPassword.length > 0 && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-[#10b981]">
                          <CheckCircle2 className="h-3 w-3" />
                          {lang === "ar"
                            ? "كلمات المرور متطابقة"
                            : "Passwords match"}
                        </p>
                      )}
                  </div>
                </div>

                {/* Requirements */}
                <div className="mt-4 rounded-lg bg-[#0a0e17] p-3">
                  <p className="mb-2 text-xs font-medium text-[#94a3b8]">
                    {lang === "ar"
                      ? "متطلبات كلمة المرور:"
                      : "Password requirements:"}
                  </p>
                  <ul className="space-y-1.5">
                    {[
                      {
                        test: newPassword.length >= 8,
                        label:
                          lang === "ar"
                            ? "8 أحرف على الأقل"
                            : "At least 8 characters",
                      },
                      {
                        test:
                          /[A-Z]/.test(newPassword) &&
                          /[a-z]/.test(newPassword),
                        label:
                          lang === "ar"
                            ? "حرف كبير وحرف صغير"
                            : "Uppercase and lowercase letters",
                      },
                      {
                        test: /\d/.test(newPassword),
                        label:
                          lang === "ar" ? "رقم واحد على الأقل" : "At least one number",
                      },
                    ].map((req, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-2 text-xs"
                      >
                        <div
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor: req.test
                              ? "#10b981"
                              : "#1f2d44",
                          }}
                        />
                        <span
                          className={
                            req.test ? "text-[#10b981]" : "text-[#64748b]"
                          }
                        >
                          {req.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <Button
                  type="submit"
                  className="glow-btn mt-6 w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] font-semibold text-[#0a0e17]"
                  disabled={state === "submitting"}
                >
                  {state === "submitting" ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {lang === "ar" ? "جاري إعادة التعيين..." : "Resetting..."}
                    </span>
                  ) : lang === "ar" ? (
                    "إعادة تعيين كلمة المرور"
                  ) : (
                    "Reset Password"
                  )}
                </Button>
              </div>
            </form>
          </>
        )}

        {/* ── Success State ── */}
        {state === "success" && (
          <>
            <div className="space-y-6">
              <div className="text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[rgba(16,185,129,0.1)]">
                  <ShieldCheck className="h-10 w-10 text-[#10b981]" />
                </div>
                <h1 className="mt-5 text-2xl font-bold text-[#f0f4f8]">
                  {lang === "ar"
                    ? "تم إعادة التعيين بنجاح!"
                    : "Password Reset!"}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-[#94a3b8]">
                  {lang === "ar"
                    ? "تم تغيير كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول باستخدام كلمة المرور الجديدة."
                    : "Your password has been changed successfully. You can now sign in with your new password."}
                </p>
              </div>

              {/* Success badge */}
              <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)] px-4 py-2">
                <CheckCircle2 className="h-4 w-4 text-[#10b981]" />
                <span className="text-sm font-medium text-[#10b981]">
                  {lang === "ar"
                    ? "تم تحديث كلمة المرور"
                    : "Password updated"}
                </span>
              </div>

              {/* Note about sessions */}
              <div className="rounded-lg border border-dashed border-[#1f2d44] bg-[#111827] p-4">
                <div className="flex items-start gap-3">
                  <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[#06b6d4]" />
                  <p className="text-xs leading-relaxed text-[#64748b]">
                    {lang === "ar"
                      ? "لأسباب أمنية، تم تسجيل خروج جميع الأجهزة الأخرى. ستحتاج لتسجيل الدخول مرة أخرى على كل جهاز."
                      : "For security, all other devices have been signed out. You'll need to sign in again on each device."}
                  </p>
                </div>
              </div>

              <Button
                onClick={() => navigate("/login")}
                className="glow-btn w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] font-semibold text-[#0a0e17]"
              >
                {lang === "ar"
                  ? "تسجيل الدخول الآن"
                  : "Sign In Now"}
              </Button>
            </div>
          </>
        )}

        {/* ── Invalid/Expired Link State ── */}
        {state === "invalid" && (
          <>
            <Link
              to="/login"
              className="mb-6 inline-flex items-center gap-2 text-sm text-[#94a3b8] transition-colors hover:text-[#06b6d4]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {lang === "ar" ? "العودة لتسجيل الدخول" : "Back to login"}
            </Link>

            <div className="space-y-6">
              <div className="text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[rgba(244,63,94,0.1)]">
                  <AlertTriangle className="h-10 w-10 text-[#f43f5e]" />
                </div>
                <h1 className="mt-5 text-2xl font-bold text-[#f0f4f8]">
                  {lang === "ar" ? "رابط غير صالح" : "Invalid Link"}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-[#94a3b8]">
                  {error ||
                    (lang === "ar"
                      ? "رابط إعادة تعيين كلمة المرور هذا غير صالح أو منتهي الصلاحية. يرجى طلب رابط جديد."
                      : "This password reset link is invalid or has expired. Please request a new one.")}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <Link to="/forgot-password">
                  <Button className="glow-btn w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] font-semibold text-[#0a0e17]">
                    {lang === "ar"
                      ? "طلب رابط جديد"
                      : "Request New Link"}
                  </Button>
                </Link>
                <Link
                  to="/login"
                  className="flex items-center justify-center gap-2 text-sm text-[#94a3b8] transition-colors hover:text-[#06b6d4]"
                >
                  {lang === "ar"
                    ? "العودة لتسجيل الدخول"
                    : "Back to login"}
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
