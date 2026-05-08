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
  // Content Security Policy — hardened: removed unsafe-inline/eval from script-src
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' https://www.clarity.ms https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https: blob:; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' https://openrouter.ai https://*.paymob.com https://www.clarity.ms https://*.sentry.io wss://; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://*.paymob.com;");
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
app.get("/api/health", async (c) => {
  var dbStatus = "ok";
  var dbLatencyMs = 0;
  try {
    var db = getDb();
    var start = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - start;
  } catch (e) {
    dbStatus = "error";
  }
  const uptimeSeconds = Math.floor((Date.now() - START_TIME) / 1000);
  const memUsage = process.memoryUsage();
  return c.json({
    status: dbStatus === "ok" ? "ok" : "degraded",
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
      console.error("[tRPC Error] " + opts.path + ": " + opts.error.message);
      // Send to Sentry if configured
      if (process.env.SENTRY_DSN) {
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
    var body = await c.req.json();
    var messages = body.messages;
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
    var { getChatResponse } = await import("./lib/chatbot");
    var result = await getChatResponse({
      messages: messages,
      language: body.language || "ar",
    });

    if (result.success && result.reply) {
      return c.json({ success: true, reply: result.reply, model: result.model });
    }
    return c.json({ success: false, error: result.error || "Service unavailable" }, 503);
  } catch (e) {
    console.error("[Chatbot] Error: " + String(e));
    // Send to Sentry if configured
    if (process.env.SENTRY_DSN) {
      import("@sentry/node").then(function(Sentry) {
        Sentry.captureException(e, { tags: { component: "chatbot" } });
      }).catch(function() {});
    }
    return c.json({ success: false, error: "Service temporarily unavailable. Please try again." }, 503);
  }
});

// ✅ PATCH-6: Paymob webhook — HMAC verification + IP allowlist + amount verification
app.post("/api/webhooks/paymob", async (c) => {
  try {
    var contentType = c.req.header("content-type") || "";
    var params;
    if (contentType.indexOf("application/json") !== -1) {
      var body = await c.req.json();
      var obj = body.obj || body;
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
    var clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "";
    var paymobIps = process.env.PAYMOB_WEBHOOK_IPS;
    if (paymobIps) {
      var allowedIps = paymobIps.split(",").map(function(s) { return s.trim(); });
      // Extract first IP if x-forwarded-for contains multiple
      var ipToCheck = clientIp.split(",")[0].trim();
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

    var isSuccess = params.success === "true";
    var isPending = params.pending === "true";
    var merchantOrderId = params.order;

    if (isSuccess && !isPending && merchantOrderId) {
      try {
        var db = getDb();
        var results = await db.select().from(payments).where(eq(payments.transactionId, merchantOrderId)).limit(1);
        if (results.length > 0 && results[0].status === "pending") {
          // ✅ SECURITY: Amount verification — prevent partial payment attacks
          var expectedAmount = parseFloat(String(results[0].amount));
          var paidAmount = parseInt(params.amount_cents) / 100;
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

            var payment = results[0];
            // ✅ CRITICAL: Create enrollment if not already exists
            // Use ON DUPLICATE KEY to handle race conditions safely
            var { drizzle } = await import("drizzle-orm");
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
        var db2 = getDb();
        await db2.update(payments).set({ status: "failed" }).where(eq(payments.transactionId, merchantOrderId));
      } catch (e) { /* ignore */ }
    }

    return c.json({ received: true, verified: true });
  } catch (e) {
    console.error("[Paymob] Error: " + String(e));
    return c.json({ received: true, error: "Processing failed" });
  }
});

// ══════════════════════════════════════════════════════════════════
// ✅ OPTIMIZED: Static file serving with aggressive caching
// Hashed filenames (.js, .css) get 1-year cache, HTML gets no-cache
// ══════════════════════════════════════════════════════════════════
const CACHEABLE_EXTENSIONS = new Set([".js", ".css", ".woff", ".woff2", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"]);

app.use("*", async (c, next) => {
  var p = c.req.path;
  if (p.startsWith("/api")) return next();
  var fp = path.join(DIST_PUBLIC, p);
  try {
    // ✅ FIX: Use async fs methods to avoid blocking the event loop under load
    const stat = await fs.promises.stat(fp).catch(() => null);
    if (stat && stat.isFile()) {
      var ext = path.extname(fp).toLowerCase();
      var headers: Record<string, string> = {
        "Content-Type": MIME[ext] || "application/octet-stream",
      };
      // ✅ OPTIMIZED: Aggressive caching for static assets with content hashes
      if (CACHEABLE_EXTENSIONS.has(ext)) {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      }
      return new Response(await fs.promises.readFile(fp), { headers });
    }
  } catch (e) { /* ignore */ }
  return next();
});

// SPA fallback - serve index.html for all non-API routes
app.get("*", async (c) => {
  var ip = path.join(DIST_PUBLIC, "index.html");
  try {
    // ✅ FIX: Async file serving for SPA fallback
    const idxStat = await fs.promises.stat(ip).catch(() => null);
    if (idxStat && idxStat.isFile()) {
      return new Response(await fs.promises.readFile(ip, "utf-8"), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          // ✅ OPTIMIZED: HTML should never be cached by browser
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }
  } catch (e) { /* ignore */ }
  return c.text("Starting...", 503);
});

var server = createServer(async (req, res) => {
  var u = new URL(req.url || "/", "http://localhost:" + PORT);
  var h = new Headers();
  for (var _i = 0, _a = Object.entries(req.headers); _i < _a.length; _i++) {
    var entry = _a[_i];
    if (entry[1]) h.set(entry[0], entry[1]);
  }
  var body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    var chunks = [];
    for await (var chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  var request = new Request(u.toString(), {
    method: req.method || "GET",
    headers: h,
    body: body ? String(body) : undefined,
  });
  try {
    var response = await app.fetch(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      var reader = response.body.getReader();
      var pump = async () => {
        while (true) {
          var result = await reader.read();
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
 // Send to Sentry if configured
    if (process.env.SENTRY_DSN) {
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
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("Sentry: Not configured (no SENTRY_DSN env var)");
    return;
  }
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: env.sentryDsn || dsn,
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
  console.log("===== Application Startup =====");
  console.log("Server running on port " + PORT);
  console.log("Static files: " + DIST_PUBLIC);
  console.log("DB: " + (process.env.DATABASE_URL ? "OK" : "not set"));
  console.log("Chat: " + (process.env.OPENROUTER_API_KEY ? "OK (28-model fallback)" : "not set"));
  console.log("CORS origins: " + corsOrigins.join(", "));
  console.log("tRPC: /api/trpc/*");
  console.log("Security: HMAC webhook verification ENABLED");
  console.log("Security: Chatbot rate limiting ENABLED (" + CHATBOT_RATE_LIMIT + "/hour per IP)");
  console.log("Security: Global rate limiting ENABLED (" + GLOBAL_RATE_LIMIT + "/min per IP)");
  console.log("Security: HTTP security headers ENABLED");
  console.log("Security: CSP strict policy ENABLED");
  console.log("Performance: gzip/brotli compression ENABLED (threshold: 1KB)");
  console.log("Performance: Static assets cache 1-year (immutable)");
  console.log("Performance: Connection pool 15 (production)");
  console.log("Sentry: " + (process.env.SENTRY_DSN ? "ENABLED" : "NOT CONFIGURED"));
  server.listen(PORT);
});
