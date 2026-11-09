import { useSearchParams } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import CourseCard from "@/components/CourseCard";
import Seo from "@/components/SEO";
import { CourseCardSkeleton } from "@/components/SkeletonCard";
import { Input } from "@/components/ui/input";
import { Zap, CircuitBoard, Cpu, FileCheck, SlidersHorizontal, Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
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
const PAGE_SIZE = 12;

export default function Courses() {
  const { t, lang } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);

  // ── URL-backed search query (?q=) ──────────────────────────────────────
  // The search box writes to the URL so results are shareable/linkable and
  // the WebSite SearchAction structured data (/courses?q={query}) actually
  // works — a prerequisite for Google Sitelinks Search Box.
  const urlQuery = searchParams.get("q") ?? "";
  const [searchInput, setSearchInput] = useState(urlQuery);
  // React-endorsed "adjust state on prop change" pattern (no effect): keeps the
  // visible input in sync when the URL changes externally (navbar search,
  // browser back/forward) without re-render loops or lint violations.
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery);
  if (lastUrlQuery !== urlQuery) {
    setLastUrlQuery(urlQuery);
    setSearchInput((prev) => (prev.trim() === urlQuery.trim() ? prev : urlQuery));
  }

  // ✅ UX FIX (pre-launch audit): server-side search, debounced. The old
  // client-side filter only searched the ≤12 courses the server returned for
  // page 1 — with a larger catalog, matching course 13+ was unreachable.
  // The backend `search` input does a title+description LIKE across ALL
  // published courses; we debounce to avoid a request per keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState(urlQuery.trim());
  useEffect(() => {
    const id = globalThis.setTimeout(() => setDebouncedQuery(urlQuery.trim()), 300);
    return () => globalThis.clearTimeout(id);
  }, [urlQuery]);

  const selectedCategory = searchParams.get("category") ? Number.parseInt(searchParams.get("category")!, 10) : undefined;
  const selectedType = searchParams.get("type") as "free" | "premium" | undefined;
  const isPremiumFilter = selectedType === "free" ? false : undefined;

  // ✅ PAGINATION FIX (pre-launch audit): the backend paginates
  // (page/limit + pagination.totalPages) but the page never advanced past
  // page 1 (limit 12) — courses 13+ were invisible forever once the catalog
  // grew. Now the page is URL-backed (?page=N) with server-side pagination.
  // Note: tRPC v11 only exposes useInfiniteQuery for cursor-based procedures;
  // course.list is offset-based, so a page-number UI is the correct pattern.
  const urlPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(urlPage) && urlPage >= 1 ? urlPage : 1;

  // Reset to page 1 whenever filters/search change so users never land on an
  // out-of-range page after narrowing results.
  useEffect(() => {
    if (page !== 1) {
      const next = new URLSearchParams(searchParams);
      next.delete("page");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, selectedType, debouncedQuery]);

  const { data: coursesResponse, isLoading, isFetching } = trpc.course.list.useQuery<CourseListResponse>({
    categoryId: selectedCategory,
    isPremium: selectedType === "premium" ? true : isPremiumFilter,
    search: debouncedQuery.length >= 2 ? debouncedQuery : undefined,
    page,
    limit: PAGE_SIZE,
  });

  const { data: categories } = trpc.course.categories.useQuery<Category[]>();

  // ✅ Count fix: free/premium chip counts are now true catalog totals (from
  // the server's pagination.totalCount of two 1-item probe queries) instead of
  // counting whatever slice the current page/filter returned — which made the
  // premium chip show "(0)" whenever the free filter was active.
  const { data: freeProbe } = trpc.course.list.useQuery<CourseListResponse>(
    { isPremium: false, page: 1, limit: 1 },
    { staleTime: 1000 * 60 * 10 }
  );
  const { data: premiumProbe } = trpc.course.list.useQuery<CourseListResponse>(
    { isPremium: true, page: 1, limit: 1 },
    { staleTime: 1000 * 60 * 10 }
  );
  const freeCount = freeProbe?.pagination.totalCount ?? 0;
  const premiumCount = premiumProbe?.pagination.totalCount ?? 0;

  const allCourses = useMemo(
    () => (Array.isArray(coursesResponse?.items) ? coursesResponse.items : []),
    [coursesResponse]
  );
  const pagination = coursesResponse?.pagination;
  const totalCount = pagination?.totalCount ?? 0;
  const totalPages = Math.max(pagination?.totalPages ?? 1, 1);

  const filteredCourses = allCourses;

  // ✅ Filter buttons now MERGE into the existing params instead of replacing
  // them — the old setSearchParams({type}) / setSearchParams({category}) wiped
  // the ?q= search (and each other), silently clearing the user's search.
  const updateParams = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  };

  const handleSearch = (value: string) => {
    setSearchInput(value);
    updateParams((next) => {
      const trimmed = value.trim();
      if (trimmed) {
        next.set("q", trimmed);
      } else {
        next.delete("q");
      }
    });
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
      const q = trimmed.toLowerCase();
      const resultsCount = allCourses?.filter((c) => c.titleEn?.toLowerCase().includes(q) || c.titleAr?.toLowerCase().includes(q)).length || 0;
      trackEvent("search_used", { query: trimmed, resultsCount, page: "courses" });
    }
  };

  const goToPage = (p: number) => {
    const clamped = Math.min(Math.max(1, p), totalPages);
    updateParams((next) => {
      if (clamped > 1) next.set("page", clamped.toString());
      else next.delete("page");
    });
    // Keep the catalog top in view when moving between pages.
    globalThis.scrollTo({ top: 240, behavior: "smooth" });
  };

  const hasActiveFilters = Boolean(selectedCategory || selectedType);
  // Numbered page buttons: compact window around the current page.
  const pageButtons = useMemo(() => {
    if (totalPages <= 1) return [] as number[];
    const window = 2;
    const lo = Math.max(1, page - window);
    const hi = Math.min(totalPages, page + window);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  }, [totalPages, page]);

  return (
    <div className="min-h-screen bg-background pt-[calc(6rem+env(safe-area-inset-top,0px))]">
      <Seo title={lang === "en" ? "Courses" : "الكورسات"} description={lang === "en" ? "Explore our premium electrical engineering courses." : "تصفح الكورسات الهندسية الكهربية المتميزة."} />
      <div className="mx-auto max-w-7xl px-4 pb-20 lg:px-6">
        <div className="mb-8">
          <span className="text-xs font-medium uppercase tracking-[0.1em] text-accent-secondary">{t("courseCatalog")}</span>
          <h1 className="mt-2 text-3xl font-bold text-foreground lg:text-4xl">{t("browseByCategory")}</h1>
        </div>

        <div className="mb-6 relative max-w-md">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t("searchCourses")}
            className="border-border bg-primary ps-10 pe-10 text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary"
          />
          {searchInput && (
            <button onClick={() => handleSearch("")} className="absolute end-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mb-8 flex flex-wrap items-center gap-3">
          <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-text-muted transition-colors hover:border-accent-secondary hover:text-accent-secondary">
            <SlidersHorizontal className="h-4 w-4" />
            {t("filters")}
          </button>

          <button data-testid="filter-all" onClick={() => updateParams((next) => { next.delete("category"); next.delete("type"); })} className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${!selectedCategory && !selectedType ? "bg-accent-secondary text-background" : "border border-border text-text-muted hover:border-accent-secondary"}`}>
            {lang === "en" ? "All" : "الكل"} ({totalCount})
          </button>

          <button data-testid="filter-free" onClick={() => updateParams((next) => { next.set("type", "free"); })} className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${selectedType === "free" ? "bg-emerald-600 text-white" : "border border-border text-text-muted hover:border-emerald-600"}`}>
            {t("free")} ({freeCount})
          </button>

          <button data-testid="filter-premium" onClick={() => updateParams((next) => { next.set("type", "premium"); })} className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${selectedType === "premium" ? "bg-accent-secondary text-background" : "border border-border text-text-muted hover:border-accent-secondary"}`}>
            {t("premium")} ({premiumCount})
          </button>

          {(categories || []).map((cat: Category) => (
            <button key={cat.id} onClick={() => updateParams((next) => { next.set("category", cat.id.toString()); })} className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${selectedCategory === cat.id ? "bg-accent-secondary/15 text-accent-secondary border border-accent-secondary" : "border border-border text-text-muted hover:border-accent-secondary"}`}>
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
          <div data-testid="courses-grid" className={`grid gap-6 sm:grid-cols-2 lg:grid-cols-3 ${isFetching ? "opacity-70 transition-opacity" : ""}`}>
            {filteredCourses?.map((course: CourseItem) => <CourseCard key={course.id} course={course} />)}
          </div>
        )}

        {/* ✅ Server-side pagination controls */}
        {!isLoading && totalPages > 1 && (
          <nav aria-label={lang === "en" ? "Course pages" : "صفحات الكورسات"} className="mt-10 flex items-center justify-center gap-2">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              aria-label={lang === "en" ? "Previous page" : "الصفحة السابقة"}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:border-accent-secondary hover:text-accent-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
              {lang === "en" ? "Prev" : "السابق"}
            </button>
            {pageButtons.map((p) => (
              <button
                key={p}
                onClick={() => goToPage(p)}
                aria-current={p === page ? "page" : undefined}
                className={`min-w-[2.5rem] rounded-lg px-3 py-2 text-sm font-medium transition-colors ${p === page ? "bg-accent-secondary text-background" : "border border-border text-text-muted hover:border-accent-secondary hover:text-accent-secondary"}`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              aria-label={lang === "en" ? "Next page" : "الصفحة التالية"}
              className="flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:border-accent-secondary hover:text-accent-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {lang === "en" ? "Next" : "التالي"}
              <ChevronRight className="h-4 w-4 rtl:rotate-180" />
            </button>
          </nav>
        )}
        {!isLoading && totalPages > 1 && (
          <p className="mt-3 text-center text-xs text-text-faint">
            {lang === "en"
              ? `Showing ${filteredCourses.length} of ${totalCount} courses`
              : `يتم عرض ${filteredCourses.length} من ${totalCount} كورس`}
          </p>
        )}

        {!isLoading && filteredCourses?.length === 0 && (totalCount > 0 || hasActiveFilters) && (
          <div className="flex flex-col items-center justify-center py-20">
            <Search className="h-12 w-12 text-border" />
            <p className="mt-4 text-lg text-text-muted">{lang === "en" ? "No courses match your search" : "لا توجد كورسات تطابق بحثك"}</p>
            <p className="mt-1 text-sm text-text-muted">{lang === "en" ? "Try a different keyword" : "جرب كلمة بحث مختلفة"}</p>
          </div>
        )}

        {!isLoading && totalCount === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <Zap className="h-12 w-12 text-border" />
            <p className="mt-4 text-lg text-text-muted">{lang === "en" ? "No courses found" : "لا توجد كورسات"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
