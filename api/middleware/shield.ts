import { createMiddleware } from "hono/factory";
import { getClientIpFromHono as getClientIp } from "../lib/client-ip.js";
import { logger } from "../lib/logger.js";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkRateLimit(c: any, ip: string, path: string): Response | null {
  const now = Date.now();
  let record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };
  }
  record.count++;
  rateLimitMap.set(ip, record);

  if (record.count > RATE_LIMIT_MAX_REQUESTS) {
    logger.warn(`[Shield] Rate limit exceeded`, { ip, path });
    c.header("Retry-After", "10");
    return c.json({
      error: "Too Many Requests",
      message: "Please slow down. Our systems are protecting themselves from overload."
    }, 429);
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkPayloadSize(c: any, ip: string, path: string): Response | null {
  const method = c.req.method;
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return null;

  const contentLength = Number.parseInt(c.req.header("Content-Length") || "0", 10);
  const isFileUpload = path.includes("/upload") || path.includes("/r2");
  const maxPayload = isFileUpload ? 100 * 1024 * 1024 : 1024 * 1024;

  if (contentLength > maxPayload) {
    logger.error(`[Shield] Payload too large`, { ip, contentLength });
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkMemoryPressure(c: any, path: string): Response | null {
  const mem = process.memoryUsage();
  const memoryUsageMB = mem.heapUsed / 1024 / 1024;
  if (memoryUsageMB <= MEMORY_PRESSURE_LIMIT_MB) return null;

  logger.warn(`[Shield] High memory pressure detected`, { memoryUsageMB: Math.round(memoryUsageMB) });
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
  // ✅ SECURITY (post-audit, MEASURED not assumed): host-allowlist at the origin.
  //
  // Why not the HMAC edge signature? Live verification proved the production
  // domain ahmedelbaz.qzz.io is NOT a Cloudflare zone on this account and is
  // NOT routed through the worker: it is an external DNS record pointing at
  // *.hf.space, and Cloudflare in the response headers is Hugging Face's own
  // edge. The worker only ever served workers.dev (behind Access). So an
  // origin-side HMAC requirement blocks the real domain too — there is no
  // signer in the request path (measured, then rolled back).
  //
  // What IS reliably distinguishable at the origin (via HF's proxy) is the
  // original Host: domain traffic arrives with x-forwarded-host: ahmedelbaz.qzz.io,
  // while direct *.hf.space visitors arrive with the space host. This middleware
  // therefore enforces a host allowlist when EDGE_HOST_ENFORCE=1:
  //   allowed: x-forwarded-host/Host ∈ {FRONTEND_URL host, qzz.io, CORS origins}
  //   exception: Sec-Fetch-Dest: iframe (keeps the HF Space page embed working —
  //   browser-controlled header; a scripted client CAN spoof it, documented
  //   trade-off). Core controls (auth, rate limits, validation) live below and
  //   are unaffected.
  // Without the flag (default) behavior is unchanged, so rollouts are safe.
  if (process.env.EDGE_HOST_ENFORCE === "1") {
    const isEmbedFrame = c.req.header("sec-fetch-dest") === "iframe";
    // Container-internal healthcheck (Dockerfile: wget localhost:7860/api/health)
    // reaches the app through the same middleware stack — never block it.
    const host0 = (c.req.header("host") ?? "").trim().toLowerCase();
    const isInternal = host0.startsWith("localhost") || host0.startsWith("127.0.0.1") || host0 === "0.0.0.0:7860";
    // Paymob server-to-server webhook: arrives with whatever host is registered
    // in the Paymob dashboard (may be the direct hf.space host) and is already
    // HMAC-verified fail-closed inside paymob-webhook.ts — exempt from the
    // host gate so payments keep working regardless of the registered host.
    // /api/webhooks/paymob is the dashboard-registered legacy alias of the
    // same handler (mobile-wallet classic flow).
    const isPaymobWebhook = c.req.path.startsWith("/api/paymob") || c.req.path.startsWith("/api/webhooks/paymob");
    if (!isEmbedFrame && !isInternal && !isPaymobWebhook) {
      const xfHost = (c.req.header("x-forwarded-host") ?? "").split(",")[0].trim().toLowerCase();
      const effective = xfHost || host0;
      // EXPLICIT allowlist — deliberately NOT built from CORS_ORIGINS: measured
      // live, it contains the hf.space host itself, which would re-open the
      // very door this gate closes.
      const allowed = new Set<string>(["ahmedelbaz.qzz.io"]);
      const fe = process.env.FRONTEND_URL ?? "";
      if (fe) {
        try {
          allowed.add(new URL(fe).host.toLowerCase());
        } catch {
          allowed.add(fe.trim().toLowerCase());
        }
      }
      if (!effective || !allowed.has(effective)) {
        logger.warn("[Shield] Rejected request with disallowed host", {
          path: c.req.path,
          host: effective || "(none)",
        });
        return c.json({ error: "Not Found" }, 404);
      }
    }
  }

  const ip = getClientIp(c);
  const path = c.req.path;

  const rateLimited = checkRateLimit(c, ip, path);
  if (rateLimited) return rateLimited;

  const payloadRejected = checkPayloadSize(c, ip, path);
  if (payloadRejected) return payloadRejected;

  const ua = c.req.header("User-Agent") || "";
  if (isSuspiciousBotRequest(ua, path)) {
    logger.warn(`[Shield] Suspicious agent on sensitive path`, { userAgent: ua, path });
    return c.json({ error: "Access Denied" }, 403);
  }

  const pressureResponse = checkMemoryPressure(c, path);
  if (pressureResponse) return pressureResponse;

  cleanupRateLimitMap();

  await next();
  return; // NOSONAR — S3626: explicit return needed for noImplicitReturns TypeScript strict mode
});
