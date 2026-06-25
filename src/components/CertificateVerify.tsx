import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import {
  Search,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Shield,
  Award,
  FileCheck,
} from "lucide-react";

export default function CertificateVerify() {
  const { t, lang } = useTranslation();
  const navigate = useNavigate();
  const [certNumber, setCertNumber] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: cert, isLoading } = trpc.certificate.verify.useQuery(
    { certificateNumber: searchQuery },
    { enabled: !!searchQuery }
  );

  const hasSearched = searchQuery.length > 0;
  const isValid = hasSearched && cert && cert.verified;

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (certNumber.trim()) {
      setSearchQuery(certNumber.trim());
    }
  };

  const handleViewCertificate = () => {
    if (cert?.certificateNumber) {
      navigate(`/certificate/${cert.certificateNumber}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e17] pt-24 pb-20">
      <div className="mx-auto max-w-3xl px-4 lg:px-6">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(6,182,212,0.1)]">
            <Shield className="h-8 w-8 text-[#06b6d4]" />
          </div>
          <h1 className="text-3xl font-bold text-[#f0f4f8]">
            {lang === "ar" ? "التحقق من الشهادة" : "Verify Certificate"}
          </h1>
          <p className="mt-2 text-[#94a3b8]">
            {lang === "ar"
              ? "أدخل رقم الشهادة للتحقق من صحتها ومعتمديتها"
              : "Enter a certificate number to verify its authenticity"}
          </p>
        </div>

        {/* Search Form */}
        <form
          onSubmit={handleVerify}
          className="mb-8 flex gap-3"
        >
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748b]" />
            <input
              type="text"
              value={certNumber}
              onChange={(e) => setCertNumber(e.target.value)}
              placeholder={
                lang === "ar"
                  ? "مثال: EE-CERT-1746950400000-A1B2C3D4"
                  : "e.g. EE-CERT-1746950400000-A1B2C3D4"
              }
              className="w-full rounded-xl border border-[#1f2d44] bg-[#111827] py-3 pe-4 ps-11 text-sm text-[#f0f4f8] placeholder-[#64748b] outline-none transition-colors focus:border-[#06b6d4] focus:ring-1 focus:ring-[#06b6d4]"
              dir="ltr"
            />
          </div>
          <button
            type="submit"
            disabled={!certNumber.trim() || isLoading}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#06b6d4] to-[#0891b2] px-6 py-3 text-sm font-semibold text-[#0a0e17] transition-all hover:shadow-[0_4px_12px_rgba(6,182,212,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileCheck className="h-4 w-4" />
            )}
            {t("verify")}
          </button>
        </form>

        {/* Results */}
        {hasSearched && !isLoading && (
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827]">
            {isValid ? (
              <>
                {/* Valid Certificate */}
                <div className="border-b border-[#1f2d44] p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(16,185,129,0.1)]">
                      <CheckCircle2 className="h-5 w-5 text-[#10b981]" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-[#10b981]">
                        {lang === "ar" ? "شهادة صالحة" : "Valid Certificate"}
                      </h2>
                      <p className="text-sm text-[#94a3b8]">
                        {lang === "ar"
                          ? "تم التحقق بنجاح من هذه الشهادة"
                          : "This certificate has been successfully verified"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Certificate Details */}
                <div className="p-6">
                  <div className="mb-6 grid gap-4 sm:grid-cols-2">
                    <div>
                      <span className="text-xs font-medium uppercase tracking-wider text-[#94a3b8]">
                        {lang === "ar" ? "اسم الطالب" : "Student Name"}
                      </span>
                      <p className="mt-1 text-sm font-medium text-[#f0f4f8]">
                        {cert.studentName || cert.studentUsername}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium uppercase tracking-wider text-[#94a3b8]">
                        {lang === "ar" ? "اسم الكورس" : "Course Name"}
                      </span>
                      <p className="mt-1 text-sm font-medium text-[#f0f4f8]">
                        {cert.courseName}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium uppercase tracking-wider text-[#94a3b8]">
                        {lang === "ar" ? "الدرجة" : "Grade"}
                      </span>
                      <p className="mt-1 text-sm font-medium text-[#f0f4f8]">
                        <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-bold ${
                          cert.grade?.toLowerCase() === "distinction"
                            ? "bg-[rgba(245,158,11,0.15)] text-[#f59e0b]"
                            : cert.grade?.toLowerCase() === "merit"
                            ? "bg-[rgba(99,102,241,0.15)] text-[#6366f1]"
                            : "bg-[rgba(16,185,129,0.15)] text-[#10b981]"
                        }`}>
                          <Award className="h-3 w-3" />
                          {cert.grade}
                        </span>
                      </p>
                    </div>
                    <div>
                      <span className="text-xs font-medium uppercase tracking-wider text-[#94a3b8]">
                        {t("issuedDate")}
                      </span>
                      <p className="mt-1 text-sm font-medium text-[#f0f4f8]">
                        {cert.issuedAt
                          ? new Date(cert.issuedAt).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                            })
                          : "—"}
                      </p>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-[#94a3b8]">
                        {t("certificateNumber")}
                      </span>
                      <p className="mt-1 font-mono text-sm text-[#f0f4f8]" dir="ltr">
                        {cert.certificateNumber}
                      </p>
                    </div>
                  </div>

                  {/* View Full Certificate Button */}
                  <button
                    onClick={handleViewCertificate}
                    className="w-full rounded-xl bg-gradient-to-r from-[#06b6d4] to-[#0891b2] py-3 text-sm font-semibold text-[#0a0e17] transition-all hover:shadow-[0_4px_12px_rgba(6,182,212,0.3)]"
                  >
                    {lang === "ar" ? "عرض الشهادة الكاملة" : "View Full Certificate"}
                  </button>
                </div>
              </>
            ) : (
              /* Invalid Certificate */
              <div className="flex flex-col items-center py-12 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(239,68,68,0.1)]">
                  <AlertCircle className="h-8 w-8 text-[#ef4444]" />
                </div>
                <h2 className="text-lg font-semibold text-[#f0f4f8]">
                  {lang === "ar" ? "شهادة غير صالحة" : "Invalid Certificate"}
                </h2>
                <p className="mt-2 max-w-sm text-sm text-[#94a3b8]">
                  {lang === "ar"
                    ? "لم يتم العثور على شهادة بهذا الرقم. تأكد من صحة الرقم وحاول مرة أخرى."
                    : "No certificate was found with this number. Please double-check and try again."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#06b6d4]" />
              <p className="mt-3 text-sm text-[#94a3b8]">
                {lang === "ar" ? "جاري التحقق..." : "Verifying..."}
              </p>
            </div>
          </div>
        )}

        {/* Info Section */}
        {!hasSearched && (
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {[
              {
                icon: <Shield className="h-6 w-6" />,
                title: lang === "ar" ? "تحقق فوري" : "Instant Verification",
                desc: lang === "ar"
                  ? "تحقق من أي شهادة في ثوانٍ معدودة"
                  : "Verify any certificate in seconds",
              },
              {
                icon: <Award className="h-6 w-6" />,
                title: lang === "ar" ? "بيانات موثقة" : "Authenticated Data",
                desc: lang === "ar"
                  ? "جميع البيانات مسجلة في نظامنا"
                  : "All data is recorded in our system",
              },
              {
                icon: <FileCheck className="h-6 w-6" />,
                title: lang === "ar" ? "رمز QR مدمج" : "Built-in QR Code",
                desc: lang === "ar"
                  ? "كل شهادة تحتوي على رمز QR قابل للمسح"
                  : "Each certificate has a scannable QR code",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6 text-center"
              >
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)] text-[#06b6d4]">
                  {item.icon}
                </div>
                <h3 className="text-sm font-semibold text-[#f0f4f8]">{item.title}</h3>
                <p className="mt-1 text-xs text-[#94a3b8]">{item.desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
