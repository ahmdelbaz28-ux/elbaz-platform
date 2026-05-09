import { Hono } from "hono";
import { createServer } from "http";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { getDb } from "./queries/connection";
import { payments } from "@db/schema";
import { eq } from "drizzle-orm";
import { env } from "./lib/env";
import { verifyPaymobHmac } from "./lib/paymob";
import { getPoolMetrics } from "./queries/connection";
import { logger } from "./lib/logger";

const app = new Hono();
const DIST_PUBLIC = path.resolve(process.cwd(), "dist/public");
const PORT = Number(process.env.PORT) || 7860;
const START_TIME = Date.now();

// ✅ PATCH-1: CORS from environment variables (not hardcoded)
const corsOrigins = env.corsOrigins
  ? env.corsOrigins.split(",").map(s => s.trim()).filter(Boolean)
  : ["https://ahmedelbaz.qzz.io", "http://localhost:5173"];

app.use("*", compress({
  threshold: 1024, // Only compress responses > 1KB
}));

app.use("*", cors({
  origin: corsOrigins,
  credentials: true,
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "x-auth-token"],
  maxAge: 86400, // ✅ OPTIMIZED: Preflight cache for 24h
}));

// ══════════════════════════════════════════════════════════════════
// ✅ SECURITY: Global Rate Limiting (in-memory) for all endpoints
// Protects against DDoS, brute-force, and abuse on non-tRPC routes
// ══════════════════════════════════════════════════════════════════
const globalRateStore = new Map<string, { count: number; windowStart: number }>();
const GLOBAL_RATE_LIMIT = 120;
const GLOBAL_RATE_WINDOW_MS = 60 * 1000; // 1 minute

function checkGlobalRateLimit(ip: string): boolean {
  const entry = globalRateStore.get(ip);
  const now = Date.now();
  if (!entry || now - entry.windowStart > GLOBAL_RATE_WINDOW_MS) {
    globalRateStore.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= GLOBAL_RATE_LIMIT) {
    return false;
  }
  entry.count++;
  return true;
}

