import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { getPublicEnvKeys, env } from "./lib/env.js";
import { db, pool } from "./queries/connection.js";
import { sql } from "drizzle-orm";
import { getCache, cacheKeys, CACHE_TTL } from "./lib/cache.js";
import { logger } from "./lib/logger.js";
import { resolvePaymobRuntimeConfig } from "./lib/payments-config.js";
import { isPaymobConfigComplete } from "./lib/paymob.js";
import { getTelegramBotStatus } from "./lib/telegram-bot.js";

const healthRouter = new Hono({ strict: false });

interface HealthCheckSnapshot {
  status: string;
  latency_ms: number;
  error?: string;
  type?: string;
  detail?: string;
}


healthRouter.get("/health", async (c) => {
  const cache = getCache();
  const cached = await cache.get<{ checks: Record<string, HealthCheckSnapshot> }>(cacheKeys.healthCheck());

  if (cached) {
    const isHealthy = Object.values(cached.checks).every((check) => check.status === "healthy" || check.status === "degraded");
    return c.json(
      {
        status: isHealthy ? "ok" : "unhealthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version ?? "unknown",
        checks: cached.checks,
        env: getPublicEnvKeys(),
        cached: true,
      },
      isHealthy ? 200 : 503
    );
  }

  const startTime = Date.now();
  const checks: Record<string, HealthCheckSnapshot> = {};

  // 1. Database Check
  try {
    const dbStart = Date.now();
    const [result] = await db.execute(sql`SELECT 1 AS ok`);
    const poolStatus = pool.pool ? "active" : "created";
    checks.database = {
      status: result ? "healthy" : "unhealthy",
      latency_ms: Date.now() - dbStart,
      detail: `pool=${poolStatus}, connectionLimit=10`,
    };
  } catch (error) {
    // ✅ SECURITY HARDENING (post-audit): never echo raw driver errors
    // (mysql2 messages include host/port/protocol details) to unauthenticated
    // callers. Full detail goes to structured logs only.
    logger.error("[Health] Database check failed", { error: error instanceof Error ? error.message : String(error) });
    checks.database = {
      status: "unhealthy",
      latency_ms: Date.now() - startTime,
      error: "database unavailable",
    };
  }

  // 2. Cache (Redis / In-Memory) Check
  try {
    const redisStart = Date.now();
    const testKey = `health:test:${Date.now()}`;
    await cache.set(testKey, "ok", 5);
    const val = await cache.get(testKey);
    await cache.del(testKey);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isRedis = typeof (cache as any).getClient === "function";
    const cacheType = isRedis ? (env.REDIS_URL ? "redis" : "memory_fallback") : "memory";
    checks.cache = {
      status: val === "ok" ? "healthy" : "degraded",
      latency_ms: Date.now() - redisStart,
      type: cacheType,
      detail: cacheType === "redis" ? "Redis distributed cache" : "In-memory LRU cache (max 500 entries)",
    };
  } catch {
    checks.cache = { status: "degraded", latency_ms: 0, error: "Cache check failed", type: "unknown" };
  }

  // 3. Storage (R2) Check — verify config + endpoint reachability
  try {
    const r2Start = Date.now();
    // Derive endpoint from account ID if not set (matching r2.ts logic)
    const r2Endpoint = env.R2_ENDPOINT || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "");
    const r2Configured = r2Endpoint && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME;
    if (r2Configured) {
      const r2BaseUrl = r2Endpoint.replace(/\/$/, "");
      const r2Response = await fetch(r2BaseUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      // S3-compatible APIs (including R2) return:
      // - 200: public bucket listing enabled (rare)
      // - 400: Bad request (missing auth params) — endpoint IS reachable
      // - 403: Forbidden (auth required) — endpoint IS reachable
      // All three mean the endpoint is healthy. Only 5xx or network errors mean unhealthy.
      const isReachable = r2Response.ok || r2Response.status === 400 || r2Response.status === 403;
      checks.storage = {
        status: isReachable ? "healthy" : "degraded",
        latency_ms: Date.now() - r2Start,
        detail: r2Response.ok
          ? "R2 endpoint reachable"
          : r2Response.status === 403
            ? "R2 endpoint reachable (auth required for listing)"
            : r2Response.status === 400
              ? "R2 endpoint reachable (S3 API responding)"
              : `R2 responded with ${r2Response.status}`,
      };
    } else {
      checks.storage = {
        status: "degraded",
        latency_ms: 0,
        detail: env.R2_ENDPOINT ? "R2 credentials incomplete" : "R2 not configured",
      };
    }
  } catch {
    checks.storage = { status: "unhealthy", latency_ms: 0, error: "R2 endpoint unreachable" };
  }

  // 4. Resend (Email) Check — REAL readiness, not a black-box ping.
  // ROOT-CURE (2026-10-29): the old probe (GET /audiences) answered an opaque
  // "400" with zero actionable detail. /domains is the endpoint that actually
  // governs sending (a verified domain = production email allowed; sandbox
  // mode can only reach the account owner), and EVERY failure now surfaces
  // Resend's own message so the next diagnosis is instant.
  try {
    const emailStart = Date.now();
    if (env.RESEND_API_KEY) {
      const emailResponse = await fetch("https://api.resend.com/domains", {
        method: "GET",
        signal: AbortSignal.timeout(5000),
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}` },
      });
      const emailLatency = Date.now() - emailStart;
      const emailBody = await emailResponse.text().catch(() => "");
      const resendMsg = (() => {
        try {
          const parsed = JSON.parse(emailBody) as { message?: string };
          return typeof parsed?.message === "string" ? parsed.message.slice(0, 140) : "";
        } catch {
          return "";
        }
      })();
      if (emailResponse.ok) {
        // Verified-domain count = the actual sending-readiness signal.
        let verified = -1;
        try {
          const data = (JSON.parse(emailBody) as { data?: Array<{ status?: string }> }).data;
          if (Array.isArray(data)) verified = data.filter((d) => d.status === "verified").length;
        } catch {
          // body shape changed — verified stays -1, plain healthy below
        }
        checks.email =
          verified > 0
            ? { status: "healthy", latency_ms: emailLatency, detail: `Resend reachable — ${verified} verified domain(s)` }
            : verified === 0
              ? {
                  status: "degraded",
                  latency_ms: emailLatency,
                  detail: "Resend reachable — NO verified domain (sandbox: only the account owner receives)",
                }
              : { status: "healthy", latency_ms: emailLatency, detail: "Resend API reachable" };
      } else if (emailResponse.status === 401) {
        checks.email = {
          status: "unhealthy",
          latency_ms: emailLatency,
          detail: "Resend key invalid or revoked",
          error: resendMsg || "HTTP 401 — rotate the key at resend.com/api-keys",
        };
      } else {
        checks.email = {
          status: "degraded",
          latency_ms: emailLatency,
          detail: `Resend HTTP ${emailResponse.status}${resendMsg ? `: ${resendMsg}` : ""}`,
          error: resendMsg || undefined,
        };
      }
    } else {
      checks.email = { status: "degraded", latency_ms: 0, detail: "RESEND_API_KEY not configured" };
    }
  } catch {
    checks.email = { status: "unhealthy", latency_ms: 0, error: "Resend endpoint unreachable" };
  }

  // 5. AI Check — provider cascade readiness (configured keys only, no network).
  // ROOT-CURE (Proposal ③): the old check looked at OPENROUTER only and the
  // cascade could silently be standing on kilo alone. All four tiers are now
  // visible — missing tiers tell the owner exactly which free key to add.
  {
    const providerMap: Array<[string, string | undefined]> = [
      ["kilo", env.KILOCODE_API_KEY],
      ["openrouter", env.OPENROUTER_API_KEY],
      ["nvidia", env.NVIDIA_API_KEY],
      ["groq", env.GROQ_API_KEY],
    ];
    const configured = providerMap.filter(([, v]) => Boolean(v)).map(([name]) => name);
    const missing = providerMap.filter(([, v]) => !v).map(([name]) => name);
    if (configured.length > 0) {
      checks.ai = {
        status: "healthy",
        latency_ms: 0,
        detail: `providers: ${configured.join(" + ")}${missing.length ? ` — missing: ${missing.join(", ")}` : " — full cascade"}`,
      };
    } else {
      checks.ai = { status: "degraded", latency_ms: 0, detail: "No AI provider configured" };
    }
  }

  // 6. Payments Check — Paymob gateway (env + dashboard settings) or manual transfer fallback
  try {
    const paymobCfg = await resolvePaymobRuntimeConfig();
    if (isPaymobConfigComplete(paymobCfg)) {
      checks.payments = { status: "healthy", latency_ms: 0, detail: "Paymob gateway configured" };
    } else {
      checks.payments = { status: "degraded", latency_ms: 0, detail: "Paymob not fully configured — manual transfer only (if admin filled siteSettings payments section)" };
    }
  } catch (error) {
    // ✅ SECURITY FIX (audit run-1, health-router.payments-check): mirror the
    // database-check hardening — mysql2 driver errors include host/port and
    // must never reach the unauthenticated response. Log the real error
    // instead (the DB check at the top of this file established the pattern).
    logger.error("[Health] Payments config check failed", { error: error instanceof Error ? error.message : String(error) });
    checks.payments = { status: "degraded", latency_ms: 0, detail: "Payments config check failed" };
  }

  // 7. Telegram worker check — liveness of the bot's supervised poller
  // (join-request auto-approval + DM expert brain). Informational only: a
  // dead worker must NOT mark the whole platform unhealthy — but it must be
  // VISIBLE (root-cure of the silent-death incident where the bot stopped
  // answering DMs with zero external signal).
  try {
    const { telegramApiBase } = await import("./lib/telegram-transport.js");
    const st = getTelegramBotStatus();
    const transport = telegramApiBase() === "https://api.telegram.org" ? "direct" : "relay";
    const detailParts = [`worker=${st.status}`, `transport=${transport}`];
    if (st.botUsername) detailParts.push(`bot=@${st.botUsername}`);
    if (st.lastPollOkAt) detailParts.push(`lastPollOk=${Math.max(0, Math.round((Date.now() - st.lastPollOkAt) / 1000))}s ago`);
    if (st.handledUpdates > 0) detailParts.push(`handled=${st.handledUpdates}`);
    if (st.bootAttempts > 1) detailParts.push(`bootAttempts=${st.bootAttempts}`);
    if (st.conflicts > 0) detailParts.push(`conflicts=${st.conflicts}`);
    if (st.lastError) detailParts.push(`lastError=${st.lastError.slice(0, 100)}`);
    checks.telegram = {
      status: st.status === "running" ? "healthy" : st.status === "disabled" ? "degraded" : "unhealthy",
      latency_ms: 0,
      detail: detailParts.join(", "),
    };
  } catch {
    checks.telegram = { status: "degraded", latency_ms: 0, detail: "Telegram worker status unavailable" };
  }

  await cache.set(cacheKeys.healthCheck(), { checks }, CACHE_TTL.HEALTH_CHECK);

  const dbHealthy = checks.database.status === "healthy";
  const allHealthy = dbHealthy; // Database is the only critical dependency

  return c.json(
    {
      status: allHealthy ? "ok" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version ?? "unknown",
      checks,
      env: getPublicEnvKeys(),
      cached: false,
    },
    allHealthy ? 200 : 503
  );
});

// ═══════════════════════════════════════════════════════════════════════
// Deep provider probe — GET /health/providers
// ROOT-CURE (Proposal ③, layer 2): the daily GH probe only sees the keys
// mirrored into GitHub secrets — but the cascade actually runs on THIS
// process with the Space's own env. This endpoint probes every configured
// provider key with a real, cheap call (same semantics as
// scripts/provider-probe.ts) and reports STATUSES ONLY — never key material.
//
// Gate: Authorization: Bearer <EDGE_ORIGIN_SECRET>, compared timing-safe.
// Unset secret or wrong token → disguised 404, same as the shield's rejection.
// ═══════════════════════════════════════════════════════════════════════
const PROVIDER_PROBE_TIMEOUT_MS = 8_000;

interface ProviderProbeRow {
  name: string;
  configured: boolean;
  status: "HEALTHY" | "UNHEALTHY" | "MISSING";
  latency_ms: number;
  detail: string;
}

function probeJsonMessage(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as { message?: string; detail?: string; error?: { message?: string } };
    // `detail` is NVIDIA's error field ("Function ...: Not found for account"),
    // `message` is OpenAI-style, `error.message` is gateway-style.
    const msg =
      (typeof parsed?.message === "string" && parsed.message) ||
      (typeof parsed?.detail === "string" && parsed.detail) ||
      (typeof parsed?.error === "object" && parsed?.error !== null && typeof (parsed.error as { message?: string }).message === "string"
        ? (parsed.error as { message: string }).message
        : "");
    return msg.slice(0, 120);
  } catch {
    return "";
  }
}

/**
 * REAL key validation for gateways whose GET /models is PUBLIC (kilo, NVIDIA):
 * a 1-token chat completion is the honest check — the exact lane the chatbot
 * uses, costing one token per probe. A model-not-served error still proves
 * AUTH (the gateway validates the key before the model).
 */
async function probeAuthChat(name: string, key: string | undefined, baseUrl: string, fallbackModel: string): Promise<ProviderProbeRow> {
  if (!key?.trim()) return { name, configured: false, status: "MISSING", latency_ms: 0, detail: "key not configured" };
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: fallbackModel, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(PROVIDER_PROBE_TIMEOUT_MS),
    });
    const latency = Date.now() - started;
    const text = await res.text().catch(() => "");
    if (res.ok) return { name, configured: true, status: "HEALTHY", latency_ms: latency, detail: `1-token chat OK via ${fallbackModel}` };
    const msg = probeJsonMessage(text);
    // Auth-OK heuristic: NVIDIA validates the key BEFORE the model — a fake key
    // answers 403 "Authorization failed" (live-verified 2026-10-29) while a
    // valid key on a missing/EOL model answers 404 "Function ... Not found for
    // account" or 410 "model ... end of life". Both prove the key is alive.
    if (res.status !== 401 && res.status !== 403 && /model|function|end.of.life/i.test(msg)) {
      return { name, configured: true, status: "HEALTHY", latency_ms: latency, detail: `auth OK — model "${fallbackModel}" not served (HTTP ${res.status})` };
    }
    return { name, configured: true, status: "UNHEALTHY", latency_ms: latency, detail: `HTTP ${res.status}${msg ? ` — ${msg}` : ""}` };
  } catch (err) {
    return { name, configured: true, status: "UNHEALTHY", latency_ms: Date.now() - started, detail: (err instanceof Error ? err.message : String(err)).slice(0, 140) };
  }
}

async function probeAuthGet(name: string, key: string | undefined, url: string, describe?: (body: unknown) => string): Promise<ProviderProbeRow> {
  if (!key?.trim()) return { name, configured: false, status: "MISSING", latency_ms: 0, detail: "key not configured" };
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key.trim()}` },
      signal: AbortSignal.timeout(PROVIDER_PROBE_TIMEOUT_MS),
    });
    const latency = Date.now() - started;
    const text = await res.text().catch(() => "");
    if (res.ok) {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // body shape drift — describe falls back to plain accepted
      }
      return { name, configured: true, status: "HEALTHY", latency_ms: latency, detail: describe?.(parsed) ?? `HTTP ${res.status}` };
    }
    const msg = probeJsonMessage(text);
    return { name, configured: true, status: "UNHEALTHY", latency_ms: latency, detail: `HTTP ${res.status}${msg ? ` — ${msg}` : ""}` };
  } catch (err) {
    return { name, configured: true, status: "UNHEALTHY", latency_ms: Date.now() - started, detail: (err instanceof Error ? err.message : String(err)).slice(0, 140) };
  }
}

