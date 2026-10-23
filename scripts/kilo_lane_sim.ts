/**
 * Kilo-lane discovery simulation — feed the REAL kilo gateway /models payload
 * through classifyRawModel to verify exactly what production's boot discovery
 * will store for the free lane (chat / vision / tier ordering).
 */
import { readFileSync } from "node:fs";
import { tsImport } from "tsx/esm/api";

const payload = JSON.parse(readFileSync("/tmp/kilo_models.json", "utf-8"));
const { classifyRawModel, SPECIALIST_CHAT_RE } = await tsImport("../api/lib/ai-router.ts", import.meta.url);

const rows = [];
for (const raw of payload.data ?? []) {
  const cls = classifyRawModel(raw);
  if (!cls) continue;
  if (!cls.isFree) continue;
  rows.push(cls);
}
// Mirror the ROUTING-TIME filters exactly (buildCandidates): NON_CHAT guard +
// specialist exclusion for the general chat lane.
const chat = rows.filter((r) => r.supportsChat && !SPECIALIST_CHAT_RE.test(r.modelId));
const vision = rows.filter((r) => r.supportsVision && r.supportsChat);

console.log("== FREE models classified:", rows.length, "==");
console.log("\n-- CHAT-lane eligible (after NON_CHAT + SPECIALIST exclusions) --");
for (const r of chat.sort((a, b) => a.tier - b.tier || b.contextLength - a.contextLength)) {
  console.log(`  tier${r.tier} ctx=${String(r.contextLength).padStart(7)} ${r.modelId}`);
}
console.log("\n-- VISION-lane eligible --");
for (const r of vision.sort((a, b) => a.tier - b.tier || b.contextLength - a.contextLength)) {
  console.log(`  tier${r.tier} ctx=${String(r.contextLength).padStart(7)} ${r.modelId}`);
}
console.log("\n-- EXCLUDED from chat lane (specialist/non-chat) --");
for (const r of rows.filter((r) => !r.supportsChat)) {
  console.log(`  ${r.modelId} (chat=${r.supportsChat} vision=${r.supportsVision})`);
}
