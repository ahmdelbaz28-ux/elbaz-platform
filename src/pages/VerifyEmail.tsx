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

type VerifyState = "idle" | "loading" | "success" | "error" | "expired" | "already";

export default function VerifyEmail() {
  const { t, lang } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get("token");
  const uid = searchParams.get("uid");

  const [state, setState] = useState<VerifyState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const verifyMutation = trpc.auth.verifyEmail.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setState("success");
        toast.success(
          lang === "ar"
            ? "تم تأكيد بريدك الإلكتروني بنجاح!"
            : "Your email has been verified successfully!"
        );
      }
    },
    onError: (err) => {
      const msg = err.message?.toLowerCase() || "";

      if (msg.includes("already verified") || msg.includes("التحقق")) {
        setState("already");
        setErrorMessage(
          lang === "ar"
            ? "بريدك الإلكتروني مؤكد بالفعل. لا حاجة لإعادة التحقق."
            : "Your email is already verified. No need to verify again."
        );
      } else if (msg.includes("expired") || msg.includes("منتهي")) {
        setState("expired");
        setErrorMessage(
          lang === "ar"
            ? "رابط التحقق منتهي الصلاحية. يرجى طلب رابط جديد من صفحة الملف الشخصي."
            : "This verification link has expired. Please request a new one from your profile."
        );
      } else if (msg.includes("invalid") || msg.includes("token") || msg.includes("غير صالح")) {
        setState("error");
        setErrorMessage(
          lang === "ar"
            ? "رابط التحقق غير صالح. يرجى التأكد من أنك نسخت الرابط كاملاً من البريد الإلكتروني."
            : "Invalid verification link. Please make sure you copied the full link from the email."
        );
      } else {
        setState("error");
        setErrorMessage(err.message);
      }
    },
  });

  useEffect(() => {
    if (!token || !uid) {
      setState("error");
      setErrorMessage(
        lang === "ar"
          ? "رابط التحقق غير مكتمل. يرجى التأكد من نسخ الرابط كاملاً من البريد الإلكتروني."
          : "Incomplete verification link. Please make sure you copied the full link from the email."
      );
      return;
    }

    // Auto-trigger verification on mount
    setState("loading");
    verifyMutation.mutate({
      userId: parseInt(uid, 10),
      token,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0e17] px-4">
      <div className="w-full max-w-md text-center">
        {/* ── Loading State ── */}
        {state === "loading" && (
          <div className="space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[rgba(6,182,212,0.1)]">
              <Loader2 className="h-10 w-10 animate-spin text-[#06b6d4]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#f0f4f8]">
                {lang === "ar" ? "جاري التحقق من بريدك الإلكتروني..." : "Verifying your email..."}
              </h1>
              <p className="mt-2 text-sm text-[#94a3b8]">
                {lang === "ar"
                  ? "يرجى الانتظار بينما نتأكد من صحة رابط التحقق"
                  : "Please wait while we verify your email"}
              </p>
            </div>
          </div>
        )}

        {/* ── Success State ── */}
        {state === "success" && (
          <div className="space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[rgba(16,185,129,0.1)]">
              <ShieldCheck className="h-10 w-10 text-[#10b981]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#f0f4f8]">
                {lang === "ar" ? "تم التحقق بنجاح!" : "Email Verified!"}
              </h1>
              <p className="mt-2 text-sm text-[#94a3b8]">
                {lang === "ar"
                  ? "تم تأكيد بريدك الإلكتروني بنجاح. حسابك الآن موثق ومؤمن بالكامل."
                  : "Your email has been verified successfully. Your account is now fully verified and secured."}
              </p>
            </div>

            {/* Verified badge */}
            <div className="mx-auto flex w-fit items-center gap-2 rounded-full bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)] px-4 py-2">
              <MailCheck className="h-4 w-4 text-[#10b981]" />
              <span className="text-sm font-medium text-[#10b981]">
                {lang === "ar" ? "البريد الإلكتروني موثق" : "Email Verified"}
              </span>
            </div>

            <Button
              onClick={() => navigate("/dashboard")}
              className="glow-btn w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] font-semibold text-[#0a0e17]"
            >
              {lang === "ar" ? "الذهاب للوحة التحكم" : "Go to Dashboard"}
            </Button>
          </div>
        )}

        {/* ── Already Verified State ── */}
        {state === "already" && (
          <div className="space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[rgba(16,185,129,0.1)]">
              <MailCheck className="h-10 w-10 text-[#10b981]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#f0f4f8]">
                {lang === "ar" ? "الحساب موثق بالفعل!" : "Already Verified!"}
              </h1>
              <p className="mt-2 text-sm text-[#94a3b8]">{errorMessage}</p>
            </div>
            <Button
              onClick={() => navigate("/dashboard")}
              className="glow-btn w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] font-semibold text-[#0a0e17]"
            >
              {lang === "ar" ? "الذهاب للوحة التحكم" : "Go to Dashboard"}
            </Button>
          </div>
        )}

        {/* ── Expired State ── */}
        {state === "expired" && (
          <div className="space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[rgba(245,158,11,0.1)]">
              <RefreshCw className="h-10 w-10 text-[#f59e0b]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#f0f4f8]">
                {lang === "ar" ? "رابط منتهي الصلاحية" : "Link Expired"}
              </h1>
              <p className="mt-2 text-sm text-[#94a3b8]">{errorMessage}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button
                onClick={() => navigate("/profile")}
                className="glow-btn w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] font-semibold text-[#0a0e17]"
              >
                {lang === "ar" ? "طلب رابط جديد" : "Request New Link"}
              </Button>
              <Link
                to="/"
                className="flex items-center justify-center gap-2 text-sm text-[#94a3b8] transition-colors hover:text-[#06b6d4]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {lang === "ar" ? "العودة للرئيسية" : "Back to Home"}
              </Link>
            </div>
          </div>
        )}

        {/* ── Error State ── */}
        {(state === "error" || state === "idle") && (
          <div className="space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-[rgba(244,63,94,0.1)]">
              <MailX className="h-10 w-10 text-[#f43f5e]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#f0f4f8]">
                {lang === "ar" ? "فشل التحقق" : "Verification Failed"}
              </h1>
              <p className="mt-2 text-sm text-[#94a3b8]">
                {errorMessage || (lang === "ar"
                  ? "حدث خطأ أثناء التحقق من بريدك الإلكتروني. يرجى المحاولة مرة أخرى."
                  : "An error occurred while verifying your email. Please try again.")}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <Button
                onClick={() => {
                  setState("loading");
                  setErrorMessage("");
                  if (token && uid) {
                    verifyMutation.mutate({
                      userId: parseInt(uid, 10),
                      token,
                    });
                  }
                }}
                disabled={verifyMutation.isPending}
                className="glow-btn w-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2] font-semibold text-[#0a0e17]"
              >
                {verifyMutation.isPending
                  ? (lang === "ar" ? "جاري إعادة المحاولة..." : "Retrying...")
                  : (lang === "ar" ? "إعادة المحاولة" : "Retry")}
              </Button>
              <Link
                to="/"
                className="flex items-center justify-center gap-2 text-sm text-[#94a3b8] transition-colors hover:text-[#06b6d4]"
              >
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
