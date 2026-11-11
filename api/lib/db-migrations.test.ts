/**
 * Unit tests — db-migrations module (✅ codebase-architecture deepening).
 * The migration-ledger module is testable OFFLINE against a mock connection:
 * probes, idempotence, error isolation, and ordered running are the module's
 * contract — none of them needs a live MySQL.
 */
import { describe, it, expect, vi } from "vitest";
import { columnExists, indexExists, ensureColumn, ensureIndex, runMigrations, type MigrationStep, type DbMigrationConn } from "./db-migrations.js";
import { logger } from "./logger.js";

/** Mock conn: resolves INFORMATION_SCHEMA probes from declarative sets; records every statement. */
function mockConn(opts: { columns?: string[]; indexes?: string[]; failOn?: string[] } = {}) {
  const statements: string[] = [];
  const execute = vi.fn(async (sql: string, params?: unknown[]) => {
    statements.push(sql);
    if (opts.failOn?.some((f) => sql.includes(f))) throw new Error("boom: " + sql.slice(0, 40));
    const table = String(params?.[0] ?? "");
    const name = String(params?.[1] ?? "");
    if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
      const present = (opts.columns ?? []).includes(`${table}.${name}`);
      return [[{ cnt: present ? 1 : 0 }]];
    }
    if (sql.includes("INFORMATION_SCHEMA.STATISTICS")) {
      const present = (opts.indexes ?? []).includes(`${table}.${name}`);
      return [[{ cnt: present ? 1 : 0 }]];
    }
    return [[{ ok: 1 }]];
  });
  const query = vi.fn(async (sql: string) => {
    statements.push(sql);
    if (opts.failOn?.some((f) => sql.includes(f))) throw new Error("boom: " + sql.slice(0, 40));
    return [[]];
  });
  const conn = { execute, query, statements } as unknown as DbMigrationConn & { statements: string[] };
  return { conn };
}

describe("db-migrations — probes", () => {
  it("columnExists: true only for the probed column", async () => {
    const { conn } = mockConn({ columns: ["users.totpSecret"] });
    await expect(columnExists(conn, "users", "totpSecret")).resolves.toBe(true);
    await expect(columnExists(conn, "users", "referralCode")).resolves.toBe(false);
  });

  it("indexExists: true only for the probed index", async () => {
    const { conn } = mockConn({ indexes: ["payments.payments_user_idempotency_unique"] });
    await expect(indexExists(conn, "payments", "payments_user_idempotency_unique")).resolves.toBe(true);
    await expect(indexExists(conn, "payments", "other_idx")).resolves.toBe(false);
  });
});

describe("db-migrations — idempotent DDL", () => {
  it("ensureColumn SKIPS the ALTER when the column exists", async () => {
    const { conn } = mockConn({ columns: ["payments.idempotencyKey"] });
    await ensureColumn(conn, "payments", "idempotencyKey", "ALTER TABLE payments ADD COLUMN idempotencyKey VARCHAR(80)");
    expect((conn as unknown as { statements: string[] }).statements.some((s) => s.startsWith("ALTER"))).toBe(false);
  });

  it("ensureColumn RUNS the ALTER exactly once when missing", async () => {
    const { conn } = mockConn({});
    await ensureColumn(conn, "payments", "idempotencyKey", "ALTER TABLE payments ADD COLUMN idempotencyKey VARCHAR(80)");
    const alters = (conn as unknown as { statements: string[] }).statements.filter((s) => s.startsWith("ALTER"));
    expect(alters).toHaveLength(1);
  });

  it("ensureIndex RUNS the ADD INDEX when missing", async () => {
    const { conn } = mockConn({});
    await ensureIndex(conn, "payments", "payments_user_idempotency_unique", "ALTER TABLE payments ADD UNIQUE INDEX payments_user_idempotency_unique (userId, idempotencyKey)");
    const alters = (conn as unknown as { statements: string[] }).statements.filter((s) => s.startsWith("ALTER"));
    expect(alters).toHaveLength(1);
  });

  it("an ALTER failure is ISOLATED (logged, not thrown)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { conn } = mockConn({ failOn: ["ADD COLUMN"] });
    await expect(ensureColumn(conn, "t1", "c1", "ALTER TABLE t1 ADD COLUMN c1 INT")).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("db-migrations — ledger runner", () => {
  it("runs steps in order with timing + summary", async () => {
    const { conn } = mockConn({});
    const order: string[] = [];
    const steps: MigrationStep[] = [
      { id: "a-first", description: "first", run: async () => { order.push("a"); } },
      { id: "b-second", description: "second", run: async () => { order.push("b"); } },
    ];
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    await runMigrations(conn, steps);
    expect(order).toEqual(["a", "b"]);
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("migration a-first ok"));
    infoSpy.mockRestore();
  });

  it("a failing step does NOT stop the ledger (isolation)", async () => {
    const { conn } = mockConn({});
    const ran: string[] = [];
    const steps: MigrationStep[] = [
      { id: "ok-1", description: "fine", run: async () => { ran.push("1"); } },
      { id: "boom-step", description: "explodes", run: async () => { throw new Error("step exploded"); } },
      { id: "ok-2", description: "still runs", run: async () => { ran.push("3"); } },
    ];
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    await runMigrations(conn, steps);
    expect(ran).toEqual(["1", "3"]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("boom-step FAILED"), expect.anything());
    warnSpy.mockRestore();
  });
});
