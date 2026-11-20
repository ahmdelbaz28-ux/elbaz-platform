/**
 * SAADAT REAL-CASE TEST HARNESS — real problems, real student phrasing.
 * ────────────────────────────────────────────────────────────────────────
 * Runs the EXACT production path (intent → problem-ID resolution → BM25 →
 * buildSaadatContextBlock → getSystemPrompt) for realistic queries and checks
 * the "نموذجي" (exemplary-response) grounding contract mechanically:
 *   R1 intent fires (or stays quiet for the negative control)
 *   R2 the requested problem id is resolved deterministically
 *   R3 the top hit is the right chapter
 *   R4 the FULL composed production prompt contains the book's own
 *      ground-truth answer for the requested problem (±0.5% grounding)
 *   R5 prompt stays inside the lane budget
 * Run: npx tsx scripts/saadat-realcases.ts   (inside the repo root)
 */
import * as saadat from "../api/lib/chatbot-saadat.js";
import { getSystemPrompt } from "../api/lib/chatbot-prompts.js";

const { buildSaadatContextBlock, hasSaadatIntent, resolveProblemId, retrieveSaadat } = saadat;
// Feature-detect the multi-id resolver (added by the real-case fix):
const resolveProblemIds: (t: string) => string[] = saadat.resolveProblemIds
  ?? ((t: string) => { const one = saadat.resolveProblemId(t); return one ? [one] : []; });

interface Case {
  label: string;
  query: string;
  expectIntent: boolean;
  expectId?: string;        // first resolved id
  expectIdsAll?: string[];  // all pinned ids (multi-problem)
  expectChapter?: number;   // top bm25 hit chapter (concept queries)
  groundTruth?: string;     // the book's own stated answer that MUST appear in the prompt
  mode: "thinking" | "instant";
}

const CASES: Case[] = [
  { label: "P2.7 direct (colloquial)", query: "حل مسألة 2.7 بالتفصيل", expectIntent: true, expectId: "2.7", groundTruth: "530.5", mode: "thinking" },
  { label: "P2.7 with رَقَم + Arabic-Indic digits", query: "حل المسألة رقم ٢.٧ خطوة بخطوة", expectIntent: true, expectId: "2.7", groundTruth: "530.5", mode: "thinking" },
  { label: "P6.9 with parentheses (colloquial)", query: "عايز حل مسألة (6.9) بتاعة Ybus", expectIntent: true, expectId: "6.9", groundTruth: "j125", mode: "thinking" },
  { label: "Two problems in one message", query: "أحل المسألتين 6.9 و 10.3", expectIntent: true, expectId: "6.9", expectIdsAll: ["6.9", "10.3"], mode: "thinking" },
  { label: "P6.9 English", query: "how to build the Ybus matrix for the 4-bus system in problem 6.9", expectIntent: true, expectId: "6.9", groundTruth: "j125", mode: "thinking" },
  { label: "Gauss-Seidel concept", query: "شرح طريقة Gauss-Seidel في تدفق الأحمال", expectIntent: true, expectChapter: 6, mode: "thinking" },
  { label: "Ch9 fault colloquial", query: "مسألة قصر ثلاثي على bus 9 زي example 9.7", expectIntent: true, expectChapter: 9, mode: "thinking" },
  { label: "P11.1 swing constants", query: "إزاي أحسب M و H لمعادلة التأرجح؟ زي مسألة 11.1", expectIntent: true, expectId: "11.1", groundTruth: "801.2", mode: "thinking" },
  { label: "Economic dispatch concept", query: "في مسألة عن التوزيع الاقتصادي lambda iteration؟", expectIntent: true, expectChapter: 7, mode: "thinking" },
  { label: "P3.5 student disagrees with VR", query: "حل مسألة 3.5 وطلع معايا voltage regulation مش 2.247", expectIntent: true, expectId: "3.5", groundTruth: "2.247", mode: "thinking" },
  { label: "Ch10 symmetrical components", query: "المكونات المتماثلة للأعطال غير المتماثلة", expectIntent: true, expectChapter: 10, mode: "thinking" },
  { label: "P12.1 instant lane", query: "حل مسألة 12.1 بسرعة", expectIntent: true, expectId: "12.1", groundTruth: "25 MW", mode: "instant" },
  { label: "NEGATIVE: course price", query: "كام سعر كورس ETAP؟", expectIntent: false, mode: "thinking" },
];

