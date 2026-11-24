/* Break down the thinking-mode prompt composition (block-level sizes). */
import { SKILL_REGISTRY } from "../api/lib/chatbot-skillnet.js";
import { getSystemPrompt } from "../api/lib/chatbot-prompts.js";

console.log("=== skill block sizes (ar/thinking) ===");
const rows = SKILL_REGISTRY.map((s) => ({ id: s.id, alwaysOn: !!s.alwaysOn, len: s.build("ar", "thinking").length }))
  .sort((a, b) => b.len - a.len);
let always = 0;
let routable = 0;
for (const r of rows) {
  if (r.len > 0) console.log(`${r.id.padEnd(34)} ${String(r.len).padStart(6)} chars ${r.alwaysOn ? "(always-on)" : ""}`);
  if (r.alwaysOn) always += r.len;
  else routable += r.len;
}
console.log(`TOTAL always-on blocks: ${always} chars (~${Math.round(always / 3.4)} tokens)`);
console.log(`TOTAL routable blocks : ${routable} chars (~${Math.round(routable / 3.4)} tokens)`);

const lean = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, false, "شكراً جزيلاً على الرد اللطيف");
console.log(`\nLEAN thinking prompt (generic msg): ${lean.length} chars (~${Math.round(lean.length / 3.4)} tokens)`);
console.log(`→ static prompt floor (persona+platform+etc): ${lean.length - always} chars (~${Math.round((lean.length - always) / 3.4)} tokens)`);
