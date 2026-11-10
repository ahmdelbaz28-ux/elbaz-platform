import { gzipSync } from "node:zlib";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { RowDataPacket } from "mysql2";
import { escape as sqlEscape, escapeId as sqlEscapeId } from "mysql2";
import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { pool } from "./queries/connection.js";

/**
 * 🗄️ Maintenance router — operator-only endpoints, each gated by a shared
 * secret compared timing-safe (same pattern as health-router's operator gate).
 * Unset secret or wrong token → disguised 404, identical to the shield's
 * rejection, so the endpoints are invisible to scanners and recon probes.
 *
 * GET /api/maintenance/dump          → full SQL dump, gzipped attachment
 * GET /api/maintenance/dump/manifest → table/row counts only (cheap verify)
 *
 * The daily GitHub Action (db-backup.yml) authenticates with BACKUP_TOKEN,
 * validates the dump (gzip integrity + CREATE TABLE present) and stores it as
 * a private GitHub Release asset with 7-day retention. Secrets never travel:
 * the app reads DATABASE_URL from its own env, the Action never sees it.
 */

const maintenanceRouter = new Hono({ strict: false });

function isBackupOperator(authorization: string | undefined): boolean {
  const secret = env.BACKUP_TOKEN;
  if (!secret) return false;
  const presented = authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!presented) return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function guard(c: { req: { header(name: string): string | undefined } }): boolean {
  return isBackupOperator(c.req.header("Authorization"));
}

async function listBaseTables(conn: Awaited<ReturnType<typeof pool.getConnection>>): Promise<string[]> {
  // SHOW FULL TABLES' first column is named "Tables_in_<db>" — read it
  // positionally so the query stays independent of the database name.
  const [rows] = await conn.query<RowDataPacket[]>("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  return rows.map((r) => String(Object.values(r)[0]));
}

maintenanceRouter.get("/maintenance/dump/manifest", async (c) => {
  if (!guard(c)) return c.json({ error: "Not Found" }, 404);
  const conn = await pool.getConnection();
  try {
    const tables = await listBaseTables(conn);
    const manifest: Array<{ name: string; rows: number }> = [];
    for (const table of tables) {
      const name = sqlEscapeId(table);
      const [countRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${name}`);
      manifest.push({ name: table, rows: Number((countRows[0] as { n: number | string }).n ?? 0) });
    }
    logger.info("[Backup] manifest served", { tables: manifest.length });
    return c.json({ generated_at: new Date().toISOString(), tables: manifest }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    logger.error("[Backup] manifest failed", { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: "backup failed" }, 500);
  } finally {
    conn.release();
  }
});

maintenanceRouter.get("/maintenance/dump", async (c) => {
  if (!guard(c)) return c.json({ error: "Not Found" }, 404);
  const started = Date.now();
  const conn = await pool.getConnection();
  try {
    const tables = await listBaseTables(conn);
    const parts: string[] = [
      "-- Elbaz Platform — full database backup",
      `-- generated_at: ${new Date().toISOString()}`,
      "-- restore: gunzip -c <file>.sql.gz | mysql -h <host> -u <user> -p <dbname>",
      "SET NAMES utf8mb4;",
      "SET FOREIGN_KEY_CHECKS=0;",
      "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
      "",
    ];
    let totalRows = 0;
    for (const table of tables) {
      const name = sqlEscapeId(table);
      const [createRows] = await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE ${name}`);
      const ddl = (createRows[0] as unknown as Record<string, string>)["Create Table"];
      if (!ddl) continue;
      parts.push(`-- ── table: ${table} ──`, `DROP TABLE IF EXISTS ${name};`, `${ddl};`, "");
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM ${name}`);
      if (rows.length > 0) {
        const cols = Object.keys(rows[0] as Record<string, unknown>).map((k) => sqlEscapeId(k)).join(", ");
        const values = (rows as Array<Record<string, unknown>>).map(
          (r) => `(${Object.values(r).map((v) => sqlEscape(v as string | number | boolean | Date | null | Buffer)).join(", ")})`
        );
        // Batch every 200 rows so a huge table never becomes one giant statement.
        for (let i = 0; i < values.length; i += 200) {
          parts.push(`INSERT INTO ${name} (${cols}) VALUES\n  ${values.slice(i, i + 200).join(",\n  ")};`);
        }
        totalRows += values.length;
      }
      parts.push("");
    }
    parts.push("SET FOREIGN_KEY_CHECKS=1;", "-- end of backup");

    const sql = parts.join("\n");
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `elbaz-db-${stamp}.sql.gz`;
    const gz = gzipSync(Buffer.from(sql, "utf8"), { level: 6 });
    logger.info("[Backup] dump generated", {
      tables: tables.length,
      rows: totalRows,
      sqlBytes: sql.length,
      gzBytes: gz.length,
      ms: Date.now() - started,
    });
    return c.body(gz, 200, {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(gz.length),
      "X-Backup-Tables": String(tables.length),
      "X-Backup-Rows": String(totalRows),
      "Cache-Control": "no-store",
    });
  } catch (error) {
    // Never leak driver errors (they include host/port) — log-only, like health-router.
    logger.error("[Backup] dump failed", { error: error instanceof Error ? error.message : String(error) });
    return c.json({ error: "backup failed" }, 500);
  } finally {
    conn.release();
  }
});

export { maintenanceRouter };
