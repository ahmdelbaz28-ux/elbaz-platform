import { Hono } from "hono";
import { getPublicEnvKeys, env } from "./lib/env.js";
import { db, pool } from "./queries/connection.js";
import { sql } from "drizzle-orm";
import { getCache, cacheKeys, CACHE_TTL } from "./lib/cache.js";

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
    checks.database = {
      status: "unhealthy",
      latency_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // 2. Cache (Redis / In-Memory) Check
  try {
    const redisStart = Date.now();
    const testKey = `health:test:${Date.now()}`;
    await cache.set(testKey, "ok", 5);
    const val = await cache.get(testKey);
    await cache.del(testKey);

    const isRedis = typeof (cache as any).getClient === "function";
    const cacheType = isRedis ? (env.REDIS_URL ? "redis" : "memory_fallback") : "memory";
    checks.cache = {
      status: val === "ok" ? "healthy" : "degraded",
      latency_ms: Date.now() - redisStart,
      type: cacheType,
      detail: cacheType === "redis" ? "Redis distributed cache" : "In-memory LRU cache (max 500 entries)",
    };
  } catch (error) {
    checks.cache = { status: "degraded", latency_ms: 0, error: "Cache check failed", type: "unknown" };
  }

  // 3. Storage (R2) Check — verify config + endpoint reachability
  try {
    const r2Start = Date.now();
    const r2Configured = env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME;
    if (r2Configured) {
      const r2BaseUrl = env.R2_ENDPOINT.replace(/\/$/, "");
      const r2Response = await fetch(r2BaseUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      checks.storage = {
        status: r2Response.ok || r2Response.status === 403 ? "healthy" : "degraded",
        latency_ms: Date.now() - r2Start,
        detail: r2Response.ok
          ? "R2 endpoint reachable"
          : r2Response.status === 403
            ? "R2 endpoint reachable (auth required for listing)"
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

  // 4. Resend (Email) Check — verify API key and domain
  try {
    const emailStart = Date.now();
    if (env.RESEND_API_KEY) {
      const emailResponse = await fetch("https://api.resend.com/audiences", {
        method: "GET",
        signal: AbortSignal.timeout(5000),
        headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}` },
      });
      checks.email = {
        status: emailResponse.ok ? "healthy" : "degraded",
        latency_ms: Date.now() - emailStart,
        detail: emailResponse.ok ? "Resend API reachable" : `Resend API responded with ${emailResponse.status}`,
        error: emailResponse.ok ? undefined : `Resend API responded with ${emailResponse.status}`,
      };
    } else {
      checks.email = { status: "degraded", latency_ms: 0, detail: "RESEND_API_KEY not configured" };
    }
  } catch {
    checks.email = { status: "unhealthy", latency_ms: 0, error: "Resend endpoint unreachable" };
  }

  // 5. OpenRouter / AI Check — verify API key is set
  if (env.OPENROUTER_API_KEY) {
    checks.ai = { status: "healthy", latency_ms: 0, detail: "OPENROUTER_API_KEY configured" };
  } else if (env.MODAL_API_KEY) {
    checks.ai = { status: "healthy", latency_ms: 0, detail: "MODAL_API_KEY configured" };
  } else {
    checks.ai = { status: "degraded", latency_ms: 0, detail: "No AI provider configured" };
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
