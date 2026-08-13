import { useState, useEffect } from "react";
import { useSearchParams, Link, useNavigate } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";
import {
  MailCheck,
  MailX,
  Loader2,
  ArrowLeft,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { bilingualByLang } from "@/lib/i18n";

type VerifyState = "idle" | "loading" | "success" | "error" | "expired" | "already";

export default function VerifyEmail() {
  const { lang } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get("token");
  const uid = searchParams.get("uid");

  const incompleteLinkMessage = lang === "ar"
    ? "رابط التحقق غير مكتمل. يرجى التأكد من نسخ الرابط كاملاً من البريد الإلكتروني."
    : "Incomplete verification link. Please make sure you copied the full link from the email.";

  const [state, setState] = useState<VerifyState>(!token || uid ? "loading" : "error");
  const [errorMessage, setErrorMessage] = useState(!token || uid ? "" : incompleteLinkMessage);

  const verifyMutation = trpc.auth.verifyEmail.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setState("success");
        toast.success(lang === "ar" ? "تم تأكيد بريدك الإلكتروني بنجاح!" : "Your email has been verified successfully!");
      }
    },
    onError: (err) => {
      const msg = err.message?.toLowerCase() || "";
      if (msg.includes("already verified") || msg.includes("التحقق")) {
        setState("already");
        setErrorMessage(lang === "ar" ? "بريدك الإلكتروني مؤكد بالفعل. لا حاجة لإعادة التحقق." : "Your email is already verified. No need to verify again.");
      } else if (msg.includes("expired") || msg.includes("منتهي")) {
        setState("expired");
        setErrorMessage(lang === "ar" ? "رابط التحقق منتهي الصلاحية. يرجى طلب رابط جديد من صفحة الملف الشخصي." : "This verification link has expired. Please request a new one from your profile.");
      } else if (msg.includes("invalid") || msg.includes("token") || msg.includes("غير صالح")) {
        setState("error");
        setErrorMessage(lang === "ar" ? "رابط التحقق غير صالح. يرجى التأكد من أنك نسخت الرابط كاملاً من البريد الإلكتروني." : "Invalid verification link. Please make sure you copied the full link from the email.");
      } else {
        setState("error");
        setErrorMessage(err.message);
      }
    },
  });

  useEffect(() => {
    if (!token || !uid) return;
    verifyMutation.mutate({ userId: Number.parseInt(uid, 10), token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyMutation.mutate, uid, token]);

  const iconWrapper = (children: React.ReactNode, bg: string, text: string) => (
    <div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-2xl ${bg}`}>
      <div className={text}>{children}</div>
    </div>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        {state === "loading" && (
          <div className="space-y-6">
            {iconWrapper(<Loader2 className="h-10 w-10 animate-spin text-accent-secondary" />, "bg-accent-secondary/10", "text-accent-secondary")}
            <div>
              <h1 className="text-2xl font-bold text-foreground">{lang === "ar" ? "جاري التحقق من بريدك الإلكتروني..." : "Verifying your email..."}</h1>
              <p className="mt-2 text-sm text-text-muted">{lang === "ar" ? "يرجى الانتظار بينما نتأكد من صحة رابط التحقق" : "Please wait while we verify your email"}</p>
            </div>
          </div>
        )}

        {state === "success" && (
          <div className="space-y-6">
            {iconWrapper(<ShieldCheck className="h-10 w-10 text-emerald-500" />, "bg-emerald-500/10", "text-emerald-500")}
            <div>
              <h1 className="text-2xl font-bold text-foreground">{lang === "ar" ? "تم التحقق بنجاح!" : "Email Verified!"}</h1>
              <p className="mt-2 text-sm text-text-muted">{lang === "ar" ? "تم تأكيد بريدك الإلكتروني بنجاح. حسابك الآن موثق ومؤمن بالكامل." : "Your email has been verified successfully. Your account is now fully verified and secured."}</p>
            </div>

            <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-4 py-2">
              <MailCheck className="h-4 w-4 text-emerald-500" />
              <span className="text-sm font-medium text-emerald-500">{lang === "ar" ? "البريد الإلكتروني موثق" : "Email Verified"}</span>
            </div>

            <Button onClick={() => navigate("/dashboard")} className="glow-btn w-full bg-gradient-to-r from-accent-secondary to-accent-secondary/80 font-semibold text-background">
              {lang === "ar" ? "الذهاب للوحة التحكم" : "Go to Dashboard"}
            </Button>
          </div>
        )}

        {state === "already" && (
          <div className="space-y-6">
            {iconWrapper(<MailCheck className="h-10 w-10 text-emerald-500" />, "bg-emerald-500/10", "text-emerald-500")}
            <div>
              <h1 className="text-2xl font-bold text-foreground">{lang === "ar" ? "الحساب موثق بالفعل!" : "Already Verified!"}</h1>
              <p className="mt-2 text-sm text-text-muted">{errorMessage}</p>
            </div>
            <Button onClick={() => navigate("/dashboard")} className="glow-btn w-full bg-gradient-to-r from-accent-secondary to-accent-secondary/80 font-semibold text-background">
              {lang === "ar" ? "الذهاب للوحة التحكم" : "Go to Dashboard"}
            </Button>
          </div>
        )}

        {state === "expired" && (
          <div className="space-y-6">
            {iconWrapper(<RefreshCw className="h-10 w-10 text-amber-500" />, "bg-amber-500/10", "text-amber-500")}
            <div>
              <h1 className="text-2xl font-bold text-foreground">{lang === "ar" ? "رابط منتهي الصلاحية" : "Link Expired"}</h1>
              <p className="mt-2 text-sm text-text-muted">{errorMessage}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button onClick={() => navigate("/profile")} className="glow-btn w-full bg-gradient-to-r from-accent-secondary to-accent-secondary/80 font-semibold text-background">
                {lang === "ar" ? "طلب رابط جديد" : "Request New Link"}
              </Button>
              <Link to="/" className="flex items-center justify-center gap-2 text-sm text-text-muted transition-colors hover:text-accent-secondary">
                <ArrowLeft className="h-3.5 w-3.5" />
                {lang === "ar" ? "العودة للرئيسية" : "Back to Home"}
              </Link>
            </div>
          </div>
        )}

        {(state === "error" || state === "idle") && (
          <div className="space-y-6">
            {iconWrapper(<MailX className="h-10 w-10 text-destructive" />, "bg-destructive/10", "text-destructive")}
            <div>
              <h1 className="text-2xl font-bold text-foreground">{lang === "ar" ? "فشل التحقق" : "Verification Failed"}</h1>
              <p className="mt-2 text-sm text-text-muted">{errorMessage || (lang === "ar" ? "حدث خطأ أثناء التحقق من بريدك الإلكتروني. يرجى المحاولة مرة أخرى." : "An error occurred while verifying your email. Please try again.")}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button onClick={() => { setState("loading"); setErrorMessage(""); if (token && uid) verifyMutation.mutate({ userId: Number.parseInt(uid, 10), token }); }} disabled={verifyMutation.isPending} className="glow-btn w-full bg-gradient-to-r from-accent-secondary to-accent-secondary/80 font-semibold text-background">
                {verifyMutation.isPending ? bilingualByLang("جاري إعادة المحاولة...", "Retrying...", lang) : bilingualByLang("إعادة المحاولة", "Retry", lang)}
              </Button>
              <Link to="/" className="flex items-center justify-center gap-2 text-sm text-text-muted transition-colors hover:text-accent-secondary">
                <ArrowLeft className="h-3.5 w-3.5" />
                {lang === "ar" ? "العودة للرئيسية" : "Back to Home"}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
