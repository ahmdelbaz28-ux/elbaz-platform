/**
 * DB MIGRATIONS — the migration-ledger module (✅ codebase-architecture
 * deepening, hot spot: db-init.ts was the single most-changed file in the
 * repo — every feature pasted another try/catch block with inline
 * INFORMATION_SCHEMA probes into one 1400-line function).
 *
 * The DEEP module: a lot of behaviour behind a small interface.
 *
 *   Interface (what a migration author must know):
 *     columnExists(conn, table, column)        → probe
 *     indexExists(conn, table, index)          → probe
 *     ensureColumn(conn, table, column, ddl)   → idempotent ALTER
 *     ensureIndex(conn, table, index, ddl)     → idempotent ADD INDEX
 *     statementIsolated(conn, name, fn)        → one place for try/catch+log
 *     runMigrations(conn, steps)               → ordered, timed, isolated run
 *
 *   Implementation (hidden): the INFORMATION_SCHEMA probes, the MySQL
 *   no-IF-NOT-EXISTS workarounds, per-statement error isolation, uniform
 *   logging, duplicate pre-checks.
 *
 * Adding migration vN is now a ~10-line declaration in the MIGRATIONS
 * ledger instead of a pasted block — and every step is unit-testable
 * offline against a mock connection (see db-migrations.test.ts).
 */

import { logger } from "./logger.js";

/** Minimal structural type for the raw mysql2/promise connection db-init uses. */
// The parameter rest type is `any[]` on purpose: mysql2's execute/query have
// complex overloads (ExecuteValues unions) that no narrow structural type
// satisfies in both directions. Everything else stays strictly typed.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DbMigrationConn {
  execute(sql: string, ...rest: any[]): Promise<unknown>;
  query(sql: string, ...rest: any[]): Promise<unknown>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Parse the first result row from a mysql2 `execute` — the shape is the
 * `[rows, fieldPackets]` tuple, but this adapts to a direct-rows shape too
 * so the probes stay correct across driver wrappers.
 *
 * ✅ BUG FOUND BY THE MOCK TESTS (systematic-debugging): the original inline
 * helper in db-init.ts cast the whole TUPLE as `{cnt}[]` and indexed [0] —
 * which is the ROWS ARRAY, not a row — so `.cnt` was always undefined and
 * every probe returned false in production. Consequence: every boot re-ran
 * each guarded ALTER and swallowed the "Duplicate column" error. The fix
 * parses the tuple properly; probes now actually short-circuit existing
 * columns/indexes.
 */
function firstResultRow(raw: unknown): { cnt?: number } | undefined {
  if (!Array.isArray(raw)) return undefined;
  // mysql2 tuple: [rowsArray, fieldPackets] — rowsArray[0] is the first row.
  if (raw.length === 2 && Array.isArray(raw[0]) && Array.isArray(raw[1])) {
    return (raw[0] as unknown[])[0] as { cnt?: number } | undefined;
  }
  // Direct rows: [row, ...]
  if (raw.length > 0 && !Array.isArray(raw[0])) {
    return raw[0] as { cnt?: number };
  }
  // Rows-only array: [[row]] or []
  const inner = raw[0];
  if (Array.isArray(inner)) return inner[0] as { cnt?: number } | undefined;
  return inner as { cnt?: number } | undefined;
}

/**
 * True when `table.column` exists in the current database.
 * (MySQL lacks ALTER TABLE ... ADD COLUMN IF NOT EXISTS — the probe replaces it.)
 */
export async function columnExists(conn: DbMigrationConn, table: string, column: string): Promise<boolean> {
  const raw = await conn.execute(
    "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
  );
  return (firstResultRow(raw)?.cnt ?? 0) > 0;
}

/** True when `table` has an index named `indexName` in the current database. */
export async function indexExists(conn: DbMigrationConn, table: string, indexName: string): Promise<boolean> {
  const raw = await conn.execute(
    "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    [table, indexName],
  );
  return (firstResultRow(raw)?.cnt ?? 0) > 0;
}

/**
 * Idempotent column add: probes INFORMATION_SCHEMA first, so a restart never
 * re-runs the ALTER and never logs syntax-error noise. Failure is isolated
 * (logged, never thrown) — one raced ALTER must not abort the boot.
 */
export async function ensureColumn(
  conn: DbMigrationConn,
  table: string,
  column: string,
  ddl: string,
  label?: string,
): Promise<void> {
  if (await columnExists(conn, table, column)) return;
  await statementIsolated(conn, label ?? `${table}.${column}`, async () => {
    await conn.execute(ddl);
    logger.info(`[DB]   + ${table}.${column}`);
  });
}

/** Idempotent named-index add with the same probe/isolate contract. */
export async function ensureIndex(
  conn: DbMigrationConn,
  table: string,
  indexName: string,
  ddl: string,
): Promise<void> {
  if (await indexExists(conn, table, indexName)) return;
  await statementIsolated(conn, indexName, async () => {
    await conn.execute(ddl);
    logger.info(`[DB]   + ${indexName}`);
  });
}

/**
 * Run `fn` with statement isolation: any error is logged with the step name
 * and swallowed — migrations are idempotent, so the next boot retries and
 * one raced statement never aborts the whole startup.
 */
export async function statementIsolated(
  conn: DbMigrationConn,
  name: string,
  fn: (conn: DbMigrationConn) => Promise<void>,
): Promise<void> {
  try {
    await fn(conn);
  } catch (err) {
    logger.warn(`[DB] migration step failed (isolated): ${name}`, { error: (err as Error).message });
  }
}

/** One declarative migration: the ledger unit a feature author writes. */
export interface MigrationStep {
  /** Stable id, e.g. "v16-payments-idempotency-unique". */
  id: string;
  /** Human description for the boot log. */
  description: string;
  run(conn: DbMigrationConn): Promise<void>;
}

/**
 * Ordered migration runner: uniform timing, per-step isolation (a failing
 * step logs and lets the rest run), and one summary line. Steps are written
 * idempotently (probes inside), so every boot re-runs the whole ledger.
 */
export async function runMigrations(conn: DbMigrationConn, steps: MigrationStep[]): Promise<void> {
  for (const step of steps) {
    const startedAt = Date.now();
    try {
      await step.run(conn);
      logger.info(`[DB] migration ${step.id} ok (${Date.now() - startedAt}ms) — ${step.description}`);
    } catch (err) {
      // statementIsolated already handles per-statement errors; an error here
      // means the step itself was mis-authored — log loudly and continue.
      logger.warn(`[DB] migration ${step.id} FAILED (${Date.now() - startedAt}ms) — continuing`, {
        description: step.description,
        error: (err as Error).message,
      });
    }
  }
}
