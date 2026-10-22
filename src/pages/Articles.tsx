import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import Seo from "@/components/SEO";
import { Input } from "@/components/ui/input";
import { Loader2, X, Search, Clock, Eye, Newspaper, PenLine } from "lucide-react";

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

const AR_DATE = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric" });
const EN_DATE = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });

function fmtDate(value: Date | string | null, lang: "ar" | "en"): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return lang === "ar" ? AR_DATE.format(d) : EN_DATE.format(d);
}

/* ── Article Card ── */

function ArticleCard({ item, lang }: { readonly item: ArticleListItem; readonly lang: "ar" | "en" }) {
  const title = lang === "ar" ? item.titleAr : item.titleEn;
  const excerpt = (lang === "ar" ? item.excerptAr : item.excerptEn) || (lang === "ar" ? item.excerptEn : item.excerptAr) || "";

  return (
    <Link
      to={`/articles/${encodeURIComponent(item.slug)}`}
      className="group flex flex-col rounded-xl border border-border bg-primary p-5 transition-all duration-200 hover:border-[rgba(6,182,212,0.35)] hover:shadow-[0_8px_32px_rgba(6,182,212,0.06)]"
    >
      {item.coverImage && (
        <div className="mb-4 aspect-[16/8] overflow-hidden rounded-lg border border-border">
          <img src={item.coverImage} alt={title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        </div>
      )}

      <div className="mb-2 flex items-center gap-2 text-[11px]">
        <span className="rounded-full bg-accent-secondary/10 px-2 py-0.5 font-medium text-accent-secondary">{item.category}</span>
        <span className="flex items-center gap-1 text-text-faint">
          <Clock className="h-3 w-3" />
          {lang === "ar" ? `${item.readMinutes} دقائق` : `${item.readMinutes} min`}
        </span>
      </div>

      <h3 className="mb-1 line-clamp-2 text-base font-semibold text-foreground group-hover:text-accent-secondary transition-colors">
        {title}
      </h3>

      {excerpt && (
        <p className="mb-3 line-clamp-3 text-xs leading-relaxed text-text-faint">{excerpt}</p>
      )}

      <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-text-faint">
        <span className="flex items-center gap-1"><PenLine className="h-3 w-3" />{item.authorName || (lang === "ar" ? "فريق المنصة" : "Platform Team")}</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{item.viewCount}</span>
          <span>{fmtDate(item.publishedAt, lang)}</span>
        </span>
      </div>
    </Link>
  );
}

/* ── Main Component ── */

export default function Articles() {
  const { lang } = useTranslation();
  const isRTL = lang === "ar";
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState("all");

  // ─── Queries ───
  const { data, isLoading } = trpc.articles.list.useQuery({
    category: activeCat,
    search: search || undefined,
  });
  const { data: cats } = trpc.articles.categories.useQuery();

  const items = (data?.items ?? []) as ArticleListItem[];
  const total = data?.total ?? 0;
  const categoryList = ["all", ...(cats ?? [])];
  const catLabel = (c: string) => (c === "all" ? (isRTL ? "الكل" : "All") : c);
  const filtering = Boolean(search) || activeCat !== "all";

  // ─── Render ───
  return (
    <>
      <Seo
        title={isRTL ? "المقالات | منصة الباز" : "Articles | Elbaz Platform"}
        description={
          isRTL
            ? "مقالات هندسية متخصصة — تحليل أنظمة القدرة، برامج المحاكاة الكهربائية مثل ETAP وPowerFactory، ودروس تطبيقية للمهندسين"
            : "Specialized engineering articles — power system analysis, electrical simulation software like ETAP and PowerFactory, and practical lessons for engineers"
        }
      />

      <div className="min-h-screen bg-background pt-20">
        {/* ─── Hero ─── */}
        <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-[rgba(6,182,212,0.08)] to-[rgba(8,145,178,0.04)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(6,182,212,0.12),transparent_60%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[rgba(6,182,212,0.3)] bg-[rgba(6,182,212,0.08)] px-3 py-1 text-[11px] font-medium text-accent-secondary">
              <Newspaper className="h-3.5 w-3.5" />
              {isRTL ? "قسم المقالات الهندسية" : "Engineering Blog"}
            </div>
            <h1 className="text-3xl font-bold text-foreground md:text-4xl">
              {isRTL ? "المقالات الهندسية" : "Engineering Articles"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-text-muted md:text-base">
              {isRTL
                ? "مقالات متخصصة في الهندسة الكهربائية وأنظمة القدرة — تحليلات معمقة، أدلة استخدام لبرامج المحاكاة، ومشاريع تطبيقية ترفع مستواك الهندسي."
                : "Specialized electrical engineering articles — in-depth analyses, simulation software guides, and hands-on projects to level up your engineering skills."}
            </p>
          </div>
        </div>

        {/* ─── Search & Category Chips ─── */}
        <div className="sticky top-16 z-20 border-b border-border bg-background/95 backdrop-blur-md">
          <div className="mx-auto max-w-7xl space-y-3 px-4 py-4 sm:px-6 lg:px-8">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              <Input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isRTL ? "ابحث في المقالات..." : "Search articles..."}
                className="border-border bg-primary pl-10 text-foreground placeholder:text-text-faint focus:border-accent-secondary focus:ring-accent-secondary"
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label={isRTL ? "مسح البحث" : "Clear search"} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-foreground transition-colors">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {categoryList.map((c) => (
                <button
                  key={c}
                  onClick={() => setActiveCat(c)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-all ${
                    activeCat === c
                      ? "bg-accent-secondary text-background shadow-[0_2px_12px_rgba(6,182,212,0.3)]"
                      : "border border-border bg-primary text-text-muted hover:border-accent-secondary/40 hover:text-foreground"
                  }`}
                >
                  {catLabel(c)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ─── Articles Grid ─── */}
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-28">
              <Loader2 className="h-9 w-9 animate-spin text-accent-secondary" />
              <p className="text-xs text-text-faint">{isRTL ? "لحظة من فضلك..." : "One moment..."}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="py-28 text-center">
              <Newspaper className="mx-auto mb-5 h-12 w-12 text-border" />
              <h3 className="text-lg font-semibold text-foreground">
                {filtering ? (isRTL ? "لا مقالات مطابقة" : "No matching articles") : (isRTL ? "لا مقالات منشورة بعد" : "Nothing published yet")}
              </h3>
              <p className="mt-2 text-sm text-text-faint">
                {filtering ? (isRTL ? "جرب كلمة بحث أخرى أو فئة مختلفة" : "Try another keyword or category") : (isRTL ? "تابعنا — مقالات جديدة قادمة قريباً" : "Stay tuned — new articles are coming soon")}
              </p>
            </div>
          ) : (
            <>
              <p className="mb-4 text-xs text-text-faint">
                {isRTL ? `${total} مقال` : `${total} article${total === 1 ? "" : "s"}`}
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                  <ArticleCard key={item.id} item={item} lang={lang} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
