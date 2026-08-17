import { useSearchParams } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import CourseCard from "@/components/CourseCard";
import Seo from "@/components/SEO";
import { CourseCardSkeleton } from "@/components/SkeletonCard";
import { Input } from "@/components/ui/input";
import { Zap, CircuitBoard, Cpu, FileCheck, SlidersHorizontal, Search, X } from "lucide-react";
import { useState, useMemo } from "react";
import { trackEvent } from "@/lib/clarity";

interface Category {
  id: number;
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  icon: string;
  sortOrder: number;
  createdAt: Date;
}

interface CourseItem {
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
  instructorName: string;
  isFeatured: boolean;
  createdAt: Date;
  categoryName?: string | null;
  categoryNameAr?: string | null;
}

interface CourseListResponse {
  items: CourseItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

const categoryIcons: Record<string, React.ReactNode> = {
  Zap: <Zap className="h-4 w-4" />,
  CircuitBoard: <CircuitBoard className="h-4 w-4" />,
  Cpu: <Cpu className="h-4 w-4" />,
  FileCheck: <FileCheck className="h-4 w-4" />,
};

const SKELETON_KEYS = ["sk-0", "sk-1", "sk-2", "sk-3", "sk-4", "sk-5"] as const;

export default function Courses() {
  const { t, lang } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedCategory = searchParams.get("category") ? Number.parseInt(searchParams.get("category")!, 10) : undefined;
  const selectedType = searchParams.get("type") as "free" | "premium" | undefined;
  const isPremiumFilter = selectedType === "free" ? false : undefined;

  const { data: coursesResponse, isLoading } = trpc.course.list.useQuery<CourseListResponse>({
    categoryId: selectedCategory,
    isPremium: selectedType === "premium" ? true : isPremiumFilter,
  });

  const { data: categories } = trpc.course.categories.useQuery<Category[]>();
  const allCourses = useMemo(
    () => (Array.isArray(coursesResponse?.items) ? coursesResponse.items : []),
    [coursesResponse]
  );
  const freeCount = allCourses.filter((c) => !c.isPremium).length;
  const premiumCount = allCourses.filter((c) => c.isPremium).length;

  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) return allCourses;
    const q = searchQuery.toLowerCase().trim();
    return allCourses.filter((c) => c.titleEn?.toLowerCase().includes(q) || c.titleAr?.toLowerCase().includes(q));
  }, [allCourses, searchQuery]);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    if (value.trim().length >= 2) {
      const q = value.trim().toLowerCase();
      const resultsCount = allCourses?.filter((c) => c.titleEn?.toLowerCase().includes(q) || c.titleAr?.toLowerCase().includes(q)).length || 0;
      trackEvent("search_used", { query: value.trim(), resultsCount, page: "courses" });
    }
  };

  return (
    <div className="min-h-screen bg-background pt-24">
      <Seo title={lang === "en" ? "Courses" : "الكورسات"} description={lang === "en" ? "Explore our premium electrical engineering courses." : "تصفح الكورسات الهندسية الكهربية المتميزة."} />
      <div className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
        <div className="mb-8">
          <span className="text-xs font-medium uppercase tracking-[0.1em] text-accent-secondary">{t("courseCatalog")}</span>
          <h1 className="mt-2 text-3xl font-bold text-foreground lg:text-4xl">{t("browseByCategory")}</h1>
        </div>

        <div className="mb-6 relative max-w-md">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t("searchCourses")}
            className="border-border bg-primary ps-10 pe-10 text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute end-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mb-8 flex flex-wrap items-center gap-3">
          <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:border-accent-secondary hover:text-accent-secondary">
            <SlidersHorizontal className="h-4 w-4" />
            {t("filters")}
          </button>

          <button data-testid="filter-all" onClick={() => setSearchParams({})} className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${!selectedCategory && !selectedType ? "bg-accent-secondary text-background" : "border border-border text-text-muted hover:border-accent-secondary"}`}>
            {lang === "en" ? "All" : "الكل"} ({allCourses?.length || 0})
          </button>

          <button data-testid="filter-free" onClick={() => setSearchParams({ type: "free" })} className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${selectedType === "free" ? "bg-emerald-600 text-white" : "border border-border text-text-muted hover:border-emerald-600"}`}>
            {t("free")} ({freeCount})
          </button>

          <button data-testid="filter-premium" onClick={() => setSearchParams({ type: "premium" })} className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${selectedType === "premium" ? "bg-accent-secondary text-background" : "border border-border text-text-muted hover:border-accent-secondary"}`}>
            {t("premium")} ({premiumCount})
          </button>

          {(categories || []).map((cat: Category) => (
            <button key={cat.id} onClick={() => setSearchParams({ category: cat.id.toString() })} className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${selectedCategory === cat.id ? "bg-accent-secondary/15 text-accent-secondary border border-accent-secondary" : "border border-border text-text-muted hover:border-accent-secondary"}`}>
              {categoryIcons[cat.icon] || categoryIcons.Zap}
              {lang === "ar" ? cat.nameAr : cat.nameEn}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SKELETON_KEYS.map(skKey => <CourseCardSkeleton key={skKey} />)}
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredCourses?.map((course: CourseItem) => <CourseCard key={course.id} course={course} />)}
          </div>
        )}

        {!isLoading && filteredCourses?.length === 0 && allCourses?.length !== 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <Search className="h-12 w-12 text-border" />
            <p className="mt-4 text-lg text-text-muted">{lang === "en" ? "No courses match your search" : "لا توجد كورسات تطابق بحثك"}</p>
            <p className="mt-1 text-sm text-text-muted">{lang === "en" ? "Try a different keyword" : "جرب كلمة بحث مختلفة"}</p>
          </div>
        )}

        {!isLoading && allCourses?.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <Zap className="h-12 w-12 text-border" />
            <p className="mt-4 text-lg text-text-muted">{lang === "en" ? "No courses found" : "لا توجد كورسات"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
