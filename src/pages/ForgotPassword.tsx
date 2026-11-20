import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { isValidEmail, hasPasswordStrengthChars } from "@/lib/validation";
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

type Step = "enterEmail" | "sending" | "sent" | "resetDone";

export default function ForgotPassword() {
  const { lang } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState<Step>("enterEmail");
  const [deliveryWarning, setDeliveryWarning] = useState<string | null>(null);
  // Code-entry state — the email carries a 6-digit code + a link. Both work.
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const forgotMutation = trpc.auth.forgotPassword.useMutation({
    onSuccess: (data) => {
      trackPlatform("forgot_password_requested");
      setStep("sent");
      toast.success(data.message);
      if (data.deliveryWarning) setDeliveryWarning(data.deliveryWarning);
    },
    onError: (err) => {
      trackPlatform("forgot_password_error");
      setError(err.message);
      toast.error(err.message);
    },
  });

  const resetMutation = trpc.auth.resetPassword.useMutation({
    onSuccess: (data) => {
      trackPlatform("password_reset_success");
      toast.success(data.message);
      setStep("resetDone");
    },
    onError: (err) => {
      trackPlatform("password_reset_error");
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      const msg = lang === "ar" ? "يرجى إدخال البريد الإلكتروني" : "Please enter your email address";
      setError(msg); toast.error(msg); return;
    }
    if (!isValidEmail(email.trim())) {
      const msg = lang === "ar" ? "صيغة البريد الإلكتروني غير صحيحة" : "Invalid email format";
      setError(msg); toast.error(msg); return;
    }
    submitForgotPassword();
  };

  const submitForgotPassword = () => {
    setStep("sending");
    forgotMutation.mutate({ email: email.trim().toLowerCase() });
  };

  const handleResend = () => {
    setError("");
    submitForgotPassword();
  };

  const handleCodeReset = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (resetCode.trim().length !== 6 || !/^\d{6}$/.test(resetCode.trim())) {
      const msg = lang === "ar" ? "الرمز يجب أن يكون 6 أرقام" : "The code must be 6 digits";
      setError(msg); toast.error(msg); return;
    }
    if (newPassword.length < 8) {
      const msg = lang === "ar" ? "كلمة المرور يجب أن تكون 8 أحرف على الأقل" : "Password must be at least 8 characters";
      setError(msg); toast.error(msg); return;
    }
    if (!hasPasswordStrengthChars(newPassword)) {
      const msg = lang === "ar" ? "كلمة المرور يجب أن تحتوي على حرف كبير وحرف صغير ورقم" : "Password must contain an uppercase letter, a lowercase letter, and a number";
      setError(msg); toast.error(msg); return;
    }
    if (newPassword !== confirmPassword) {
      const msg = lang === "ar" ? "كلمتا المرور غير متطابقتين" : "Passwords do not match";
      setError(msg); toast.error(msg); return;
    }
    resetMutation.mutate({ email: email.trim().toLowerCase(), code: resetCode.trim(), newPassword });
  };

  const sendResetLinkLabel = lang === "ar" ? "إرسال رابط إعادة التعيين" : "Send Reset Link";
  const resendLinkLabel = lang === "ar" ? "إعادة إرسال الرابط" : "Resend Link";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {(step === "enterEmail" || step === "sending") && (
          <>
            <Link to="/login" className="mb-6 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-accent-secondary">
              <ArrowLeft className="h-3.5 w-3.5" />
              {lang === "ar" ? "العودة لتسجيل الدخول" : "Back to login"}
            </Link>

            <div className="mb-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-secondary/10">
                <KeyRound className="h-8 w-8 text-accent-secondary" />
              </div>
              <h1 className="mt-5 text-2xl font-bold text-foreground">
                {lang === "ar" ? "نسيت كلمة المرور؟" : "Forgot your password?"}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                {lang === "ar"
                  ? "لا تقلق! أدخل بريدك الإلكتروني وسنرسل لك رابط لإعادة تعيين كلمة المرور."
                  : "No worries! Enter your email address and we'll send you a link to reset your password."}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-xl border border-border bg-primary p-6">
                {error && (
                  <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="forgot-email" className="text-sm text-text-muted">
                      {lang === "ar" ? "البريد الإلكتروني" : "Email Address"}
                    </Label>
                    <div className="relative mt-1">
                      <Input
                        id="forgot-email"
                        name="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="example@email.com"
                        className="border-border bg-background pl-10 text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary"
                        autoComplete="email"
                        disabled={step === "sending"}
                        required
                      />
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                    </div>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="glow-btn mt-6 w-full bg-gradient-to-r from-accent-secondary to-accent-secondary/80 font-semibold text-background"
                  disabled={forgotMutation.isPending || step === "sending"}
                >
                  {forgotMutation.isPending || step === "sending" ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {lang === "ar" ? "جاري الإرسال..." : "Sending..."}
                    </span>
                  ) : (
                    sendResetLinkLabel
                  )}
                </Button>
              </div>
            </form>

            <div className="mt-6 rounded-lg border border-dashed border-border bg-primary p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-secondary" />
                <p className="text-xs leading-relaxed text-text-muted">
                  {lang === "ar"
                    ? "لأسباب أمنية، لن نخبرك ما إذا كان البريد الإلكتروني مسجلاً أم لا. ستصلك رسالة فقط إذا كان الحساب موجوداً."
                    : "For security reasons, we won't tell you if the email is registered or not. You'll only receive a message if an account exists."}
                </p>
              </div>
            </div>
          </>
        )}

        {step === "sent" && (
          <>
            <Link to="/login" className="mb-6 inline-flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-accent-secondary">
              <ArrowLeft className="h-3.5 w-3.5" />
              {lang === "ar" ? "العودة لتسجيل الدخول" : "Back to login"}
            </Link>

            <div className="space-y-6">
              <div className="text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/10">
                  <Inbox className="h-10 w-10 text-emerald-500" />
                </div>
                <h1 className="mt-5 text-2xl font-bold text-foreground">
                  {lang === "ar" ? "تم إرسال الرابط بنجاح!" : "Check your email!"}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">
                  {lang === "ar"
                    ? `إذا كان هناك حساب مرتبط بـ `
                    : `If an account exists for `}
                  <span className="font-medium text-foreground">{email}</span>
                  {lang === "ar"
                    ? " فستصلك رسالة تحتوي على رابط إعادة تعيين كلمة المرور."
                    : ", you'll receive an email with a password reset link."}
                </p>
              </div>

              <div className="rounded-xl border border-border bg-primary p-5">
                {deliveryWarning && (
                  <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                    <p className="text-sm font-medium text-amber-500">
                      {lang === "ar" ? "⚠️ ملاحظة حول البريد الإلكتروني" : "⚠️ Email delivery notice"}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-text-muted">{deliveryWarning}</p>
                  </div>
                )}

                <div className="space-y-3">
                  {[
                    { num: "1", ar: "افتح صندوق الوارد الخاص ببريدك الإلكتروني", en: "Open your email inbox" },
                    { num: "2", ar: "ابحث عن رسالة من منصة أحمد الباز", en: 'Look for an email from "Ahmed Elbaz Platform"' },
                    { num: "3", ar: "اضغط على زر إعادة التعيين في الرسالة", en: 'Click the "Reset Password" button in the email' },
                  ].map((item) => (
                    <div key={item.num} className="flex items-start gap-3">
                      <div className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-secondary/15">
                        <span className="text-xs font-bold text-accent-secondary">{item.num}</span>
                      </div>
                      <p className="text-sm text-text-muted">{lang === "ar" ? item.ar : item.en}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-500/8 p-3">
                  <div className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                  <p className="text-xs text-amber-500">
                    {lang === "ar"
                      ? "الرمز والرابط ينتهيان خلال 15 دقيقة. تحقق من مجلد الرسائل غير المرغوب فيها إذا لم تجد الرسالة."
                      : "The code and link expire in 15 minutes. Check your spam folder if you don't see the email."}
                  </p>
                </div>
              </div>

              {deliveryWarning && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <p className="text-sm font-medium text-amber-500">
                    {lang === "ar" ? "ملاحظة حول البريد الإلكتروني" : "Email delivery notice"}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-text-muted">{deliveryWarning}</p>
                </div>
              )}

              {/* ── Code entry: set the new password directly with the 6-digit code ── */}
              <form onSubmit={handleCodeReset} className="rounded-xl border border-border bg-primary p-5">
                <h2 className="mb-1 text-base font-semibold text-foreground">
                  {lang === "ar" ? "عندك الرمز؟ عيّن كلمة المرور مباشرة" : "Have the code? Set your new password"}
                </h2>
                <p className="mb-4 text-xs leading-relaxed text-text-muted">
                  {lang === "ar"
                    ? "أدخل الرمز المكوّن من 6 أرقام الموجود في رسالة البريد مع كلمة المرور الجديدة."
                    : "Enter the 6-digit code from the email along with your new password."}
                </p>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="reset-code" className="text-sm text-text-muted">
                      {lang === "ar" ? "رمز التأكيد (6 أرقام)" : "Confirmation code (6 digits)"}
                    </Label>
                    <Input
                      id="reset-code"
                      name="code"
                      inputMode="numeric"
                      maxLength={6}
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="123456"
                      dir="ltr"
                      className="mt-1 border-border bg-background text-center text-lg tracking-[0.4em] text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary"
                      autoComplete="one-time-code"
                      disabled={resetMutation.isPending}
                    />
                  </div>
                  <div>
                    <Label htmlFor="fp-new-password" className="text-sm text-text-muted">
                      {lang === "ar" ? "كلمة المرور الجديدة" : "New password"}
                    </Label>
                    <Input
                      id="fp-new-password"
                      name="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="mt-1 border-border bg-background text-foreground focus:border-accent-secondary focus:ring-accent-secondary"
                      autoComplete="new-password"
                      disabled={resetMutation.isPending}
                    />
                  </div>
                  <div>
                    <Label htmlFor="fp-confirm-password" className="text-sm text-text-muted">
                      {lang === "ar" ? "تأكيد كلمة المرور" : "Confirm new password"}
                    </Label>
                    <Input
                      id="fp-confirm-password"
                      name="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="mt-1 border-border bg-background text-foreground focus:border-accent-secondary focus:ring-accent-secondary"
                      autoComplete="new-password"
                      disabled={resetMutation.isPending}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="glow-btn w-full bg-gradient-to-r from-accent-secondary to-accent-secondary/80 font-semibold text-background"
                    disabled={resetMutation.isPending}
                  >
                    {resetMutation.isPending ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {lang === "ar" ? "جاري التعيين..." : "Setting..."}
                      </span>
                    ) : (
                      (lang === "ar" ? "تأكيد الرمز وتعيين كلمة المرور" : "Confirm code & set password")
                    )}
                  </Button>
                </div>
              </form>

              <div className="flex flex-col gap-3">
                <Button
                  onClick={handleResend}
                  disabled={forgotMutation.isPending}
                  variant="outline"
                  className="w-full border-border bg-primary text-text-muted hover:border-accent-secondary hover:text-accent-secondary"
                >
                  {forgotMutation.isPending ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {lang === "ar" ? "جاري الإعادة..." : "Resending..."}
                    </span>
                  ) : resendLinkLabel}
                </Button>
                <Link to="/login" className="flex items-center justify-center gap-2 text-sm text-accent-secondary transition-colors hover:text-accent">
                  {lang === "ar" ? "العودة لتسجيل الدخول" : "Back to login"}
                </Link>
              </div>
            </div>
          </>
        )}

        {step === "resetDone" && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-emerald-500/10">
                <ShieldCheck className="h-10 w-10 text-emerald-500" />
              </div>
              <h1 className="mt-5 text-2xl font-bold text-foreground">
                {lang === "ar" ? "تم تغيير كلمة المرور بنجاح!" : "Password updated!"}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                {lang === "ar"
                  ? "تم تعيين كلمة المرور الجديدة بنجاح. سجّل الدخول الآن بكلمة المرور الجديدة."
                  : "Your new password has been set. Sign in with it now."}
              </p>
            </div>
            <Button
              onClick={() => navigate("/login")}
              className="glow-btn w-full bg-gradient-to-r from-accent-secondary to-accent-secondary/80 font-semibold text-background"
            >
              {lang === "ar" ? "تسجيل الدخول الآن" : "Sign In Now"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
