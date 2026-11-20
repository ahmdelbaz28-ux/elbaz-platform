// ═══════════════════════════════════════════════════════════════════════════
// LH STATIC SERVER — faithful production-shape static server for clean
// Lighthouse measurement of the REAL domain semantics (canonical qzz.io,
// no HF canonical injection, no qzz.io edge challenge in the sandbox).
//
// Serves dist/public + the exact production edges Lighthouse touches:
//   /robots.txt   → byte-identical to the live dynamic route (captured live)
//   /sitemap.xml  → the built static sitemap
//   /api/version  → { buildId } so cache-nuke's version check behaves
//   /api/trpc/*   → valid 200 tRPC envelopes (no guest 401 console noise —
//                   sessionProbe answered {authenticated:false}, lists empty)
//   /api/csp-report → 204
//
// Usage: node scripts/lh_static_server.mjs [port]
// ═══════════════════════════════════════════════════════════════════════════
import http from "node:http";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const PORT = Number(process.argv[2] || 4199);
const ROOT = path.resolve(process.cwd(), "dist/public");

const ROBOTS = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /dashboard
Disallow: /profile
Disallow: /support
Disallow: /wishlist
Disallow: /journey
Disallow: /documents
Disallow: /admin
Disallow: /certificate/

# Explicitly welcome major search engines
User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

