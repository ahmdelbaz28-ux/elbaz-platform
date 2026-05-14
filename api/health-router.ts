import { Hono } from "hono";
import { getPublicEnvKeys, env } from "./lib/env.js";
import { db } from "./queries/connection.js";
import { sql } from "drizzle-orm";
import { getCache, cacheKeys, CACHE_TTL } from "./lib/cache.js";

const healthRouter = new Hono({ strict: false });

interface HealthCheckSnapshot {
  status: string;
  latency_ms: number;
  error?: string;
  type?: string;
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
    await db.execute(sql`SELECT 1`);
    checks.database = { status: "healthy", latency_ms: Date.now() - dbStart };
  } catch (error) {
    checks.database = {
      status: "unhealthy",
      latency_ms: Date.now() - startTime,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  // 2. Cache (Redis) Check
  try {
    const redisStart = Date.now();
    const testKey = `health:test:${Date.now()}`;
    await cache.set(testKey, "ok", 5);
    const val = await cache.get(testKey);
    await cache.del(testKey);
    
    const isRedis = (cache as any).client !== undefined;
    checks.cache = { 
      status: val === "ok" ? "healthy" : "degraded", 
      latency_ms: Date.now() - redisStart,
      type: isRedis ? "redis" : "memory"
    };
  } catch (error) {
    checks.cache = { status: "degraded", latency_ms: 0, error: "Cache check failed" };
  }

  // 3. Storage (R2) Check
  try {
    const r2Start = Date.now();
    // We check if we can reach the R2 endpoint or have credentials
    if (env.R2_ACCOUNT_ID && env.R2_BUCKET_NAME) {
      checks.storage = { status: "healthy", latency_ms: Date.now() - r2Start };
    } else {
      checks.storage = { status: "degraded", latency_ms: 0, error: "R2 credentials missing" };
    }
  } catch {
    checks.storage = { status: "unhealthy", latency_ms: 0 };
  }

  await cache.set(cacheKeys.healthCheck(), { checks }, CACHE_TTL.HEALTH_CHECK);

  const isHealthy = checks.database.status === "healthy"; // Critical dependency

  return c.json(
    {
      status: isHealthy ? "ok" : "unhealthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version ?? "unknown",
      checks,
      env: getPublicEnvKeys(),
      cached: false,
    },
    isHealthy ? 200 : 503
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
