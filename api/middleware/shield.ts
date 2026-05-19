import { createMiddleware } from "hono/factory";
import { env } from "../lib/env.js";

/**
 * 🛡️ Elite Shield Middleware v1
 * ═══════════════════════════
 * This is the ultimate "Digital Firewall" for the Elbaz Platform.
 * 1. Rate Limiting (Flood Protection)
 * 2. Payload Size Guard (Anti-OOM)
 * 3. Bot/Scraper Filtering
 * 4. Automatic System Pressure Relief
 */

// Simple in-memory rate limiter (Elite standard for non-Redis environments)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export const shieldMiddleware = createMiddleware(async (c, next) => {
  const ip = c.req.header("cf-connecting-ip") || 
             c.req.header("x-forwarded-for")?.split(",")[0].trim() || 
             "127.0.0.1";
  
  const now = Date.now();
  const path = c.req.path;
  
  // ── 1. Rate Limiting (Flood Protection) ──
  // Allow 200 requests per 10 seconds per IP (complements tRPC rate limiter)
  const limitWindow = 10000; 
  const limitCount = 200;
  
  let record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 0, resetTime: now + limitWindow };
  }
  
  record.count++;
  rateLimitMap.set(ip, record);
  
  if (record.count > limitCount) {
    console.warn(`[Shield] Rate limit exceeded for IP: ${ip} on path: ${path}`);
    c.header("Retry-After", "10");
    return c.json({ 
      error: "Too Many Requests", 
      message: "Please slow down. Our systems are protecting themselves from overload." 
    }, 429);
  }

  // ── 2. Payload Size Guard (Anti-OOM) ──
  const method = c.req.method;
  const contentLength = parseInt(c.req.header("Content-Length") || "0", 10);

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const isFileUpload = path.includes("/upload") || path.includes("/r2");
    const maxPayload = isFileUpload ? 100 * 1024 * 1024 : 1024 * 1024; // 100MB for files, 1MB for data

    if (contentLength > maxPayload) {
      console.error(`[Shield] Payload too large from IP: ${ip}. Size: ${contentLength}`);
      return c.json({ error: "Payload Too Large" }, 413);
    }
  }

  // ── 3. Bot / Malicious Agent Filtering ──
  // Only block unknown bots on sensitive auth/admin paths. Allow known crawlers and tools.
  const ua = c.req.header("User-Agent") || "";
  const isSensitivePath = path.includes("/api/auth") || path.includes("/api/admin");
  const isKnownBot = /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|facebot|ia_archiver/i.test(ua);
  const isSuspiciousAgent = /^(curl|postman|python-requests|go-http-client|java|axios)\b/i.test(ua);
  if (isSensitivePath && isSuspiciousAgent && !isKnownBot) {
    console.warn(`[Shield] Suspicious agent on sensitive path: ${ua} -> ${path}`);
    return c.json({ error: "Access Denied" }, 403);
  }

  // ── 4. Automatic System Pressure Relief ──
  const mem = process.memoryUsage();
  const memoryUsage = mem.heapUsed / mem.heapTotal;
  if (memoryUsage > 0.9) {
    console.warn(`[Shield] High Memory Pressure Detected (90%+). Throttling traffic.`);
    if (path.startsWith("/api/")) {
      // Return 503 for non-critical API calls to shed load
      if (!path.includes("/auth") && !path.includes("/health")) {
        return c.json({ error: "Service Under Pressure" }, 503);
      }
    }
  }

  // Periodically clean the rate limit map to prevent memory leaks
  if (rateLimitMap.size > 5000) {
    const cleanupNow = Date.now();
    for (const [key, val] of rateLimitMap.entries()) {
      if (cleanupNow > val.resetTime) rateLimitMap.delete(key);
    }
  }

  await next();
});
