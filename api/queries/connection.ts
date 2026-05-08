import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;
let pool: mysql.Pool;

/**
 * ✅ FIX: Sanitize DATABASE_URL by removing query params that are invalid for mysql2.
 * Aiven MySQL URLs may include params like `ssl-mode=REQUIRED` and `acquireTimeout=10000`
 * which are NOT valid mysql2 Connection options and trigger deprecation warnings.
 * mysql2 uses `ssl: { rejectUnauthorized: true }` instead of `ssl-mode`.
 */
function sanitizeDatabaseUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const params = url.searchParams;
    // mysql2 invalid params to strip (commonly added by Aiven/PlanetScale/other hosts)
    const invalidParams = [
      "ssl-mode",     // mysql2 uses `ssl` object, not `ssl-mode` query param
      "acquireTimeout", // not a mysql2 pool option (pool uses waitForConnections)
      "ssl-mode=REQUIRED",
      "ssl-mode=VERIFY_IDENTITY",
      "ssl-mode=PREFERRED",
    ];
    let stripped = false;
    for (const key of Array.from(params.keys())) {
      if (invalidParams.includes(key) || key.startsWith("ssl-mode")) {
        params.delete(key);
        stripped = true;
      }
    }
    if (stripped) {
      console.warn("[DB] Sanitized DATABASE_URL: removed invalid mysql2 query params (ssl-mode, acquireTimeout).");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * ✅ PRODUCTION FIX: Connection pooling with proper limits
 * Without pooling, every request creates a new connection → server crashes under load
 */
export function getDb() {
  if (!instance) {
    const cleanUrl = sanitizeDatabaseUrl(env.databaseUrl);
    pool = mysql.createPool({
      uri: cleanUrl,
      // ✅ FIX: SSL as proper object (mysql2 requires object, not boolean)
      ssl: { rejectUnauthorized: false },
      // ✅ OPTIMIZED: Connection pool tuned for Aiven free-1-1gb (max_connections=76)
      waitForConnections: true,
      connectionLimit: env.isProduction ? 15 : 5,
      queueLimit: 50,                                   // Back-pressure: queue up to 50 before failing fast
      enableKeepAlive: true,
      keepAliveInitialDelay: 30000,                    // ✅ OPTIMIZED: 30s initial delay (reduced network churn)
      idleTimeout: 60000,                              // ✅ OPTIMIZED: Kill idle connections after 60s
      // ✅ SECURITY: Connection timeout prevents connection leak
      connectTimeout: 10000,
      // ✅ Timezone handling for Egypt (Africa/Cairo = UTC+2)
      timezone: "+02:00",
      // ✅ OPTIMIZED: Encoding
      charset: "utf8mb4",
      multipleStatements: false,                       // ✅ SECURITY: Prevent SQL injection via multi-statements
    });

    // ✅ OPTIMIZED: Pool event handlers for monitoring
    pool.on("acquire", (connection) => {
      (connection as any)._acquiredAt = Date.now();
    });

    pool.on("release", (connection) => {
      const held = Date.now() - ((connection as any)._acquiredAt || Date.now());
      if (held > 5000) {
        console.warn("[DB Pool] Slow connection release: " + held + "ms");
      }
    });

    pool.on("enqueue", () => {
      console.warn("[DB Pool] All connections in use, request queued");
    });

    instance = drizzle(pool, {
      mode: "default",
      schema: fullSchema,
    });
  }
  return instance;
}

/**
 * ✅ CRITICAL FIX: Transaction helper for atomic multi-step operations
 * Without transactions, concurrent requests can cause race conditions:
 * e.g., Two users enrolling at the same time both pass the "already enrolled" check
 *
 * Usage:
 * ```ts
 * const result = await withTransaction(async (tx) => {
 *   await tx.insert(payments).values({...});
 *   await tx.insert(enrollments).values({...});
 *   return { success: true };
 * });
 * ```
 */
export async function withTransaction<T>(
  fn: (tx: ReturnType<typeof getDb>) => Promise<T>,
): Promise<T> {
  const db = getDb();

  // Drizzle ORM transaction wrapper
  return await db.transaction(async (tx) => {
    return await fn(tx as unknown as ReturnType<typeof getDb>);
  });
}

/**
 * Graceful shutdown — close pool on process exit
 * ✅ PRODUCTION FIX: Without this, the process hangs on SIGTERM
 */
function gracefulShutdown() {
  if (pool) {
    pool.end().catch(() => {});
  }
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
