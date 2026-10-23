/**
 * Seed/clean the mock OpenRouter provider for the web-grounding e2e.
 * Also self-heals the v9 AI tables (they are only created by the incremental
 * migration path on an ALREADY-initialized database — a fresh testdb boots
 * with just the 24 base tables).
 * Usage:
 *   DATABASE_URL=mysql://user:pass@127.0.0.1:3306/testdb node scripts/seed_mock_provider.mjs seed
 *   DATABASE_URL=... node scripts/seed_mock_provider.mjs enable-charged
 *   DATABASE_URL=... node scripts/seed_mock_provider.mjs clean
 */
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const mode = process.argv[2] || "seed";
const url = new URL(process.env.DATABASE_URL);

const conn = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: url.username,
  password: url.password,
  database: url.pathname.replace(/^\//, ""),
  multipleStatements: true,
});

// ── Self-heal: v9 AI router tables (same DDL as db-init's incremental path) ──
const v9Sql = readFileSync(new URL("./../db/migration-v9-ai-router.sql", import.meta.url), "utf-8");
const v9Statements = v9Sql
  .split(";")
  .map((chunk) => chunk.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
  .filter((s) => s.length > 0);
for (const stmt of v9Statements) {
  await conn.query(stmt);
}

if (mode === "enable-charged") {
  // UPDATE only — the provider/models rows from `seed` must stay untouched.
  await conn.query("UPDATE aiModels SET enabled=1 WHERE modelId='mock/charged'");
  console.log("mock/charged ENABLED (tier1) — 402 breaker path armed");
  await conn.end();
  process.exit(0);
}

// seed | clean: wipe any previous mock provider (models cascade via FK)
const [providers] = await conn.query("SELECT id FROM aiProviders WHERE slug='openrouter'");
for (const p of providers) {
  await conn.query("DELETE FROM aiModels WHERE providerId=?", [p.id]);
}
await conn.query("DELETE FROM aiProviders WHERE slug='openrouter'");

if (mode === "seed") {
  const [ins] = await conn.query(
    "INSERT INTO aiProviders (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES ('openrouter','OpenRouter Mock','http://127.0.0.1:47777/v1','mock-key',1,1,'healthy')"
  );
  const pid = ins.insertId;
  // charged: tier 1 but DISABLED — T4 flips it on to exercise the 402 breaker.
  await conn.query(
    "INSERT INTO aiModels (providerId, modelId, supportsChat, supportsVision, isFree, enabled, tier) VALUES (?,?,1,0,1,0,1),(?,?,1,0,1,1,2),(?,?,1,0,1,1,2)",
    [pid, "mock/charged", pid, "mock/grounded", pid, "mock/grounded-stream"]
  );
  console.log(`seeded provider ${pid}: mock/grounded + mock/grounded-stream (tier2, on), mock/charged (tier1, OFF)`);
} else {
  console.log("cleaned mock provider rows");
}

await conn.end();
