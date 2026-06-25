import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { env } from "./lib/env.js";
import { initRedis } from "./lib/rate-limiter.js";
import { healthRouter } from "./health-router.js";
import { promoRouter } from "./promo-router.js";
import { paymobWebhook } from "./paymob-webhook.js";
import { chatbotRouter } from "./chatbot-router.js";
import { googleAuthRouter } from "./google-auth-router.js";
import { securityMiddleware } from "./middleware/security.js";
import { createContext } from "./context.js";
import { appRouter } from "./router.js";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { ensureDatabase } from "./lib/db-init.js";
import { randomBytes } from "node:crypto";

/**
 * Build ID — loaded from build-id.json at startup.
 * Changes on every deploy, used by cache-nuke.js to detect new versions.
 * Falls back to a runtime-generated ID if the file doesn't exist (dev mode).
 */
let buildId: string | null = null;

async function loadBuildId() {
  try {
    const { readFile } = await import("node:fs/promises");
    const content = await readFile("./dist/public/build-id.json", "utf-8");
    const data = JSON.parse(content);
    buildId = data.buildId;
    console.log(`[Server] Build ID loaded: ${buildId}`);
  } catch {
    // Fallback for dev mode or if build-id.json is missing
    buildId = `runtime-${randomBytes(4).toString("hex")}`;
    console.log(`[Server] No build-id.json found, using runtime ID: ${buildId}`);
  }
}

/**
 * Critical file names that must never be cached by the browser.
 * These files are always served with Cache-Control: no-cache, no-store.
 * - sw.js: Service Worker itself — must be fresh for update checks
 * - cache-nuke.js: version detector — must be fresh to detect new deploys
 * - clarity.js / pii-mask.js: analytics — should always be latest
 * - rtl-detect.js: early detection — must be fresh
 * - build-id.json: build identifier — cache-nuke reads this via /api/version
 */
const NO_CACHE_FILES = new Set([
  "sw.js",
  "sw.js.map",
  "workbox-*.js",
  "workbox-*.js.map",
  "cache-nuke.js",
  "clarity.js",
  "pii-mask.js",
  "rtl-detect.js",
  "build-id.json",
]);

/**
 * Middleware: Set Cache-Control: no-cache for critical files.
 * Placed BEFORE serveStatic so it runs for matching requests.
 */
import { createMiddleware } from "hono/factory";
const noCacheMiddleware = createMiddleware(async (c, next) => {
  const url = new URL(c.req.url);
  const filename = url.pathname.split("/").pop() || "";

  const isNoCache = NO_CACHE_FILES.has(filename) ||
    filename.startsWith("workbox-");

  if (isNoCache) {
    c.header("Cache-Control", "no-cache, no-store, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
  }

  await next();
});

declare const Bun: { serve: (opts: { fetch: (r: Request) => Response | Promise<Response>; port?: number; hostname?: string }) => { close: (cb?: () => void) => void } } | undefined;

type AppVariables = {
  cspNonce: string;
  requestId: string;
};

import { shieldMiddleware } from "./middleware/shield.js";

const app = new Hono<{ Variables: AppVariables }>({ strict: false });

app.use("*", logger());
app.use("*", shieldMiddleware); // 🛡️ Elite Shield: First line of defense
app.use("*", securityMiddleware);


const corsOrigins = env.CORS_ORIGINS
  ? env.CORS_ORIGINS.split(",").map((o) => o.trim())
  : [env.FRONTEND_URL];

app.use(
  "*",
  cors({
    origin: corsOrigins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Auth-Token",
      "X-Request-ID",
      "X-Forwarded-For",
    ],
    exposeHeaders: ["X-Request-ID"],
    maxAge: 86400,
    credentials: true,
  })
);

// ── Health endpoints at /api/health, /api/ready, /api/live ──
app.route("/api", healthRouter);
app.route("/api/promo", promoRouter);
app.route("/api/paymob", paymobWebhook);
app.route("/api/chatbot", chatbotRouter);
app.route("/api/google-auth", googleAuthRouter);

// ── tRPC handler at /api/trpc ──
// Authentication is handled per-procedure (publicQuery vs authedQuery)
app.all("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    router: appRouter,
    req: c.req.raw,
    endpoint: "/api/trpc",
    createContext: createContext as never,
  });
});