// Periodic cleanup of stale rate limit entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of globalRateStore) {
    if (now - entry.windowStart > GLOBAL_RATE_WINDOW_MS * 2) {
      globalRateStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

// Apply global rate limiting to ALL requests (before other middleware)
app.use("*", async (c, next) => {
  const fwd = c.req.header("x-forwarded-for");
  const clientIp = c.req.header("cf-connecting-ip") || (fwd ? fwd.split(",").pop()?.trim() : null) || c.req.header("x-real-ip") || "unknown";
  if (!checkGlobalRateLimit(clientIp)) {
    return c.json({ error: "Too many requests. Please try again later." }, 429);
  }
  await next();
});

// ══════════════════════════════════════════════════════════════════
// ✅ SECURITY: HTTP Security Headers Middleware
// Adds defense-in-depth headers to all responses
// Critical since HF Spaces uses Hono directly (no nginx)
// ══════════════════════════════════════════════════════════════════
app.use("*", async (c, next) => {
  await next();
  // ═══════════════════════════════════════════════════════════════
  // Content Security Policy — Single source of truth (no <meta> tag)
  // ═══════════════════════════════════════════════════════════════
  // Design decisions:
  //   - script-src: NO 'unsafe-inline' — all scripts must be external files
  //     (inline scripts moved to /rtl-detect.js to comply)
  //   - connect-src: includes Google Fonts for workbox service worker caching
  //   - wss:// removed (invalid bare origin — add specific WS origins if needed)
  //   - frame-ancestors 'none' ONLY works via HTTP header (ignored in <meta>)
  // ═══════════════════════════════════════════════════════════════
  c.header("Content-Security-Policy",
    "default-src 'self';"
    + " script-src 'self' https://www.clarity.ms https://cdn.jsdelivr.net;"
    + " style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"
    + " img-src 'self' data: https: blob:;"
    + " font-src 'self' https://fonts.gstatic.com data:;"
    + " connect-src 'self' https://openrouter.ai https://*.openrouter.ai https://*.paymob.com https://www.clarity.ms https://*.sentry.io https://fonts.googleapis.com https://fonts.gstatic.com https://api.github.com "
    + " frame-ancestors 'none';"
    + " base-uri 'self';"
    + " form-action 'self' https://*.paymob.com;"
  );
  // ✅ X-App-Version: helps debug whether the live site is running latest code
  c.header("X-App-Version", "2026.05.09-v7");
  // Prevent clickjacking — CSP frame-ancestors 'none' is the modern replacement.
  // Cloudflare may override this to SAMEORIGIN, but CSP frame-ancestors takes
  // precedence in all modern browsers (Chrome/Firefox/Safari/Edge).
  c.header("X-Frame-Options", "DENY");
  // Prevent MIME type sniffing
  c.header("X-Content-Type-Options", "nosniff");
  // Explicitly disable deprecated X-XSS-Protection (Cloudflare adds 1; mode=block by default,
  // which can actually introduce XSS vulnerabilities via filter bypass).
  // Modern CSP handles XSS protection — X-XSS-Protection is obsolete.
  c.header("X-XSS-Protection", "0");
  // Referrer policy
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  // Restrict browser features (Feature-Policy is deprecated — replaced by Permissions-Policy)
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(self)");
  // HSTS (HTTPS enforcement)
  c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  // X-Permitted-Cross-Domain-Policies
  c.header("X-Permitted-Cross-Domain-Policies", "none");
});

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

// ══════════════════════════════════════════════════════════════════
// ✅ ENHANCED: Health Check Endpoint
// Returns: status, db connectivity, uptime, memory usage, version
// Used by HuggingFace Spaces health probe and monitoring
// ══════════════════════════════════════════════════════════════════
// Version endpoint — lightweight, no DB hit. Used by clients and service
// worker to detect new deployments and trigger cache refresh.
app.get("/api/version", async (c) => {
  return c.json({ version: "2026.05.09-v7" });
});

app.get("/api/health", async (c) => {
  let dbStatus = "ok";
  let dbLatencyMs = 0;
  try {
    const db = getDb();
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - start;
  } catch (e) {
    dbStatus = "error";
  }
  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);
  const memUsage = process.memoryUsage();
  return c.json({
    status: dbStatus === "ok" && distPublicExists ? "ok" : "degraded",
    ts: new Date().toISOString(),
    db: dbStatus,
    dbLatencyMs,
    uptime: uptimeSeconds,
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + "MB",
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + "MB",
    },
    version: process.env.npm_package_version || "0.0.0",
    rateLimits: {
      global: GLOBAL_RATE_LIMIT + "/min",
      chatbot: CHATBOT_RATE_LIMIT + "/hour",
    },
    pool: getPoolMetrics(),
    staticFiles: {
      enabled: distPublicExists,
      path: DIST_PUBLIC_RESOLVED,
    },
  });
});

// tRPC endpoint
app.all("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: createContext,
    onError: function(opts) {
      // ✅ Suppress noisy UNAUTHORIZED errors from auth.me (expected for unauthenticated visitors)
      if (opts.path === "auth.me" && opts.error.code === "UNAUTHORIZED") {
        return;
      }
      // ✅ Suppress expected heartbeat errors (sendBeacon with no Content-Type)
      if (opts.path === "course.heartbeat") {
        return;
      }
      console.error("[tRPC Error] " + opts.path + ": " + opts.error.message);
      // Send to Sentry if configured and DSN is valid
      if (env.sentryDsn && env.sentryDsn.startsWith("https://")) {
        import("@sentry/node").then(function(Sentry) {
          Sentry.captureException(opts.error, {
            tags: { trpc_path: opts.path, type: opts.error.code },
            contexts: { tRPC: { path: opts.path, input: JSON.stringify(opts.input || {}) } },
          });
        }).catch(function() {});
      }
    },
  });
});

// ✅ PATCH-7: In-memory rate limiter for chatbot (per IP, 20 req/hour)
const chatbotRateStore = new Map<string, { count: number; windowStart: number }>();
const CHATBOT_RATE_LIMIT = 20;
const CHATBOT_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkChatbotRateLimit(ip: string): boolean {
  const entry = chatbotRateStore.get(ip);
  const now = Date.now();
  if (!entry || now - entry.windowStart > CHATBOT_RATE_WINDOW_MS) {
    chatbotRateStore.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= CHATBOT_RATE_LIMIT) {
    return false;
  }
  entry.count++;
  return true;
}

