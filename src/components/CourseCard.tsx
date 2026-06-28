import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { Clock, Star, Users, Zap, ChevronRight } from "lucide-react";
import { TiltCard } from "@/components/ui/motion";

interface CourseCardProps {
  course: {
    id: number;
    slug: string;
    titleEn: string;
    titleAr: string;
    shortDescEn: string | null;
    shortDescAr: string | null;
    thumbnail: string | null;
    level: string;
    isPremium: boolean;
    price: string;
    originalPrice: string | null;
    durationHours: number;
    rating: string;
    reviewCount: number;
    studentCount: number;
    categoryName?: string | null;
    categoryNameAr?: string | null;
  };
}

const levelColors: Record<string, { bg: string; text: string; label: string; labelAr: string }> = {
  beginner:     { bg: "rgba(16,185,129,0.12)",  text: "#10b981", label: "Beginner",     labelAr: "مبتدئ" },
  intermediate: { bg: "rgba(245,158,11,0.12)",  text: "#f59e0b", label: "Intermediate", labelAr: "متوسط" },
  advanced:     { bg: "rgba(239,68,68,0.12)",   text: "#ef4444", label: "Advanced",     labelAr: "متقدم" },
};

export default function CourseCard({ course }: CourseCardProps) {
  const { lang } = useTranslation();
  const title = lang === "ar" && course.titleAr ? course.titleAr : course.titleEn;
  const shortDesc = lang === "ar" && course.shortDescAr ? course.shortDescAr : course.shortDescEn;
  const categoryLabel = lang === "ar" && course.categoryNameAr ? course.categoryNameAr : course.categoryName;
  const coursePrice = parseFloat(course.price || "0");
  const originalPrice = course.originalPrice ? parseFloat(course.originalPrice) : 0;
  const discount = originalPrice > coursePrice && originalPrice > 0
    ? Math.round(((originalPrice - coursePrice) / originalPrice) * 100)
    : 0;
  const lvl = levelColors[course.level] || levelColors.beginner;

  return (
    <TiltCard className="h-full">
      <Link to={`/courses/${course.slug}`} className="group block h-full outline-none focus-visible:ring-2 focus-visible:ring-[#06b6d4] rounded-2xl">
        <article
          className="relative h-full overflow-hidden rounded-2xl border border-[#1e2d3d] bg-[#0d1420] transition-all duration-300
            group-hover:border-[rgba(6,182,212,0.4)] group-hover:shadow-[0_20px_60px_rgba(6,182,212,0.12)]
            group-hover:will-change-transform"
        >
          {/* ── Thumbnail ── */}
          <div className="relative h-48 overflow-hidden bg-gradient-to-br from-[#0a1628] to-[#1e2d3d]">
            <img
              src={course.thumbnail || "/hero-bg.jpg"}
              alt={title}
              loading="lazy"
              width="384"
              height="192"
              decoding="async"
              onError={(e) => { e.currentTarget.src = "/hero-bg.jpg"; e.currentTarget.onerror = null; }}
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
            />

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0d1420] via-transparent to-transparent" />

            {/* Top badges row */}
            <div className="absolute start-3 top-3 flex items-center gap-2">
              {course.isPremium ? (
                <span className="flex items-center gap-1 rounded-lg bg-[rgba(6,182,212,0.9)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#001a24] backdrop-blur-sm">
                  <Zap className="h-3 w-3" />
                  Premium
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-lg border border-[#f59e0b] bg-[rgba(245,158,11,0.15)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#f59e0b] backdrop-blur-sm">
                  {lang === "ar" ? "مجاني" : "Free"}
                </span>
              )}
              {discount > 0 && (
                <span className="rounded-lg bg-[rgba(239,68,68,0.85)] px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
                  -{discount}%
                </span>
              )}
            </div>

            {/* Duration — bottom right */}
            <div className="absolute bottom-3 end-3 flex items-center gap-1 rounded-lg bg-[rgba(10,14,23,0.75)] px-2 py-1 backdrop-blur-md">
              <Clock className="h-3 w-3 text-[#94a3b8]" />
              <span className="text-[11px] font-medium text-[#94a3b8]">
                {course.durationHours}{lang === "ar" ? "س" : "h"}
              </span>
            </div>
          </div>

          {/* ── Body ── */}
          <div className="p-5 flex flex-col h-[calc(100%-12rem)]">
            <div className="flex-1">
              {/* Category + Level */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-[#06b6d4]">
                  {categoryLabel || "Engineering"}
                </span>
                <span
                  className="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ background: lvl.bg, color: lvl.text }}
                >
                  {lang === "ar" ? lvl.labelAr : lvl.label}
                </span>
              </div>

              {/* Title */}
              <h3
                className="mt-2 line-clamp-2 text-[15px] font-bold leading-snug text-[#e8f0fe] transition-colors duration-200 group-hover:text-[#06b6d4]"
                dir={lang === "ar" ? "rtl" : "ltr"}
              >
                {title}
              </h3>

              {/* Short description */}
              {shortDesc && (
                <p
                  className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-[#64748b]"
                  dir={lang === "ar" ? "rtl" : "ltr"}
                >
                  {shortDesc}
                </p>
              )}

              {/* ── Stats row ── */}
              <div className="mt-4 flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 fill-[#f59e0b] text-[#f59e0b]" />
                  <span className="text-[12px] font-semibold text-[#e8f0fe]">
                    {parseFloat(course.rating).toFixed(1)}
                  </span>
                  <span className="text-[11px] text-[#475569]">
                    ({course.reviewCount})
                  </span>
                </div>
                <div className="h-3 w-px bg-[#1e2d3d]" />
                <div className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5 text-[#475569]" />
                  <span className="text-[11px] text-[#64748b]">
                    {course.studentCount >= 1000
                      ? `${(course.studentCount / 1000).toFixed(1)}k`
                      : course.studentCount.toLocaleString()}
                    {lang === "ar" ? " طالب" : " students"}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Separator ── */}
            <div className="my-4 h-px bg-gradient-to-r from-transparent via-[#1e2d3d] to-transparent" />

            {/* ── Price + CTA ── */}
            <div className="flex items-center justify-between mt-auto">
              <div>
                {coursePrice === 0 ? (
                  <span className="text-base font-bold text-[#10b981]">
                    {lang === "ar" ? "مجاناً" : "Free"}
                  </span>
                ) : (
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-extrabold text-[#e8f0fe]">
                      {coursePrice.toLocaleString()} {lang === "ar" ? "ج.م" : "EGP"}
                    </span>
                    {originalPrice > coursePrice && (
                      <span className="text-sm text-[#475569] line-through">
                        {originalPrice.toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Animated CTA arrow */}
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#1e2d3d] bg-[#111827] transition-all duration-200 group-hover:border-[#06b6d4] group-hover:bg-[rgba(6,182,212,0.1)]">
                <ChevronRight className="h-4 w-4 text-[#475569] transition-colors group-hover:text-[#06b6d4] rtl:rotate-180" />
              </div>
            </div>
          </div>

          {/* Shimmer line on hover */}
          <div className="absolute bottom-0 start-0 h-[2px] w-0 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] transition-all duration-500 group-hover:w-full" />

          {/* Premium shine sweep effect */}
          <div className="absolute inset-0 overflow-hidden rounded-2xl pointer-events-none">
            <div className="shimmer-shine" />
          </div>
        </article>
      </Link>
    </TiltCard>
  );
}

