import { useEffect } from "react";
import { useNavigate, Link } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import { Progress } from "@/components/ui/progress";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Award,
  Clock,
  TrendingUp,
  Zap,
  BookOpen,
  CheckCircle2,
  ArrowRight,
  ExternalLink,
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
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1, type: "spring", stiffness: 200, damping: 20 }}
              whileHover={{ y: -4, scale: 1.02, boxShadow: "0 8px 30px rgba(6,182,212,0.12)" }}
              whileTap={{ scale: 0.98 }}
              className="rounded-xl border border-[#1f2d44] bg-[#111827] p-5 cursor-pointer"
            >
              <motion.div
                whileHover={{ rotate: [0, -8, 8, -4, 4, 0], scale: 1.1 }}
                transition={{ duration: 0.4 }}
                className="text-[#06b6d4]"
              >
                {stat.icon}
              </motion.div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-2 text-2xl font-bold text-[#f0f4f8]">{stat.value}</motion.p>
              <p className="mt-1 text-xs text-[#94a3b8]">{stat.label}</p>
            </motion.div>
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
              {myEnrollments.map((enrollment, idx) => {
                const progress = parseFloat(enrollment.progress || "0");
                const isComplete = progress >= 100;
                const courseSlug = enrollment.course?.slug || enrollment.courseId;
                const courseTitle = enrollment.course
                  ? (lang === "ar" ? enrollment.course.titleAr : enrollment.course.titleEn)
                  : (lang === "en" ? "Unknown Course" : "كورس غير معروف");

                return (
                  <motion.div
                    key={enrollment.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.08, type: "spring", stiffness: 200, damping: 20 }}
                  >
                    <Link
                      to={`/courses/${courseSlug}`}
                      className="group block rounded-xl border border-[#1f2d44] bg-[#111827] p-5 transition-all hover:border-[rgba(6,182,212,0.35)] hover:shadow-[0_8px_24px_rgba(6,182,212,0.06)]"
                    >
                      {/* Title + Status */}
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <h3 className="line-clamp-2 text-sm font-semibold text-[#f0f4f8] group-hover:text-[#06b6d4] transition-colors">
                          {courseTitle}
                        </h3>
                        {isComplete ? (
                          <motion.span
                            animate={{ scale: [1, 1.05, 1] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="shrink-0 flex items-center gap-1 rounded-full bg-[rgba(16,185,129,0.1)] px-2 py-0.5 text-[10px] font-medium text-[#10b981]"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            {t("completed")}
                          </motion.span>
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
                        <div className="relative h-2 overflow-hidden rounded-full bg-[#1f2d44]">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(progress, 100)}%` }}
                            transition={{ duration: 1, delay: idx * 0.1, type: "spring", stiffness: 100 }}
                            className="absolute inset-y-0 start-0 rounded-full bg-gradient-to-r from-[#06b6d4] to-[#0891b2]"
                          />
                          <motion.div
                            animate={{ x: ["100%", "-100%"] }}
                            transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                            className="absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-white/20 to-transparent"
                          />
                        </div>
                      </div>

                      {/* Last accessed + Continue / Certificate */}
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-[10px] text-[#64748b]">
                          {enrollment.lastAccessedAt
                            ? `${t("lastAccessed")}: ${new Date(enrollment.lastAccessedAt).toLocaleDateString()}`
                            : ""
                          }
                        </span>
                        {isComplete ? (
                          <Link
                            to={`/courses/${courseSlug}`}
                            className="flex items-center gap-1 rounded-md bg-[rgba(245,158,11,0.1)] px-2 py-1 text-[10px] font-semibold text-[#f59e0b] transition-colors hover:bg-[rgba(245,158,11,0.2)]"
                          >
                            <Award className="h-3 w-3" />
                            {lang === "en" ? "Get Certificate" : "احصل على الشهادة"}
                          </Link>
                        ) : (
                          <motion.span
                            animate={{ x: [0, 4, 0] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                            className="flex items-center gap-1 text-xs font-medium text-[#06b6d4] opacity-0 group-hover:opacity-100"
                          >
                            {t("continueCourse")}
                            <ArrowRight className="h-3 w-3" />
                          </motion.span>
                        )}
                      </div>
                    </Link>
                  </motion.div>
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
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, type: "spring", stiffness: 150 }}
            className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#f0f4f8]">{t("myCertificates")}</h2>
              <motion.div
                whileHover={{ rotate: [0, -10, 10, 0], scale: 1.1 }}
                transition={{ duration: 0.3 }}
                className="text-[#06b6d4]"
              >
                <Award className="h-5 w-5" />
              </motion.div>
            </div>
            {myCertificates && myCertificates.length > 0 ? (
              <div className="space-y-3">
                {myCertificates.map((cert) => {
                  const gradeColor = cert.grade?.toLowerCase() === "distinction"
                    ? "bg-[rgba(245,158,11,0.15)] text-[#f59e0b]"
                    : cert.grade?.toLowerCase() === "merit"
                    ? "bg-[rgba(99,102,241,0.15)] text-[#6366f1]"
                    : "bg-[rgba(16,185,129,0.15)] text-[#10b981]";
                  return (
                    <motion.div
                      key={cert.id}
                      whileHover={{ x: 4, borderColor: "rgba(6,182,212,0.35)" }}
                      whileTap={{ scale: 0.99 }}
                    >
                      <Link
                        to={`/certificate/${cert.certificateNumber}`}
                        className="group flex items-center gap-3 rounded-lg bg-[#0a0e17] p-3 transition-all hover:border-[rgba(6,182,212,0.35)] hover:bg-[#0d1525]"
                      >
                        <motion.div
                          whileHover={{ rotate: 360, scale: 1.1 }}
                          transition={{ duration: 0.5 }}
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgba(6,182,212,0.1)]"
                        >
                          <Award className="h-5 w-5 text-[#06b6d4]" />
                        </motion.div>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium text-[#f0f4f8] group-hover:text-[#06b6d4] transition-colors">{cert.courseName}</p>
                          <div className="flex items-center gap-2">
                            <p className="truncate text-xs text-[#64748b]">{cert.certificateNumber}</p>
                            {cert.grade && (
                              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${gradeColor}`}>
                                {cert.grade}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <motion.span
                            animate={{ opacity: [0.6, 1, 0.6] }}
                            transition={{ duration: 2, repeat: Infinity }}
                            className="rounded bg-[rgba(16,185,129,0.1)] px-2 py-0.5 text-xs text-[#10b981]"
                          >
                            {t("verified")}
                          </motion.span>
                          <ExternalLink className="h-3.5 w-3.5 text-[#64748b] opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center">
                <motion.div
                  animate={{ opacity: [0.3, 0.6, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity }}
                >
                  <Award className="mx-auto h-10 w-10 text-[#1f2d44]" />
                </motion.div>
                <p className="mt-3 text-sm text-[#94a3b8]">{t("noCertificates")}</p>
                <p className="mt-1 text-xs text-[#64748b]">{t("completeCourse")}</p>
              </div>
            )}
          </motion.div>

          {/* Recent Payments */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4, type: "spring", stiffness: 150 }}
            className="rounded-xl border border-[#1f2d44] bg-[#111827] p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#f0f4f8]">
                {lang === "en" ? "Recent Enrollments" : "التسجيلات الأخيرة"}
              </h2>
              <motion.div
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <Zap className="h-5 w-5 text-[#06b6d4]" />
              </motion.div>
            </div>
            {payments && payments.length > 0 ? (
              <div className="space-y-3">
                {payments.slice(0, 5).map((p, idx) => (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    whileHover={{ x: 4 }}
                    className="flex items-center justify-between rounded-lg bg-[#0a0e17] p-3 cursor-pointer"
                  >
                    <div>
                      <p className="text-sm font-medium text-[#f0f4f8]">
                        {lang === "en" ? "Course Purchase" : "شراء كورس"}
                      </p>
                      <p className="text-xs text-[#64748b]">
                        {p.paymentMethod} — {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                      </p>
                    </div>
                    <motion.span
                      whileHover={{ scale: 1.05 }}
                      className="text-sm font-semibold text-[#06b6d4]"
                    >
                      {p.amount} {p.currency}
                    </motion.span>
                  </motion.div>
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
          </motion.div>
        </div>

        {/* Quick Links */}
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            {
              to: "/courses",
              icon: <GraduationCap className="h-6 w-6" />,
              title: t("exploreCourses"),
              desc: lang === "en" ? "Browse the catalog" : "تصفح القائمة",
            },
            {
              to: "/support",
              icon: <Zap className="h-6 w-6" />,
              title: t("support"),
              desc: lang === "en" ? "Get help" : "احصل على مساعدة",
            },
            {
              to: "/courses",
              icon: <Award className="h-6 w-6" />,
              title: t("certificates"),
              desc: lang === "en" ? "View your achievements" : "عرض إنجازاتك",
            },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.1, type: "spring", stiffness: 200 }}
              whileHover={{ y: -4, scale: 1.02, borderColor: "rgba(6,182,212,0.4)" }}
              whileTap={{ scale: 0.98 }}
            >
              <Link
                to={item.to}
                className="flex items-center gap-3 rounded-xl border border-[#1f2d44] bg-[#111827] p-5 transition-colors hover:border-[#06b6d4]"
              >
                <motion.div
                  whileHover={{ rotate: [0, -15, 15, -8, 8, 0], scale: 1.15 }}
                  transition={{ duration: 0.4 }}
                  className="text-[#06b6d4]"
                >
                  {item.icon}
                </motion.div>
                <div>
                  <p className="font-medium text-[#f0f4f8]">{item.title}</p>
                  <p className="text-xs text-[#94a3b8]">{item.desc}</p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