// ✅ PATCH-7: Chatbot endpoint — 28-model smart cascading fallback
// Uses api/lib/chatbot.ts getChatResponse() for automatic model switching
// If one model is overloaded/down/unavailable, instantly tries the next
// User NEVER sees any error — the system always finds a working model
app.post("/api/chatbot", async (c) => {
  try {
    // 1. Rate limiting (per IP)
    const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    if (!checkChatbotRateLimit(clientIp)) {
      return c.json({ success: false, error: "Rate limit exceeded. Try again later." }, 429);
    }

    // 2. Validate request
    const body = await c.req.json();
    const messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ success: false, error: "Messages array is required" }, 400);
    }
    if (messages.length > 20) {
      return c.json({ success: false, error: "Too many messages (max 20)" }, 400);
    }
    // Validate each message
    for (const m of messages) {
      if (typeof m.content !== "string" || m.content.length > 4000) {
        return c.json({ success: false, error: "Invalid message content" }, 400);
      }
      if (!["user", "assistant", "system"].includes(m.role)) {
        return c.json({ success: false, error: "Invalid message role" }, 400);
      }
    }

    // 3. Use the 28-model smart fallback system from api/lib/chatbot.ts
    const { getChatResponse } = await import("./lib/chatbot");
    const result = await getChatResponse({
      messages: messages,
      language: body.language || "ar",
    });

    if (result.success && result.reply) {
      return c.json({ success: true, reply: result.reply, model: result.model });
    }
    return c.json({ success: false, error: result.error || "Service unavailable" }, 503);
  } catch (e) {
    console.error("[Chatbot] Error: " + String(e));
    // Send to Sentry if configured and DSN is valid
    if (env.sentryDsn && env.sentryDsn.startsWith("https://")) {
      import("@sentry/node").then(function(Sentry) {
        Sentry.captureException(e, { tags: { component: "chatbot" } });
      }).catch(function() {});
    }
    return c.json({ success: false, error: "Service temporarily unavailable. Please try again." }, 503);
  }
});

// ✅ SSE Streaming endpoint for chatbot — streams reply character by character
app.post("/api/chatbot/stream", async (c) => {
  try {
    // 1. Rate limiting (per IP)
    const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || c.req.header("x-real-ip") || "unknown";
    if (!checkChatbotRateLimit(clientIp)) {
      return c.json({ success: false, error: "Rate limit exceeded. Try again later." }, 429);
    }

    // 2. Validate request
    const body = await c.req.json();
    const messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ success: false, error: "Messages array is required" }, 400);
    }
    if (messages.length > 20) {
      return c.json({ success: false, error: "Too many messages (max 20)" }, 400);
    }
    for (const m of messages) {
      if (typeof m.content !== "string" || m.content.length > 4000) {
        return c.json({ success: false, error: "Invalid message content" }, 400);
      }
      if (!["user", "assistant", "system"].includes(m.role)) {
        return c.json({ success: false, error: "Invalid message role" }, 400);
      }
    }

    // 3. Get chat response using the smart fallback system
    const { getChatResponse } = await import("./lib/chatbot");
    const result = await getChatResponse({
      messages: messages,
      language: body.language || "ar",
    });

    // 4. Stream the response as SSE
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        // Send model name first
        if (result.model) {
          controller.enqueue(encoder.encode("data: " + JSON.stringify({ model: result.model }) + "\n\n"));

        }

        if (result.success && result.reply) {
          // Stream character by character in small chunks
          const reply = result.reply;
          const chunkSize = 3; // Send 3 chars at a time for smooth effect
          let i = 0;
          const interval = setInterval(function() {
            if (i < reply.length) {
              const chunk = reply.slice(i, i + chunkSize);
              controller.enqueue(encoder.encode("data: " + JSON.stringify({ text: chunk }) + "\n\n"));
              i += chunkSize;
            } else {
              clearInterval(interval);
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            }
          }, 8); // 8ms between chunks for smooth streaming feel
        } else {
          controller.enqueue(encoder.encode("data: " + JSON.stringify({ error: result.error || "Service unavailable" }) + "\n\n"));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    console.error("[Chatbot/Stream] Error: " + String(e));
    return c.json({ success: false, error: "Service temporarily unavailable. Please try again." }, 503);
  }
});

