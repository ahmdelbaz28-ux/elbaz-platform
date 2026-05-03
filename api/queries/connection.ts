import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let instance: ReturnType<typeof drizzle<typeof fullSchema>>;
let pool: mysql.Pool;

/**
 * ✅ PRODUCTION FIX: Connection pooling with proper limits
 * Without pooling, every request creates a new connection → server crashes under load
 */
export function getDb() {
  if (!instance) {
    pool = mysql.createPool({
      uri: env.databaseUrl,
      // ✅ Connection pool settings for production
      waitForConnections: true,
      connectionLimit: env.isProduction ? 25 : 5,   // Scale with expected load
      queueLimit: 0,                                   // No limit on queued requests
      enableKeepAlive: true,                           // ✅ Keep connections alive
      keepAliveInitialDelay: 0,
      // ✅ SECURITY: Connection timeout prevents connection leak
      connectTimeout: 10000,                          // 10 seconds to establish connection
      // ✅ Timezone handling for Egypt (Africa/Cairo = UTC+2)
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
