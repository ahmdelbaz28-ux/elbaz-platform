import { timingSafeEqual } from "node:crypto";
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

  // ✅ SECURITY FIX (audit run-1, shield.payload-guard): the cap previously
  // compared ONLY the client-controlled Content-Length header — a chunked
  // body (no header) parsed as 0 and bypassed the guard entirely, letting
  // arbitrarily large bodies buffer into the Node heap. Body-carrying
  // requests without a verifiable length are now rejected (411); browsers,
  // axios/fetch and every S2S client send Content-Length on fixed-size bodies.
  const contentLength = Number.parseInt(c.req.header("Content-Length") || "", 10);
  if (!Number.isFinite(contentLength)) {
    return c.json({ error: "Length Required" }, 411);
  }
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

// ── v1.1.3 origin-gate hardening helpers ────────────────────────────────────

/**
 * Timing-safe operator Bearer check for the host gate. Reads the secret from
 * process.env directly (same source the zod env schema validates) so the gate
 * stays testable without import-order coupling to env.ts. Unset/short secret
 * → the lane never opens (fail-closed, byte-identical behavior for everyone).
 * Same disguise contract as health-router's operator gate: mismatched secret
 * is indistinguishable from "no lane" — nothing about its existence leaks.
 */
export function isOperatorBearer(authHeader: string | undefined): boolean {
  const secret = process.env.EDGE_ORIGIN_SECRET;
  if (!secret || secret.length < 32) return false;
  const presented = (authHeader ?? "").startsWith("Bearer ")
    ? (authHeader ?? "").slice(7).trim()
    : "";
  if (!presented) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Throttled spoof-detection warn: direct-origin probes can spam, so cap the
// log noise at 5 lines/minute while still recording every distinct burst.
const SPOOF_LOG_MAX_PER_MIN = 5;
let spoofLogCount = 0;
let spoofLogWindowStart = 0;

function warnSpoofedForwardedHostThrottled(xfHost: string, host0: string, path: string, hasCfFingerprint: boolean): void {
  const now = Date.now();
  if (now - spoofLogWindowStart >= 60_000) {
    spoofLogWindowStart = now;
    spoofLogCount = 0;
  }
  if (spoofLogCount >= SPOOF_LOG_MAX_PER_MIN) return;
  spoofLogCount++;
  logger.warn("[Shield] x-forwarded-host spoof probe on raw origin", {
    claimed: xfHost,
    actualHost: host0,
    path,
    hasCfRay: hasCfFingerprint,
    note: "space router passes client x-forwarded-host through — gate is advisory; hard closure = CF Worker secret header",
  });
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
    // YouTube playlist ingest (/api/yt-sync/*): pushes from the GH Actions
    // relay AND the worker cron arrive on the raw hf.space host — exactly the
    // host this gate blocks (measured 2026-11-10: shield-404 for the same
    // payload that a different egress path delivered). The route is
    // HMAC-verified fail-closed INSIDE its handler (x-sync-signature over the
    // raw body, timing-safe compare) — the host gate adds nothing there.
    // Exempt it like the Paymob webhook above so the playlist mirror never
    // depends on which egress path a relay happens to use.
    const isYtSyncIngest = c.req.path.startsWith("/api/yt-sync/");
    if (!isEmbedFrame && !isInternal && !isPaymobWebhook && !isYtSyncIngest) {
      const xfHost = (c.req.header("x-forwarded-host") ?? "").split(",")[0].trim().toLowerCase();
      const effective = xfHost || host0;
      // ✅ v1.1.3 HARDENING (origin E2E audit 2026-11-20): the space router
      // passes a client-supplied x-forwarded-host through UNCHANGED (measured:
      // `curl -H "x-forwarded-host: ahmedelbaz.qzz.io"` direct to the raw
      // *.hf.space origin returned 200 for gated endpoints) — so this gate is
      // spoofable by construction. Two zero-breakage levers shipped now:
      //   1. OPERATOR LANE — a timing-safe EDGE_ORIGIN_SECRET Bearer proves
      //      operator identity and bypasses the disguise, giving monitoring
      //      and origin E2E a legitimate path (no header spoofing needed).
      //   2. SPOOF DETECTION — whenever the gate passes on the RAW space host
      //      via a client-supplied x-forwarded-host, a throttled warn lands in
      //      the ops log, making direct-origin probing visible.
      //   The cryptographic closure is a Cloudflare Worker injecting a secret
      //   header on canonical-domain routes only (infra change, documented in
      //   the E2E report) — every header at the container is client-writable,
      //   so no app-side check can be stronger than this without it.
      // Raw-origin spoof probe: host header is the space subdomain while a
      // client-supplied x-forwarded-host claims a different (allowed) host.
      // Requests that genuinely traversed Cloudflare always carry cf-ray (CF
      // injects it on every served request) — so a spoof WITHOUT any CF
      // fingerprint is the reliable direct-origin-probe signal. The hasCfRay
      // field in the log settles, within a day of live traffic, whether HF's
      // router forwards cf-* headers (if domain traffic ever logs with
      // hasCfRay:false, the detector threshold can be revisited).
      if (host0.endsWith(".hf.space") && xfHost && xfHost !== host0) {
        const hasCfRay = Boolean(c.req.header("cf-ray"));
        if (!hasCfRay) {
          warnSpoofedForwardedHostThrottled(xfHost, host0, c.req.path, false);
        }
      }
      if (isOperatorBearer(c.req.header("authorization"))) {
        // Operator lane: fall through to the rest of the shield (rate limits,
        // payload guard, etc.) but SKIP the host allowlist rejection below —
        // the middleware must still call next(), never return early here.
      } else {
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
        // ✅ UX FIX (pre-launch audit run-2, shield.redirect-legacy-host): a
        // human opening the legacy *.hf.space URL in a browser used to hit a
        // bare `404 {"error":"Not Found"}` and read it as "the site is down"
        // (it is live on the canonical domain). Browser NAVIGATIONS
        // (GET/HEAD, non-API) are now 302-redirected to the canonical domain,
        // preserving path + query. Everything else (API calls, POSTs —
        // redirecting those would replay bodies into GETs) keeps the
        // fail-closed 404 JSON.
        const method = c.req.method.toUpperCase();
        const isApiPath = c.req.path.startsWith("/api/");
        if (!isApiPath && (method === "GET" || method === "HEAD")) {
          const qs = new URL(c.req.raw.url).search || "";
          return c.redirect(`https://ahmedelbaz.qzz.io${c.req.path}${qs}`, 302);
        }
        return c.json({ error: "Not Found" }, 404);
      }
      } // end else (non-operator: host allowlist enforcement)
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