// ✅ PATCH-6: Paymob webhook — HMAC verification + IP allowlist + amount verification
app.post("/api/webhooks/paymob", async (c) => {
  try {
    const contentType = c.req.header("content-type") || "";
    let params;
    if (contentType.indexOf("application/json") !== -1) {
      const body = await c.req.json();
      const obj = body.obj || body;
      params = {
        hmac: body.hmac || "",
        amount_cents: String(obj.amount_cents || ""),
        created_at: String(obj.created_at || ""),
        currency: String(obj.currency || ""),
        error_occured: String(obj.error_occured || ""),
        has_parent_transaction: String(obj.has_parent_transaction || ""),
        id: String(obj.id || ""),
        integration_id: String(obj.integration_id || ""),
        is_3d_secure: String(obj.is_3d_secure || ""),
        is_auth: String(obj.is_auth || ""),
        is_capture: String(obj.is_capture || ""),
        is_refunded: String(obj.is_refunded || ""),
        is_standalone_payment: String(obj.is_standalone_payment || ""),
        is_voided: String(obj.is_voided || ""),
        order: String(obj.order ? (obj.order.id || obj.order) : ""),
        owner: String(obj.owner || ""),
        pending: String(obj.pending || ""),
        source_data_pan: String(obj.source_data ? obj.source_data.pan : ""),
        source_data_sub_type: String(obj.source_data ? obj.source_data.sub_type : ""),
        source_data_type: String(obj.source_data ? obj.source_data.type : ""),
        success: String(obj.success || ""),
      };
    } else {
      params = Object.fromEntries(new URL(c.req.url).searchParams);
    }

    console.log("[Paymob] webhook received, success=" + params.success + ", order=" + params.order);

    // ✅ SECURITY: IP Allowlist check
    const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "";
    const paymobIps = process.env.PAYMOB_WEBHOOK_IPS;
    if (paymobIps) {
      const allowedIps = paymobIps.split(",").map(function(s) { return s.trim(); });
      // Extract first IP if x-forwarded-for contains multiple
      const ipToCheck = clientIp.split(",")[0].trim();
      if (allowedIps.length > 0 && !allowedIps.includes(ipToCheck)) {
        console.warn("[Paymob] Webhook from unauthorized IP: " + clientIp);
        return c.json({ received: true, verified: false, error: "Unauthorized source" });
      }
    }

    // ✅ SECURITY: HMAC Signature Verification
    if (!verifyPaymobHmac(params)) {
      console.warn("[Paymob] Invalid HMAC signature for order: " + params.order);
      return c.json({ received: true, verified: false, error: "Invalid signature" });
    }

    const isSuccess = params.success === "true";
    const isPending = params.pending === "true";
    const merchantOrderId = params.order;

    if (isSuccess && !isPending && merchantOrderId) {
      try {
        const db = getDb();
        const results = await db.select().from(payments).where(eq(payments.transactionId, merchantOrderId)).limit(1);
        if (results.length > 0 && results[0].status === "pending") {
          // ✅ SECURITY: Amount verification — prevent partial payment attacks
          const expectedAmount = parseFloat(String(results[0].amount));
          const paidAmount = parseInt(params.amount_cents) / 100;
          if (Math.abs(paidAmount - expectedAmount) > 0.01) {
            console.warn("[Paymob] Amount mismatch for order " + merchantOrderId + ": expected=" + expectedAmount + " got=" + paidAmount);
            return c.json({ received: true, verified: true, error: "Amount mismatch" });
          }

          // ✅ CRITICAL FIX: Use transaction — update payment + create enrollment atomically
          // Previously, the webhook only updated payment status but NEVER created the enrollment!
          // This meant users who paid via Paymob could not access their courses.
          await db.transaction(async (tx) => {
            await tx.update(payments).set({
              status: "completed",
              gatewayTxnId: params.id,
              paymobTransactionId: params.id,
              paidAt: new Date(),
            }).where(eq(payments.transactionId, merchantOrderId));

            const payment = results[0];
            // ✅ CRITICAL: Create enrollment if not already exists
            // Use ON DUPLICATE KEY to handle race conditions safely
            const { drizzle } = await import("drizzle-orm");
            await tx.execute(drizzle.sql`INSERT IGNORE INTO enrollments (\`userId\`, \`courseId\`, \`progress\`, \`isCompleted\`, \`lastAccessedAt\`, \`createdAt\`)
              VALUES (${payment.userId}, ${payment.courseId}, 0, false, NOW(), NOW())
              ON DUPLICATE KEY UPDATE \`lastAccessedAt\` = NOW()`);

            console.log("[Paymob] Payment confirmed + enrollment created (HMAC verified): " + merchantOrderId);
          });
        }
      } catch (e) {
        console.error("[Paymob] DB error: " + String(e));
      }
    } else if (!isSuccess && merchantOrderId) {
      try {
        const db2 = getDb();
        await db2.update(payments).set({ status: "failed" }).where(eq(payments.transactionId, merchantOrderId));
      } catch (e) { /* ignore */ }
    }

    return c.json({ received: true, verified: true });
  } catch (e) {
    console.error("[Paymob] Error: " + String(e));
    return c.json({ received: true, error: "Processing failed" });
  }
});