Sitemap: https://ahmedelbaz.qzz.io/sitemap.xml
`;

const MIME = {
  ".html": "text/html; charset=UTF-8",
  ".js": "text/javascript; charset=UTF-8",
  ".css": "text/css; charset=UTF-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml; charset=UTF-8",
  ".txt": "text/plain; charset=UTF-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".map": "application/json",
};

function trpcEnvelope(proc, body) {
  // Minimal valid tRPC v11 GET envelope — null/[] data keeps UI in its
  // loading/empty branches without throwing.
  return { result: { data: { json: body ?? null } } };
}

// Realistic fixtures (shapes mirror the live DB output) so the local
// Lighthouse run exercises the SAME pending→content swap as production.
const FIXTURES = {
  "course.categories": [
    { id: 1, slug: "etap", nameAr: "كورسات ETAP", nameEn: "ETAP Courses", descriptionAr: "تحليل ومحاكاة أنظمة القوى الكهربية من الصفر حتى الاحتراف.", descriptionEn: "Power system analysis from scratch to pro.", icon: "zap" },
    { id: 2, slug: "skm", nameAr: "كورسات SKM", nameEn: "SKM Courses", descriptionAr: "دراسات التدفق والقصر على البرنامج العالمي.", descriptionEn: "Load flow and short-circuit studies.", icon: "activity" },
    { id: 3, slug: "powerfactory", nameAr: "كورسات PowerFactory", nameEn: "PowerFactory Courses", descriptionAr: "محاكاة الشبكات والأنظمة الصناعية.", descriptionEn: "Grid and industrial simulation.", icon: "cpu" },
    { id: 4, slug: "pvsyst", nameAr: "كورسات PVSyst", nameEn: "PVSyst Courses", descriptionAr: "تصميم أنظمة الطاقة الشمسية الاحترافية.", descriptionEn: "Professional solar design.", icon: "sun" },
    { id: 5, slug: "panels", nameAr: "تصميم اللوحات", nameEn: "Panel Design", descriptionAr: "تصميم لوحات التوزيع والتحكم.", descriptionEn: "Distribution and control panels.", icon: "panel" },
    { id: 6, slug: "autocad", nameAr: "كورسات AutoCAD", nameEn: "AutoCAD Courses", descriptionAr: "الرسم الهندسي الكهربي باحتراف.", descriptionEn: "Electrical drafting.", icon: "pen" },
  ],
  "course.list": [1, 2, 3].map((i) => ({
    id: i,
    slug: `course-${i}`,
    titleAr: `كورس الهندسة الكهربية المتقدم ${i}`,
    titleEn: `Advanced Electrical Engineering ${i}`,
    shortDescAr: "شرح عملي شامل بالعربي مع تطبيقات ومشاريع حقيقية وشهادة موثقة.",
    shortDescEn: "Hands-on course with real projects.",
    categoryName: "ETAP",
    categoryNameAr: "كورسات ETAP",
    thumbnail: "/course-etap.jpg",
    price: 500,
    originalPrice: 999,
    isPremium: true,
    level: "advanced",
    durationHours: 20,
    rating: 4.9,
    reviewCount: 120,
    studentCount: 850,
  })),
  "course.testimonials": [
    { id: 1, name: "م. محمد علي", content: "شرح ممتاز وواضح، أفضل كورس ETAP بالعربي شفته.", rating: 5, certificateNumber: "EB-2024-001" },
    { id: 2, name: "م. سارة حسن", content: "المحتوى عملي جداً وساعدني في شغلي الفعلي.", rating: 5, certificateNumber: null },
    { id: 3, name: "م. أحمد سمير", content: "الدعم متجاوب والاستاذ يشرح من القلب.", rating: 5, certificateNumber: null },
  ],
  "course.stats": { totalStudents: 3200, totalCourses: 6, satisfactionRate: 98 },
  "articles.list": [],
  "settings.getActivePromotions": [],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=UTF-8", "Cache-Control": "public, max-age=3600" });
      return res.end(ROBOTS);
    }
    if (p === "/api/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ buildId: "lh-local-0000", version: "lh" }));
    }
    if (p === "/api/csp-report" || p === "/api/telemetry") {
      res.writeHead(204);
      return res.end();
    }
    if (p.startsWith("/api/trpc/")) {
      const proc = p.replace("/api/trpc/", "").split("?")[0];
      // auth.sessionProbe must answer 200 with authenticated:false (guest) —
      // exactly the console-silent probe contract. Known procs get realistic
      // fixtures so the homepage exercises the same pending→content swap as
      // production; everything else: nulls.
      let body;
      if (proc.endsWith("sessionProbe")) body = { authenticated: false };
      else {
        const key = Object.keys(FIXTURES).find((k) => proc === k || proc.startsWith(k));
        body = key ? FIXTURES[key] : null;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(trpcEnvelope(proc, body)));
    }

    // ── static files ──
    let file = p === "/" ? "/index.html" : p;
    // SPA routes → index.html with placeholder replacement (like spa-handler)
    const looksAsset = /\.(js|css|html?|png|jpg|jpeg|svg|ico|woff2?|ttf|eot|webmanifest|webp|avif|gif|map|txt|xml|json|mp4)$/.test(p);
    if (looksAsset) {
      const data = await readFile(path.join(ROOT, file));
      const ext = path.extname(file);
      const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
      if (/\.(js|css|woff2|png|jpg|jpeg|webp|svg|mp4)$/.test(ext)) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      } else if (ext === ".html") {
        headers["Cache-Control"] = "no-cache, must-revalidate";
      }
      if (/\.(js|css|html|xml|txt|webmanifest)$/.test(ext)) {
        headers["Content-Encoding"] = "gzip";
        return res.writeHead(200, headers).end(gzipSync(data));
      }
      return res.writeHead(200, headers).end(data);
    }

    // SPA navigation → index.html
    let html = await readFile(path.join(ROOT, "index.html"), "utf-8");
    html = html.replaceAll("%%CACHE_BUST%%", "lh-local-0000").replaceAll('"%%OFFER_COUNT%%"', '"6"');
    res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache, must-revalidate", "Content-Encoding": "gzip" });
    return res.end(gzipSync(Buffer.from(html)));
  } catch (err) {
    if (!/ENOENT/.test(String(err))) console.error("[lh-static]", p, String(err).slice(0, 120));
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("not found");
  }
});

server.listen(PORT, () => console.log(`[lh-static] serving dist/public at http://localhost:${PORT}`));