// Thinking-lane prompt budget: the identity cores + routed skills run ≈29-38k
// chars by design (measured baseline); the guard here only fails if the Saadat
// layer pushes the prompt beyond the hard ceiling. Instant matches the repo's
// tested 22k budget.
const THINKING_BUDGET = 42_000;
const INSTANT_BUDGET = 22_000;

console.log("═══════ SAADAT REAL-CASE HARNESS ═══════");
let pass = 0, fail = 0;
const failures: string[] = [];

for (const c of CASES) {
  const intent = hasSaadatIntent(c.query);
  const id = resolveProblemId(c.query);
  const ids = resolveProblemIds(c.query);
  const hits = intent ? retrieveSaadat(c.query, c.mode === "instant" ? 1 : 3) : [];
  const block = intent ? buildSaadatContextBlock(c.query, "ar", c.mode) : "";
  const prompt = getSystemPrompt("ar", c.mode, "", false, undefined, undefined, false,
    c.query, false, "full", block);

  const r1 = intent === c.expectIntent;
  const r2 = c.expectId === undefined ? true : id === c.expectId;
  const r2b = c.expectIdsAll === undefined ? true : c.expectIdsAll.every((x) => ids.includes(x));
  const r3 = c.expectChapter === undefined ? true : hits.length > 0 && hits[0].ch === c.expectChapter;
  const r4 = c.groundTruth === undefined ? true : prompt.includes(c.groundTruth);
  const r5 = c.mode === "instant" ? prompt.length < INSTANT_BUDGET : prompt.length < THINKING_BUDGET;

  const ok = r1 && r2 && r2b && r3 && r4 && r5;
  if (ok) pass++; else { fail++; failures.push(c.label); }
  console.log(`\n── ${c.label}`);
  console.log(`   query: "${c.query}"`);
  console.log(`   R1 intent=${intent} (want ${c.expectIntent}) ${r1 ? "OK" : "FAIL"}`);
  if (c.expectId !== undefined) console.log(`   R2 id=${id ?? "null"} (want ${c.expectId}) ${r2 ? "OK" : "FAIL"}`);
  if (c.expectIdsAll !== undefined) console.log(`   R2b ids=[${ids.join(",")}] (want ${c.expectIdsAll.join(",")}) ${r2b ? "OK" : "FAIL"}`);
  if (c.expectChapter !== undefined) console.log(`   R3 topHit=${hits[0]?.id ?? "-"} ch${hits[0]?.ch ?? "-"} (want ch${c.expectChapter}) ${r3 ? "OK" : "FAIL"}`);
  if (c.groundTruth !== undefined) console.log(`   R4 book-answer "${c.groundTruth}" in production prompt: ${r4 ? "OK" : "FAIL"}`);
  console.log(`   R5 prompt=${prompt.length} chars (budget ${c.mode === "instant" ? INSTANT_BUDGET : THINKING_BUDGET}) ${r5 ? "OK" : "FAIL"}`);
  console.log(`   hits: ${hits.map((h) => `${h.id}(ch${h.ch},p${h.page},${h.reason})`).join(" ") || "—"}`);
  console.log(`   block: ${block.length} chars`);
}

console.log("\n═══════ SUMMARY ═══════");
console.log(`  PASS ${pass}/${pass + fail}${failures.length ? ` — FAILURES: ${failures.join(" | ")}` : ""}`);
if (fail > 0) process.exitCode = 1;
