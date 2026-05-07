import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import fs from "node:fs/promises";
import path from "node:path";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
const gzipAsync = promisify(gzip);
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { getDb } from "./queries/connection";
import { payments } from "@db/schema";
import { eq, sql } from "drizzle-orm";
import mysql from "mysql2/promise";
import { hashPassword } from "./lib/password";
import { checkRateLimit } from "./lib/rate-limiter";

const app = new Hono();
const DIST_PUBLIC = path.resolve(process.cwd(), "dist/public");
const PORT = Number(process.env.PORT) || 7860;
const START_TIME = Date.now();

// Strip ssl-mode from DATABASE_URL (Aiven MySQL adds this but mysql2 doesn't support it)
let rawDbUrl = process.env.DATABASE_URL || "";
if (rawDbUrl.indexOf("ssl-mode") !== -1 || rawDbUrl.indexOf("sslmode") !== -1 || rawDbUrl.indexOf("ssl_mode") !== -1) {
  rawDbUrl = rawDbUrl.replace(/[?&]ssl[-_]mode=[^&]*/g, "");
  rawDbUrl = rawDbUrl.replace(/[?&]$/, "");
  process.env.DATABASE_URL = rawDbUrl;
  console.log("[DB] Cleaned ssl-mode from DATABASE_URL");
}

// CORS
let corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(function(s) { return s.trim(); })
  .filter(Boolean);
if (corsOrigins.length === 0) {
  corsOrigins = [
    "https://ahmedelbaz.qzz.io",
    "http://localhost:5173",
    "http://localhost:3000",
  ];
}
app.use("*", cors({
  origin: corsOrigins,
  credentials: true,
  allowMethods: ["GET", "POST", "OPTIONS"],
  // FIX #3: Removed x-auth-token — header fallback was removed from context.ts
  allowHeaders: ["Content-Type", "Authorization"],
}));

// ══════════════════════════════════════════════════════════════════
// ✅ SECURITY: Global Rate Limiting (in-memory) for ALL endpoints
// First layer of defense before any route handler
// ══════════════════════════════════════════════════════════════════
const globalRateStore = new Map<string, { count: number; windowStart: number }>();
const GLOBAL_RATE_LIMIT = 120; // requests per minute per IP
const GLOBAL_RATE_WINDOW_MS = 60 * 1000;

function checkGlobalRateLimit(ip: string): boolean {
  const entry = globalRateStore.get(ip);
  const now = Date.now();
  if (!entry || now - entry.windowStart > GLOBAL_RATE_WINDOW_MS) {
    globalRateStore.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= GLOBAL_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Periodic cleanup of stale entries (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of globalRateStore) {
    if (now - entry.windowStart > GLOBAL_RATE_WINDOW_MS * 2) {
      globalRateStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

app.use("*", async (c, next) => {
  const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
  if (!checkGlobalRateLimit(clientIp)) {
    return c.json({ error: "Too many requests. Please try again later." }, 429);
  }
  await next();
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
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".txt": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
};

app.get("/api/health", async (c) => {
  let dbStatus = "ok";
  let dbLatencyMs = 0;
  let dbError = "";
  try {
    const db = getDb();
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    dbLatencyMs = Date.now() - start;
  } catch (e: any) {
    dbStatus = "error";
    dbError = String(e?.message || e);
    console.error("[Health] DB error: " + dbError);
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
    dbError: dbError ? dbError.substring(0, 200) : undefined,
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
      if (opts.error.code === "UNAUTHORIZED" && opts.path === "auth.me") return;
      console.error("[tRPC Error] " + opts.path + ": " + opts.error.message);
    },
  });
});

// Chatbot endpoint — PATCH 7: JWT auth + per-user rate limiting
app.post("/api/chatbot", async (c) => {
  try {
    // 1. JWT Authentication — only logged-in users can use the chatbot
    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ success: false, error: "Authorization required" }, 401);
    }
    const { verifyToken } = await import("./lib/jwt");
    const user = await verifyToken(authHeader.replace("Bearer ", ""));
    if (!user) {
      return c.json({ success: false, error: "Invalid or expired token" }, 401);
    }

    // 2. Per-user rate limiting (10 requests/minute per user, not per IP)
    try {
      await checkRateLimit("user:" + user.userId, "chatbot");
    } catch (rateErr: any) {
      return c.json({ success: false, error: "Rate limit exceeded. Try again later." }, 429);
    }

    // 3. Input validation
    const body = await c.req.json();
    const messages = body.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return c.json({ success: false, error: "Messages array is required" }, 400);
    }
    if (messages.length > 20) {
      return c.json({ success: false, error: "Too many messages. Maximum 20 messages allowed." }, 400);
    }
    for (let i = 0; i < messages.length; i++) {
      if (!messages[i].content || typeof messages[i].content !== "string" || messages[i].content.length > 4000) {
        return c.json({ success: false, error: "Each message content must be under 4000 characters." }, 400);
      }
      if (messages[i].role && !["user", "assistant", "system"].includes(messages[i].role)) {
        return c.json({ success: false, error: "Invalid message role" }, 400);
      }
    }
    if (!process.env.OPENROUTER_API_KEY && !process.env.CHATBOT_API_KEY) {
      return c.json({ success: false, error: "Chatbot not configured" }, 503);
    }

    // 4. Process chatbot request
    const { getChatResponse } = await import("./lib/chatbot");
    const result = await getChatResponse({ messages: messages, language: body.language });
    if (result.success && result.reply) {
      console.log("[Chatbot] User " + user.userId + " (" + user.username + ") — Reply from: " + (result.model || "unknown"));
      return c.json({ success: true, reply: result.reply });
    }
    console.error("[Chatbot] User " + user.userId + " — Failed: " + (result.error || "unknown"));
    return c.json({ success: false, error: result.error || "Service temporarily unavailable" }, 503);
  } catch (e) {
    console.error("[Chatbot] Error: " + String(e));
    return c.json({ success: false, error: "Service unavailable" }, 500);
  }
});

