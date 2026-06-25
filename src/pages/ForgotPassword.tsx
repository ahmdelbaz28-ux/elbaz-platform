import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import {
  KeyRound,
  ArrowLeft,
  Mail,
  Loader2,
  ShieldCheck,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trackPlatform } from "@/lib/clarity";

type Step = "enterEmail" | "sending" | "sent";

export default function ForgotPassword() {
  const { lang } = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState<Step>("enterEmail");

  const forgotMutation = trpc.auth.forgotPassword.useMutation({
    onSuccess: (data) => {
      trackPlatform("forgot_password_requested");
      setStep("sent");
      toast.success(data.message);
      // Surface email delivery problems (e.g. Resend sandbox / unverified
      // domain) to the user instead of letting them wait for an email that
      // will never arrive.
      if (data.deliveryWarning) {
        setTimeout(() => {
          toast.warning(data.deliveryWarning, { duration: 8000 });
        }, 1500);
      }
    },
    onError: (err) => {
      trackPlatform("forgot_password_error");
      setError(err.message);
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      const msg =
        lang === "ar"
          ? "يرجى إدخال البريد الإلكتروني"
          : "Please enter your email address";
      setError(msg);
      toast.error(msg);
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      const msg =
        lang === "ar"
          ? "صيغة البريد الإلكتروني غير صحيحة"
          : "Invalid email format";
      setError(msg);
      toast.error(msg);
      return;
    }

    setStep("sending");
    forgotMutation.mutate({ email: email.trim().toLowerCase() });
  };

  const handleResend = () => {
    setError("");
    setStep("sending");
    forgotMutation.mutate({ email: email.trim().toLowerCase() });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0e17] px-4">
      <div className="w-full max-w-md">
        {/* ── Step 1: Enter Email ── */}
        {(step === "enterEmail" || step === "sending") && (
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
                <KeyRound className="h-8 w-8 text-[#06b6d4]" />
              </div>
              <h1 className="mt-5 text-2xl font-bold text-[#f0f4f8]">
                {lang === "ar" ? "نسيت كلمة المرور؟" : "Forgot your password?"}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-[#94a3b8]">
                {lang === "ar"
                  ? "لا تقلق! أدخل بريدك الإلكتروني وسنرسل لك رابط لإعادة تعيين كلمة المرور."
                  : "No worries! Enter your email address and we'll send you a link to reset your password."}
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
                  <div>
                    <Label
                      htmlFor="forgot-email"
                      className="text-sm text-[#94a3b8]"
                    >
                      {lang === "ar" ? "البريد الإلكتروني" : "Email Address"}
                    </Label>
                    <div className="relative mt-1">
                      <Input
                        id="forgot-email"
                        name="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={
                          lang === "ar"
                            ? "example@email.com"
                            : "example@email.com"
                        }
                        className="border-[#1f2d44] bg-[#0a0e17] pl-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4] focus:ring-[#06b6d4]"
                        autoComplete="email"
                        disabled={step === "sending"}
                        required
                      />
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
                    </div>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="glow-btn mt-6 w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] font-semibold text-[#0a0e17]"
                  disabled={forgotMutation.isPending || step === "sending"}
                >
                  {forgotMutation.isPending || step === "sending" ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {lang === "ar" ? "جاري الإرسال..." : "Sending..."}
                    </span>
                  ) : (
                    lang === "ar"
                      ? "إرسال رابط إعادة التعيين"
                      : "Send Reset Link"
                  )}
                </Button>
              </div>
            </form>

            {/* Security note */}
            <div className="mt-6 rounded-lg border border-dashed border-[#1f2d44] bg-[#111827] p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#06b6d4]" />
                <p className="text-xs leading-relaxed text-[#64748b]">
                  {lang === "ar"
                    ? "لأسباب أمنية، لن نخبرك ما إذا كان البريد الإلكتروني مسجلاً أم لا. ستصلك رسالة فقط إذا كان الحساب موجوداً."
                    : "For security reasons, we won't tell you if the email is registered or not. You'll only receive a message if an account exists."}
                </p>
              </div>
            </div>
          </>
        )}

        {/* ── Step 2: Email Sent Confirmation ── */}
        {step === "sent" && (
          <>
            {/* Back link */}
            <Link
              to="/login"
              className="mb-6 inline-flex items-center gap-2 text-sm text-[#94a3b8] transition-colors hover:text-[#06b6d4]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {lang === "ar" ? "العودة لتسجيل الدخول" : "Back to login"}
            </Link>

            <div className="space-y-6">
              {/* Success icon */}
              <div className="text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[rgba(16,185,129,0.1)]">
                  <Inbox className="h-10 w-10 text-[#10b981]" />
                </div>
                <h1 className="mt-5 text-2xl font-bold text-[#f0f4f8]">
                  {lang === "ar"
                    ? "تم إرسال الرابط بنجاح!"
                    : "Check your email!"}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-[#94a3b8]">
                  {lang === "ar"
                    ? "إذا كان هناك حساب مرتبط بـ "
                    : "If an account exists for "}
                  <span className="font-medium text-[#f0f4f8]">{email}</span>
                  {lang === "ar"
                    ? " فستصلك رسالة تحتوي على رابط إعادة تعيين كلمة المرور."
                    : ", you'll receive an email with a password reset link."}
                </p>
              </div>

              {/* Info card */}
              <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-5">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(6,182,212,0.15)]">
                      <span className="text-xs font-bold text-[#06b6d4]">1</span>
                    </div>
                    <p className="text-sm text-[#94a3b8]">
                      {lang === "ar"
                        ? "افتح صندوق الوارد الخاص ببريدك الإلكتروني"
                        : "Open your email inbox"}
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(6,182,212,0.15)]">
                      <span className="text-xs font-bold text-[#06b6d4]">2</span>
                    </div>
                    <p className="text-sm text-[#94a3b8]">
                      {lang === "ar"
                        ? "ابحث عن رسالة من منصة أحمد الباز"
                        : 'Look for an email from "Ahmed Elbaz Platform"'}
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[rgba(6,182,212,0.15)]">
                      <span className="text-xs font-bold text-[#06b6d4]">3</span>
                    </div>
                    <p className="text-sm text-[#94a3b8]">
                      {lang === "ar"
                        ? "اضغط على زر إعادة التعيين في الرسالة"
                        : 'Click the "Reset Password" button in the email'}
                    </p>
                  </div>
                </div>

                {/* Expiry warning */}
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-[rgba(245,158,11,0.08)] p-3">
                  <div className="h-2 w-2 shrink-0 rounded-full bg-[#f59e0b]" />
                  <p className="text-xs text-[#f59e0b]">
                    {lang === "ar"
                      ? "الرابط ينتهي خلال 15 دقيقة. تحقق من مجلد الرسائل غير المرغوب فيها إذا لم تجد الرسالة."
                      : "The link expires in 15 minutes. Check your spam folder if you don't see the email."}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3">
                <Button
                  onClick={handleResend}
                  disabled={forgotMutation.isPending}
                  variant="outline"
                  className="w-full border-[#1f2d44] bg-[#111827] text-[#94a3b8] hover:border-[#06b6d4] hover:text-[#06b6d4]"
                >
                  {forgotMutation.isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {lang === "ar" ? "جاري الإعادة..." : "Resending..."}
                    </span>
                  ) : lang === "ar" ? (
                    "إعادة إرسال الرابط"
                  ) : (
                    "Resend Link"
                  )}
                </Button>
                <Link
                  to="/login"
                  className="flex items-center justify-center gap-2 text-sm text-[#06b6d4] transition-colors hover:text-[#22d3ee]"
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