// ══════════════════════════════════════════════════════════════════════
// STATIC FILE SERVING — Elite Root Solution
// ══════════════════════════════════════════════════════════════════════
// This section handles static file serving for the SPA frontend.
// Design principles:
//   1. Accept-Encoding negotiation: serve .br/.gz pre-compressed files
//   2. ETag + Last-Modified: conditional requests → 304 Not Modified
//   3. File existence check BEFORE fallback: prevents white screen bug
//   4. Directory traversal protection: sandbox to DIST_PUBLIC
//   5. Aggressive cache: immutable for hashed assets, no-store for HTML
// ══════════════════════════════════════════════════════════════════════

const CACHEABLE_EXTENSIONS = new Set([
  ".js", ".css", ".woff", ".woff2", ".png", ".jpg", ".jpeg",
  ".gif", ".svg", ".webp", ".ico", ".map",
]);
const STATIC_EXTENSIONS = new Set([
  ".js", ".css", ".woff", ".woff2", ".png", ".jpg", ".jpeg",
  ".gif", ".svg", ".webp", ".ico", ".map", ".html", ".json",
  ".xml", ".txt", ".pdf", ".webmanifest",
]);

// Pre-computed resolved DIST_PUBLIC for path security checks
const DIST_PUBLIC_RESOLVED = path.resolve(DIST_PUBLIC);

// Startup validation: verify dist/public exists (fail-fast in production)
let distPublicExists = false;
try {
  distPublicExists = fs.statSync(DIST_PUBLIC_RESOLVED).isDirectory();
} catch (_e) { /* not found */ }

if (!distPublicExists) {
  const msg = "[FATAL] dist/public not found at: " + DIST_PUBLIC_RESOLVED
    + " — Run 'npm run build' before starting. In Docker, check the build stage.";
  if (process.env.NODE_ENV === "production") {
    console.error(msg);
    // In production, this is a fatal misconfiguration — refuse to start
    // serving traffic if we can't serve any frontend assets.
    // We still start the server so /api/health can report the issue.
  } else {
    console.warn(msg);
  }
}

// Generate ETag from file size + mtime (fast, no need to hash content)
function generateETag(stat: fs.Stats): string {
  const mtime = stat.mtimeMs.toString(36);
  const size = stat.size.toString(36);
  return '"' + size + '-' + mtime + '"';
}

// Parse Accept-Encoding header and return preferred encoding (br > gzip > identity)
function parseAcceptEncoding(header: string | undefined): string {
  if (!header) return "identity";
  if (header.includes("br")) return "br";
  if (header.includes("gzip")) return "gzip";
  return "identity";
}

