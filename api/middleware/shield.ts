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
  // Allow 100 requests per 10 seconds per IP (Elite threshold)
  const limitWindow = 10000; 
  const limitCount = 100;
  
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
  // Prevent huge POST/PUT requests (max 10MB for videos/files, 100KB for others)
  const method = c.req.method;
  const contentLength = parseInt(c.req.header("Content-Length") || "0", 10);
  
  if (method === "POST" || method === "PUT" || method === "PATCH") {
    const isFileUpload = path.includes("/upload") || path.includes("/r2");
    const maxPayload = isFileUpload ? 1024 * 1024 * 1024 : 1024 * 1024; // 1GB for files, 1MB for data
    
    if (contentLength > maxPayload) {
      console.error(`[Shield] Payload too large from IP: ${ip}. Size: ${contentLength}`);
      return c.json({ error: "Payload Too Large" }, 413);
    }
  }

  // ── 3. Bot / Malicious Agent Filtering ──
  const ua = c.req.header("User-Agent") || "";
  const maliciousBots = /bot|spider|crawl|curl|postman|python|go-http-client|java|axios/i;
  // We allow Clarity and GoogleBot, block others if they hit sensitive paths
  if (maliciousBots.test(ua) && (path.includes("/api/auth") || path.includes("/api/admin"))) {
    console.warn(`[Shield] Suspicious Bot detected: ${ua} on path: ${path}`);
    return c.json({ error: "Access Denied" }, 403);
  }

  // ── 4. Automatic System Pressure Relief ──
  const memoryUsage = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal;
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
