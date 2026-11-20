/**
 * Live smoke test of the Saadat Academic Core end-to-end path:
 * intent → retrieval → verification → routing → full prompt composition.
 * Run: npx tsx scripts/saadat-smoke.ts   (inside the repo root)
 */
import {
  buildSaadatContextBlock,
  hasSaadatIntent,
  retrieveSaadat,
  resolveProblemId,
  verifyAgainstBook,
} from "../api/lib/chatbot-saadat.js";
import { getSystemPrompt } from "../api/lib/chatbot-prompts.js";
import { routeSkills } from "../api/lib/chatbot-skillnet.js";

const queries = [
  "حل مسألة 2.7 من كتاب سعدت بالخطوات",
  "ازاي أبني Ybus لتدفق الأحمال؟",
  "شرح المكونات المتماثلة للأعطال غير المتماثلة",
  "كام سعر كورس ETAP؟",
];

console.log("═══════ SAADAT ACADEMIC CORE — LIVE SMOKE ═══════");
for (const q of queries) {
  console.log(`\n── query: ${q}`);
  console.log("  intent:", hasSaadatIntent(q));
  console.log("  problemId:", resolveProblemId(q));
  const block = buildSaadatContextBlock(q, "ar", "thinking");
  const hits = retrieveSaadat(q, 3);
  console.log("  hits:", hits.map((h) => `${h.id}(ch${h.ch},p${h.page},${h.reason})`).join(" "));
  console.log("  block chars:", block.length);
}

console.log("\n═══════ verification contract (±0.5%) ═══════");
console.log("  2.7 @ 530.5 →", JSON.stringify(verifyAgainstBook("2.7", 530.5), null, 0).slice(0, 220));
console.log("  2.7 @ 500   →", JSON.stringify(verifyAgainstBook("2.7", 500), null, 0).slice(0, 200));
console.log("  6.9 @ -j100 →", JSON.stringify(verifyAgainstBook("6.9", -100), null, 0).slice(0, 220));

console.log("\n═══════ routing + prompt composition ═══════");
const decision = routeSkills({ signal: "حل مسألة 2.7 من كتاب سعدت", lang: "ar", mode: "thinking" });
console.log("  selected:", decision.selected.map((s) => `${s.id}:${s.score}`).join(", "));
const prompt = getSystemPrompt("ar", "thinking", "", false, undefined, undefined, false, "حل مسألة 2.7 من كتاب سعدت", false, "full", buildSaadatContextBlock("حل مسألة 2.7 من كتاب سعدت", "ar"));
console.log("  thinking prompt chars:", prompt.length);
console.log("  has saadat core:", prompt.includes("النواة الأكاديمية"));
console.log("  has KB block:", prompt.includes("SAADAT-KB"));
console.log("  has citation contract:", prompt.includes("[Saadat, Solutions Manual, Ch.X"));

const instantPrompt = getSystemPrompt("ar", "instant", "", false, undefined, undefined, false, "حل مسألة 2.7 من كتاب سعدت", false, "full", buildSaadatContextBlock("حل مسألة 2.7 من كتاب سعدت", "ar", "instant"));
console.log("  instant prompt chars:", instantPrompt.length, "(budget 22000)");
