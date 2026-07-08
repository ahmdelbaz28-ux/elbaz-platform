/**
 * CACHE MIDDLEWARE
 *
 * Sets Cache-Control headers based on file type.
 * - Hashed assets (assets/*.js, *.css) → 1 year cache (immutable)
 * - Images (png, jpg, webp, svg, etc.) → 1 year cache
 * - Fonts (woff2, ttf, etc.) → 1 year cache
 * - Critical files (sw.js, cache-nuke.js, etc.) → no-cache (must be fresh)
 * - HTML pages → no-cache (handled by the SPA HTML handler)
 *
 * Extracted from boot.ts to keep the main server file focused on routing.
 */

import { createMiddleware } from "hono/factory";

// Files that must NEVER be cached (always fetch fresh)
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

// File extensions that get 1-year cache (immutable, content-hashed)
const LONG_CACHE_EXTENSIONS = new Set([
  // JS/CSS with content hashes
  "js", "css", "mjs",
  // Images
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico",
  // Fonts
  "woff", "woff2", "ttf", "eot", "otf",
  // Other static
  "json", "xml", "txt", "webmanifest", "map",
]);

/**
 * Hono middleware that sets Cache-Control headers based on file type.
 * Must be registered BEFORE serveStatic so it runs for matching requests.
 */
export const cacheMiddleware = createMiddleware(async (c, next) => {
  const url = new URL(c.req.url);
  const pathname = url.pathname;
  const filename = pathname.split("/").pop() || "";
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  // Critical files: no-cache (must always be fresh)
  const isNoCache = NO_CACHE_FILES.has(filename) ||
    filename.startsWith("workbox-");

  if (isNoCache) {
    c.header("Cache-Control", "no-cache, no-store, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Expires", "0");
  } else if (LONG_CACHE_EXTENSIONS.has(ext) && pathname.startsWith("/assets/")) {
    // 🚀 Hashed assets in /assets/ → 1 year cache (immutable)
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  } else if (LONG_CACHE_EXTENSIONS.has(ext)) {
    // 🚀 Other static files (images, fonts in /public/) → 1 year cache
    c.header("Cache-Control", "public, max-age=31536000, immutable");
  }

  await next();
});
