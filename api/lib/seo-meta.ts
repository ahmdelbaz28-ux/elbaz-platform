/**
 * SEO META MODULE — Server-side per-route meta generation
 *
 * The frontend is a React SPA: every route is served the same index.html,
 * which historically carried ONE static set of meta tags (title/description/
 * canonical pointing at "/") for ALL routes. Google mostly indexes the raw
 * HTML it fetches, so every deep route looked like a duplicate of the home
 * page — a serious indexing/ranking problem.
 *
 * This module gives the SPA handler real per-route SEO:
 *   - Bilingual (Arabic-first) title + description + keywords per route
 *   - Exact canonical URL per route (also emitted as a `Link` HTTP header to
 *     fight the HuggingFace Spaces injected `rel=canonical` header that
 *     points at huggingface.co — that header actively tells Google NOT to
 *     index the custom domain)
 *   - Rich JSON-LD per route: WebSite(+SearchAction), ItemList, Course,
 *     BreadcrumbList, FAQPage (data pulled live from the DB, cached)
 *   - `noindex` + X-Robots-Tag for private/utility routes
 *
 * Everything degrades gracefully: if the DB is unreachable we fall back to
 * sensible static meta so pages are never broken by SEO logic.
 */

import { logger as appLogger } from "./logger.js";

export interface RouteSeo {
  /** <title> text (Arabic-first, bilingual) */
  title: string;
  /** meta description (~150-200 chars) */
  description: string;
  /** meta keywords (minor engines; Google ignores) */
  keywords?: string;
  /** og:type */
  ogType: "website" | "article";
  /** exact canonical URL (base + path, no query) */
  canonical: string;
  /** robots directive — default "index, follow" */
  robots?: string;
  /** Optional route-specific social image (e.g. course thumbnail) */
  ogImage?: string;
  /** JSON-LD objects to inject for this route */
  jsonLd: object[];
}

const BASE_URL = "https://ahmedelbaz.qzz.io";

const BRAND_SUFFIX = " | م. أحمد الباز — Eng Ahmed Elbaz";

// ─────────────────────────────────────────────────────────────────────────────
// Route classification
// ─────────────────────────────────────────────────────────────────────────────

/** Routes that must NEVER be indexed (private / utility / thin content).
 *  NOTE: "/verify" (certificate verification landing page) stays indexable —
 *  only individual certificate results (/verify/:number) are noindexed. */
const NOINDEX_ROUTES = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/dashboard",
  "/profile",
  "/support",
  "/wishlist",
  "/journey",
  "/documents",
  "/admin",
  "/certificate",
]);

/**
 * Every valid SPA route. Anything NOT listed here (and not matching a
 * dynamic pattern) gets HTTP 404 + the SPA HTML, so React still renders
 * the NotFound page for humans while Google correctly sees a 404 —
 * eliminating an infinite soft-404 duplicate space.
 */
const STATIC_ROUTES = new Set([
  "/",
  "/courses",
  "/references",
  "/faq",
  "/verify",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/terms",
  "/privacy",
  "/refund",
  "/dashboard",
  "/profile",
  "/support",
  "/wishlist",
  "/journey",
  "/documents",
  "/admin",
]);

const DYNAMIC_ROUTE_PATTERNS: RegExp[] = [
  /^\/courses\/[^/]+$/,
  /^\/certificate\/[^/]+$/,
  /^\/verify\/[^/]+$/,
];

/** Is this path a real SPA route? (unknown paths → 404 status) */
export function isKnownSpaRoute(path: string): boolean {
  if (STATIC_ROUTES.has(path)) return true;
  return DYNAMIC_ROUTE_PATTERNS.some((re) => re.test(path));
}

/** Should this path be kept out of search indexes? */
export function isNoindexPath(path: string): boolean {
  if (NOINDEX_ROUTES.has(path)) return true;
  return /^\/certificate\/[^/]+$/.test(path) || /^\/verify\/[^/]+$/.test(path);
}

/**
 * The exact robots directive for a noindex path.
 * Private user areas also block link-following; auth pages keep follow.
 */
export function robotsDirectiveFor(path: string): string {
  const privateStrict = new Set([
    "/dashboard",
    "/profile",
    "/support",
    "/wishlist",
    "/journey",
    "/documents",
    "/admin",
  ]);
  if (privateStrict.has(path)) return "noindex, nofollow";
  if (/^\/certificate\/[^/]+$/.test(path) || /^\/verify\/[^/]+$/.test(path)) {
    return "noindex, nofollow";
  }
  return "noindex, follow";
}

