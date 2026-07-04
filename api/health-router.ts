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


function buildHealthResponse(c: any, checks: Record<string, HealthCheckSnapshot>, cached: boolean) {
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
      cached,
    },
    allHealthy ? 200 : 503
  );
}

function buildCachedHealthResponse(c: any, checks: Record<string, HealthCheckSnapshot>) {
  const isHealthy = Object.values(checks).every((check) => check.status === "healthy" || check.status === "degraded");
  return c.json(
    {
      status: isHealthy ? "ok" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version ?? "unknown",
      checks,
      env: getPublicEnvKeys(),
      cached: true,
    },
    isHealthy ? 200 : 503
  );
}

async function checkDatabase(startTime: number): Promise<HealthCheckSnapshot> {
  try {
    const dbStart = Date.now();
    const [result] = await db.execute(sql`SELECT 1 AS ok`);
    const poolStatus = pool.pool ? "active" : "created";
    return {
      status: result ? "healthy" : "unhealthy",
      latency_ms: Date.now() - dbStart,
      detail: `pool=${poolStatus}, connectionLimit=10`,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      latency_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function checkCache(): Promise<HealthCheckSnapshot> {
  const cache = getCache();
  try {
    const redisStart = Date.now();
    const testKey = `health:test:${Date.now()}`;
    await cache.set(testKey, "ok", 5);
    const val = await cache.get(testKey);
    await cache.del(testKey);

    const isRedis = typeof (cache as any).getClient === "function";
    const innerCacheType = env.REDIS_URL ? "redis" : "memory_fallback";
    const cacheType = isRedis ? innerCacheType : "memory";
    return {
      status: val === "ok" ? "healthy" : "degraded",
      latency_ms: Date.now() - redisStart,
      type: cacheType,
      detail: cacheType === "redis" ? "Redis distributed cache" : "In-memory LRU cache (max 500 entries)",
    };
  } catch (error) {
    return { status: "degraded", latency_ms: 0, error: `Cache check failed: ${error instanceof Error ? error.message : String(error)}`, type: "unknown" };
  }
}

function describeR2Reachability(r2Response: Response): string {
  if (r2Response.ok) return "R2 endpoint reachable";
  if (r2Response.status === 403) return "R2 endpoint reachable (auth required for listing)";
  if (r2Response.status === 400) return "R2 endpoint reachable (S3 API responding)";
  return `R2 responded with ${r2Response.status}`;
}

async function checkStorage(): Promise<HealthCheckSnapshot> {
  try {
    const r2Start = Date.now();
    const r2Configured = env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME;
    if (!r2Configured) {
      return {
        status: "degraded",
        latency_ms: 0,
        detail: env.R2_ENDPOINT ? "R2 credentials incomplete" : "R2 not configured",
      };
    }
    const r2BaseUrl = (env.R2_ENDPOINT ?? "").replace(/\/$/, "");
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
    return {
      status: isReachable ? "healthy" : "degraded",
      latency_ms: Date.now() - r2Start,
      detail: describeR2Reachability(r2Response),
    };
  } catch {
    return { status: "unhealthy", latency_ms: 0, error: "R2 endpoint unreachable" };
  }
}

async function checkEmail(): Promise<HealthCheckSnapshot> {
  try {
    const emailStart = Date.now();
    if (!env.RESEND_API_KEY) {
      return { status: "degraded", latency_ms: 0, detail: "RESEND_API_KEY not configured" };
    }
    const emailResponse = await fetch("https://api.resend.com/audiences", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}` },
    });
    return {
      status: emailResponse.ok ? "healthy" : "degraded",
      latency_ms: Date.now() - emailStart,
      detail: emailResponse.ok ? "Resend API reachable" : `Resend API responded with ${emailResponse.status}`,
      error: emailResponse.ok ? undefined : `Resend API responded with ${emailResponse.status}`,
    };
  } catch {
    return { status: "unhealthy", latency_ms: 0, error: "Resend endpoint unreachable" };
  }
}

function checkAi(): HealthCheckSnapshot {
  if (env.OPENROUTER_API_KEY) {
    return { status: "healthy", latency_ms: 0, detail: "OPENROUTER_API_KEY configured" };
  }
  if (env.MODAL_API_KEY) {
    return { status: "healthy", latency_ms: 0, detail: "MODAL_API_KEY configured" };
  }
  return { status: "degraded", latency_ms: 0, detail: "No AI provider configured" };
}


healthRouter.get("/health", async (c) => {
  const cache = getCache();
  const cached = await cache.get<{ checks: Record<string, HealthCheckSnapshot> }>(cacheKeys.healthCheck());

  if (cached) {
    return buildCachedHealthResponse(c, cached.checks);
  }

  const startTime = Date.now();
  const checks: Record<string, HealthCheckSnapshot> = {};

  checks.database = await checkDatabase(startTime);
  checks.cache = await checkCache();
  checks.storage = await checkStorage();
  checks.email = await checkEmail();
  checks.ai = checkAi();

  await cache.set(cacheKeys.healthCheck(), { checks }, CACHE_TTL.HEALTH_CHECK);

  return buildHealthResponse(c, checks, false);
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
