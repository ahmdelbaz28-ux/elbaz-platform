import { useEffect } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { Progress } from "@/components/ui/progress";
import {
  GraduationCap,
  Award,
  Clock,
  TrendingUp,
  Zap,
  BookOpen,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

export default function Dashboard() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { t, lang } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login");
    }
  }, [isLoading, isAuthenticated, navigate]);

  const { data: myCertificates } = trpc.certificate.myCertificates.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const { data: payments } = trpc.payment.history.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // ✅ Watch Time Tracking — Total learning time
  const { data: watchTime } = trpc.course.myWatchTime.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // ✅ CRITICAL FIX: Fetch real enrollment data instead of fake numbers
  const { data: myEnrollments } = trpc.course.enrollments.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  // ✅ Calculate real statistics from actual data
  const enrolledCoursesCount = myEnrollments?.length || 0;
  const certificatesCount = myCertificates?.length || 0;
  const totalSpent = Array.isArray(payments) ? payments.reduce((sum, p) => sum + (parseFloat(String(p.amount)) || 0), 0) : 0;

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e17]">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1f2d44] border-t-[#06b6d4]" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-[#0a0e17] pt-24">
      <div className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#f0f4f8]">
            {t("myDashboard")}
          </h1>
          <p className="mt-1 text-sm text-[#94a3b8]">
            {lang === "en" ? "Welcome back," : "مرحباً بعودتك،"} {user?.name || user?.username}
          </p>
        </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: <GraduationCap className="h-5 w-5" />, label: lang === "en" ? "Enrolled Courses" : "الكورسات المسجل بها", value: enrolledCoursesCount },
            { icon: <Clock className="h-5 w-5" />, label: lang === "en" ? "Total Watch Time" : "إجمالي وقت المشاهدة", value: watchTime?.formatted || "0m" },
            { icon: <Award className="h-5 w-5" />, label: t("myCertificates"), value: certificatesCount },
            { icon: <TrendingUp className="h-5 w-5" />, label: lang === "en" ? "Total Spent" : "إجمالي المدفوع", value: `${totalSpent.toLocaleString()} ${lang === "ar" ? "ج.م" : "EGP"}` },
          ].map((stat, i) => (
            <div key={i} className="rounded-xl border border-[#1f2d44] bg-[#111827] p-5">
              <div className="flex items-center gap-2 text-[#06b6d4]">{stat.icon}</div>
              <p className="mt-2 text-2xl font-bold text-[#f0f4f8]">{stat.value}</p>
              <p className="mt-1 text-xs text-[#94a3b8]">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* ─── My Courses with Progress ─── */}
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#f0f4f8]">{t("myCourses")}</h2>
            <BookOpen className="h-5 w-5 text-[#06b6d4]" />
          </div>

          {myEnrollments && myEnrollments.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myEnrollments.map((enrollment) => {
                const progress = enrollment.progress || 0;
                const isComplete = progress >= 100;
                const courseSlug = enrollment.course?.slug || enrollment.courseId;
                const courseTitle = enrollment.course
                  ? (lang === "ar" ? enrollment.course.titleAr : enrollment.course.titleEn)
                  : (lang === "en" ? "Unknown Course" : "كورس غير معروف");

                return (
                  <Link
                    key={enrollment.id}
                    to={`/courses/${courseSlug}`}
                    className="group rounded-xl border border-[#1f2d44] bg-[#111827] p-5 transition-all hover:border-[rgba(6,182,212,0.35)] hover:shadow-[0_8px_24px_rgba(6,182,212,0.06)]"
                  >
                    {/* Title + Status */}
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <h3 className="line-clamp-2 text-sm font-semibold text-[#f0f4f8] group-hover:text-[#06b6d4] transition-colors">
                        {courseTitle}
                      </h3>
                      {isComplete ? (
                        <span className="shrink-0 flex items-center gap-1 rounded-full bg-[rgba(16,185,129,0.1)] px-2 py-0.5 text-[10px] font-medium text-[#10b981]">
                          <CheckCircle2 className="h-3 w-3" />
                          {t("completed")}
                        </span>
                      ) : (
                        <span className="shrink-0 flex items-center gap-1 rounded-full bg-[rgba(6,182,212,0.1)] px-2 py-0.5 text-[10px] font-medium text-[#06b6d4]">
                          {t("inProgress")}
                        </span>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div className="mb-2">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-[#94a3b8]">{t("progress")}</span>
                        <span className={`font-medium ${isComplete ? "text-[#10b981]" : "text-[#06b6d4]"}`}>
                          {Math.min(progress, 100)}%
                        </span>
                      </div>
                      <Progress
                        value={Math.min(progress, 100)}
                        className="h-2 bg-[#1f2d44]"
                      />
                    </div>

                    {/* Last accessed + Continue */}
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[10px] text-[#64748b]">
                        {enrollment.createdAt
                          ? `${t("lastAccessed")}: ${new Date(enrollment.createdAt).toLocaleDateString()}`
                          : ""
                        }
                      </span>
                      <span className="flex items-center gap-1 text-xs font-medium text-[#06b6d4] opacity-0 transition-opacity group-hover:opacity-100">
                        {t("continueCourse")}
                        <ArrowRight className="h-3 w-3" />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1f2d44] bg-[#111827] py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(6,182,212,0.08)]">
                <BookOpen className="h-8 w-8 text-[#1f2d44]" />
              </div>
              <p className="mt-4 text-base font-medium text-[#94a3b8]">
                {t("noEnrolledCourses")}
              </p>
              <p className="mt-1 text-sm text-[#64748b]">
                {t("noEnrolledCoursesDesc")}
              </p>
              <Link
                to="/courses"
                className="glow-btn mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#06b6d4] to-[#0891b2] px-5 py-2.5 text-sm font-semibold text-[#0a0e17]"
              >
                <GraduationCap className="h-4 w-4" />
                {t("exploreCourses")}
              </Link>
            </div>
          )}
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* Certificates */}
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#f0f4f8]">{t("myCertificates")}</h2>
              <Award className="h-5 w-5 text-[#06b6d4]" />
            </div>
            {myCertificates && myCertificates.length > 0 ? (
              <div className="space-y-3">
                {myCertificates.map((cert) => (
                  <div key={cert.id} className="flex items-center gap-3 rounded-lg bg-[#0a0e17] p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)]">
                      <Award className="h-5 w-5 text-[#06b6d4]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-[#f0f4f8]">{cert.courseName}</p>
                      <p className="text-xs text-[#64748b]">{cert.certificateNumber}</p>
                    </div>
                    <span className="rounded bg-[rgba(16,185,129,0.1)] px-2 py-0.5 text-xs text-[#10b981]">
                      {t("verified")}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <Award className="mx-auto h-10 w-10 text-[#1f2d44]" />
                <p className="mt-3 text-sm text-[#94a3b8]">{t("noCertificates")}</p>
                <p className="mt-1 text-xs text-[#64748b]">{t("completeCourse")}</p>
              </div>
            )}
          </div>

          {/* Recent Payments */}
          <div className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#f0f4f8]">
                {lang === "en" ? "Recent Enrollments" : "التسجيلات الأخيرة"}
              </h2>
              <Zap className="h-5 w-5 text-[#06b6d4]" />
            </div>
            {payments && payments.length > 0 ? (
              <div className="space-y-3">
                {payments.slice(0, 5).map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-[#0a0e17] p-3">
                    <div>
                      <p className="text-sm font-medium text-[#f0f4f8]">
                        {lang === "en" ? "Course Purchase" : "شراء كورس"}
                      </p>
                      <p className="text-xs text-[#64748b]">
                        {p.paymentMethod} — {new Date(p.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-[#06b6d4]">
                      {p.amount} {p.currency}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center">
                <GraduationCap className="mx-auto h-10 w-10 text-[#1f2d44]" />
                <p className="mt-3 text-sm text-[#94a3b8]">
                  {lang === "en" ? "No enrollments yet" : "لا توجد تسجيلات بعد"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Quick Links */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <Link
            to="/courses"
            className="flex items-center gap-3 rounded-xl border border-[#1f2d44] bg-[#111827] p-5 transition-colors hover:border-[#06b6d4]"
          >
            <GraduationCap className="h-6 w-6 text-[#06b6d4]" />
            <div>
              <p className="font-medium text-[#f0f4f8]">{t("exploreCourses")}</p>
              <p className="text-xs text-[#94a3b8]">{lang === "en" ? "Browse the catalog" : "تصفح القائمة"}</p>
            </div>
          </Link>
          <Link
            to="/support"
            className="flex items-center gap-3 rounded-xl border border-[#1f2d44] bg-[#111827] p-5 transition-colors hover:border-[#06b6d4]"
          >
            <Zap className="h-6 w-6 text-[#06b6d4]" />
            <div>
              <p className="font-medium text-[#f0f4f8]">{t("support")}</p>
              <p className="text-xs text-[#94a3b8]">{lang === "en" ? "Get help" : "احصل على مساعدة"}</p>
            </div>
          </Link>
          <Link
            to="/courses"
            className="flex items-center gap-3 rounded-xl border border-[#1f2d44] bg-[#111827] p-5 transition-colors hover:border-[#06b6d4]"
          >
            <Award className="h-6 w-6 text-[#06b6d4]" />
            <div>
              <p className="font-medium text-[#f0f4f8]">{t("certificates")}</p>
              <p className="text-xs text-[#94a3b8]">{lang === "en" ? "View your achievements" : "عرض إنجازاتك"}</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
