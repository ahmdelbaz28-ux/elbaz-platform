import { useParams, useNavigate } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { useState } from "react";
import CertificateCard from "@/components/CertificateCard";
import {
  Printer,
  Download,
  Share2,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Award,
} from "lucide-react";
import { toast } from "sonner";

export default function CertificateView() {
  const { certificateNumber } = useParams<{ certificateNumber: string }>();
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const [showLinkedInShare, setShowLinkedInShare] = useState(false);

  const { data: cert, isLoading, isError } = trpc.certificate.verify.useQuery(
    { certificateNumber: certificateNumber || "" },
    { enabled: !!certificateNumber }
  );

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    // Use browser's print dialog as PDF download
    // The print-optimized CSS will handle the layout
    try {
      window.print();
    } catch {
      toast.error(lang === "ar" ? "فشل تحميل الشهادة" : "Failed to download certificate");
    }
  };

  const handleShareLinkedIn = () => {
    const certUrl = `https://ahmedelbaz.qzz.io/certificate/${certificateNumber}`;
    const shareText = cert
      ? `I've earned a certificate in "${cert.courseName}" from Elbaz Platform - Electrical Engineering Academy! 🎓`
      : lang === "ar"
        ? "لقد حصلت على شهادة من منصة الباز!"
        : "I've earned a certificate from Elbaz Platform!";

    const linkedInUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(certUrl)}&summary=${encodeURIComponent(shareText)}`;
    window.open(linkedInUrl, "_blank", "width=600,height=500");
    setShowLinkedInShare(false);
  };

  const handleCopyLink = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(lang === "ar" ? "تم نسخ الرابط" : "Link copied to clipboard");
    } catch {
      toast.error(lang === "ar" ? "فشل نسخ الرابط" : "Failed to copy link");
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e17] pt-24">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-[#06b6d4]" />
          <p className="mt-4 text-[#94a3b8]">
            {lang === "ar" ? "جاري التحقق من الشهادة..." : "Verifying certificate..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e17] pt-24 pb-20">
      <div className="mx-auto max-w-7xl px-4 lg:px-6">
        {/* Breadcrumb */}
        <button
          onClick={() => navigate(-1)}
          className="mb-6 flex items-center gap-1 text-sm text-[#94a3b8] transition-colors hover:text-[#06b6d4]"
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
          {lang === "ar" ? "رجوع" : "Back"}
        </button>

        {/* Action Buttons - hidden during print */}
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[rgba(6,182,212,0.1)]">
              <Award className="h-6 w-6 text-[#06b6d4]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#f0f4f8]">
                {lang === "ar" ? "شهادة الإتمام" : "Certificate of Completion"}
              </h1>
              <p className="text-sm text-[#94a3b8]">
                {cert
                  ? `${cert.studentName || cert.studentUsername} — ${cert.courseName}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 rounded-lg border border-[#1f2d44] bg-[#111827] px-4 py-2.5 text-sm font-medium text-[#f0f4f8] transition-colors hover:border-[#06b6d4] hover:text-[#06b6d4]"
            >
              <Printer className="h-4 w-4" />
              {t("print")}
            </button>
            <button
              onClick={handleDownloadPDF}
              className="flex items-center gap-2 rounded-lg border border-[#1f2d44] bg-[#111827] px-4 py-2.5 text-sm font-medium text-[#f0f4f8] transition-colors hover:border-[#06b6d4] hover:text-[#06b6d4]"
            >
              <Download className="h-4 w-4" />
              {t("download")} PDF
            </button>
            <div className="relative">
              <button
                onClick={() => setShowLinkedInShare(!showLinkedInShare)}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#06b6d4] to-[#0891b2] px-4 py-2.5 text-sm font-semibold text-[#0a0e17] transition-all hover:shadow-[0_4px_12px_rgba(6,182,212,0.3)]"
              >
                <Share2 className="h-4 w-4" />
                {t("share")}
              </button>

              {/* Share Dropdown */}
              {showLinkedInShare && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowLinkedInShare(false)} />
                  <div className="absolute end-0 top-full z-50 mt-2 w-56 rounded-xl border border-[#1f2d44] bg-[#111827] p-2 shadow-xl">
                    <button
                      onClick={handleShareLinkedIn}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#f0f4f8] transition-colors hover:bg-[rgba(6,182,212,0.1)]"
                    >
                      <Share2 className="h-4 w-4 text-[#0a66c2]" />
                      LinkedIn
                    </button>
                    <button
                      onClick={handleCopyLink}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[#f0f4f8] transition-colors hover:bg-[rgba(6,182,212,0.1)]"
                    >
                      <svg className="h-4 w-4 text-[#06b6d4]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      {lang === "ar" ? "نسخ الرابط" : "Copy Link"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Verification Status - hidden during print */}
        <div className="no-print mb-6">
          {cert && cert.verified ? (
            <div className="flex items-center gap-3 rounded-xl border border-[rgba(16,185,129,0.2)] bg-[rgba(16,185,129,0.05)] px-4 py-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-[#10b981]" />
              <div>
                <p className="text-sm font-medium text-[#10b981]">
                  {lang === "ar" ? "هذه الشهادة موثقة ومعتمدة" : "This certificate is verified and authentic"}
                </p>
                <p className="mt-0.5 text-xs text-[#94a3b8]">
                  {lang === "ar"
                    ? `رقم الشهادة: ${cert.certificateNumber}`
                    : `Certificate No: ${cert.certificateNumber}`}
                </p>
              </div>
            </div>
          ) : isError || !cert ? (
            <div className="flex items-center gap-3 rounded-xl border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.05)] px-4 py-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-[#ef4444]" />
              <div>
                <p className="text-sm font-medium text-[#ef4444]">
                  {lang === "ar" ? "الشهادة غير صالحة" : "Certificate Not Found"}
                </p>
                <p className="mt-0.5 text-xs text-[#94a3b8]">
                  {lang === "ar"
                    ? "لم يتم العثور على شهادة بهذا الرقم. تأكد من صحة الرقم."
                    : "No certificate found with this number. Please check and try again."}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Certificate */}
        {cert ? (
          <div className="overflow-x-auto rounded-xl border border-[#1f2d44] bg-[#0a0e17] p-4 md:p-8">
            <CertificateCard
              data={{
                studentName: cert.studentName || cert.studentUsername || "Student",
                courseName: cert.courseName || "Course",
                courseNameAr: cert.courseNameAr || "",
                certificateNumber: cert.certificateNumber,
                issuedAt: cert.issuedAt || new Date(),
                grade: cert.grade || "Pass",
                averageScore: cert.averageScore ?? undefined,
              }}
              lang={lang}
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1f2d44] bg-[#111827] py-20">
            <AlertCircle className="h-16 w-16 text-[#1f2d44]" />
            <h2 className="mt-4 text-xl font-bold text-[#f0f4f8]">
              {lang === "ar" ? "الشهادة غير موجودة" : "Certificate Not Found"}
            </h2>
            <p className="mt-2 text-sm text-[#94a3b8]">
              {lang === "ar"
                ? "لم يتم العثور على شهادة بهذا الرقم"
                : "No certificate found with this number"}
            </p>
            <button
              onClick={() => navigate("/verify")}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#06b6d4] to-[#0891b2] px-5 py-2.5 text-sm font-semibold text-[#0a0e17]"
            >
              {lang === "ar" ? "تحقق من شهادة" : "Verify a Certificate"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