// ── API version endpoint (used by cache-nuke.js for cache invalidation) ──
// Returns buildId which changes on every deploy, triggering cache clear.
app.get("/api/version", (c) => {
  return c.json({
    version: process.env.npm_package_version ?? "unknown",
    buildId: buildId ?? "unknown",
    stage: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── Public env endpoint (used by frontend to get GOOGLE_CLIENT_ID, etc.) ──
// Dedicated endpoint so the frontend doesn't have to parse /api/health.
// Returns only safe, public keys — never secrets.
app.get("/api/env", async (c) => {
  const { getPublicEnvKeys } = await import("./lib/env.js");
  return c.json(getPublicEnvKeys());
});

// ── Dynamic Sitemap ──
// Generates sitemap.xml from live DB data so URLs + lastmod are always accurate.
// Cached for 1 hour to avoid DB query on every request.
let cachedSitemap: string | null = null;
let sitemapExpiry = 0;

export function invalidateSitemapCache(): void {
  cachedSitemap = null;
  sitemapExpiry = 0;
}

app.get("/sitemap.xml", async (c) => {
  if (cachedSitemap && Date.now() < sitemapExpiry) {
    c.header("Content-Type", "application/xml; charset=UTF-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(cachedSitemap);
  }

  try {
    const { db } = await import("./queries/connection.js");
    const { courses } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");

    const publishedCourses = await db
      .select({
        slug: courses.slug,
        updatedAt: courses.updatedAt,
      })
      .from(courses)
      .where(eq(courses.isPublished, true))
      .orderBy(courses.sortOrder);

    const baseUrl = env.FRONTEND_URL.replace(/\/$/, "");
    const now = new Date().toISOString().split("T")[0];

    const staticUrls = [
      { loc: `${baseUrl}/`, priority: "1.0", changefreq: "weekly", lastmod: now },
      { loc: `${baseUrl}/courses`, priority: "0.9", changefreq: "weekly", lastmod: now },
      { loc: `${baseUrl}/terms`, priority: "0.3", changefreq: "yearly", lastmod: now },
      { loc: `${baseUrl}/privacy`, priority: "0.3", changefreq: "yearly", lastmod: now },
      { loc: `${baseUrl}/refund`, priority: "0.3", changefreq: "yearly", lastmod: now },
    ];

    // Escape XML special characters in slugs to prevent XML injection
    const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

    const courseUrls = publishedCourses.map((course) => ({
      loc: `${baseUrl}/courses/${escapeXml(course.slug)}`,
      priority: "0.8",
      changefreq: "monthly",
      lastmod: course.updatedAt ? course.updatedAt.toISOString().split("T")[0] : now,
    }));

    const allUrls = [...staticUrls, ...courseUrls];

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...allUrls.map((u) =>
        `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      ),
      '</urlset>',
    ].join("\n");

    cachedSitemap = xml;
    sitemapExpiry = Date.now() + 60 * 60 * 1000; // Cache for 1 hour

    c.header("Content-Type", "application/xml; charset=UTF-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(xml);
  } catch (err) {
    console.error("[Sitemap] Error generating sitemap:", err);
    // Fallback: serve static file
    try {
      const { readFile } = await import("node:fs/promises");
      const staticSitemap = await readFile("./dist/public/sitemap.xml", "utf-8");
      c.header("Content-Type", "application/xml; charset=UTF-8");
      return c.body(staticSitemap);
    } catch {
      return c.json({ error: "Sitemap unavailable" }, 503);
    }
  }
});

// ── Webhook status (internal) ──
app.get("/__webhook/status", async (c) => {
  const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",").pop()?.trim() || "";
  const internalRanges = ["127.0.0.1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "::1"];
  const isInternal = internalRanges.some((range) => {
    if (!clientIp) return false;
    if (!range.includes("/")) return clientIp === range;
    const parts = range.split("/");
    const networkStr = parts[0];
    const cidrBits = parseInt(parts[1], 10);
    const networkParts = networkStr.split(".").map(Number);
    const ipParts = clientIp.split(".").map(Number);
    if (networkParts.length !== 4 || ipParts.length !== 4 || networkParts.some(isNaN) || ipParts.some(isNaN)) {
      return clientIp === range;
    }
    const ipNum = ((ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3]) >>> 0;
    const netNum = ((networkParts[0] << 24) | (networkParts[1] << 16) | (networkParts[2] << 8) | networkParts[3]) >>> 0;
    const mask = cidrBits > 0 ? (~((1 << (32 - cidrBits)) - 1)) >>> 0 : 0 >>> 0;
    return (ipNum & mask) === (netNum & mask);
  });

  if (env.NODE_ENV === "production" && !isInternal) {
    return c.json({ error: "Not Found" }, 404);
  }

  return c.json({
    status: "operational",
    timestamp: new Date().toISOString(),
    services: {
      api: "running",
      database: "connected",
    },
  }, 200);
});

// ── CSP Violation Report Endpoint ──
// CSP report-uri sends POST with application/csp-report or application/reports+json
app.post("/api/csp-report", async (c) => {
  let report: unknown;
  try {
    report = await c.req.json();
  } catch {
    return c.body(null, 204);
  }

  if (env.NODE_ENV === "production") {
    const requestId = c.get("requestId") ?? crypto.randomUUID();
    console.warn("[CSP][%s] Violation:", requestId, JSON.stringify(report));
  }

  // 204 No Content — no body allowed per RFC 7231
  return c.body(null, 204);
});

// ── No-cache headers for critical files (must come before serveStatic) ──
app.use("/*", noCacheMiddleware);

// ── SPA route handler — MUST be before serveStatic ──────────────────────
// serveStatic would otherwise serve index.html directly for "/" and bypass
// our CSP nonce injection. By registering the wildcard HTML handler BEFORE
// serveStatic, browser navigations (Accept: text/html) are caught here and
// served with the nonce. Non-HTML requests (assets, API) fall through to
// serveStatic / API routes below.
// Caches the HTML template + course count to avoid disk/DB reads on every page load
let cachedHtmlTemplate: string | null = null;
let cachedHtmlTemplateMtime = 0;
let cachedCourseCount = 0;
let courseCountExpiry = 0;

async function getHtmlTemplate(): Promise<string> {
  try {
    const { stat, readFile } = await import("node:fs/promises");
    const filePath = "./dist/public/index.html";
    const fileStat = await stat(filePath);
    if (fileStat.mtimeMs !== cachedHtmlTemplateMtime) {
      cachedHtmlTemplate = await readFile(filePath, "utf-8");
      cachedHtmlTemplateMtime = fileStat.mtimeMs;
    }
  } catch {
    if (!cachedHtmlTemplate) {
      throw new Error("index.html not found");
    }
  }
  return cachedHtmlTemplate!;
}

async function getCourseCount(): Promise<number> {
  if (Date.now() > courseCountExpiry) {
    try {
      const { db } = await import("./queries/connection.js");
      const { courses } = await import("@db/schema");
      const { count, eq } = await import("drizzle-orm");
      const result = await db
        .select({ count: count() })
        .from(courses)
        .where(eq(courses.isPublished, true));
      cachedCourseCount = Number(result[0]?.count ?? 0);
    } catch {
      // Keep previous value on error
    }
    courseCountExpiry = Date.now() + 5 * 60 * 1000; // Refresh every 5 minutes
  }
  return cachedCourseCount;
}

// HTML route handler — registered BEFORE serveStatic so it wins for "/"
// and all SPA routes. Implemented as a MIDDLEWARE (not a route handler)
// because we need to call next() to fall through to serveStatic for
// non-HTML requests (static assets, API calls). Route handlers in Hono
// can only respond or 404 — they can't fall through.
app.use("*", async (c, next) => {
  const accept = c.req.header("accept") ?? "";
  const wantsHtml = accept.includes("text/html");
  const path = c.req.path;

  // Skip if this isn't a browser navigation request
  if (!wantsHtml) {
    return next(); // → serveStatic handles static assets
  }

  // Skip API routes
  if (path.startsWith("/api/")) {
    return next();
  }

  // Skip requests that look like static assets (even if Accept: text/html
  // is present, which can happen with some browsers/prefetchers)
  if (path.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?|ttf|eot|webmanifest|webp|avif|gif|map|txt|xml|json)$/)) {
    return next();
  }

  try {
    let html = await getHtmlTemplate();
    const nonce = c.get("cspNonce") as string | undefined;

    const courseCount = await getCourseCount();
    html = html.replace(/"%%OFFER_COUNT%%"/g, `"${courseCount}"`);
    html = html.replace(/%%CACHE_BUST%%/g, process.env.BUILD_ID || "dev");

    if (nonce) {
      // Inject the nonce meta tag into <head>
      html = html.replace(
        /<head([^>]*)>/,
        `<head$1><meta name="csp-nonce" content="${nonce}">`
      );
      // Add nonce attribute to ALL inline <script> tags (those without src).
      // This prevents CSP "script-src-elem" violations for inline scripts.
      // External scripts (with src=) are unaffected — allowed via 'self'.
      html = html.replace(
        /<script(?![^>]*\ssrc=)([^>]*)>/g,
        `<script nonce="${nonce}"$1>`
      );
      return c.html(html);
    }
    return c.html(html);
  } catch {
    return c.json({ error: "Not Found" }, 404);
  }
});

// ── Static frontend files from dist/public ──
// Serves JS/CSS/image assets. index.html is already handled by the wildcard
// route above, so this only handles actual static files.
app.use(
  "/*",
  serveStatic({
    root: "./dist/public",
    rewriteRequestPath: (path) => path,
  })
);

app.onError(async (err, c) => {
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  console.error(`[${requestId}] Unhandled error:`, err);

  // 🧠 Elite AI Diagnosis: Analyze the crash in background
  if (env.NODE_ENV === "production") {
    import("./lib/ai-diagnostics.js").then(({ diagnoseError }) => {
      diagnoseError(err, `Request ID: ${requestId} | Path: ${c.req.path}`);
    });
  }

  if (env.SENTRY_DSN && env.NODE_ENV === "production") {
    const { captureException } = await import("./lib/sentry.js");
    captureException(err, { tags: { requestId } });
  }

  return c.json(
    {
      error: env.NODE_ENV === "production" ? "Internal Server Error" : err.message,
      requestId,
    },
    500
  );
});


async function start() {
  // ── Load build ID from build-id.json ──
  await loadBuildId();

  // ── Auto-migrate database on startup ──
  try {
    await ensureDatabase();
  } catch (err) {
    console.warn("[Server] DB migration warning:", (err as Error).message);
  }

  try {
    await initRedis();
  } catch (err) {
    console.warn("[Server] Redis unavailable, rate limiting disabled:", (err as Error).message);
  }

  const useBun = typeof Bun !== "undefined" && Bun?.serve;
  let server;

  if (useBun) {
    server = Bun.serve({
      fetch: app.fetch,
      port: env.PORT,
      hostname: env.HOST,
    });
  } else {
    const { serve } = await import("@hono/node-server");
    server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST });
  }

  console.log(`[Server] Running on http://${env.HOST}:${env.PORT}`);
  console.log(`[Server] Environment: ${env.NODE_ENV}`);
  console.log(`[Server] Frontend: ${env.FRONTEND_URL}`);

  process.on("SIGTERM", () => {
    console.log("[Server] SIGTERM received, shutting down...");
    try {
      import("../cache/index.js").then(({ default: ElbazCache }) => {
        ElbazCache.engine.destroy();
        ElbazCache.short.destroy();
        ElbazCache.long.destroy();
        ElbazCache.session.destroy();
      });
    } catch {}
    server.close(() => process.exit(0));
  });

  process.on("SIGINT", () => {
    console.log("[Server] SIGINT received, shutting down...");
    try {
      import("../cache/index.js").then(({ default: ElbazCache }) => {
        ElbazCache.engine.destroy();
        ElbazCache.short.destroy();
        ElbazCache.long.destroy();
        ElbazCache.session.destroy();
      });
    } catch {}
    server.close(() => process.exit(0));
  });
}

start().catch((err) => {
  console.error("[Server] Fatal startup error:", err);
  process.exit(1);
});

export { app };
