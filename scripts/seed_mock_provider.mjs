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
const [providers] = await conn.query("SELECT id FROM aiProviders WHERE slug IN ('kilocode','openrouter','groq')");
for (const p of providers) {
  await conn.query("DELETE FROM aiModels WHERE providerId=?", [p.id]);
}
await conn.query("DELETE FROM aiProviders WHERE slug IN ('kilocode','openrouter','groq')");

if (mode === "seed-429") {
  // NEVER-BUSY T1: an OpenRouter whose ONLY model 429s with the account-level
  // daily-quota body — the walk must trip the breaker, persist silently, and
  // only surface the soft busy event after the deadline.
  const [ins] = await conn.query(
    "INSERT INTO aiProviders (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES ('openrouter','OpenRouter Mock','http://127.0.0.1:47777/v1','mock-key',1,1,'healthy')"
  );
  await conn.query(
    "INSERT INTO aiModels (providerId, modelId, supportsChat, supportsVision, isFree, enabled, tier) VALUES (?,?,1,0,1,1,1)",
    [ins.insertId, "mock/daily-429"]
  );
  console.log(`seeded provider ${ins.insertId}: mock/daily-429 (tier1, on)`);
} else if (mode === "seed-slow") {
  // NEVER-BUSY T2: a winner whose first byte lands after 6s — proves SSE
  // headers + `: ping` keepalives reach the client BEFORE any content.
  const [ins] = await conn.query(
    "INSERT INTO aiProviders (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES ('openrouter','OpenRouter Mock','http://127.0.0.1:47777/v1','mock-key',1,1,'healthy')"
  );
  await conn.query(
    "INSERT INTO aiModels (providerId, modelId, supportsChat, supportsVision, isFree, enabled, tier) VALUES (?,?,1,0,1,1,1)",
    [ins.insertId, "mock/slow-stream"]
  );
  console.log(`seeded provider ${ins.insertId}: mock/slow-stream (tier1, on)`);
} else if (mode === "seed-429-groq") {
  // NEVER-BUSY T3: OpenRouter daily-429 (trips the breaker) + an independent
  // Groq provider with a healthy model — after the breaker trips, Groq must
  // answer immediately on the same request.
  const [or] = await conn.query(
    "INSERT INTO aiProviders (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES ('openrouter','OpenRouter Mock','http://127.0.0.1:47777/v1','mock-key',1,1,'healthy')"
  );
  await conn.query(
    "INSERT INTO aiModels (providerId, modelId, supportsChat, supportsVision, isFree, enabled, tier) VALUES (?,?,1,0,1,1,1)",
    [or.insertId, "mock/daily-429"]
  );
  const [gq] = await conn.query(
    "INSERT INTO aiProviders (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES ('groq','Groq Mock','http://127.0.0.1:47777/v1','mock-key',2,1,'healthy')"
  );
  await conn.query(
    "INSERT INTO aiModels (providerId, modelId, supportsChat, supportsVision, isFree, enabled, tier) VALUES (?,?,1,0,1,1,1)",
    [gq.insertId, "mock/grounded"]
  );
  console.log(`seeded openrouter=${or.insertId} (daily-429) + groq=${gq.insertId} (grounded)`);
} else if (mode === "seed-kilo-lane") {
  // KILO-LANE T6 — owner contract: kilocode is the FIRST provider (priority 1
  // here / 5 in prod). BOTH of its free models are unusable (one 429-quota
  // exhausted, one 404-dead) — the walk must exhaust EVERY kilo model, then
  // hand off to the next provider (groq) in the SAME request, and the second
  // request must skip the cooling kilo models instantly. The bot never stops.
  const [kilo] = await conn.query(
    "INSERT INTO aiProviders (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES ('kilocode','Kilo Mock','http://127.0.0.1:47777/v1','mock-key',1,1,'healthy')"
  );
  await conn.query(
    // contextLength mirrors the real lane: 1M flagship sorts before 262k.
    "INSERT INTO aiModels (providerId, modelId, supportsChat, supportsVision, isFree, enabled, tier, contextLength) VALUES (?,?,1,0,1,1,1,1000000),(?,?,1,0,1,1,1,262144)",
    [kilo.insertId, "mock/kilo-exhausted", kilo.insertId, "mock/kilo-dead"]
  );
  const [gq2] = await conn.query(
    "INSERT INTO aiProviders (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES ('groq','Groq Mock','http://127.0.0.1:47777/v1','mock-key',2,1,'healthy')"
  );
  await conn.query(
    "INSERT INTO aiModels (providerId, modelId, supportsChat, supportsVision, isFree, enabled, tier, contextLength) VALUES (?,?,1,0,1,1,1,131072)",
    [gq2.insertId, "mock/grounded-stream"]
  );
  console.log(`seeded kilocode=${kilo.insertId} (kilo-exhausted 1M + kilo-dead 262k, tier1) + groq=${gq2.insertId} (grounded-stream tier1)`);
} else if (mode === "seed-dud") {
  // NEVER-BUSY T4: a dud tier-1 winner that peeks alive (reasoning delta)
  // then dies with zero visible content, + a healthy tier-2 streamer. The
  // endpoint's zero-content re-walk must serve the user from tier-2 within
  // the SAME request — the client never sees an empty reply.
  const [ins] = await conn.query(
    "INSERT INTO aiProviders (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES ('openrouter','OpenRouter Mock','http://127.0.0.1:47777/v1','mock-key',1,1,'healthy')"
  );
  await conn.query(
    "INSERT INTO aiModels (providerId, modelId, supportsChat, supportsVision, isFree, enabled, tier) VALUES (?,?,1,0,1,1,1),(?,?,1,0,1,1,2)",
    [ins.insertId, "mock/dud-stream", ins.insertId, "mock/grounded-stream"]
  );
  console.log(`seeded provider ${ins.insertId}: mock/dud-stream (tier1) + mock/grounded-stream (tier2)`);
} else if (mode === "seed-vision") {
  // NEVER-BUSY T5 (vision policy): a vision-capable tier-1 reader + a healthy
  // tier-2 TEXT streamer. PASS 1 reads the image from mock/vl-reader; PASS 2
  // must answer from mock/grounded-stream — the VL model itself refuses to
  // write chat answers (mock returns 500 for persona-prompt requests).
  const [ins] = await conn.query(
    "INSERT INTO aiProviders (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES ('openrouter','OpenRouter Mock','http://127.0.0.1:47777/v1','mock-key',1,1,'healthy')"
  );
  await conn.query(
    "INSERT INTO aiModels (providerId, modelId, supportsChat, supportsVision, isFree, enabled, tier) VALUES (?,?,1,1,1,1,1),(?,?,1,0,1,1,2)",
    [ins.insertId, "mock/vl-reader", ins.insertId, "mock/grounded-stream"]
  );
  console.log(`seeded provider ${ins.insertId}: mock/vl-reader (tier1, vision) + mock/grounded-stream (tier2, text)`);
} else if (mode === "seed") {
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