// Paymob webhook — PATCH 6: IP whitelist + HMAC + amount verification
app.post("/api/webhooks/paymob", async (c) => {
  try {
    // 1. IP whitelist — only allow requests from Paymob servers
    const clientIp = c.req.header("cf-connecting-ip") || c.req.header("x-real-ip") || "";
    const paymobIps = (process.env.PAYMOB_WEBHOOK_IPS || "").split(",").map(function(s) { return s.trim(); }).filter(Boolean);
    if (paymobIps.length > 0 && clientIp && !paymobIps.includes(clientIp)) {
      console.warn("[Paymob] Blocked IP: " + clientIp + " (not in allowlist)");
      return c.json({ received: false, error: "Unauthorized IP" }, 403);
    }

    // 2. Rate limit webhook to prevent spam attacks
    const webhookIp = clientIp || "unknown";
    try { await checkRateLimit(webhookIp, "api"); } catch(rateErr: any) {
      return c.json({ error: "Rate limited" }, 429);
    }

    const contentType = c.req.header("content-type") || "";
    let params: Record<string, string> = {};
    let merchantOrderId = "";

    if (contentType.indexOf("application/json") !== -1) {
      const body = await c.req.json();
      const obj = body.obj || body;
      if (obj.order && typeof obj.order === "object") {
        params["order"] = String(obj.order.id || "");
        merchantOrderId = String(obj.order.merchant_order_id || "");
      } else {
        params["order"] = String(obj.order || "");
      }
      params = {
        ...params,
        hmac: String(body.hmac || ""),
        amount_cents: String(obj.amount_cents || ""),
        created_at: String(obj.created_at || ""),
        currency: String(obj.currency || ""),
        error_occured: String(obj.error_occured || false),
        has_parent_transaction: String(obj.has_parent_transaction || false),
        id: String(obj.id || ""),
        integration_id: String(obj.integration_id || ""),
        is_3d_secure: String(obj.is_3d_secure || false),
        is_auth: String(obj.is_auth || false),
        is_capture: String(obj.is_capture || false),
        is_refunded: String(obj.is_refunded || false),
        is_standalone_payment: String(obj.is_standalone_payment || false),
        is_voided: String(obj.is_voided || false),
        owner: String(obj.owner || ""),
        pending: String(obj.pending || false),
        source_data_pan: String(obj.source_data ? obj.source_data.pan : ""),
        source_data_sub_type: String(obj.source_data ? obj.source_data.sub_type : ""),
        source_data_type: String(obj.source_data ? obj.source_data.type : ""),
        success: String(obj.success || false),
      };
    } else if (contentType.indexOf("application/x-www-form-urlencoded") !== -1) {
      const rawBody = await c.req.text();
      const urlParams = new URLSearchParams(rawBody);
      for (const [key, value] of urlParams) { params[key] = value || ""; }
      merchantOrderId = params["merchant_order_id"] || params["order"] || "";
    } else {
      params = Object.fromEntries(new URL(c.req.url).searchParams);
      merchantOrderId = params["merchant_order_id"] || params["order"] || "";
    }

    const { verifyPaymobHmac, confirmPaymentAndEnroll } = await import("./lib/paymob");
    const hmacValid = verifyPaymobHmac(params);
    if (!hmacValid) {
      console.error("[Paymob] HMAC verification FAILED — rejected");
      return c.json({ received: true, verified: false }, 400);
    }
    console.log("[Paymob] HMAC verified successfully");

    console.log("[Paymob] webhook received: success=" + params.success + ", paymob_order=" + params.order + ", merchant_txn=" + merchantOrderId);
    const isSuccess = params.success === "true";
    const isPending = params.pending === "true";

    if (isSuccess && !isPending && merchantOrderId) {
      try {
        // 3. Amount verification — reject if paid amount doesn't match expected amount
        if (params.amount_cents) {
          const db = getDb();
          const pendingPayments = await db.select().from(payments)
            .where(eq(payments.transactionId, merchantOrderId)).limit(1);
          if (pendingPayments.length > 0) {
            const expectedAmount = Math.round(parseFloat(String(pendingPayments[0].amount)) * 100);
            const paidAmount = parseInt(params.amount_cents, 10);
            if (expectedAmount > 0 && paidAmount !== expectedAmount) {
              console.error("[Paymob] Amount mismatch: expected=" + expectedAmount + " cents, received=" + paidAmount + " cents — REJECTED");
              return c.json({ received: true, verified: true, error: "Amount mismatch" }, 400);
            }
          }
        }

        const result = await confirmPaymentAndEnroll(merchantOrderId, params.id, Number(params.order));
        console.log("[Paymob] Payment confirmed + enrolled: userId=" + result.userId + " courseId=" + result.courseId + " isNew=" + result.isNewEnrollment);
      } catch (enrollErr: any) {
        const errMsg = String(enrollErr?.message || enrollErr);
        if (errMsg.indexOf("No pending payment") !== -1) {
          console.log("[Paymob] Payment already processed (idempotent): " + merchantOrderId);
        } else if (errMsg.indexOf("order ID mismatch") !== -1) {
          console.error("[Paymob] Order ID mismatch — possible attack: " + merchantOrderId);
        } else {
          console.error("[Paymob] Enrollment error: " + errMsg);
        }
      }
    } else if (!isSuccess && merchantOrderId) {
      try {
        const db = getDb();
        await db.update(payments).set({ status: "failed" }).where(eq(payments.transactionId, merchantOrderId));
        console.log("[Paymob] Payment marked as failed: " + merchantOrderId);
      } catch (e) { /* non-critical */ }
    } else {
      console.log("[Paymob] Webhook ignored: success=" + params.success + ", pending=" + params.pending + ", txn=" + merchantOrderId);
    }

    return c.json({ received: true, verified: true });
  } catch (e) {
    console.error("[Paymob] Webhook error: " + String(e));
    return c.json({ received: true, error: "Processing failed" });
  }
});
const COMPRESSIBLE = new Set([
  "text/html; charset=utf-8",
  "application/javascript; charset=utf-8",
  "text/css; charset=utf-8",
  "application/json",
  "text/plain; charset=utf-8",
  "image/svg+xml",
]);

app.use("*", async (c, next) => {
  const p = c.req.path;
  if (p.startsWith("/api")) return next();
  const fp = path.join(DIST_PUBLIC, p);
  if (!fp.startsWith(DIST_PUBLIC)) return next();
  try {
    const stat = await fs.stat(fp);
    if (!stat.isFile()) return next();
    const ext = path.extname(fp).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    const fileBuffer = await fs.readFile(fp);
    if (COMPRESSIBLE.has(contentType) && fileBuffer.length > 1024) {
      const compressed = await gzipAsync(fileBuffer, { level: 6 });
      return new Response(compressed, {
        headers: {
          "Content-Type": contentType,
          "Content-Encoding": "gzip",
          "Cache-Control": getCacheControl(ext),
          "Vary": "Accept-Encoding",
        },
      });
    }
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": getCacheControl(ext),
      },
    });
  } catch (e) { /* ignore */ }
  return next();
});

