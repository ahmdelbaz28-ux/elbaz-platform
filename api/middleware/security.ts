import { createMiddleware } from "hono/factory";
import { env } from "../lib/env.js";
import { randomBytes } from "node:crypto";

export const securityMiddleware = createMiddleware(async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const path = c.req.path;
  const isApi = path.startsWith("/api/");
  const isAsset = path.match(/\.(js|css|png|jpg|svg|ico|woff2?|ttf|eot|webmanifest|webp|avif)$/);
  const accept = c.req.header("accept") ?? "";
  const wantsHtml = accept.includes("text/html");

  if (isApi) {
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
    c.header("Vary", "Authorization, Accept-Language, Accept-Encoding");
  } else if (isAsset) {
    // 🚀 PERFORMANCE: Don't set Cache-Control here — cacheMiddleware handles it.
    // This middleware runs first, but cacheMiddleware (registered before serveStatic)
    // will set the proper Cache-Control: immutable for assets.
    c.header("Vary", "Accept-Encoding");
  }

  if (wantsHtml && !isApi && !isAsset) {
    const nonce = randomBytes(16).toString("base64url");
    c.set("cspNonce", nonce);

    const cspDirectives = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net https://www.clarity.ms https://accounts.google.com https://oauth2.googleapis.com`,
      "worker-src 'self'",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://api.openrouter.ai https://*.aivencloud.com https://www.clarity.ms https://www.googleapis.com https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://accounts.google.com",
      "report-uri /api/csp-report",
    ].join("; ");

    c.header("Content-Security-Policy", cspDirectives);
    c.header("Report-To", JSON.stringify({
      group: "csp",
      max_age: 86400,
      endpoints: [{ url: "/api/csp-report" }],
    }));

    // Don't cache HTML pages (they contain dynamic nonces)
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
  } else if (!isApi) {
    // For API/assets, set a minimal CSP. Include 'unsafe-inline' in script-src
    // as a fallback for when Cloudflare CDN caches HTML responses (the cached
    // version may not have the per-request nonce). This is less secure than
    // nonce-based CSP but prevents the site from breaking on the custom domain.
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://www.clarity.ms https://accounts.google.com https://oauth2.googleapis.com",
      "worker-src 'self'",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://api.openrouter.ai https://*.aivencloud.com https://www.clarity.ms https://www.googleapis.com https://accounts.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://accounts.google.com",
      "report-uri /api/csp-report",
    ].join("; ");

    c.header("Content-Security-Policy", cspDirectives);
    c.header("Report-To", JSON.stringify({
      group: "csp",
      max_age: 86400,
      endpoints: [{ url: "/api/csp-report" }],
    }));
  }

  if (env.NODE_ENV === "production") {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }

  const method = c.req.method;

  const blockedPatterns = [
    /\.env/i,
    /\.git/i,
    /wp-admin/i,
    /wp-login/i,
    /phpmyadmin/i,
    /adminer/i,
    /\.bak$/i,
    /\.sql$/i,
    /\.log$/i,
    /\/proc\//i,
    /\/etc\//i,
  ];

  for (const pattern of blockedPatterns) {
    if (pattern.test(path)) {
      return c.json({ error: "Not Found" }, 404);
    }
  }

  if (method === "TRACE" || method === "TRACK" || method === "DEBUG") {
    return c.json({ error: "Method Not Allowed" }, 405);
  }

  const contentType = c.req.header("Content-Type") ?? "";
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    // CSP violation reports use application/csp-report or application/reports+json
    const isCspReport = path === "/api/csp-report";
    const allowedContentTypes = [
      "application/json",
      "multipart/form-data",
      "application/x-www-form-urlencoded",
      "application/csp-report",
      "application/reports+json",
    ];
    if (!isCspReport && !allowedContentTypes.some((t) => contentType.includes(t))) {
      return c.json({ error: "Unsupported Content-Type" }, 415);
    }
  }

  c.header("X-Request-ID", c.get("requestId") ?? crypto.randomUUID());

  await next();
});