// ─────────────────────────────────────────────────────────────────────────────
// Static route meta definitions
// ─────────────────────────────────────────────────────────────────────────────

interface StaticMeta {
  title: string;
  description: string;
  keywords: string;
}

const ROUTE_META: Record<string, StaticMeta> = {
  "/": {
    title: "م. أحمد الباز | كورسات الهندسة الكهربية ETAP و SKM — Eng Ahmed Elbaz",
    description:
      "كورسات احترافية في الهندسة الكهربية: ETAP، SKM، PowerFactory، PVSyst وتصميم اللوحات — شرح عملي بالعربي، شهادات موثقة، ووصول مدى الحياة. Professional electrical engineering courses.",
    keywords:
      "م أحمد الباز, كورسات كهربية, كورس ETAP, كورس SKM, PowerFactory, PVSyst, هندسة قوى كهربية, electrical engineering courses, Ahmed Elbaz, كورسات هندسة اونلاين",
  },
  "/courses": {
    title: `جميع الكورسات والكورسات المجانية${BRAND_SUFFIX}`,
    description:
      "تصفح جميع كورسات الهندسة الكهربية: ETAP، SKM PowerFactory، DIgSILENT، PVSyst وتصميم اللوحات الكهربية — كورسات مجانية ومميزة بجودة عالية مع شهادات موثقة.",
    keywords:
      "كورسات كهربية مجانية, كورس ETAP بالعربي, كورس SKM PowerFactory, كورس PVSyst, كورسات هندسة القوى, electrical courses online",
  },
  "/references": {
    title: `المراجع الهندسية والملفات المجانية${BRAND_SUFFIX}`,
    description:
      "مكتبة مراجع هندسية مجانية: كتب وملفات وموارد تعليمية في الهندسة الكهربية وأنظمة القوى الكهربية ومحطات المحولات — تحميل مباشر ومجاني.",
    keywords:
      "مراجع هندسة كهربية, كتب هندسة كهربية pdf, ملفات هندسية, مراجع قوى كهربية, مراجع ETAP SKM مجانا",
  },
  "/faq": {
    title: `الأسئلة الشائعة حول الكورسات والشهادات${BRAND_SUFFIX}`,
    description:
      "إجابات على أكثر الأسئلة شيوعاً حول الكورسات والمدفوعات والشهادات والوصول للمحتوى والدعم الفني في منصة م. أحمد الباز للهندسة الكهربية.",
    keywords:
      "أسئلة شائعة, كيف اشترك في الكورس, شهادة موثقة, طرق الدفع, فودافون كاش, انستاباي, دعم فني",
  },
  "/verify": {
    title: `التحقق من صحة الشهادات${BRAND_SUFFIX}`,
    description:
      "تحقق من صحة شهادات كورسات م. أحمد الباز عبر رقم الشهادة — خدمة تحقق فورية ومجانية لأصحاب العمل والجهات المعنية.",
    keywords: "التحقق من الشهادات, شهادة موثقة, certificate verification",
  },
  "/terms": {
    title: `الشروط والأحكام${BRAND_SUFFIX}`,
    description:
      "الشروط والأحكام الخاصة باستخدام منصة م. أحمد الباز: حقوق الاستخدام، سياسة الحسابات، والالتزامات المتبادلة بين المنصة والمستخدم.",
    keywords: "الشروط والأحكام, terms of service",
  },
  "/privacy": {
    title: `سياسة الخصوصية${BRAND_SUFFIX}`,
    description:
      "سياسة الخصوصية الخاصة بمنصة م. أحمد الباز: البيانات التي نجمعها، كيف نستخدمها، وكيف نحمي خصوصية مستخدمي المنصة.",
    keywords: "سياسة الخصوصية, privacy policy",
  },
  "/refund": {
    title: `سياسة الاسترداد والاسترجاع${BRAND_SUFFIX}`,
    description:
      "سياسة الاسترداد الخاصة بمنصة م. أحمد الباز: حالات استرداد قيمة الكورسات، مدة الاسترجاع، وخطوات تقديم طلب الاسترداد.",
    keywords: "سياسة الاسترداد, استرجاع أموال, refund policy",
  },
};

