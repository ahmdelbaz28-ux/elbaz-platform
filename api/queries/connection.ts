import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;
let pool: mysql.Pool;

/**
 * ✅ Clean ssl-mode from database URL
 * Aiven MySQL adds ssl-mode=REQUIRED but mysql2 doesn't support it
 * This must run before ANY connection is created
 */
function cleanDbUrl(rawUrl: string): string {
  let cleaned = rawUrl;
  if (cleaned.indexOf("ssl-mode") !== -1 || cleaned.indexOf("sslmode") !== -1 || cleaned.indexOf("ssl_mode") !== -1) {
    cleaned = cleaned.replace(/[?&]ssl[-_]mode=[^&]*/g, "");
    cleaned = cleaned.replace(/[?&]$/, "");
  }
  return cleaned;
}

/**
 * ✅ PRODUCTION FIX: Connection pooling with proper limits
 */
export function getDb() {
  if (!instance) {
    let dbUrl = cleanDbUrl(
      process.env.DATABASE_URL || ""
    );

    pool = mysql.createPool({
      uri: dbUrl,
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 50,
      queueLimit: Number(process.env.DB_QUEUE_LIMIT) || 100,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 10000,
      timezone: "+02:00",
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
 */
export async function withTransaction<T>(
  fn: (tx: ReturnType<typeof getDb>) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return await db.transaction(async (tx) => {
    return await fn(tx as unknown as ReturnType<typeof getDb>);
  });
}

/**
 * Graceful shutdown — close pool on process exit
 */
function gracefulShutdown() {
  if (pool) {
    pool.end().catch(() => {});
  }
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);