const HASHED_EXTS = new Set([".js", ".css", ".woff2", ".woff"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico"]);

function getCacheControl(ext: string): string {
  if (ext === ".html") return "public, max-age=0, must-revalidate";
  if (HASHED_EXTS.has(ext)) return "public, max-age=31536000, immutable";
  if (IMAGE_EXTS.has(ext)) return "public, max-age=2592000";
  if (ext === ".m3u8") return "public, max-age=3600";
  if (ext === ".ts") return "public, max-age=2592000, immutable";
  return "public, max-age=3600";
}

const SENSITIVE_PATHS = ["/.env", "/.git", "/.gitignore", "/.gitattributes", "/wp-admin", "/wp-login", "/phpmyadmin", "/.htaccess", "/.htpasswd", "/server-status", "/server-info", "/actuator", "/wp-content", "/wp-includes", "/xmlrpc.php"];
const BLOCKED_EXTENSIONS = new Set([".php", ".asp", ".aspx", ".jsp", ".cgi", ".pl", ".py", ".rb", ".sh", ".bash"]);
const MAX_BODY_SIZE = 20 * 1024 * 1024;

app.use("*", async (c, next) => {
  const p = c.req.path;
  const lowerPath = p.toLowerCase();
  for (const sp of SENSITIVE_PATHS) {
    if (lowerPath === sp || lowerPath.startsWith(sp + "/") || lowerPath.includes(sp)) {
      c.status(404);
      return;
    }
  }
  const ext = path.extname(p).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    c.status(404);
    return;
  }
  if (p.includes("..")) {
    c.status(400);
    return;
  }
  const contentLength = parseInt(c.req.header("content-length") || "0", 10);
  if (contentLength > MAX_BODY_SIZE) {
    c.status(413);
    return c.json({ error: "Payload too large" });
  }
  await next();
});

app.use("*", async (c, next) => {
  await next();
  // Content Security Policy
  c.header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' https://openrouter.ai https://*.paymob.com wss://; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://*.paymob.com;");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Request-ID", crypto.randomUUID());
  c.header("Vary", "Accept-Encoding, Origin");
  c.header("X-Powered-By", undefined);
  c.header("Server", undefined);
  // Security headers — applied to ALL responses (not just non-API)
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), payment=(self), usb=(), magnetometer=()");
  c.header("X-Permitted-Cross-Domain-Policies", "none");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("X-DNS-Prefetch-Control", "on");
  // HSTS — enforce HTTPS
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
});

app.get("*", async (c) => {
  const indexPath = path.join(DIST_PUBLIC, "index.html");
  try {
    const html = await fs.readFile(indexPath, "utf-8");
    return c.html(html);
  } catch (e) { /* ignore */ }
  return c.text("Starting...", 503);
});

// ─── Server: @hono/node-server (replaced manual HTTP server) ───
// serve() is called after ensureTables() to ensure DB is ready before accepting requests

