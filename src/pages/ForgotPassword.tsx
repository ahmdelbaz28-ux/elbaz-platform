import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { isValidEmail } from "@/lib/validation";
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
  const [recoveryLink, setRecoveryLink] = useState<string | null>(null);
  const [deliveryWarning, setDeliveryWarning] = useState<string | null>(null);

  const forgotMutation = trpc.auth.forgotPassword.useMutation({
    onSuccess: (data) => {
      trackPlatform("forgot_password_requested");
      setStep("sent");
      toast.success(data.message);
      if (data.deliveryWarning) setDeliveryWarning(data.deliveryWarning);
      if (data.recoveryLink) setRecoveryLink(data.recoveryLink);
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
                {recoveryLink && (
                  <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                    <p className="text-sm font-medium text-amber-500">
                      {lang === "ar" ? "⚠️ لم يتم إرسال البريد الإلكتروني" : "⚠️ Email could not be delivered"}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-text-muted">
                      {deliveryWarning || (lang === "ar"
                        ? "نظام البريد الإلكتروني غير مُهيأ بالكامل بعد. استخدم الرابط أدناه لإعادة تعيين كلمة المرور مباشرة:"
                        : "Email delivery is not fully set up yet. Use the link below to reset your password directly:")}
                    </p>
                    <a
                      href={recoveryLink}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent-secondary px-4 py-2.5 text-sm font-semibold text-background transition-all hover:bg-accent-secondary/80"
                    >
                      {lang === "ar" ? "إعادة تعيين كلمة المرور الآن" : "Reset Password Now"}
                    </a>
                    <p className="mt-2 text-xs text-text-muted">
                      {lang === "ar"
                        ? "الرابط صالح لمدة 15 دقيقة وللاستخدام مرة واحدة فقط"
                        : "Link expires in 15 minutes and is single-use only"}
                    </p>
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
                      ? "الرابط ينتهي خلال 15 دقيقة. تحقق من مجلد الرسائل غير المرغوب فيها إذا لم تجد الرسالة."
                      : "The link expires in 15 minutes. Check your spam folder if you don't see the email."}
                  </p>
                </div>
              </div>

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
      </div>
    </div>
  );
}
