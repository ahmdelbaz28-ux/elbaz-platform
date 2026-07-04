import { useTranslation } from "@/hooks/useTranslation";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import Seo from "@/components/SEO";
import { Loader2, Award, BookOpen, CheckCircle, DollarSign, Clock, TrendingUp } from "lucide-react";
import { Link } from "react-router";
import { type ReactNode } from "react";

interface JourneyStats {
  totalCourses?: number;
  completedCourses?: number;
  totalCertificates?: number;
  totalLessonsCompleted?: number;
  totalSpent?: number;
}

interface JourneyEvent {
  id?: string | number;
  type?: "certificate" | "enrollment" | "payment" | "lesson" | string;
  title?: string;
  titleAr?: string;
  description?: string;
  descriptionAr?: string;
  date?: string | Date;
  link?: string;
}

// ─── Timeline icon resolver — replaces nested ternary (S3358) ───
function renderTimelineIcon(type: string | undefined): ReactNode {
  switch (type) {
    case "certificate":
      return <Award className="h-4 w-4 text-yellow-400" />;
    case "enrollment":
      return <BookOpen className="h-4 w-4 text-cyan-400" />;
    case "payment":
      return <DollarSign className="h-4 w-4 text-emerald-400" />;
    default:
      return <CheckCircle className="h-4 w-4 text-green-400" />;
  }
}

// ─── Stats card — extracted to reduce parent cognitive complexity (S3776) ───
function StatCard({ icon, value, label }: {
  readonly icon: ReactNode;
  readonly value: number;
  readonly label: string;
}) {
  return (
    <div className="rounded-xl border border-[#1e2d3d] bg-[#0d1521] p-4 text-center">
      <div className="flex justify-center mb-2">{icon}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

// ─── Timeline list — extracted to reduce parent cognitive complexity (S3776) ───
function TimelineList({ events, lang, formatDate }: {
  readonly events: JourneyEvent[];
  readonly lang: "ar" | "en";
  readonly formatDate: (date: Date | string) => string;
}) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <Clock className="h-10 w-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400">{lang === "ar" ? "لا توجد أحداث بعد" : "No events yet"}</p>
        <Link to="/courses" className="mt-4 inline-block text-cyan-400 hover:underline">
          {lang === "ar" ? "ابدأ التعلم الآن" : "Start learning now"}
        </Link>
      </div>
    );
  }

  return (
    <div className="relative space-y-4 before:absolute before:left-4 before:top-0 before:h-full before:w-px before:bg-[#1e2d3d]">
      {events.map((event) => {
        const title = lang === "ar" ? (event.titleAr || event.title || "") : (event.title || "");
        const desc = lang === "ar" ? (event.descriptionAr || event.description || "") : (event.description || "");
        // Use a composite stable key (NOT the array index) — S6479
        const key = event.id != null
          ? String(event.id)
          : `${event.type || "event"}-${event.date ? new Date(event.date).getTime() : ""}`;
        return (
          <div key={key} className="relative flex gap-4 pl-10">
            <div className="absolute left-2 top-3 flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#0a0e17] bg-[#0d1521]">
              {renderTimelineIcon(event.type)}
            </div>
            <div className="flex-1 rounded-lg border border-[#1e2d3d] bg-[#0d1521] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[#e8f0fe]">{title}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                </div>
                {event.date && (
                  <span className="text-[10px] text-slate-600 whitespace-nowrap">{formatDate(event.date)}</span>
                )}
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
  );
}

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

  const stats = (data?.stats || {}) as JourneyStats;
  const timeline = (data?.timeline || []) as JourneyEvent[];

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
            <StatCard icon={<BookOpen className="h-6 w-6 text-cyan-400" />} value={stats.totalCourses || 0} label={lang === "ar" ? "كورس" : "Courses"} />
            <StatCard icon={<CheckCircle className="h-6 w-6 text-green-400" />} value={stats.completedCourses || 0} label={lang === "ar" ? "مكتمل" : "Completed"} />
            <StatCard icon={<Award className="h-6 w-6 text-yellow-400" />} value={stats.totalCertificates || 0} label={lang === "ar" ? "شهادة" : "Certificates"} />
            <StatCard icon={<TrendingUp className="h-6 w-6 text-violet-400" />} value={stats.totalLessonsCompleted || 0} label={lang === "ar" ? "درس" : "Lessons"} />
            <StatCard icon={<DollarSign className="h-6 w-6 text-emerald-400" />} value={stats.totalSpent || 0} label={lang === "ar" ? "جنيه" : "EGP"} />
          </div>

          {/* Timeline */}
          <h2 className="mb-4 text-lg font-semibold text-white">
            {lang === "ar" ? "الجدول الزمني" : "Timeline"}
          </h2>
          <TimelineList events={timeline} lang={lang} formatDate={formatDate} />
        </div>
      </div>
    </>
  );
}