/** Titles for private/noindex routes (kept short). */
const PRIVATE_TITLES: Record<string, string> = {
  "/login": `تسجيل الدخول${BRAND_SUFFIX}`,
  "/register": `إنشاء حساب جديد${BRAND_SUFFIX}`,
  "/forgot-password": `استعادة كلمة المرور${BRAND_SUFFIX}`,
  "/reset-password": `إعادة تعيين كلمة المرور${BRAND_SUFFIX}`,
  "/verify-email": `تأكيد البريد الإلكتروني${BRAND_SUFFIX}`,
  "/dashboard": `لوحة التحكم${BRAND_SUFFIX}`,
  "/profile": `الملف الشخصي${BRAND_SUFFIX}`,
  "/support": `الدعم الفني${BRAND_SUFFIX}`,
  "/wishlist": `قائمة المفضلة${BRAND_SUFFIX}`,
  "/journey": `رحلة التعلم${BRAND_SUFFIX}`,
  "/documents": `مستنداتي${BRAND_SUFFIX}`,
  "/admin": `لوحة الإدارة${BRAND_SUFFIX}`,
};

const HOME_FALLBACK = ROUTE_META["/"];

// ─────────────────────────────────────────────────────────────────────────────
// DB-backed lookups (courses for /courses/*, FAQs for /faq) — cached
// ─────────────────────────────────────────────────────────────────────────────

interface CourseRow {
  slug: string;
  titleEn: string;
  titleAr: string;
  shortDescEn: string | null;
  shortDescAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  level: string;
  isPremium: boolean;
  price: string;
  currency?: string;
  durationHours: number;
  rating: string;
  reviewCount: number;
  studentCount: number;
  thumbnail: string | null;
  updatedAt: Date | null;
}

let courseCache: { bySlug: Map<string, CourseRow>; all: CourseRow[]; expiry: number } = {
  bySlug: new Map(),
  all: [],
  expiry: 0,
};

async function loadCourses(): Promise<void> {
  if (Date.now() < courseCache.expiry) return;
  try {
    const { db } = await import("../queries/connection.js");
    const { courses } = await import("@db/schema");
    const { eq, asc } = await import("drizzle-orm");
    const rows = await db
      .select({
        slug: courses.slug,
        titleEn: courses.titleEn,
        titleAr: courses.titleAr,
        shortDescEn: courses.shortDescEn,
        shortDescAr: courses.shortDescAr,
        descriptionEn: courses.descriptionEn,
        descriptionAr: courses.descriptionAr,
        level: courses.level,
        isPremium: courses.isPremium,
        price: courses.price,
        durationHours: courses.durationHours,
        rating: courses.rating,
        reviewCount: courses.reviewCount,
        studentCount: courses.studentCount,
        thumbnail: courses.thumbnail,
        updatedAt: courses.updatedAt,
      })
      .from(courses)
      .where(eq(courses.isPublished, true))
      .orderBy(asc(courses.sortOrder));

    courseCache = {
      bySlug: new Map(rows.map((r) => [r.slug, r])),
      all: rows,
      expiry: Date.now() + 5 * 60 * 1000,
    };
  } catch (err) {
    // Keep previous cache on error; extend TTL briefly to avoid hammering a
    // failing DB on every request.
    courseCache.expiry = Date.now() + 30 * 1000;
    appLogger.warn("[SEO] Failed to load courses for meta", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

interface FaqRow {
  questionEn: string;
  questionAr: string;
  answerEn: string;
  answerAr: string;
}

let faqCache: { items: FaqRow[]; expiry: number } = { items: [], expiry: 0 };

async function loadFaqs(): Promise<void> {
  if (Date.now() < faqCache.expiry) return;
  try {
    const { db } = await import("../queries/connection.js");
    const { faqEntries } = await import("@db/schema");
    const { eq, asc } = await import("drizzle-orm");
    const rows = await db
      .select({
        questionEn: faqEntries.questionEn,
        questionAr: faqEntries.questionAr,
        answerEn: faqEntries.answerEn,
        answerAr: faqEntries.answerAr,
      })
      .from(faqEntries)
      .where(eq(faqEntries.isPublished, true))
      .orderBy(asc(faqEntries.sortOrder))
      .limit(30);
    faqCache = { items: rows, expiry: Date.now() + 5 * 60 * 1000 };
  } catch (err) {
    faqCache.expiry = Date.now() + 30 * 1000;
    appLogger.warn("[SEO] Failed to load FAQs for meta", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-LD builders
// ─────────────────────────────────────────────────────────────────────────────

function stripHtml(text: string, maxLen = 300): string {
  const clean = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1).trimEnd()}…` : clean;
}

function buildWebSiteJsonLd(): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "منصة م. أحمد الباز — Eng Ahmed Elbaz",
    alternateName: ["Ahmed Elbaz Courses", "منصة أحمد الباز للهندسة الكهربية"],
    url: `${BASE_URL}/`,
    inLanguage: ["ar", "en"],
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${BASE_URL}/courses?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

function buildCourseItemListJsonLd(all: CourseRow[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "كورسات الهندسة الكهربية — م. أحمد الباز",
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: all.length,
    itemListElement: all.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${BASE_URL}/courses/${encodeURIComponent(c.slug)}`,
      name: c.titleAr || c.titleEn,
    })),
  };
}

