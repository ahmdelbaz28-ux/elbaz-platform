import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { logger as appLogger } from "./lib/logger.js";
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
    appLogger.info(`[Server] Build ID loaded: ${buildId}`);
  } catch {
    // Fallback for dev mode or if build-id.json is missing
    buildId = `runtime-${randomBytes(4).toString("hex")}`;
    appLogger.info(`[Server] No build-id.json found, using runtime ID: ${buildId}`);
  }
}

import { cacheMiddleware } from "./middleware/cache.js";
import { createSpaHandler } from "./lib/spa-handler.js";

declare const Bun: { serve: (opts: { fetch: (r: Request) => Response | Promise<Response>; port?: number; hostname?: string }) => { close: (cb?: () => void) => void } } | undefined;

type AppVariables = {
  cspNonce: string;
  requestId: string;
};

import { shieldMiddleware } from "./middleware/shield.js";
import { getClientIpFromHono } from "./lib/client-ip";

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
      { loc: `${baseUrl}/`, priority: "1", changefreq: "weekly", lastmod: now },
      { loc: `${baseUrl}/courses`, priority: "0.9", changefreq: "weekly", lastmod: now },
      { loc: `${baseUrl}/terms`, priority: "0.3", changefreq: "yearly", lastmod: now },
      { loc: `${baseUrl}/privacy`, priority: "0.3", changefreq: "yearly", lastmod: now },
      { loc: `${baseUrl}/refund`, priority: "0.3", changefreq: "yearly", lastmod: now },
    ];

    // Escape XML special characters in slugs to prevent XML injection
    const escapeXml = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&apos;");

    const courseUrls = publishedCourses.map((course) => ({
      loc: `${baseUrl}/courses/${escapeXml(course.slug)}`,
      priority: "0.8",
      changefreq: "monthly",
      lastmod: course.updatedAt ? course.updatedAt.toISOString().split("T")[0] : now,
    }));

    const allUrls = [...staticUrls, ...courseUrls];

    const xml = [
      '<?xml version="1" encoding="UTF-8"?>',
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
    appLogger.error("[Sitemap] Error generating sitemap", { error: err instanceof Error ? err.message : String(err) });
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
  // BUG FIX: was using .pop() which returns the LAST proxy IP, not the client.
  // Now uses unified getClientIpFromHono which correctly takes the first IP.
  const clientIp = getClientIpFromHono(c);
  // Private/internal CIDR ranges for the trust check. These are IANA
  // reserved blocks (RFC 1918) — they cannot be reached from the public
  // internet, so the values are intentionally hardcoded. NOSONAR —
  // reviewed against SonarCloud S1313.
  const internalRanges = ["127.1", "10/8", "172.16/12", "192.168/16", "::1"]; // NOSONAR
  const isInternal = internalRanges.some((range) => {
    if (!clientIp) return false;
    if (!range.includes("/")) return clientIp === range;
    const parts = range.split("/");
    const networkStr = parts[0];
    const cidrBits = Number.parseInt(parts[1], 10);
    const networkParts = networkStr.split(".").map(Number);
    const ipParts = clientIp.split(".").map(Number);
    if (networkParts.length !== 4 || ipParts.length !== 4 || networkParts.some(Number.isNaN) || ipParts.some(Number.isNaN)) {
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
    appLogger.warn("[CSP] Violation", { requestId, report });
  }

  // 204 No Content — no body allowed per RFC 7231
  return c.body(null, 204);
});

// ── No-cache headers for critical files (must come before serveStatic) ──
app.use("/*", cacheMiddleware);

// ── SPA route handler — MUST be before serveStatic ──────────────────────
// serveStatic would otherwise serve index.html directly for "/" and bypass
// our CSP nonce injection. By registering the wildcard HTML handler BEFORE
// serveStatic, browser navigations (Accept: text/html) are caught here and
// served with the nonce. Non-HTML requests (assets, API) fall through to
// serveStatic / API routes below.
// Pass a getter function so buildId is read at request time (after loadBuildId sets it), not at module eval time
app.use("*", createSpaHandler(() => buildId));

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

// ─────────────────────────────────────────────────────────────────────────────
// ROOT CAUSE FIX: notFound handler with aggressive cache-busting headers
// ─────────────────────────────────────────────────────────────────────────────
// Without this, Hono's default 404 response has NO Cache-Control headers.
// The HF Space CDN caches the bare 404 for several minutes, causing the
// "/api/* returns 404" outage that lasts well after the app is healthy.
//
// This handler:
//   1. Sets Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate
//   2. Sets Surrogate-Control: no-store (CDN-specific override — some CDNs
//      ignore Cache-Control but respect Surrogate-Control)
//   3. Sets Expires: 0 (HTTP/1.0 fallback)
//   4. Sets Pragma: no-cache
//   5. Returns JSON for /api/* routes (so tRPC clients get a parseable error)
//      and HTML for everything else (so SPA routes fall through to index.html)
app.notFound((c) => {
  const path = c.req.path;
  const isApi = path.startsWith("/api/");

  // Aggressive cache-busting headers on EVERY 404
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  c.header("Surrogate-Control", "no-store");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");

  if (isApi) {
    return c.json({ error: "Not Found", path }, 404);
  }

  // For non-API routes (SPA), return a minimal HTML that forces a reload.
  // This prevents the CDN from caching a bare 404 page for SPA routes.
  return c.html(
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="refresh" content="0; url=/">` +
    `<title>Loading...</title></head>` +
    `<body><script>location.replace('/');</script></body></html>`,
    404,
  );
});

app.onError(async (err, c) => {
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  appLogger.error(`Unhandled error [${requestId}]`, { error: err instanceof Error ? err.message : String(err) });

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

  // Aggressive cache-busting on all error responses — prevents CDN from
  // caching 500 errors and causing prolonged outages.
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  c.header("Surrogate-Control", "no-store");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");

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
    appLogger.warn("[Server] DB migration warning", { error: (err as Error).message });
  }

  try {
    await initRedis();
  } catch (err) {
    appLogger.warn("[Server] Redis unavailable, rate limiting disabled", { error: (err as Error).message });
  }

  // Detect Bun runtime. CRITICAL: must use `typeof Bun !== "undefined"`,
  // NOT `Bun?.serve` — `Bun` is not a declared global on Node.js, so any
  // direct reference (even with optional chaining) throws ReferenceError
  // and crashes the server at startup. The previous Biome auto-fix
  // (`useOptionalChain`) broke this and shipped to production — reverted.
  // NOSONAR — S7741: typeof guard is REQUIRED for undeclared globals;
  // comparing Bun === undefined directly throws ReferenceError.
  const isBunRuntime = typeof Bun !== "undefined"; // NOSONAR
  const useBun = isBunRuntime && typeof Bun.serve === "function"; // NOSONAR
  let server: { close: (cb?: () => void) => void } | undefined;

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

  appLogger.info(`[Server] Running on http://${env.HOST}:${env.PORT}`);
  appLogger.info(`[Server] Environment: ${env.NODE_ENV}`);
  appLogger.info(`[Server] Frontend: ${env.FRONTEND_URL}`);

  const shutdownHandler = async (signal: string) => {
    appLogger.info(`[Server] ${signal} received, shutting down...`);
    try {
      const { default: ElbazCache } = await import("../cache/index.js");
      ElbazCache.engine.destroy();
      ElbazCache.short.destroy();
      ElbazCache.long.destroy();
      ElbazCache.session.destroy();
    } catch {// Intentionally ignored: best-effort cleanup, the error has already
    // been logged upstream and re-throwing would mask the original cause.
    }
    server?.close(() => process.exit(0));
  };

  process.on("SIGTERM", () => shutdownHandler("SIGTERM"));
  process.on("SIGINT", () => shutdownHandler("SIGINT"));
}

try {
  await start();
} catch (err) {
  appLogger.error("[Server] Fatal startup error", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}

export { app };
