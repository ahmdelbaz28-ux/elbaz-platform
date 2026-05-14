import { createMiddleware } from "hono/factory";
import { env } from "../lib/env.js";
import { randomBytes } from "node:crypto";

/**
 * Security middleware — sets security headers and CSP with per-request nonce.
 *
 * The nonce is generated fresh for every HTML response and injected into the
 * CSP header. The frontend picks it up from a <meta> tag in index.html.
 */

export const securityMiddleware = createMiddleware(async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const path = c.req.path;
  const isApiOrAsset = path.startsWith("/api/") || path.match(/\.(js|css|png|jpg|svg|ico|woff2?|ttf|eot|webmanifest|webp|avif)$/);
  const accept = c.req.header("accept") ?? "";
  const wantsHtml = accept.includes("text/html");

  // Only generate nonce and set CSP for HTML page requests
  // API and static asset requests don't need nonces (saves CPU)
  if (wantsHtml && !isApiOrAsset) {
    const nonce = randomBytes(16).toString("base64url");
    c.set("cspNonce", nonce);

    const cspDirectives = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net https://www.clarity.ms`,
      "worker-src 'self'",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://api.openrouter.ai https://*.aivencloud.com https://www.clarity.ms",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "report-uri /api/csp-report",
      `report-to {"endpoints":[{"url":"/api/csp-report"}],"max_age":86400,"group":"csp"}`,
    ].join("; ");

    c.header("Content-Security-Policy", cspDirectives);

    // Don't cache HTML pages (they contain dynamic nonces)
    c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    c.header("Pragma", "no-cache");
  } else {
    // For API/assets, set a minimal CSP without nonces (no scripts expected)
    const cspDirectives = [
      "default-src 'self'",
      "worker-src 'self'",
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://api.openrouter.ai https://*.aivencloud.com https://www.clarity.ms",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "report-uri /api/csp-report",
      `report-to {"endpoints":[{"url":"/api/csp-report"}],"max_age":86400,"group":"csp"}`,
    ].join("; ");

    c.header("Content-Security-Policy", cspDirectives);
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
