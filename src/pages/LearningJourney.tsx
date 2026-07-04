import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import Seo from "@/components/SEO";
import { Loader2, Award, BookOpen, CheckCircle, DollarSign, Clock, TrendingUp } from "lucide-react";
import { Link } from "react-router";

export default function LearningJourney() {
  const { lang } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { data, isLoading } = trpc.journey.timeline.useQuery();

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e17] text-[#e8f0fe]">
        <div className="text-center">
          <p className="text-slate-400 mb-4">{lang === "ar" ? "سجل دخولك لعرض رحلتك" : "Log in to view your journey"}</p>
          <Link to="/login" className="text-cyan-400 hover:underline">{lang === "ar" ? "تسجيل الدخول" : "Login"}</Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0e17]">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  const stats = data?.stats;
  const timeline = data?.timeline || [];

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
  };

  return (
    <>
      <Seo title={lang === "ar" ? "رحلتي التعليمية | منصة الباز" : "Learning Journey | Elbaz Platform"} description={lang === "ar" ? "تتبع تقدمك وإنجازاتك" : "Track your progress and achievements"} />
      <div className="min-h-screen bg-[#0a0e17] text-[#e8f0fe]">
        <div className="border-b border-[#1e2d3d] bg-gradient-to-r from-violet-600/10 to-indigo-600/10">
          <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
            <h1 className="text-2xl font-bold text-white mb-1">
              {lang === "ar" ? "رحلتي التعليمية" : "My Learning Journey"}
            </h1>
            <p className="text-sm text-slate-400">
              {lang === "ar" ? "تتبع تقدمك وإنجازاتك على المنصة" : "Track your progress and achievements"}
            </p>
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Stats Cards */}
          <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-5">
            <div className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] p-4 text-center">
              <BookOpen className="h-6 w-6 text-cyan-400 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{stats?.totalCourses || 0}</div>
              <div className="text-xs text-slate-500">{lang === "ar" ? "كورس" : "Courses"}</div>
            </div>
            <div className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] p-4 text-center">
              <CheckCircle className="h-6 w-6 text-green-400 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{stats?.completedCourses || 0}</div>
              <div className="text-xs text-slate-500">{lang === "ar" ? "مكتمل" : "Completed"}</div>
            </div>
            <div className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] p-4 text-center">
              <Award className="h-6 w-6 text-yellow-400 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{stats?.totalCertificates || 0}</div>
              <div className="text-xs text-slate-500">{lang === "ar" ? "شهادة" : "Certificates"}</div>
            </div>
            <div className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] p-4 text-center">
              <TrendingUp className="h-6 w-6 text-violet-400 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{stats?.totalLessonsCompleted || 0}</div>
              <div className="text-xs text-slate-500">{lang === "ar" ? "درس" : "Lessons"}</div>
            </div>
            <div className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] p-4 text-center">
              <DollarSign className="h-6 w-6 text-emerald-400 mx-auto mb-2" />
              <div className="text-2xl font-bold text-white">{stats?.totalSpent || 0}</div>
              <div className="text-xs text-slate-500">{lang === "ar" ? "جنيه" : "EGP"}</div>
            </div>
          </div>

          {/* Timeline */}
          <h2 className="mb-4 text-lg font-semibold text-white">
            {lang === "ar" ? "الجدول الزمني" : "Timeline"}
          </h2>
          {timeline.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="h-10 w-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">{lang === "ar" ? "لا توجد أحداث بعد" : "No events yet"}</p>
              <Link to="/courses" className="mt-4 inline-block text-cyan-400 hover:underline">
                {lang === "ar" ? "ابدأ التعلم الآن" : "Start learning now"}
              </Link>
            </div>
          ) : (
            <div className="relative space-y-4 before:absolute before:left-4 before:top-0 before:h-full before:w-px before:bg-[#1e2d3d]">
              {timeline.map((event: any, idx: number) => {
                const icon = event.type === "certificate" ? <Award className="h-4 w-4 text-yellow-400" />
                  : event.type === "enrollment" ? <BookOpen className="h-4 w-4 text-cyan-400" />
                  : event.type === "payment" ? <DollarSign className="h-4 w-4 text-emerald-400" />
                  : <CheckCircle className="h-4 w-4 text-green-400" />;
                const title = lang === "ar" ? event.titleAr : event.title;
                const desc = lang === "ar" ? event.descriptionAr : event.description;
                return (
                  <div key={idx} className="relative flex gap-4 pl-10">
                    <div className="absolute left-2 top-3 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#0a0e17] bg-[#0d1521]">
                      {icon}
                    </div>
                    <div className="flex-1 rounded-lg border border-[#1e2d3d] bg-[#0d1521] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-[#e8f0fe]">{title}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                        </div>
                        <span className="text-[10px] text-slate-600 whitespace-nowrap">{formatDate(event.date)}</span>
                      </div>
                      {event.link && (
                        <Link to={event.link} className="mt-2 inline-block text-xs text-cyan-400 hover:underline">
                          {lang === "ar" ? "عرض التفاصيل" : "View details"} →
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