async function ensureTables() {
  try {
    const dbUrl = process.env.DATABASE_URL || "";
    const conn = await mysql.createConnection(dbUrl);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL UNIQUE,
        passwordHash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        email VARCHAR(320),
        avatar TEXT,
        role ENUM('user','admin') DEFAULT 'user' NOT NULL,
        preferredLanguage VARCHAR(10) DEFAULT 'en' NOT NULL,
        tokenVersion INT DEFAULT 0 NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        lastSignInAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        passwordResetToken VARCHAR(255),
        passwordResetExpiresAt TIMESTAMP,
        UNIQUE INDEX idx_users_username (username),
        INDEX idx_users_email (email),
        INDEX idx_users_role (role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS courses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(255) NOT NULL UNIQUE,
        categoryId BIGINT UNSIGNED NOT NULL,
        titleEn VARCHAR(500) NOT NULL,
        titleAr VARCHAR(500) NOT NULL,
        descriptionEn TEXT,
        descriptionAr TEXT,
        shortDescEn VARCHAR(500),
        shortDescAr VARCHAR(500),
        thumbnail VARCHAR(500),
        trailerUrl VARCHAR(500),
        level ENUM('beginner','intermediate','advanced') DEFAULT 'beginner' NOT NULL,
        isPremium BOOLEAN DEFAULT FALSE NOT NULL,
        price DECIMAL(10,2) DEFAULT '0.00' NOT NULL,
        originalPrice DECIMAL(10,2) DEFAULT '0.00' NOT NULL,
        durationHours INT DEFAULT 0 NOT NULL,
        rating DECIMAL(3,1) DEFAULT '5.0' NOT NULL,
        reviewCount INT DEFAULT 0 NOT NULL,
        studentCount INT DEFAULT 0 NOT NULL,
        instructorName VARCHAR(255) DEFAULT 'Eng Ahmed Elbaz' NOT NULL,
        isPublished BOOLEAN DEFAULT TRUE NOT NULL,
        isFeatured BOOLEAN DEFAULT FALSE NOT NULL,
        prerequisitesEn TEXT,
        prerequisitesAr TEXT,
        learningOutcomesEn JSON,
        learningOutcomesAr JSON,
        sortOrder INT DEFAULT 0 NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        UNIQUE INDEX idx_courses_slug (slug),
        INDEX idx_courses_category (categoryId),
        INDEX idx_courses_published_featured (isPublished, isFeatured),
        INDEX idx_courses_published_level (isPublished, level),
        INDEX idx_courses_published_premium (isPublished, isPremium)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS lessons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        courseId BIGINT UNSIGNED NOT NULL,
        titleEn VARCHAR(500) NOT NULL,
        titleAr VARCHAR(500) NOT NULL,
        descriptionEn TEXT,
        descriptionAr TEXT,
        videoUrl VARCHAR(500),
        durationMinutes INT DEFAULT 0 NOT NULL,
        sortOrder INT DEFAULT 0 NOT NULL,
        isFree BOOLEAN DEFAULT FALSE NOT NULL,
        isPublished BOOLEAN DEFAULT TRUE NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_lessons_course_published (courseId, isPublished, sortOrder)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS quizQuestions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lessonId BIGINT UNSIGNED NOT NULL,
        questionEn TEXT NOT NULL,
        questionAr TEXT NOT NULL,
        optionsEn JSON NOT NULL,
        optionsAr JSON NOT NULL,
        correctOptionIndex INT NOT NULL,
        explanationEn TEXT,
        explanationAr TEXT,
        points INT DEFAULT 1 NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_quiz_lesson (lessonId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId BIGINT UNSIGNED NOT NULL,
        courseId BIGINT UNSIGNED NOT NULL,
        progress INT DEFAULT 0 NOT NULL,
        isCompleted BOOLEAN DEFAULT FALSE NOT NULL,
        completedAt TIMESTAMP,
        lastAccessedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE INDEX idx_enrollments_user_course (userId, courseId),
        INDEX idx_enrollments_user (userId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId BIGINT UNSIGNED NOT NULL,
        courseId BIGINT UNSIGNED NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'EGP' NOT NULL,
        paymentMethod ENUM('visa','instapay','vodafone_cash','wallet','bank_transfer','paypal','kiosk','cash_collection','other') NOT NULL,
        transactionId VARCHAR(255),
        status ENUM('pending','completed','failed','refunded','expired') DEFAULT 'pending' NOT NULL,
        paidAt TIMESTAMP,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        paymobOrderId VARCHAR(100),
        paymobTransactionId VARCHAR(100),
        gatewayTxnId VARCHAR(100),
        expiresAt TIMESTAMP,
        phoneNumber VARCHAR(20),
        promoCodeId BIGINT UNSIGNED,
        discountAmount DECIMAL(10,2),
        finalAmount DECIMAL(10,2),
        INDEX idx_payments_user (userId),
        UNIQUE INDEX idx_payments_transaction (transactionId),
        INDEX idx_payments_status (status),
        INDEX idx_payments_paymob_order (paymobOrderId),
        INDEX idx_payments_expires (expiresAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS supportTickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId BIGINT UNSIGNED NOT NULL,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        category ENUM('technical','billing','content','general') DEFAULT 'general' NOT NULL,
        status ENUM('open','in_progress','resolved','closed') DEFAULT 'open' NOT NULL,
        priority ENUM('low','medium','high','urgent') DEFAULT 'medium' NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_tickets_user (userId),
        INDEX idx_tickets_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        slug VARCHAR(255) NOT NULL UNIQUE,
        nameEn VARCHAR(255) NOT NULL,
        nameAr VARCHAR(255) NOT NULL,
        descriptionEn TEXT,
        descriptionAr TEXT,
        icon VARCHAR(100) NOT NULL,
        sortOrder INT DEFAULT 0 NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_categories_slug (slug),
        INDEX idx_categories_sort (sortOrder)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS testimonials (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        title VARCHAR(255),
        company VARCHAR(255),
        content TEXT NOT NULL,
        rating INT DEFAULT 5 NOT NULL,
        isPublished BOOLEAN DEFAULT TRUE NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_testimonials_published (isPublished)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS siteSettings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        section VARCHAR(100) NOT NULL,
        \`key\` VARCHAR(255) NOT NULL,
        value TEXT NOT NULL,
        type ENUM('text','richtext','image','url','color','number','json') DEFAULT 'text' NOT NULL,
        sortOrder INT DEFAULT 0 NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_settings_section_key (section, \`key\`),
        INDEX idx_settings_section (section)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS themes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(100) NOT NULL UNIQUE,
        isActive BOOLEAN DEFAULT FALSE NOT NULL,
        primaryColor VARCHAR(7) DEFAULT '#06b6d4' NOT NULL,
        secondaryColor VARCHAR(7) DEFAULT '#0891b2' NOT NULL,
        accentColor VARCHAR(7) DEFAULT '#f59e0b' NOT NULL,
        bgColor VARCHAR(7) DEFAULT '#0a0e17' NOT NULL,
        cardBgColor VARCHAR(7) DEFAULT '#111827' NOT NULL,
        textColor VARCHAR(7) DEFAULT '#f0f4f8' NOT NULL,
        mutedTextColor VARCHAR(7) DEFAULT '#94a3b8' NOT NULL,
        borderColor VARCHAR(7) DEFAULT '#1f2d44' NOT NULL,
        fontFamily VARCHAR(100) DEFAULT 'Inter, sans-serif' NOT NULL,
        headingFontFamily VARCHAR(100) DEFAULT 'Inter, sans-serif' NOT NULL,
        borderRadius VARCHAR(20) DEFAULT '12px' NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_themes_slug (slug),
        INDEX idx_themes_active (isActive)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS promoCodes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) NOT NULL UNIQUE,
        description VARCHAR(255),
        discountType ENUM('percentage','fixed') NOT NULL,
        discountValue DECIMAL(10,2) NOT NULL,
        maxUses INT,
        usedCount INT DEFAULT 0 NOT NULL,
        minOrderAmount DECIMAL(10,2) DEFAULT '0.00',
        appliesTo ENUM('all','specific') DEFAULT 'all' NOT NULL,
        courseId BIGINT UNSIGNED,
        startsAt TIMESTAMP NOT NULL,
        expiresAt TIMESTAMP NOT NULL,
        isActive BOOLEAN DEFAULT TRUE NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE INDEX idx_promo_code (code),
        INDEX idx_promo_active (isActive),
        INDEX idx_promo_expires (expiresAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS promoCodeUsage (
        id INT AUTO_INCREMENT PRIMARY KEY,
        promoCodeId BIGINT UNSIGNED NOT NULL,
        userId BIGINT UNSIGNED NOT NULL,
        paymentId BIGINT UNSIGNED NOT NULL,
        discountAmount DECIMAL(10,2) NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE INDEX idx_promo_usage_promo_user (promoCodeId, userId),
        INDEX idx_promo_usage_payment (paymentId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS promotions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        titleEn VARCHAR(500) NOT NULL,
        titleAr VARCHAR(500) NOT NULL,
        subtitleEn VARCHAR(500),
        subtitleAr VARCHAR(500),
        discountText VARCHAR(100),
        ctaTextEn VARCHAR(100),
        ctaTextAr VARCHAR(100),
        ctaUrl VARCHAR(500),
        promoCodeId BIGINT UNSIGNED,
        bgGradientFrom VARCHAR(7) DEFAULT '#06b6d4' NOT NULL,
        bgGradientTo VARCHAR(7) DEFAULT '#8b5cf6' NOT NULL,
        textColor VARCHAR(7) DEFAULT '#ffffff' NOT NULL,
        startsAt TIMESTAMP NOT NULL,
        endsAt TIMESTAMP NOT NULL,
        isActive BOOLEAN DEFAULT TRUE NOT NULL,
        showCountdown BOOLEAN DEFAULT TRUE NOT NULL,
        position ENUM('top','hero_above','hero_below','floating') DEFAULT 'top' NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_promotions_active (isActive),
        INDEX idx_promotions_dates (startsAt, endsAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS lessonProgress (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId BIGINT UNSIGNED NOT NULL,
        lessonId BIGINT UNSIGNED NOT NULL,
        isCompleted BOOLEAN DEFAULT FALSE NOT NULL,
        isQuizPassed BOOLEAN DEFAULT FALSE NOT NULL,
        quizScore INT DEFAULT 0 NOT NULL,
        completedAt TIMESTAMP,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        watchedSeconds INT DEFAULT 0 NOT NULL,
        lastPosition INT DEFAULT 0 NOT NULL,
        lastHeartbeatAt TIMESTAMP,
        UNIQUE INDEX idx_progress_user_lesson (userId, lessonId),
        INDEX idx_progress_user (userId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    try { await conn.execute(`ALTER TABLE lessonProgress ADD COLUMN watchedSeconds INT DEFAULT 0 NOT NULL`); } catch (e) {}
    try { await conn.execute(`ALTER TABLE lessonProgress ADD COLUMN lastPosition INT DEFAULT 0 NOT NULL`); } catch (e) {}
    try { await conn.execute(`ALTER TABLE lessonProgress ADD COLUMN lastHeartbeatAt TIMESTAMP`); } catch (e) {}

    try { await conn.execute(`ALTER TABLE users ADD COLUMN emailVerifiedAt TIMESTAMP`); } catch (e) {}
    try { await conn.execute(`ALTER TABLE users ADD COLUMN emailVerificationToken VARCHAR(255)`); } catch (e) {}
    try { await conn.execute(`ALTER TABLE users ADD COLUMN emailVerificationExpiresAt TIMESTAMP`); } catch (e) {}

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ticketReplies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ticketId BIGINT UNSIGNED NOT NULL,
        userId BIGINT UNSIGNED NOT NULL,
        message TEXT NOT NULL,
        isAdminReply BOOLEAN DEFAULT FALSE NOT NULL,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_replies_ticket (ticketId)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS certificates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        userId BIGINT UNSIGNED NOT NULL,
        courseId BIGINT UNSIGNED NOT NULL,
        certificateNumber VARCHAR(255) NOT NULL UNIQUE,
        grade VARCHAR(50),
        issuedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        verified BOOLEAN DEFAULT FALSE NOT NULL,
        pdfUrl VARCHAR(500),
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        UNIQUE INDEX idx_certs_user_course (userId, courseId),
        UNIQUE INDEX idx_certs_number (certificateNumber)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Seed categories
    const [catRows] = await conn.execute(`SELECT COUNT(*) as c FROM categories`);
    if ((catRows?.[0] as any)?.c === 0) {
      await conn.execute(`INSERT INTO categories (slug, nameEn, nameAr, icon, sortOrder) VALUES
        ('electrical-engineering', 'Electrical Engineering', 'هندسة كهربائية', 'Zap', 1),
        ('power-systems', 'Power Systems', 'أنظمة القوى', 'Battery', 2),
        ('control-systems', 'Control Systems', 'أنظمة التحكم', 'Settings', 3),
        ('electronics', 'Electronics', 'إلكترونيات', 'Cpu', 4),
        ('renewable-energy', 'Renewable Energy', 'الطاقة المتجددة', 'Sun', 5)
      `);
      console.log("[DB] Seeded 5 categories");
    }

    // Seed testimonials
    const [testRows] = await conn.execute(`SELECT COUNT(*) as c FROM testimonials`);
    if ((testRows?.[0] as any)?.c === 0) {
      await conn.execute(`INSERT INTO testimonials (name, title, company, content, rating, isPublished) VALUES
        ('أحمد محمد', 'مهندس كهربائي', 'شركة القوى', 'الدورة ممتازة وساعدتني كثيراً في عملي اليومي', 5, 1),
        ('سارة علي', 'مهندسة طاقة', 'مصر للطاقة', 'محتوى عالي الجودة وشرح واضح ومبسط', 5, 1),
        ('محمد حسن', 'طالب هندسة', 'جامعة القاهرة', 'أفضل دورة هندسة كهربائية اتعلمتها أونلاين',5, 1),
        ('ياسمين خالد', 'مهندسة تحكم', 'شركة الأتمتة', 'الدورة غيرت مسار حياتي المهنية بالكامل',5, 1)
      `);
      console.log("[DB] Seeded 4 testimonials");
    }

    // ─── FIX #1: Remove hardcoded admin password "AHMED123" ───
    const [adminRows] = await conn.execute(`SELECT COUNT(*) as c FROM users WHERE username = 'AHMEDETAP'`);
    if ((adminRows?.[0] as any)?.c === 0) {
      let adminPass = process.env.ADMIN_PASSWORD;
      if (!adminPass) {
        adminPass = "Adm_" + Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
        console.error("══════════════════════════════════════════════════");
        console.error("[SECURITY] ADMIN_PASSWORD not set in .env");
        console.error("[SECURITY] A random password was generated for admin user");
        console.error("[SECURITY] CHANGE IT IMMEDIATELY after first login!");
        console.error("[SECURITY] Add ADMIN_PASSWORD=... to your .env file");
        console.error("══════════════════════════════════════════════════");
      }
      const adminHash = await hashPassword(adminPass);
      await conn.execute(`INSERT INTO users (username, passwordHash, name, email, role) VALUES (?, ?, ?, ?, ?)`,
        ["AHMEDETAP", adminHash, "Eng Ahmed Elbaz", "admin@engahmedelbaz.com", "admin"]);
      console.log("[DB] Seeded admin user: AHMEDETAP");
    }

    // Seed demo user (dev only)
    if (!process.env.NODE_ENV || process.env.NODE_ENV !== "production") {
      const [demoRows] = await conn.execute(`SELECT COUNT(*) as c FROM users WHERE username = 'demo'`);
      if ((demoRows?.[0] as any)?.c === 0) {
        const demoHash = await hashPassword("demo123");
        await conn.execute(`INSERT INTO users (username, passwordHash, name, email, role) VALUES(?, ?, ?, ?, ?)`,
          ["demo", demoHash, "Demo Student", "demo@example.com", "user"]);
        console.log("[DB] Seeded demo user: demo (dev only)");
      }
    }

    // ─── Seed courses (unchanged) ───
    const [courseRows] = await conn.execute(`SELECT COUNT(*) as c FROM courses`);
    if ((courseRows?.[0] as any)?.c === 0) {
      await conn.execute(`INSERT INTO courses (slug, categoryId, titleEn, titleAr, shortDescEn, shortDescAr, descriptionEn, descriptionAr, thumbnail, level, isPremium, price, originalPrice, durationHours, rating, reviewCount, studentCount, isFeatured, isPublished, learningOutcomesEn, learningOutcomesAr) VALUES
        ('etap-complete-course', 3, 'ETAP Complete Course — Power System Analysis & Design', 'ETAP — تحليل وتصميم منظومات القدرة', 'Master ETAP for load flow, short circuit, arc flash, and protection coordination studies.', 'أتقن ETAP لدراسات تدفق الحمل والدائرة القصيرة ومتابعة الحماية.', 'Comprehensive ETAP training covering power system modeling, load flow analysis, short circuit calculations, arc flash studies, motor starting, and protection coordination.', 'تدريب شامل على ETAP يغطي نمذجة منظومات القدرة وتحليل تدفق الحمل وحسابات الدائرة القصيرة.', '/course-etap.jpg', 'intermediate', 1, '49.00', '99.00', 42, '4.9', 180, 2400, 1, 1, ?, ?),
        ('advanced-cable-sizing', 2, 'Advanced Cable Sizing & Voltage Drop Calculations', 'تحديد حجم الكابلات المتقدم وهبوط الجهد', 'Learn industry-standard methods for cable sizing, derating, and voltage drop analysis.', 'تعلم الطرق القياسية لتحديد حجم الكابلات والتصنيف وهبوط الجهد.', 'Deep dive into cable sizing methodologies per IEC and NEC standards.', 'غوص عميق في منهجيات تحديد حجم الكابلات حسب معايير IEC وNEC.', '/course-cable.jpg', 'intermediate', 0, '0.00', '0.00', 18, '4.8', 95, 1500, 1, 1, ?, ?),
        ('skm-protection-coordination', 3, 'SKM PowerTools for Protection Coordination', 'SKM PowerTools لتنسيق الحماية', 'Master SKM Dapper and CAPTOR for protection studies and TCC curve plotting.', 'أتقن SKM Dapper وCAPTOR لدراسات الحماية ومنحنيات TCC.', 'Complete SKM PowerTools training for protection engineers.', 'تدريب كامل على SKM PowerTools لمهندسي الحماية.', '/course-skm.jpg', 'advanced', 1, '59.00', '119.00', 28, '4.9', 124, 980, 1, 1, ?, ?),
        ('pvsyst-solar-design', 1, 'PVSyst — Solar PV System Design Masterclass', 'PVSyst — تصميم أنظمة الطاقة الشمسية', 'From site survey to performance ratio — design complete solar PV systems in PVSyst.', 'من المسح الميداني إلى نسبة الأداء — تصميم أنظمة شمسية كاملة في PVSyst.', 'Comprehensive PVSyst training covering meteorological data analysis, 3D shading simulation, system sizing, and production forecasting.', 'تدريب شامل على PVSyst يغطي تحليل البيانات الجوية والمحاكاة ثلاثية الأبعاد وتصميم الأنظمة.', '/course-pvsyst.jpg', 'intermediate', 1, '45.00', '89.00', 22, '4.7', 210, 1800, 1, 1, ?, ?),
        ('powerfactory-loadflow', 3, 'PowerFactory — Load Flow & Short Circuit', 'PowerFactory — تدفق الحمل والدائرة القصيرة', 'Learn DIgSILENT PowerFactory for transmission and distribution system studies.', 'تعلم DIgSILENT PowerFactory لدراسات أنظمة النقل والتوزيع.', 'Hands-on PowerFactory training for load flow, short circuit, and stability analysis.', 'تدريب عملي على PowerFactory لتدفق الحمل والدائرة القصيرة.', '/course-powerfactory.jpg', 'advanced', 0, '0.00', '0.00', 16, '4.8', 67, 750, 0, 1, ?, ?),
        ('electrical-panel-design', 2, 'Electrical Panel Design with AutoCAD', 'تصميم لوحات التوزيع الكهربية باستخدام AutoCAD', 'Design LV/MV electrical panels, MCCs, and switchboards from scratch.', 'تصميم لوحات الجهد المنخفض/المتوسط ولوحات MCC من الصفر.', 'Step-by-step electrical panel design training.', 'تدريب تصميم لوحات كهربية خطوة بخطوة.', '/course-panel.jpg', 'intermediate', 1,'39.00', '79.00', 14, '4.9', 143, 1200, 1, 1, ?, ?)
      `, [
        JSON.stringify(["Build complete power system models in ETAP","Perform load flow and short circuit studies","Design protection coordination schemes","Generate arc flash reports"]),
        JSON.stringify(["بناء نماذج كاملة لمنظومات القدرة في ETAP","إجراء دراسات تدفق الحمل والدائرة القصيرة","تصميم مخططات تنسيق الحماية","إنشاء تقارير ومضات القوس الكهربي"]),
        JSON.stringify(["Size cables per IEC 60364 and NEC Article 310","Calculate voltage drop for 3-phase and 1-phase systems","Apply derating factors for grouping and temperature","Select cables for short-circuit withstand"]),
        JSON.stringify(["تحديد حجم الكابلات حسب IEC 60364 وNEC","حساب هبوط الجهد لأنظمة 3 و1 فاز","تطبيق عوامل التصنيف","اختيار كابلات مقاومة الدائرة القصيرة"]),
        JSON.stringify(["Build TCC curves in SKM CAPTOR","Perform time-current coordination studies","Set relay pickup and time dial settings","Validate protection for motor, transformer, and feeder circuits"]),
        JSON.stringify(["بناء منحنيات TCC في SKM","إجراء دراسات التنسيق الزمني","ضبط إعدادات الريلاي","التحقق من حماية المحركات والمحولات"]),
        JSON.stringify(["Analyze meteorological data for solar projects","Perform 3D shading analysis","Size PV arrays and inverters","Generate yield forecasts and PR analysis"]),
        JSON.stringify(["تحليل البيانات الجوية لمشاريع الطاقة الشمسية","إجراء تحليل الظل ثلاثي الأبعاد","تحديد حجم المصفوفات والمحولات","إنشاء توقعات الإنتاج وتحليل PR"]),
        JSON.stringify(["Build network models in PowerFactory","Run load flow and short circuit simulations","Model renewable energy sources","Perform stability analysis"]),
        JSON.stringify(["بناء نماذج الشبكة في PowerFactory","تشغيل محاكاة تدفق الحمل والدائرة القصيرة","نمذجة مصادر الطاقة المتجددة","إجراء تحليل الاستقرارية"]),
        JSON.stringify(["Design LV/MV switchboards per IEC 61439","Size busbars and select breakers","Create wiring and single-line diagrams","Generate BOM and panel schedules"]),
        JSON.stringify(["تصميم لوحات الجهد المنخفض/المتوسط حسب IEC 61439","تحديد حجم القضبان واختيار القواطع","إنشاء مخططات الأسلاك","توليد BOM وجداول اللوحات"]),
      ]);
      console.log("[DB] Seeded 6 courses");
    }

    // ─── Seed lessons (unchanged) ───
    async function seedLessonsForCourse(courseId: number, lessons: string) {
      const [rows] = await conn.execute(`SELECT COUNT(*) as c FROM lessons WHERE courseId = ?`, [courseId]);
      if ((rows?.[0] as any)?.c === 0) {
        await conn.execute(`INSERT INTO lessons (courseId, titleEn, titleAr, descriptionEn, descriptionAr, durationMinutes, sortOrder, isFree, isPublished) VALUES ` + lessons);
      }
    }
    await seedLessonsForCourse(1, `
      (1, 'Introduction to ETAP Interface', 'مقدمة لواجهة ETAP', 'Overview of ETAP workspace, toolbars, and project navigation.', 'نظرة عامة على مساحة عمل ETAP وأدوات التنقل.', 25, 1, 1, 1),
      (1, 'Creating One-Line Diagrams', 'إنشاء المخططات أحادية الخط', 'Build single-line diagrams with buses, generators, transformers, and loads.', 'بناء المخططات أحادية الخط مع الحافلات والمولدات والمحولات.', 45, 2, 0, 1),
      (1, 'Load Flow Analysis Basics', 'أساسيات تحليل تدفق الحمل', 'Perform load flow studies and interpret voltage and power results.', 'إجراء دراسات تدفق الحمل وتفسير نتائج الجهد والقدرة.', 55, 3, 0, 1),
      (1, 'Short Circuit Calculations', 'حسابات الدائرة القصيرة', 'Calculate fault currents using ANSI and IEC standards.', 'حساب تيارات الأعطال وفق معايير ANSI وIEC.', 60, 4, 0, 1),
      (1, 'Protection Device Coordination', 'تنسيق أجهزة الحماية', 'Set up TCC curves and coordinate relays, fuses, and breakers.', 'إعداد منحنيات TCC وتنسيق الريلايزات والفيوزات.', 50, 5, 0, 1),
      (1, 'Arc Flash Analysis', 'تحليل ومضات القوس الكهربي', 'Perform arc flash hazard analysis per IEEE 1584.', 'إجراء تحليل خطر ومضات القوس وفق IEEE 1584.', 40, 6, 0, 1),
      (1, 'Motor Starting Study', 'دراسة بدء المحركات', 'Analyze motor starting impact on voltage and system stability.', 'تحليل تأثير بدء المحركات على الجهد واستقرار النظام.', 35, 7, 0, 1),
      (1, 'Project Report Generation', 'إنشاء تقارير المشاريع', 'Generate professional study reports and customize output formats.', 'إنشاء تقارير دراسات احترافية وتخصيص صيغ الإخراج.', 30, 8, 1, 1)
    `);
    await seedLessonsForCourse(2, `
      (2, 'Cable Sizing Fundamentals', 'أساسيات تحديد حجم الكابلات', 'Learn cable sizing principles, current carrying capacity, and derating factors.', 'تعلم مبادئ تحديد حجم الكابلات والسعة الحالية وعوامل التصنيف.', 40, 1, 1, 1),
      (2, 'Voltage Drop Calculations', 'حسابات هبوط الجهد', 'Calculate voltage drop for single-phase and three-phase systems.', 'حساب هبوط الجهد لأنظمة أحادية وثلاثية الأطوار.', 50, 2, 1, 1),
      (2, 'Cable Derating & Grouping', 'تصنيف الكابلات وتجميعها', 'Apply derating factors for temperature, grouping, and installation method.', 'تطبيق عوامل التصنيف للحرارة والتجميع وطريقة التركيب.', 45, 3, 0, 1),
      (2, 'Short Circuit Withstand', 'تحمل الدائرة القصيرة للكابلات', 'Select cables that can withstand short-circuit currents per IEC standards.', 'اختيار كابلات تتحمل تيارات الدائرة القصيرة وفق IEC.', 35, 4, 0, 1)
    `);
    await seedLessonsForCourse(3, `
      (3, 'SKM Dapper Interface Overview', 'نظرة عامة على واجهة SKM Dapper', 'Navigate the SKM PowerTools environment and set up your first project.', 'التنقل في بيئة SKM PowerTools وإعداد أول مشروع.', 30, 1, 1, 1),
      (3, 'Building System Models', 'بناء نماذج النظام', 'Create detailed electrical system models with accurate equipment data.', 'إنشاء نماذج نظام كهربائي تفصيلية مع بيانات المعدات الدقيقة.',55, 2, 0, 1),
      (3, 'TCC Curve Plotting in CAPTOR', 'رسم منحنيات TCC في CAPTOR', 'Plot time-current characteristic curves and set protective device settings.', 'رسم منحنيات زمن-تيار وضبط إعدادات أجهزة الحماية.', 50, 3, 0, 1),
      (3, 'Protection Coordination Studies', 'دراسات تنسيق الحماية', 'Perform complete protection coordination for radial and network systems.', 'إجراء تنسيق حماية كامل للأنظمة الشعاعية والشبكية.', 60, 4, 0, 1)
    `);
    await seedLessonsForCourse(4, `
      (4, 'PVSyst Workspace & Meteorological Data', 'مساحة عمل PVSyst والبيانات الجوية', 'Set up PVSyst projects and import meteorological data from various sources.', 'إعداد مشاريع PVSyst واستيراد البيانات الجوية من مصادر مختلفة.', 40, 1, 1, 1),
      (4, '3D Shading Simulation', 'محاكاة الظل ثلاثية الأبعاد', 'Create 3D scene models and perform shading analysis throughout the year.', 'إنشاء نماذج مشاهد ثلاثية الأبعاد وإجراء تحليل الظل على مدار العام.', 55, 2, 0, 1),
      (4, 'PV System Sizing & Inverter Selection', 'تحديد حجم نظام PV واختيار العاكس', 'Size PV arrays, select inverters, and optimize system configuration.', 'تحديد حجم المصفوفات PV واختيار العاكسات وتحسين إعدادات النظام.', 50, 3, 0, 1),
      (4, 'Production Forecasting & PR Analysis', 'توقعات الإنتاج وتحليل PR', 'Generate energy yield forecasts and analyze performance ratio.', 'إنشاء توقعات إنتاج الطاقة وتحليل نسبة الأداء.', 45, 4, 0, 1)
    `);
    await seedLessonsForCourse(5, `
      (5, 'PowerFactory Interface & Project Setup', 'واجهة PowerFactory وإعداد المشاريع', 'Get started with DIgSILENT PowerFactory and configure project settings.', 'البدء مع DIgSILENT PowerFactory وتكوين إعدادات المشروع.', 35, 1, 1, 1),
      (5, 'Network Modeling & Data Entry', 'نمذجة الشبكة وإدخال البيانات', 'Model transmission and distribution networks with accurate parameters.', 'نمذجة شبكات النقل والتوزيع مع معاملات دقيقة.', 50, 2, 0, 1),
      (5, 'Load Flow & Short Circuit Analysis', 'تحليل تدفق الحمل والدائرة القصيرة', 'Run load flow simulations and short circuit studies.', 'تشغيل محاكاة تدفق الحمل ودراسات الدائرة القصيرة.', 55, 3, 0, 1)
    `);
    await seedLessonsForCourse(6, `
      (6, 'Panel Design Standards (IEC 61439)', 'معايير تصميم اللوحات (IEC 61439)', 'Understand IEC 61439 requirements for low-voltage switchgear assemblies.', 'فهم متطلبات IEC 61439 لتجميعات معدات الجهد المنخفض.', 35, 1, 1, 1),
      (6, 'Busbar Sizing & Breaker Selection', 'تحديد حجم القضبان واختيار القواطع', 'Size busbars and select circuit breakers based on fault level and load.', 'تحديد حجم القضبان واختيار القواطع بناء على مستوى العطل والحمل.', 50, 2, 0, 1),
      (6, 'Wiring Diagrams & BOM Generation', 'مخططات الأسلاك وتوليد BOM', 'Create detailed wiring diagrams and generate bills of materials.', 'إنشاء مخططات أسلاك تفصيلية وتوليد قوائم المواد.',45, 3, 0, 1),
      (6, 'Panel Schedule & Documentation', 'جدول اللوحات والتوثيق', 'Produce panel schedules and complete project documentation.', 'إنتاج جداول اللوحات والتوثيق الكامل للمشروع.', 30, 4, 0, 1)
    `);
    console.log("[DB] Lessons checked/seeded for all 6 courses");

    // Seed quiz questions (unchanged)
    async function seedQuizForLesson(lessonId: number, questions: string, values: any[]) {
      const [rows] = await conn.execute(`SELECT COUNT(*) as c FROM quizQuestions WHERE lessonId = ?`, [lessonId]);
      if ((rows?.[0] as any)?.c === 0) {
        await conn.execute(
          `INSERT INTO quizQuestions (lessonId, questionEn, questionAr, optionsEn, optionsAr, correctOptionIndex, explanationEn, explanationAr) VALUES (?, ` + questions.slice(1),
          [lessonId, ...values]
        );
      }
    }
    await seedQuizForLesson(1, `(?, ?, ?, ?, 1, ?, ?)`, [
      'What is the first step when creating a new project in ETAP?',
      'ما هي الخطوة الأولى عند إنشاء مشروع جديد في ETAP؟',
      JSON.stringify(["Draw the one-line diagram","Configure project settings and base values","Run load flow analysis","Add protection devices"]),
      JSON.stringify(["رسم المخطط أحادي الخط","تهيئة إعدادات المشروع والقيم الأساسية","تشغيل تحليل تدفق الحمل","إضافة أجهزة الحماية"]),
      'Before drawing, you must set the project base values (kV, MVA) and frequency.',
      'قبل الرسم، يجب ضبط القيم الأساسية للمشروع (kV, MVA) والتردد.'
    ]);
    await seedQuizForLesson(2, `(?, ?, ?, ?, 1, ?, ?)`, [
      'Which ETAP module is used for short circuit calculations?',
      'أي وحدة في ETAP تُستخدم لحسابات الدائرة القصيرة؟',
      JSON.stringify(["Load Flow","Short Circuit","Arc Flash","Harmonic Analysis"]),
      JSON.stringify(["تدفق الحمل","الدائرة القصيرة","ومضات القوس","تحليل التوافقيات"]),
      'The Short Circuit module calculates fault currents for different fault types.',
      'وحدة الدائرة القصيرة تحسب تيارات العطل لأنواع مختلفة من الأعطال.'
    ]);
    await seedQuizForLesson(9, `(?, ?, ?, ?, 1, ?, ?)`, [
      'What is the primary factor in determining cable ampacity?',
      'ما هو العامل الأساسي في تحديد سعة الكابل؟',
      JSON.stringify(["Conductor cross-sectional area","Cable color","Insulation thickness","Cable weight"]),
      JSON.stringify(["مساحة مقطع الموصل","لون الكابل","سماكة العزل","وزن الكابل"]),
      'Larger cross-sectional area allows more current to flow with less heat.',
      'مساحة المقطع الأكبر تسمح بتدفق تيار أكبر مع حرارة أقل.'
    ]);
    await seedQuizForLesson(13, `(?, ?, ?, ?, 1, ?, ?)`, [
      'Which data source does PVSyst use for solar irradiance?',
      'ما هو المصدر اللي PVSyst بيستخدمه للإشعاع الشمسي؟',
      JSON.stringify(["Meteorological databases (Meteonorm, NASA SSE)","Google Maps","Weather API","Manual input only"]),
      JSON.stringify(["قواعد بيانات الأرصاد الجوية","خرائط جوجل","واجهة الطقس","إدخال يدوي فقط"]),
      'PVSyst imports hourly irradiance data from meteorological databases.',
      'PVSyst يستورد بيانات الإشعاع الساعي من قواعد بيانات الأرصاد الجوية.'
    ]);
    await seedQuizForLesson(17, `(?, ?, ?, ?, 1, ?, ?)`, [
      'What standard covers low-voltage switchgear assembly design?',
      'ما هو المعيار اللي يغطي تصميم تجميعات معدات الجهد المنخفض؟',
      JSON.stringify(["IEC 61439","IEC 60947","IEEE 1584","NEC Article 240"]),
      JSON.stringify(["IEC 61439","IEC 60947","IEEE 1584","NEC المادة 240"]),
      'IEC 61439 specifies requirements for low-voltage switchgear assemblies.',
      'IEC 61439 يحدد متطلبات تجميعات معدات الجهد المنخفض.'
    ]);
    console.log("[DB] Quiz questions checked/seeded");

    await conn.end();
    console.log("[DB] All 17 tables verified and seeded");
  } catch (e) {
    console.error("[DB] Table creation error: " + String(e));
    try { await conn.end(); } catch (_) {}
  }
}

console.log("===== Application Startup =====");
console.log("Server running on port " + PORT);
console.log("Static files: " + DIST_PUBLIC);
console.log("DB: " + (process.env.DATABASE_URL ? "OK" : "not set"));
console.log("Chat: " + ((process.env.OPENROUTER_API_KEY || process.env.CHATBOT_API_KEY) ? "OK" : "not set"));
console.log("tRPC: /api/trpc/*");

const KEEP_ALIVE_MS = 5 * 60 * 1000;
let keepAliveCount = 0;

async function dbKeepAlive() {
  try {
    const conn = await mysql.createConnection(process.env.DATABASE_URL || "");
    await conn.execute("SELECT 1");
    await conn.end();
    keepAliveCount++;
    if (keepAliveCount % 12 === 1) {
      console.log("[Keep-Alive] DB ping #" + keepAliveCount + " OK (" + new Date().toISOString()+ ")");
    }
  } catch (e) {
    console.error("[Keep-Alive] DB ping failed: " + String(e));
  }
}

setInterval(dbKeepAlive, KEEP_ALIVE_MS);
setTimeout(dbKeepAlive, 10000);

ensureTables().then(function() {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log("[Server] Running on http://localhost:" + info.port);
  });
  console.log("[Keep-Alive] DB ping every 5 min to prevent Aiven auto-poweroff");
}).catch(function(e) {
  console.error("Failed to initialize database: " + String(e));
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log("[Server] Running on http://localhost:" + info.port + " (DB init failed)");
  });
});