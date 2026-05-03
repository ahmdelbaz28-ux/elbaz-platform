import { useSearchParams } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import CourseCard from "@/components/CourseCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Zap, CircuitBoard, Cpu, FileCheck, SlidersHorizontal, Search, X } from "lucide-react";
import { useState, useMemo } from "react";

const categoryIcons: Record<string, React.ReactNode> = {
  Zap: <Zap className="h-4 w-4" />,
  CircuitBoard: <CircuitBoard className="h-4 w-4" />,
  Cpu: <Cpu className="h-4 w-4" />,
  FileCheck: <FileCheck className="h-4 w-4" />,
};

function CourseCardSkeleton() {
  return (
    <div className="rounded-xl border border-[#1f2d44] bg-[#111827] overflow-hidden">
      <Skeleton className="h-48 w-full rounded-none" />
      <div className="p-5 space-y-3">
        <Skeleton className="h-4 w-20 rounded" />
        <Skeleton className="h-5 w-3/4 rounded" />
        <Skeleton className="h-4 w-full rounded" />
        <div className="flex items-center gap-4 pt-2">
          <Skeleton className="h-4 w-16 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
          <Skeleton className="h-4 w-16 rounded" />
        </div>
      </div>
    </div>
  );
}

export default function Courses() {
  const { t, lang } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedCategory = searchParams.get("category")
    ? parseInt(searchParams.get("category")!)
    : undefined;
  const selectedType = searchParams.get("type") as "free" | "premium" | undefined;

  const { data: allCourses, isLoading } = trpc.course.list.useQuery({
    categoryId: selectedCategory,
    isPremium: selectedType === "premium" ? true : selectedType === "free" ? false : undefined,
  });

  const { data: categories } = trpc.course.categories.useQuery();

  const freeCount = allCourses?.filter((c) => !c.isPremium).length || 0;
  const premiumCount = allCourses?.filter((c) => c.isPremium).length || 0;

  // Client-side search filter
  const filteredCourses = useMemo(() => {
    if (!allCourses) return [];
    if (!searchQuery.trim()) return allCourses;
    const q = searchQuery.toLowerCase().trim();
    return allCourses.filter(
      (c) =>
        c.titleEn?.toLowerCase().includes(q) ||
        c.titleAr?.toLowerCase().includes(q)
    );
  }, [allCourses, searchQuery]);

  return (
    <div className="min-h-screen bg-[#0a0e17] pt-24">
      <div className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
        {/* Header */}
        <div className="mb-8">
          <span className="text-xs font-medium uppercase tracking-[0.1em] text-[#06b6d4]">
            {t("courseCatalog")}
          </span>
          <h1 className="mt-2 text-3xl font-bold text-[#f0f4f8] lg:text-4xl">
            {t("browseByCategory")}
          </h1>
        </div>

        {/* Search */}
        <div className="mb-6 relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748b]" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchCourses")}
            className="border-[#1f2d44] bg-[#111827] pl-10 pr-10 text-[#f0f4f8] placeholder:text-[#64748b] focus:border-[#06b6d4] focus:ring-[#06b6d4]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-[#94a3b8] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 rounded-lg border border-[#1f2d44] px-4 py-2 text-sm text-[#94a3b8] transition-colors hover:border-[#06b6d4] hover:text-[#06b6d4]"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {t("filters")}
          </button>

          <button
            onClick={() => setSearchParams({})}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              !selectedCategory && !selectedType
                ? "bg-[#06b6d4] text-[#0a0e17]"
                : "border border-[#1f2d44] text-[#94a3b8] hover:border-[#06b6d4]"
            }`}
          >
            {lang === "en" ? "All" : "الكل"} ({allCourses?.length || 0})
          </button>

          <button
            onClick={() => setSearchParams({ type: "free" })}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              selectedType === "free"
                ? "bg-[#10b981] text-white"
                : "border border-[#1f2d44] text-[#94a3b8] hover:border-[#10b981]"
            }`}
          >
            {t("free")} ({freeCount})
          </button>

          <button
            onClick={() => setSearchParams({ type: "premium" })}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              selectedType === "premium"
                ? "bg-[#06b6d4] text-[#0a0e17]"
                : "border border-[#1f2d44] text-[#94a3b8] hover:border-[#06b6d4]"
            }`}
          >
            {t("premium")} ({premiumCount})
          </button>

          {categories?.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSearchParams({ category: cat.id.toString() })}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                selectedCategory === cat.id
                  ? "bg-[rgba(6,182,212,0.15)] text-[#06b6d4] border border-[#06b6d4]"
                  : "border border-[#1f2d44] text-[#94a3b8] hover:border-[#06b6d4]"
              }`}
            >
              {categoryIcons[cat.icon]}
              {lang === "ar" ? cat.nameAr : cat.nameEn}
            </button>
          ))}
        </div>

        {/* Course Grid */}
        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CourseCardSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCourses?.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        )}

        {!isLoading && filteredCourses?.length === 0 && allCourses?.length !== 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <Search className="h-12 w-12 text-[#1f2d44]" />
            <p className="mt-4 text-lg text-[#64748b]">
              {lang === "en" ? "No courses match your search" : "لا توجد كورسات تطابق بحثك"}
            </p>
            <p className="mt-1 text-sm text-[#64748b]">
              {lang === "en" ? "Try a different keyword" : "جرب كلمة بحث مختلفة"}
            </p>
          </div>
        )}

        {!isLoading && allCourses?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <Zap className="h-12 w-12 text-[#1f2d44]" />
            <p className="mt-4 text-lg text-[#64748b]">
              {lang === "en" ? "No courses found" : "لا توجد كورسات"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
