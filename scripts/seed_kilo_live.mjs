/**
 * KILO LIVE e2e seeding — the mock groq safety net ONLY (priority 30).
 * The kilocode provider row (priority 5, real token) is created by the
 * db-init env-sync path at boot — this script deliberately does NOT touch it,
 * so the run also proves the env→DB auto-creation works on an existing DB.
 */
import mysql from "mysql2/promise";

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: url.username,
  password: url.password,
  database: url.pathname.replace(/^\//, ""),
  multipleStatements: true,
});

const [rows] = await conn.query("SELECT id FROM aiProviders WHERE slug='groq'");
for (const p of rows) await conn.query("DELETE FROM aiModels WHERE providerId=?", [p.id]);
await conn.query("DELETE FROM aiProviders WHERE slug='groq'");

const [gq] = await conn.query(
  "INSERT INTO aiProviders (slug, displayName, baseUrl, apiKey, priority, enabled, status) VALUES ('groq','Groq Mock','http://127.0.0.1:47777/v1','mock-key',30,1,'healthy')"
);
await conn.query(
  "INSERT INTO aiModels (providerId, modelId, supportsChat, supportsVision, isFree, enabled, tier, contextLength) VALUES (?,?,1,0,1,1,1,131072)",
  [gq.insertId, "mock/grounded-stream"]
);
console.log(`seeded groq mock=${gq.insertId} (grounded-stream, priority 30 safety net)`);
await conn.end();