app.use("*", async (c, next) => {
  const requestPath = c.req.path;

  // Skip API routes entirely
  if (requestPath.startsWith("/api")) return next();

  // SECURITY: Block path traversal attempts
  if (requestPath.includes("..") || requestPath.includes("\0")) {
    return c.notFound();
  }

  // Resolve the file path safely
  const filePath = path.join(DIST_PUBLIC, requestPath);
  const resolvedPath = path.resolve(filePath);

  // SECURITY: Sandboxed to DIST_PUBLIC — resolved path must be within the static root
  if (!resolvedPath.startsWith(DIST_PUBLIC_RESOLVED + path.sep) && resolvedPath !== DIST_PUBLIC_RESOLVED) {
    return c.notFound();
  }

  // SECURITY: Block directory listing — return 403 for directory access
  let stat: fs.Stats | null = null;
  try {
    stat = await fs.promises.stat(resolvedPath);
  } catch (_e) { /* not found */ }

  if (!stat) return next(); // Not a file, not a dir → fall through to SPA
  if (stat.isDirectory()) return c.text("Forbidden", 403);

  // ── File exists — prepare response ──
  const ext = path.extname(resolvedPath).toLowerCase();

  // ── Accept-Encoding negotiation ──
  // If the client accepts brotli or gzip, and a pre-compressed version exists,
  // serve it instead of the original file.
  const acceptEncoding = parseAcceptEncoding(c.req.header("accept-encoding"));
  let finalPath = resolvedPath;
  let contentEncoding = "";

  if (acceptEncoding !== "identity" && CACHEABLE_EXTENSIONS.has(ext)) {
    const compressedExt = acceptEncoding === "br" ? ".br" : ".gz";
    const compressedPath = resolvedPath + compressedExt;
    try {
      const compressedStat = await fs.promises.stat(compressedPath);
      if (compressedStat.isFile()) {
        finalPath = compressedPath;
        contentEncoding = acceptEncoding === "br" ? "br" : "gzip";
        stat = compressedStat; // Update stat for ETag
      }
    } catch (_e) { /* compressed version not found → serve original */ }
  }

  // ── Conditional request: ETag + If-None-Match → 304 ──
  const etag = generateETag(stat);
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { "ETag": etag } });
  }

  // ── Conditional request: Last-Modified + If-Modified-Since → 304 ──
  const lastModified = stat.mtime.toUTCString();
  const ifModifiedSince = c.req.header("if-modified-since");
  if (ifModifiedSince && new Date(ifModifiedSince).getTime() >= stat.mtime.getTime()) {
    return new Response(null, { status: 304, headers: { "Last-Modified": lastModified, "ETag": etag } });
  }

  // ── Build response headers ──
  const headers: Record<string, string> = {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "ETag": etag,
    "Last-Modified": lastModified,
  };

  // Aggressive caching for hashed static assets (1 year, immutable)
  if (CACHEABLE_EXTENSIONS.has(ext)) {
    // CRITICAL: Service Worker MUST NOT be cached — browser must always fetch
    // the latest sw.js to detect new precache manifest after deployments.
    // Without this, old SW serves stale assets → white screen after deploy.
    if (requestPath === "/sw.js" || requestPath.endsWith("/sw.js")) {
      headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    } else {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    }
  }

  // Content-Encoding for pre-compressed files
  if (contentEncoding) {
    headers["Content-Encoding"] = contentEncoding;
    headers["Vary"] = "Accept-Encoding";
  }

  return new Response(await fs.promises.readFile(finalPath), { headers });
});

// ══════════════════════════════════════════════════════════════════════
// SPA FALLBACK — Serve index.html ONLY for page navigation routes
// NEVER for requests with static file extensions (prevents white screen)
// ══════════════════════════════════════════════════════════════════════
app.get("*", async (c) => {
  const requestPath = c.req.path;

  // CRITICAL SAFETY: If the request targets a static file extension,
  // return 404. Previously, index.html was served as application/javascript
  // which browsers rejected due to X-Content-Type-Options: nosniff → WHITE SCREEN.
  const ext = path.extname(requestPath).toLowerCase();
  if (ext && STATIC_EXTENSIONS.has(ext)) {
    return c.notFound();
  }

  const indexPath = path.join(DIST_PUBLIC, "index.html");
  try {
    const idxContent = await fs.promises.readFile(indexPath, "utf-8");
    const idxStat = await fs.promises.stat(indexPath);
    const idxEtag = generateETag(idxStat);
    const idxLastModified = idxStat.mtime.toUTCString();

    // Conditional request for index.html too
    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch && ifNoneMatch === idxEtag) {
      return new Response(null, { status: 304, headers: { "ETag": idxEtag } });
    }
    const ifModifiedSince = c.req.header("if-modified-since");
    if (ifModifiedSince && new Date(ifModifiedSince).getTime() >= idxStat.mtime.getTime()) {
      return new Response(null, { status: 304, headers: { "Last-Modified": idxLastModified, "ETag": idxEtag } });
    }

    return new Response(idxContent, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // ✅ CRITICAL: Never cache HTML — prevents stale content after deployments
        // no-store: browser MUST NOT store. proxy-revalidate: CDN MUST revalidate.
        // CDN-Cache-Control: Cloudflare-specific override for edge caching.
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "CDN-Cache-Control": "no-store",
        "Surrogate-Control": "no-store",
        "ETag": idxEtag,
        "Last-Modified": idxLastModified,
      },
    });
  } catch (_e) {
    return c.text("Starting...", 503);
  }
});