function buildBreadcrumbJsonLd(items: { name: string; url: string }[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function buildCourseJsonLd(c: CourseRow): object {
  const priceNum = Number.parseFloat(c.price || "0");
  const name = c.titleAr || c.titleEn;
  const description =
    stripHtml(c.shortDescAr || c.descriptionAr || c.shortDescEn || c.descriptionEn || "", 280) ||
    `كورس ${name} مع م. أحمد الباز — شرح عملي احترافي بالعربي مع شهادة موثقة.`;
  return {
    "@context": "https://schema.org",
    "@type": "Course",
    name,
    alternateName: c.titleEn,
    description,
    url: `${BASE_URL}/courses/${encodeURIComponent(c.slug)}`,
    image: c.thumbnail ? new URL(c.thumbnail, BASE_URL).toString() : `${BASE_URL}/logo.png`,
    inLanguage: ["ar", "en"],
    educationalLevel: c.level,
    provider: {
      "@type": "EducationalOrganization",
      name: "منصة م. أحمد الباز",
      url: `${BASE_URL}/`,
    },
    instructor: {
      "@type": "Person",
      name: "م. أحمد الباز",
      jobTitle: "Power Systems Engineer",
      url: `${BASE_URL}/`,
    },
    offers: {
      "@type": "Offer",
      category: c.isPremium ? "Paid" : "Free",
      price: c.isPremium ? priceNum.toFixed(2) : "0",
      priceCurrency: "EGP",
      availability: "https://schema.org/InStock",
      url: `${BASE_URL}/courses/${encodeURIComponent(c.slug)}`,
    },
    ...(Number(c.rating) > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Number(c.rating),
            reviewCount: Math.max(c.reviewCount, 1),
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
    ...(c.durationHours > 0
      ? {
          timeRequired: `PT${c.durationHours}H`,
        }
      : {}),
    hasCourseInstance: {
      "@type": "CourseInstance",
      courseMode: "online",
      courseWorkload: c.durationHours > 0 ? `PT${c.durationHours}H` : undefined,
    },
  };
}

function buildFaqPageJsonLd(items: FaqRow[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.questionAr || f.questionEn,
      acceptedAnswer: {
        "@type": "Answer",
        text: stripHtml(f.answerAr || f.answerEn, 900),
      },
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route → SEO resolution
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve SEO metadata for a SPA route path (no query string). */
export async function resolveRouteSeo(path: string): Promise<RouteSeo> {
  const canonical = `${BASE_URL}${path === "/" ? "/" : path}`;

  // Course detail pages — pull live data from DB
  const courseMatch = path.match(/^\/courses\/([^/]+)$/);
  if (courseMatch) {
    const slug = decodeURIComponent(courseMatch[1]);
    await loadCourses();
    const course = courseCache.bySlug.get(slug);
    if (course) {
      const name = course.titleAr || course.titleEn;
      const description =
        stripHtml(
          course.shortDescAr || course.descriptionAr || course.shortDescEn || course.descriptionEn || "",
          300
        ) || HOME_FALLBACK.description;
      return {
        title: `${name}${BRAND_SUFFIX}`,
        description,
        keywords: `${name}, ${course.titleEn}, كورس ${name}, ${course.level}, م أحمد الباز`,
        ogType: "article",
        canonical,
        ogImage: course.thumbnail
          ? new URL(course.thumbnail, BASE_URL).toString()
          : `${BASE_URL}/og-image.png`,
        jsonLd: [
          buildCourseJsonLd(course),
          buildBreadcrumbJsonLd([
            { name: "الرئيسية", url: `${BASE_URL}/` },
            { name: "الكورسات", url: `${BASE_URL}/courses` },
            { name, url: canonical },
          ]),
        ],
      };
    }
    // Unknown course slug → let the SPA render; use courses meta as fallback.
  }

  // Courses listing — ItemList from DB
  if (path === "/courses") {
    await loadCourses();
    const meta = ROUTE_META["/courses"];
    return {
      title: meta.title,
      description: meta.description,
      keywords: meta.keywords,
      ogType: "website",
      canonical,
      jsonLd:
        courseCache.all.length > 0
          ? [buildCourseItemListJsonLd(courseCache.all)]
          : [],
    };
  }

  // FAQ — FAQPage JSON-LD from DB
  if (path === "/faq") {
    await loadFaqs();
    const meta = ROUTE_META["/faq"];
    return {
      title: meta.title,
      description: meta.description,
      keywords: meta.keywords,
      ogType: "website",
      canonical,
      jsonLd: faqCache.items.length > 0 ? [buildFaqPageJsonLd(faqCache.items)] : [],
    };
  }

  // Home — WebSite (+SearchAction) on top of the static Organization data
  if (path === "/") {
    const meta = HOME_FALLBACK;
    return {
      title: meta.title,
      description: meta.description,
      keywords: meta.keywords,
      ogType: "website",
      canonical,
      jsonLd: [buildWebSiteJsonLd()],
    };
  }

  // Private / utility routes → noindex with simple titles
  if (isNoindexPath(path)) {
    return {
      title: PRIVATE_TITLES[path] ?? `منصة م. أحمد الباز`,
      description: "هذه الصفحة خاصة بمستخدمي المنصة ولا تُفهرس في محركات البحث.",
      ogType: "website",
      canonical,
      robots: robotsDirectiveFor(path),
      jsonLd: [],
    };
  }

  // Remaining static public routes (references, terms, privacy, refund)
  const staticMeta = ROUTE_META[path];
  if (staticMeta) {
    return {
      title: staticMeta.title,
      description: staticMeta.description,
      keywords: staticMeta.keywords,
      ogType: "website",
      canonical,
      jsonLd: [],
    };
  }

  // Fallback (unknown course slug etc.) — indexable default
  return {
    title: HOME_FALLBACK.title,
    description: HOME_FALLBACK.description,
    ogType: "website",
    canonical,
    jsonLd: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML rewriting
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Rewrite the served SPA HTML with per-route SEO data:
 * title, description, keywords, canonical, OG, Twitter, robots, JSON-LD.
 * Optionally injects search-engine verification meta tags when the
 * corresponding env vars are configured.
 */
export function applySeoToHtml(
  html: string,
  seo: RouteSeo,
  opts: { noindex: boolean; verifications: { google?: string; bing?: string } }
): string {
  let out = html;
  const robots = opts.noindex ? (seo.robots ?? "noindex, follow") : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
  const title = escapeHtmlAttr(seo.title);
  const description = escapeHtmlAttr(seo.description);
  const canonical = escapeHtmlAttr(seo.canonical);

  // 1. <title>
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`);

  // 2. description (replace the first/primary one; also the lang="ar" variant)
  if (/<meta\s+name="description"/i.test(out)) {
    out = out.replace(
      /<meta\s+name="description"([^>]*)\/?>/i,
      `<meta name="description" content="${description}" />`
    );
    out = out.replace(
      /<meta\s+name="description"\s+lang="ar"([^>]*)\/?>/i,
      `<meta name="description" lang="ar" content="${description}" />`
    );
  } else {
    out = out.replace("</head>", `  <meta name="description" content="${description}" />\n  </head>`);
  }

  // 3. keywords
  if (seo.keywords) {
    const kw = escapeHtmlAttr(seo.keywords);
    if (/<meta\s+name="keywords"/i.test(out)) {
      out = out.replace(/<meta\s+name="keywords"([^>]*)\/?>/i, `<meta name="keywords" content="${kw}" />`);
    } else {
      out = out.replace("</head>", `  <meta name="keywords" content="${kw}" />\n  </head>`);
    }
  }

  // 4. robots
  if (/<meta\s+name="robots"/i.test(out)) {
    out = out.replace(
      /<meta\s+name="robots"([^>]*)\/?>/i,
      `<meta name="robots" content="${robots}" />`
    );
  } else {
    out = out.replace("</head>", `  <meta name="robots" content="${robots}" />\n  </head>`);
  }

  // 5. canonical
  if (/<link\s+rel="canonical"/i.test(out)) {
    out = out.replace(
      /<link\s+rel="canonical"([^>]*)\/?>/i,
      `<link rel="canonical" href="${canonical}" />`
    );
  } else {
    out = out.replace("</head>", `  <link rel="canonical" href="${canonical}" />\n  </head>`);
  }

  // 6. Twitter
  const tw = (name: string, content: string) => {
    const re = new RegExp(`<meta\\s+(?:property|name)="${name}"([^>]*)/?>`, "i");
    if (re.test(out)) {
      out = out.replace(re, `<meta name="${name}" content="${content}" />`);
    } else {
      out = out.replace("</head>", `  <meta name="${name}" content="${content}" />\n  </head>`);
    }
  };

  // 7. Open Graph
  const og = (property: string, content: string) => {
    const re = new RegExp(`<meta\\s+property="${property}"([^>]*)/?>`, "i");
    if (re.test(out)) {
      out = out.replace(re, `<meta property="${property}" content="${content}" />`);
    } else {
      out = out.replace("</head>", `  <meta property="${property}" content="${content}" />\n  </head>`);
    }
  };
  og("og:title", title);
  og("og:description", description);
  og("og:url", canonical);
  og("og:type", seo.ogType);
  if (seo.ogImage) {
    og("og:image", escapeHtmlAttr(seo.ogImage));
    tw("twitter:image", escapeHtmlAttr(seo.ogImage));
  }

  tw("twitter:title", title);
  tw("twitter:description", description);

  // 8. Verification meta tags (Google Search Console / Bing Webmaster)
  if (opts.verifications.google) {
    out = out.replace(
      "</head>",
      `  <meta name="google-site-verification" content="${escapeHtmlAttr(opts.verifications.google)}" />\n  </head>`
    );
  }
  if (opts.verifications.bing) {
    out = out.replace(
      "</head>",
      `  <meta name="msvalidate.01" content="${escapeHtmlAttr(opts.verifications.bing)}" />\n  </head>`
    );
  }

  // 9. Per-route JSON-LD. SECURITY (audit run-1, seo-meta.jsonld.*): the HTML
  // parser terminates <script> at the first literal "</script" regardless of
  // JS string context, and JSON.stringify does not escape '<'. Stored DB
  // fields (course titles, FAQ questions) feed these objects, so the payload
  // must be script-context-safe: escape '<', '>' and U+2028/2029 so no
  // markup can terminate or leave the script data element.
  if (seo.jsonLd.length > 0) {
    const ldScripts = seo.jsonLd
      .map((obj) => `<script type="application/ld+json" data-route-jsonld="true">${jsonLdSafeStringify(obj)}</script>`)
      .join("\n    ");
    out = out.replace("</head>", `  ${ldScripts}\n  </head>`);
  }

  return out;
}

/** JSON.stringify with script-context-safe escaping (no '</script' breakout). */
export function jsonLdSafeStringify(obj: unknown): string {
  return JSON.stringify(obj)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

// ─────────────────────────────────────────────────────────────────────────────
// robots.txt
// ─────────────────────────────────────────────────────────────────────────────

/** Build robots.txt — allow public site, block private areas, declare sitemap. */
export function buildRobotsTxt(): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /dashboard",
    "Disallow: /profile",
    "Disallow: /support",
    "Disallow: /wishlist",
    "Disallow: /journey",
    "Disallow: /documents",
    "Disallow: /admin",
    "Disallow: /certificate/",
    "",
    "# Explicitly welcome major search engines",
    "User-agent: Googlebot",
    "Allow: /",
    "",
    "User-agent: Bingbot",
    "Allow: /",
    "",
    `Sitemap: ${BASE_URL}/sitemap.xml`,
    "",
  ].join("\n");
}

export const SEO_BASE_URL = BASE_URL;
