import { createMiddleware } from "hono/factory";

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

const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds
const RATE_LIMIT_MAX_REQUESTS = 200;
const MEMORY_PRESSURE_LIMIT_MB = 800;
const RATE_LIMIT_MAP_MAX_SIZE = 5000;

function getClientIp(c: any): string {
  return c.req.header("cf-connecting-ip")
    || c.req.header("x-forwarded-for")?.split(",")[0].trim()
    || "127.0.1";
}

function checkRateLimit(c: any, ip: string, path: string): Response | null {
  const now = Date.now();
  let record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
  }
  record.count++;
  rateLimitMap.set(ip, record);

  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    console.warn(`[Shield] Rate limit exceeded for IP: ${ip} on path: ${path}`);
    c.header("Retry-After", "10");
    return c.json({
      error: "Too Many Requests",
      message: "Please slow down. Our systems are protecting themselves from overload."
    }, 429);
  }
  return null;
}

function checkPayloadSize(c: any, path: string): Response | null {
  const method = c.req.method;
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return null;

  const contentLength = Number.parseInt(c.req.header("Content-Length") || "0", 10);
  const isFileUpload = path.includes("/upload") || path.includes("/r2");
  const maxPayload = isFileUpload ? 100 * 1024 * 1024 : 1024 * 1024;

  if (contentLength > maxPayload) {
    console.error(`[Shield] Payload too large from IP. Size: ${contentLength}`);
    return c.json({ error: "Payload Too Large" }, 413);
  }
  return null;
}

function isSuspiciousBotRequest(ua: string, path: string): boolean {
  const isSensitivePath = path.includes("/api/auth") || path.includes("/api/admin");
  if (!isSensitivePath) return false;
  const isKnownBot = /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|facebot|ia_archiver/i.test(ua);
  if (isKnownBot) return false;
  const isSuspiciousAgent = /^(curl|postman|python-requests|go-http-client|java|axios)\b/i.test(ua);
  return isSuspiciousAgent;
}

function checkMemoryPressure(c: any, path: string): Response | null {
  const mem = process.memoryUsage();
  const memoryUsageMB = mem.heapUsed / 1024 / 1024;
  if (memoryUsageMB <= MEMORY_PRESSURE_LIMIT_MB) return null;

  console.warn(`[Shield] High Memory Pressure Detected (${Math.round(memoryUsageMB)}MB). Throttling traffic.`);
  if (path.startsWith("/api/") && !path.includes("/auth") && !path.includes("/health")) {
    return c.json({ error: "Service Under Pressure" }, 503);
  }
  return null;
}

function cleanupRateLimitMap(): void {
  if (rateLimitMap.size <= RATE_LIMIT_MAP_MAX_SIZE) return;
  const cleanupNow = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (cleanupNow > val.resetTime) rateLimitMap.delete(key);
  }
}

export const shieldMiddleware = createMiddleware(async (c, next) => {
  const ip = getClientIp(c);
  const path = c.req.path;

  const rateLimited = checkRateLimit(c, ip, path);
  if (rateLimited) return rateLimited;

  const payloadRejected = checkPayloadSize(c, path);
  if (payloadRejected) return payloadRejected;

  const ua = c.req.header("User-Agent") || "";
  if (isSuspiciousBotRequest(ua, path)) {
    console.warn(`[Shield] Suspicious agent on sensitive path: ${ua} -> ${path}`);
    return c.json({ error: "Access Denied" }, 403);
  }

  const pressureResponse = checkMemoryPressure(c, path);
  if (pressureResponse) return pressureResponse;

  cleanupRateLimitMap();

  await next();
});