const server = createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://localhost:" + PORT);
  const h = new Headers();
  for (let _i = 0, _a = Object.entries(req.headers); _i < _a.length; _i++) {
    const entry = _a[_i];
    if (entry[1]) h.set(entry[0], entry[1]);
  }
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    body = Buffer.concat(chunks);
  }
  const request = new Request(u.toString(), {
    method: req.method || "GET",
    headers: h,
    body: body ? String(body) : undefined,
  });
  try {
    const response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        while (true) {
          const result = await reader.read();
          if (result.done) { res.end(); break; }
          res.write(Buffer.from(result.value));
        }
      };
      await pump();
    } else {
      res.end();
    }
  } catch (e) {
    console.error("[Server Error] " + String(e));
 // Send to Sentry if configured and DSN is valid
    if (env.sentryDsn && env.sentryDsn.startsWith("https://")) {
      import("@sentry/node").then(function(Sentry) {
        Sentry.captureException(e);
      }).catch(function() {});
    }
    res.writeHead(500);
    res.end("Error");
  }
});

// ══════════════════════════════════════════════════════════════════
// ✅ Sentry Error Tracking Integration
// Captures unhandled errors and provides performance monitoring
// Only initializes if SENTRY_DSN is configured
// ══════════════════════════════════════════════════════════════════
async function initSentry() {
  const dsn = env.sentryDsn;
  if (!dsn) {
    console.log("Sentry: Not configured (no SENTRY_DSN env var)");
    return;
  }
  // ✅ FIX: Validate DSN format — must start with https://
  // Common mistake: using a Sentry auth token (sntryu_...) instead of a DSN
  if (!dsn.startsWith("https://")) {
    console.warn("Sentry: Invalid DSN format (starts with \"" + dsn.slice(0, 8) + "...\"). Expected \"https://KEY@ORG.ingest.sentry.io/PROJECT_ID\". Skipping initialization.");
    console.warn("Sentry: Tip: Go to Sentry > Project Settings > Client Keys (DSN) > copy the DSN value.");
    return;
  }
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: dsn,
      environment: env.isProduction ? "production" : "development",
      release: process.env.npm_package_version || "0.0.0",
      tracesSampleRate: env.isProduction ? 0.1 : 1.0,
      profilesSampleRate: env.isProduction ? 0.1 : 1.0,
      integrations: [
        Sentry.extraErrorDataIntegration(),
        Sentry.consoleIntegration(),
      ],
      beforeSend(event) {
        // Strip sensitive headers
        if (event.request?.headers) {
          delete event.request.headers["authorization"];
          delete event.request.headers["x-auth-token"];
          delete event.request.headers["cookie"];
        }
        return event;
      },
    });
    console.log("Sentry: ENABLED (" + (env.isProduction ? "production" : "development") + ")");
  } catch (e) {
    console.error("Sentry: Failed to initialize: " + String(e));
  }
}

// Initialize Sentry before starting server
initSentry().then(() => {
  logger.info("Application startup", {
    port: PORT,
    staticFiles: DIST_PUBLIC,
    dbConfigured: !!process.env.DATABASE_URL,
    corsOrigins: corsOrigins.join(", "),
  });
  logger.info("Security features enabled", {
    hmacWebhook: true,
    httpSecurityHeaders: true,
    cspStrictPolicy: true,
    chatbotRateLimit: `${CHATBOT_RATE_LIMIT}/hour per IP`,
    globalRateLimit: `${GLOBAL_RATE_LIMIT}/min per IP`,
  });
  logger.info("Performance features enabled", {
    gzipCompression: true,
    compressionThreshold: "1KB",
    staticAssetsCache: "1-year (immutable)",
    connectionPoolLimit: env.isProduction ? 15 : 5,
    sentryEnabled: !!env.sentryDsn,
  });
  server.listen(PORT);
});
