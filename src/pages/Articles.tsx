import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import Seo from "@/components/SEO";
import { Input } from "@/components/ui/input";
import { Loader2, X, Search, Filter, ChevronDown, Clock, Eye, Newspaper } from "lucide-react";

/* ── Types ── */

interface ArticleListItem {
  id: number;
  slug: string;
  titleAr: string;
  titleEn: string;
  excerptAr: string | null;
  excerptEn: string | null;
  coverImage: string | null;
  category: string;
  tags: string | null;
  authorName: string | null;
  viewCount: number;
  readMinutes: number;
  publishedAt: Date | string | null;
}

/* ── Helpers ── */

function formatDate(date: Date | string | null, lang: "ar" | "en"): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { year: "numeric", month: "long", day: "numeric" });
}

/* ── Loading State ── */

function ArticlesLoading({ lang }: { readonly lang: "ar" | "en" }) {
  return (
    <div className="flex flex-col items-center justify-center py-32">
      <Loader2 className="h-10 w-10 animate-spin text-accent-secondary" />
      <p className="mt-4 text-sm text-text-muted">
        {lang === "ar" ? "جارٍ تحميل المقالات..." : "Loading articles..."}
      </p>
    </div>
  );
}

/* ── Empty State ── */

function ArticlesEmpty({ lang, hasFilter }: { readonly lang: "ar" | "en"; readonly hasFilter: boolean }) {
  const heading = hasFilter
    ? (lang === "ar" ? "لا توجد نتائج" : "No results found")
    : (lang === "ar" ? "لا توجد مقالات بعد" : "No articles yet");
  const subtext = hasFilter
    ? (lang === "ar" ? "جرب تغيير البحث أو الفئة" : "Try changing your search or category")
    : (lang === "ar" ? "سيتم نشر المقالات قريباً" : "Articles will be published soon");

  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary border border-border">
        <Newspaper className="h-10 w-10 text-border" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">{heading}</h3>
      <p className="mt-2 text-sm text-text-faint">{subtext}</p>
    </div>
  );
}

/* ── Article Card ── */

interface ArticleCardProps {
  readonly item: ArticleListItem;
  readonly lang: "ar" | "en";
}

