import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { randomInt } from "node:crypto";
import { env } from "../lib/env.js";

function sanitizeDbUri(raw: string): string {
  // mysql2 does not recognize ssl-mode — strip it from the URI
  return raw.replace(/[?&]ssl-mode=[^&]*/g, "").replace(/\?$/, "");
}

function createPoolConfig(): mysql.PoolOptions {
  const baseConfig: mysql.PoolOptions = {
    uri: sanitizeDbUri(env.DATABASE_URL),
    connectTimeout: 15000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 30000,
    namedPlaceholders: true,
    maxIdle: 5,
    idleTimeout: 60000,
    multipleStatements: true,
  };

  if (env.NODE_ENV === "production" || env.DATABASE_URL?.includes("aivencloud.com")) {
    if (env.DATABASE_SSL_CA) {
      baseConfig.ssl = { ca: env.DATABASE_SSL_CA, rejectUnauthorized: true };
      console.log("[DB] ✅ SSL connection with CA verification enabled (rejectUnauthorized: true)");
      if (env.DATABASE_SSL_CERT && env.DATABASE_SSL_KEY) {
        baseConfig.ssl.cert = env.DATABASE_SSL_CERT;
        baseConfig.ssl.key = env.DATABASE_SSL_KEY;
      }
    } else {
      // ⚠️ SECURITY WARNING: rejectUnauthorized: false allows MITM attacks.
      // STAGED FIX: We keep the connection working to avoid breaking production.
      // NEXT STEP: Download CA cert from Aiven dashboard → add as DATABASE_SSL_CA in HF Secrets.
      // Once set, this code automatically uses proper CA verification.
      if (env.NODE_ENV === "production") {
        console.error(
          "\n" +
          "╔══════════════════════════════════════════════════════════════╗\n" +
          "║  🛑 SECURITY WARNING: Database SSL without CA verification ║\n" +
          "║                                                            ║\n" +
          "║  The connection to Aiven MySQL uses rejectUnauthorized:false ║\n" +
          "║  which exposes data to Man-in-the-Middle attacks.           ║\n" +
          "║                                                            ║\n" +
          "║  ACTION REQUIRED:                                          ║\n" +
          "║  1. Open Aiven Console → your service → Overview           ║\n" +
          "║  2. Download CA Certificate                                ║\n" +
          "║  3. Add it as DATABASE_SSL_CA in HF Space Secrets          ║\n" +
          "║  4. Redeploy — connection will auto-use the CA cert        ║\n" +
          "╚══════════════════════════════════════════════════════════════╝\n"
        );
      } else {
        console.warn("[DB] ⚠️ DATABASE_SSL_CA not set — using rejectUnauthorized: false (development only)");
      }
      baseConfig.ssl = { rejectUnauthorized: false };
    }
  }

  return baseConfig;
}

// ── Connection Pool with Self-Healing Retry Logic ────────────────
const poolConfig = createPoolConfig();
// `pool` is created once and never reassigned — declare as `const` so the
// binding cannot be accidentally re-bound elsewhere (SonarCloud S6861:
// mutable `let` exports are a code smell).
const pool: mysql.Pool = mysql.createPool(poolConfig);
let isMockMode = false;

async function testConnection(retries = 3, delay = 1000): Promise<void> {
  let lastErr: Error | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      await pool.execute("SELECT 1");
      console.log(`[DB] ✅ Connection pool verified (Attempt ${i + 1}/${retries})`);
      return;
    } catch (err) {
      lastErr = err as Error;
      console.warn(`[DB] Connection attempt ${i + 1}/${retries} failed:`, (err as Error).message);
      if (i < retries - 1) {
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  // SECURITY: In production, never fall back to mock mode — fail loudly
  if (env.NODE_ENV === "production") {
    console.error("[DB] 🛑 FATAL: Cannot connect to database in production. Exiting.", lastErr?.message);
    process.exit(1);
  }
  console.error('[DB] ⚠️ Could not connect to MySQL. Enabling "Elite Sandbox Mode" (In-Memory Data).');
  isMockMode = true;
}

// Fire-and-forget: test connection in background. boot.ts calls
// ensureDatabase before any queries. We use `void` rather than `await` so
// module load is not blocked (SonarCloud S7785 prefers top-level await
// only when the result is actually consumed).
void testConnection();

// Helper: build the in-memory mock query result used in Sandbox Mode.
// Extracted from the Proxy handler so we do not nest function declarations
// more than four levels deep (SonarCloud S2004).
function buildMockQueryResult(): unknown {
  return {
    where: () => ({ limit: () => [] }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
    insert: () => ({ values: () => [{ insertId: randomInt(1, 10000) }] }),
    update: () => ({ set: () => ({ where: () => ({}) }) }),
  };
}

// Proxy DB object to handle Mock Mode
const drizzleDb = drizzle(pool);
const db = new Proxy(drizzleDb, {
  get(target, prop, receiver) {
    if (isMockMode) {
      return (..._args: any[]) => {
        console.log(`[Sandbox] Intercepted DB call: ${String(prop)}`);
        return buildMockQueryResult();
      };
    }
    return Reflect.get(target, prop, receiver);
  }
});

function getDb() {
  return db;
}

export async function getRawConnection(): Promise<mysql.PoolConnection> {
  const conn = await pool.getConnection();
  try {
    return conn;
  } catch (err) {
    conn.release();
    throw err;
  }
}

// ── Transactions ─────────────────────────────────────────────────
async function withTransaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    return fn(tx as unknown as typeof db);
  });
}

export { db, getDb, withTransaction, poolConfig as connectionConfig, pool };
export type Database = typeof db;
