import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "@/hooks/useTranslation";
import { trpc } from "@/providers/trpc";
import Seo from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Loader2, Clock, Eye, ArrowRight, Newspaper, User } from "lucide-react";

/* ── Helpers ── */

/**
 * Safe text renderer — converts plain-text blocks into JSX (no raw HTML).
 * Supported markers: "## heading", "- list item", blank-line paragraph splits.
 */
function renderContent(content: string, isRTL: boolean): ReactNode {
  const blocks = content.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block, bi) => {
    if (block.startsWith("##")) {
      const heading = block.replace(/^#+\s*/, "");
      return (
        <h2 key={bi} className="mt-8 mb-3 text-xl font-bold text-foreground md:text-2xl">
          {heading}
        </h2>
      );
    }
    if (block.split("\n").every((line) => line.trim().startsWith("-"))) {
      const items = block.split("\n").map((l) => l.replace(/^-\s*/, "").trim()).filter(Boolean);
      return (
        <ul key={bi} className={`mt-3 mb-4 space-y-2 ${isRTL ? "pr-5" : "pl-5"} list-disc text-text-muted`}>
          {items.map((li, lii) => (
            <li key={lii} className="leading-relaxed">{li}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={bi} className="mb-4 leading-loose text-text-muted">
        {block}
      </p>
    );
  });
}

const DETAIL_AR_DATE = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", year: "numeric" });
const DETAIL_EN_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

function fmtDate(value: Date | string | null, lang: "ar" | "en"): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  return lang === "ar" ? DETAIL_AR_DATE.format(d) : DETAIL_EN_DATE.format(d);
}

/* ── Main Component ── */

export default function ArticleDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { lang } = useTranslation();
  const isRTL = lang === "ar";

  const { data: article, isLoading, error } = trpc.articles.getBySlug.useQuery(
    { slug: slug ?? "" },
    { enabled: Boolean(slug), retry: false },
  );

  // Tags parsed once — comma-separated string in DB.
  const tags = useMemo(() => {
    const raw = (article as { tags?: string | null } | null | undefined)?.tags;
    if (!raw) return [] as string[];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }, [article]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background pt-20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-9 w-9 animate-spin text-accent-secondary" />
          <p className="text-xs text-text-faint">{lang === "ar" ? "جارٍ فتح المقال..." : "Opening article..."}</p>
        </div>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background pt-20 text-center">
        <Newspaper className="mb-5 h-12 w-12 text-border" />
        <h1 className="text-xl font-semibold text-foreground">
          {lang === "ar" ? "المقال غير متاح" : "Article unavailable"}
        </h1>
        <p className="mt-2 max-w-sm text-sm text-text-faint">
          {lang === "ar" ? "ربما تم حذف المقال أو أنه غير منشور بعد — يمكنك العودة لقائمة المقالات" : "The article may have been removed or is not published yet — you can go back to the articles list"}
        </p>
        <Button asChild className="mt-6 bg-gradient-to-r from-accent-secondary to-accent-secondary/80 text-background font-semibold">
          <Link to="/articles">
            <ArrowRight className="h-4 w-4 rotate-180" />
            <span className="ml-1.5">{lang === "ar" ? "عودة للمقالات" : "Back to articles"}</span>
          </Link>
        </Button>
      </div>
    );
  }

  const a = article as {
    slug: string;
    titleAr: string;
    titleEn: string;
    excerptAr: string | null;
    excerptEn: string | null;
    contentAr: string;
    contentEn: string | null;
    coverImage: string | null;
    category: string;
    authorName: string | null;
    viewCount: number;
    readMinutes: number;
    publishedAt: Date | string | null;
  };

  const title = isRTL ? a.titleAr : a.titleEn;
  const excerpt = (isRTL ? a.excerptAr : a.excerptEn) || a.excerptAr || a.excerptEn || "";
  const content = (isRTL ? a.contentAr : a.contentEn) || a.contentAr;

  return (
    <>
      <Seo
        title={`${title} | منصة الباز`}
        description={excerpt || ""}
      />

      <div className="min-h-screen bg-background pt-20" dir={isRTL ? "rtl" : "ltr"}>
        {/* ─── Hero ─── */}
        <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-[rgba(6,182,212,0.08)] to-[rgba(8,145,178,0.04)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(6,182,212,0.12),transparent_60%)]" />
          <div className="relative mx-auto max-w-4xl px-4 py-12 sm:px-6">
            {/* Breadcrumb */}
            <div className="mb-6 flex items-center gap-2 text-xs text-text-faint">
              <Link to="/articles" className="hover:text-accent-secondary transition-colors">
                {lang === "ar" ? "المقالات" : "Articles"}
              </Link>
              <span>/</span>
              <span className="rounded-full bg-accent-secondary/10 px-2 py-0.5 font-medium text-accent-secondary">{a.category}</span>
            </div>

            <h1 className="mb-4 text-3xl font-bold leading-snug text-foreground md:text-4xl">
              {title}
            </h1>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-text-faint">
              <span className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {a.authorName || (isRTL ? "فريق المنصة" : "Platform Team")}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {isRTL ? `${a.readMinutes} دقائق قراءة` : `${a.readMinutes} min read`}
              </span>
              <span className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                {a.viewCount} {isRTL ? "مشاهدة" : "views"}
              </span>
              <span>{fmtDate(a.publishedAt, lang)}</span>
            </div>
          </div>
        </div>

        {/* ─── Cover ─── */}
        {a.coverImage && (
          <div className="mx-auto max-w-4xl px-4 pt-8 sm:px-6">
            <div className="overflow-hidden rounded-2xl border border-border">
              <img src={a.coverImage} alt={title} className="w-full object-cover max-h-[420px]" />
            </div>
          </div>
        )}

        {/* ─── Content ─── */}
        <article className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
          {excerpt && (
            <div className="mb-8 rounded-xl border border-border bg-primary p-5 text-sm leading-relaxed text-text-muted">
              {excerpt}
            </div>
          )}

          <div className="text-[15px]" dir={isRTL ? "rtl" : "ltr"}>
            {renderContent(content, isRTL)}
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="mt-10 flex flex-wrap gap-2 border-t border-border pt-6">
              {tags.map((tag) => (
                <span key={tag} className="rounded-full border border-border bg-primary px-3 py-1 text-xs text-text-muted">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Back link */}
          <div className="mt-10 flex justify-center">
            <Button asChild variant="outline" className="border-border bg-primary text-foreground hover:text-accent-secondary">
              <Link to="/articles">
                <ArrowRight className="h-4 w-4 rotate-180" />
                <span className="ml-1.5">{lang === "ar" ? "كل المقالات" : "All articles"}</span>
              </Link>
            </Button>
          </div>
        </article>
      </div>
    </>
  );
}