function ArticleCard({ item, lang }: ArticleCardProps) {
  const title = lang === "ar" ? item.titleAr : item.titleEn;
  const excerpt = (lang === "ar" ? item.excerptAr : item.excerptEn) || (lang === "ar" ? item.excerptEn : item.excerptAr) || "";

  return (
    <Link
      to={`/articles/${encodeURIComponent(item.slug)}`}
      className="group flex flex-col rounded-xl border border-border bg-primary p-5 transition-all duration-200 hover:border-[rgba(6,182,212,0.35)] hover:shadow-[0_8px_32px_rgba(6,182,212,0.06)]"
    >
      {/* Cover */}
      {item.coverImage && (
        <div className="mb-4 aspect-[16/8] overflow-hidden rounded-lg border border-border">
          <img src={item.coverImage} alt={title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        </div>
      )}

      {/* Category + read time */}
      <div className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="rounded-full bg-accent-secondary/10 px-2 py-0.5 font-medium text-accent-secondary">{item.category}</span>
        <span className="flex items-center gap-1 text-text-faint">
          <Clock className="h-3 w-3" />
          {lang === "ar" ? `${item.readMinutes} دقائق` : `${item.readMinutes} min`}
        </span>
      </div>

      {/* Title */}
      <h3 className="mb-1 line-clamp-2 text-base font-semibold text-foreground group-hover:text-accent-secondary transition-colors">
        {title}
      </h3>

      {/* Excerpt */}
      {excerpt && (
        <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-text-faint">{excerpt}</p>
      )}

      {/* Meta row */}
      <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-text-faint">
        <span>{item.authorName || (lang === "ar" ? "فريق المنصة" : "Platform Team")}</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{item.viewCount}</span>
          <span>{formatDate(item.publishedAt, lang)}</span>
        </span>
      </div>
    </Link>
  );
}

/* ── Main Component ── */

export default function Articles() {
  const { lang } = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  // ─── Queries ───
  const { data, isLoading } = trpc.articles.list.useQuery({
    category: selectedCategory,
    search: search || undefined,
  });
  const { data: categories } = trpc.articles.categories.useQuery();

  const items = (data?.items ?? []) as ArticleListItem[];
  const total = data?.total ?? 0;

  const hasFilter = Boolean(search) || selectedCategory !== "all";

  // ─── Render ───
  return (
    <>
      <Seo
        title={lang === "ar" ? "المقالات | منصة الباز" : "Articles | Elbaz Platform"}
        description={
          lang === "ar"
            ? "مقالات هندسية متخصصة — تحليل أنظمة القدرة، برامج المحاكاة الكهربائية مثل ETAP وPowerFactory، ودروس تطبيقية للمهندسين"
            : "Specialized engineering articles — power system analysis, electrical simulation software like ETAP and PowerFactory, and practical lessons for engineers"
        }
      />

      <div className="min-h-screen bg-background pt-20">
        {/* ─── Hero Section ─── */}
        <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-[rgba(6,182,212,0.08)] to-[rgba(8,145,178,0.04)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(6,182,212,0.12),transparent_60%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent-secondary to-accent-secondary/80 shadow-lg shadow-accent-secondary/25">
                    <Newspaper className="h-7 w-7 text-white" />
                  </div>
                  <h1 className="text-3xl font-bold text-foreground md:text-4xl">
                    {lang === "ar" ? "المقالات الهندسية" : "Engineering Articles"}
                  </h1>
                </div>
                <p className="max-w-2xl text-sm text-text-muted md:text-base">
                  {lang === "ar"
                    ? "مقالات متخصصة في الهندسة الكهربائية وأنظمة القدرة — تحليلات معمقة، أدلة استخدام لبرامج المحاكاة، ومشاريع تطبيقية ترفع مستواك الهندسي."
                    : "Specialized electrical engineering articles — in-depth analyses, simulation software guides, and hands-on projects to level up your engineering skills."}
                </p>
              </div>

              {/* Stats */}
              <div className="flex gap-3">
                <div className="rounded-xl border border-border bg-primary px-5 py-3 text-center">
                  <div className="text-2xl font-bold text-accent-secondary">{total}</div>
                  <div className="text-xs text-text-faint">{lang === "ar" ? "مقال" : "Articles"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Search & Filter Bar ─── */}
        <div className="sticky top-16 z-20 border-b border-border bg-background/95 backdrop-blur-md">
          <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              {/* Search */}
              <div className="relative flex-1 md:max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
                <Input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={lang === "ar" ? "ابحث في المقالات..." : "Search articles..."}
                  className="pl-10 bg-primary border-border text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-foreground transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Mobile filter toggle */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-2 rounded-lg border border-border bg-primary px-3 py-2 text-sm text-text-muted hover:text-foreground md:hidden"
              >
                <Filter className="h-4 w-4" />
                {lang === "ar" ? "تصفية" : "Filter"}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showFilters ? "rotate-180" : ""}`} />
              </button>

              {/* Desktop category filter */}
              <div className="hidden md:flex md:items-center md:gap-2">
                <span className="text-xs text-text-faint">{lang === "ar" ? "الفئة:" : "Category:"}</span>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="rounded-lg border border-border bg-primary px-3 py-2 text-sm text-foreground focus:border-accent-secondary focus:outline-none focus:ring-1 focus:ring-accent-secondary"
                >
                  <option value="all">{lang === "ar" ? "كل الفئات" : "All categories"}</option>
                  {(categories || []).map((cat: string) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mobile category filter (collapsible) */}
            {showFilters && (
              <div className="mt-3 md:hidden">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedCategory("all")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      selectedCategory === "all"
                        ? "bg-[rgba(6,182,212,0.15)] text-accent-secondary border border-[rgba(6,182,212,0.3)]"
                        : "bg-primary text-text-faint border border-border hover:text-foreground"
                    }`}
                  >
                    {lang === "ar" ? "الكل" : "All"}
                  </button>
                  {(categories || []).map((cat: string) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        selectedCategory === cat
                          ? "bg-[rgba(6,182,212,0.15)] text-accent-secondary border border-[rgba(6,182,212,0.3)]"
                          : "bg-primary text-text-faint border border-border hover:text-foreground"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── Articles Grid ─── */}
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {isLoading ? (
            <ArticlesLoading lang={lang} />
          ) : items.length === 0 ? (
            <ArticlesEmpty lang={lang} hasFilter={hasFilter} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <ArticleCard key={item.id} item={item} lang={lang} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
