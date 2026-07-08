/**
 * SPA HTML HANDLER
 *
 * Serves index.html for browser navigation requests with:
 *   - CSP nonce injection (from shield middleware)
 *   - Public env vars injection (globalThis.__ENV__)
 *   - Build ID injection for cache-busting
 *   - Course count injection for JSON-LD structured data
 *
 * Registered BEFORE serveStatic so browser navigations (Accept: text/html)
 * get the nonce-injected HTML instead of the raw file. Non-HTML requests
 * (assets, API) fall through to serveStatic / API routes.
 *
 * Extracted from boot.ts to keep the main server file focused on routing.
 */

import { createMiddleware } from "hono/factory";

// ── HTML template cache ──
let cachedHtmlTemplate: string | null = null;
let cachedHtmlTemplateMtime = 0;

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

// ── Course count cache ──
let cachedCourseCount = 0;
let courseCountExpiry = 0;

async function getCourseCount(): Promise<number> {
  if (Date.now() > courseCountExpiry) {
    try {
      const { db } = await import("../queries/connection.js");
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

/**
 * SPA HTML handler middleware.
 *
 * For browser navigation requests, serves index.html with:
 *   - CSP nonce injected into <head> and inline <script> tags
 *   - globalThis.__ENV__ injected with public env vars + buildId
 *   - Course count injected for JSON-LD structured data
 *   - Cache-busting via %%CACHE_BUST%% placeholder replacement
 *
 * Non-HTML and API requests fall through to next().
 *
 * @param getBuildId - Getter function that returns the current buildId (captured by closure at request time)
 */
export function createSpaHandler(getBuildId: () => string | null) {
  return createMiddleware(async (c, next) => {
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
      html = html.replaceAll('"%%OFFER_COUNT%%"', `"${courseCount}"`);
      html = html.replaceAll("%%CACHE_BUST%%", process.env.BUILD_ID || "dev");

      if (nonce) {
        // Inject the nonce meta tag into <head>
        html = html.replace(
          /<head([^>]*)>/,
          `<head$1><meta name="csp-nonce" content="${nonce}">`
        );
        // Add nonce attribute to ALL inline <script> tags (those without src).
        html = html.replaceAll(/<script(?![^>]*\ssrc=)([^>]*)>/g,
          `<script nonce="${nonce}"$1>`
        );

        // Inject public env vars directly into HTML
        const { getPublicEnvKeys } = await import("./env.js");
        const publicEnv = getPublicEnvKeys();
        const currentBuildId = getBuildId();
      const envWithBuild = { ...publicEnv, buildId: currentBuildId || process.env.BUILD_ID || "dev" };
        const envScript = `<script nonce="${nonce}">globalThis.__ENV__=${JSON.stringify(envWithBuild)};</script>`;
        html = html.replace(
          /<meta name="csp-nonce"[^>]*>/,
          `$&${envScript}`
        );

        return c.html(html);
      }
      return c.html(html);
    } catch {
      // Aggressive cache-busting on this 404 — prevents CDN from caching it
      c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      c.header("Surrogate-Control", "no-store");
      c.header("Pragma", "no-cache");
      c.header("Expires", "0");
      return c.json({ error: "Not Found" }, 404);
    }
  });
}