healthRouter.get("/health/providers", async (c) => {
  const secret = env.EDGE_ORIGIN_SECRET;
  if (!secret) return c.json({ error: "Not Found" }, 404);
  const auth = c.req.header("Authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return c.json({ error: "Not Found" }, 404);

  const rows: ProviderProbeRow[] = await Promise.all([
    probeAuthChat("kilo", env.KILOCODE_API_KEY, "https://ai-gateway.kilo.ai/api/v1", "Qwen/Qwen3-235B-A22B-Instruct"),
    probeAuthGet("openrouter", env.OPENROUTER_API_KEY, "https://openrouter.ai/api/v1/auth/key"),
    probeAuthChat("nvidia", env.NVIDIA_API_KEY, "https://integrate.api.nvidia.com/v1", "ibm/granite-3.0-8b-instruct"),
    probeAuthGet("groq", env.GROQ_API_KEY, "https://api.groq.com/openai/v1/models", (body) => {
      const n = Array.isArray((body as { data?: unknown[] } | null)?.data) ? (body as { data: unknown[] }).data.length : 0;
      return n ? `${n} models visible` : "key accepted";
    }),
    probeAuthGet("resend", env.RESEND_API_KEY, "https://api.resend.com/domains", (body) => {
      const list = (body as { data?: Array<{ status?: string }> } | null)?.data;
      const verified = Array.isArray(list) ? list.filter((d) => d?.status === "verified").length : -1;
      return verified >= 0 ? `${verified} verified domain(s)` : "key accepted";
    }),
  ]);

  const kilo = rows[0];
  const failing = rows.filter((r) => r.status === "UNHEALTHY");
  const configuredCount = rows.filter((r) => r.configured).length;
  const ok = configuredCount > 0 && !(kilo.configured && kilo.status === "UNHEALTHY") && failing.length === 0;

  return c.json(
    {
      ok,
      checked_at: new Date().toISOString(),
      summary: `configured=${configuredCount}/${rows.length} failing=${failing.length}`,
      providers: rows,
    },
    ok ? 200 : 503,
  );
});

healthRouter.get("/ready", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ready" }, 200);
  } catch {
    return c.json({ status: "not_ready" }, 503);
  }
});

healthRouter.get("/live", (c) => {
  return c.json({ status: "alive" }, 200);
});

export { healthRouter };
