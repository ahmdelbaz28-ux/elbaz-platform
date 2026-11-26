/**
 * AUDIT — chatbot skill-integration & routing-discipline proof (v3.9.1).
 * Answers the owner's three questions with RUNTIME evidence, not prose:
 *   A. INTEGRATION: do skills co-activate correctly when a task needs both
 *      (e.g. cables sizing + explicit file request → cables core + docgen)?
 *   B. TOKEN DISCIPLINE: every routed/lean prompt saves tokens vs the
 *      legacy full-injection superset; numbers are printed per case.
 *   C. NO IRRELEVANT KB READS: saadat/cables/refs RAG blocks stay EMPTY
 *      unless their intent gate fires; a Schneider question never loads
 *      ABB/DPS docs, an ETAP question loads no KB at all.
 */
import { getSystemPrompt, PROMPT_VERSION } from "../elbaz-platform/api/lib/chatbot-prompts";
import { routeSkills } from "../elbaz-platform/api/lib/chatbot-skillnet";
import { buildCablesContextBlock, hasCablesIntent } from "../elbaz-platform/api/lib/chatbot-cables";
import { buildRefsContextBlock, hasRefsIntent, routeRefsQuery } from "../elbaz-platform/api/lib/chatbot-refs";
import { buildSaadatContextBlock } from "../elbaz-platform/api/lib/chatbot-saadat";

/** Production-replica gating (the exact chatbot.ts junction, v3.9.2):
 *  cross-flags flow BOTH ways — refs receives cablesIntentActive, cables
 *  receives refsRouteActive (suppressed unless an explicit cable noun). */
function productionKB(query: string): { saadat: string; cables: string; refs: string } {
  const cablesIntentActive = hasCablesIntent(query);
  const refsRouteActive = hasRefsIntent(query) && routeRefsQuery(query, cablesIntentActive).docs.length > 0;
  return {
    saadat: buildSaadatContextBlock(query, "ar", "thinking"),
    cables: buildCablesContextBlock(query, "ar", "thinking", { refsRouteActive }),
    refs: buildRefsContextBlock(query, "ar", "thinking", { cablesIntentActive }),
  };
}

const CEILING_BY_LANE: Record<string, number> = { thinking: 40_000, instant: 22_000 };

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  const safe = detail.replace(/\p{Cc}+/gu, " ");
  console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${label}${safe ? ` — ${safe}` : ""}`);
  if (ok) {
    pass++;
  } else {
    fail++;
  }
}

interface Case {
  id: string;
  q: string;
  expectSkills: string[];
  forbidSkills?: string[];
  expectKB: Array<"cables" | "refs" | "saadat">;  // which RAG blocks must be NON-empty
  forbidKB: Array<"cables" | "refs" | "saadat">;  // which RAG blocks must be EMPTY
}

const CASES: Case[] = [
  {
    id: "A1 cables sizing + explicit PDF request (integration: cables core × docgen)",
    q: "اعمل لي ملف PDF بتقرير اختيار مقطع الكابل لتغذية محرك 90 كيلووات على مسافة 150 متر",
    expectSkills: ["cables-expert-core", "docgen-file-export"],
    forbidSkills: [],
    expectKB: ["cables"],
    forbidKB: ["saadat", "refs"],
  },
  {
    id: "A2 ABB transformer selection (refs→abb lane only)",
    q: "اختر لي محول جهد من ABB قدرته 1000 كيلو فولت أمبير جهد 11 كيلو فولت",
    expectSkills: ["abb-transformer-core"],
    forbidSkills: ["saudi-load-core", "schneider-price-core", "gilany-pse-core"],
    expectKB: ["refs"],
    forbidKB: ["cables", "saadat"],
  },
  {
    id: "A3 Saudi DPS load calculation (refs→saudi lane + Schneider cross-link)",
    q: "احسب الأحمال حسب الكود السعودي DPS لمصنع به محركات 50 كيلووات وإنارة 10 كيلووات",
    expectSkills: ["saudi-load-core"],
    forbidSkills: ["abb-transformer-core", "gilany-pse-core"],
    expectKB: ["refs"],
    forbidKB: ["cables", "saadat"],
  },
  {
    id: "A4 academic Saadat problem",
    q: "حل مسألة تدفق الأحمال شبكة 3 عقد بطريقة نيوتن رافسون فصل 6",
    expectSkills: ["saadat-academic-core"],
    forbidSkills: [],
    expectKB: ["saadat"],
    forbidKB: ["cables", "refs"],
  },
  {
    id: "A5 ETAP arc-flash study (domain core + study pack, ZERO KB)",
    q: "كيف أعمل دراسة arc flash في ETAP خطوة بخطوة؟",
    expectSkills: ["etap-expert-core", "arc-flash-pack"],
    forbidSkills: [],
    expectKB: [],
    forbidKB: ["cables", "refs", "saadat"],
  },
  {
    id: "A6 SLD drawing request",
    q: "ارسم لي مخطط single line diagram للوحة توزيع رئيسية",
    expectSkills: ["sld-drawing-skill"],
    forbidSkills: ["docgen-file-export"],
    expectKB: [],
    forbidKB: ["cables", "refs", "saadat"],
  },
  {
    id: "A7 casual thanks → LEAN (all routable skills dropped)",
    q: "شكراً جزيلاً على الرد اللطيف",
    expectSkills: [],
    forbidSkills: ["docgen-file-export", "sld-drawing-skill", "find-skills-discovery"],
    expectKB: [],
    forbidKB: ["cables", "refs", "saadat"],
  },
];

console.log(`PROMPT_VERSION = ${PROMPT_VERSION}\n`);

for (const c of CASES) {
  console.log(`▶ ${c.id}`);
  console.log(`  Q: ${c.q}`);

  const decision = routeSkills({ signal: c.q, lang: "ar", mode: "thinking" });
  const sel = new Set(decision.selected.map((s) => s.id));
  for (const id of c.expectSkills) {
    check(`skill selected: ${id}`, sel.has(id), decision.strategy);
  }
  for (const id of c.forbidSkills) {
    check(`skill NOT selected: ${id}`, !sel.has(id));
  }

  const kb = productionKB(c.q);
  for (const k of c.expectKB) check(`KB loaded: ${k}`, kb[k].length > 0, `${kb[k].length} chars`);
  for (const k of c.forbidKB) check(`KB EMPTY: ${k}`, kb[k].length === 0, `${kb[k].length} chars`);

  // Token discipline: routed/lean must save vs full-fallback superset.
  if (decision.strategy !== "full-fallback") {
    check("token savings > 0 vs legacy full injection", decision.savedTokensEstimate > 0, `~${decision.savedTokensEstimate} tok saved (${decision.savedChars} chars)`);
  }

  // The composed prompt must stay under its lane's evolution-meter ceiling
  // (thinking = 40k chars, instant = 22k chars — scripts/measure-chatbot-evolution.ts).
  const prompt = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, false, c.q, false, "full", kb.saadat, kb.cables, kb.refs);
  check("composed prompt < thinking ceiling (40k)", prompt.length < CEILING_BY_LANE.thinking, `${prompt.length} chars`);
  console.log("");
}

// ── C. format-question gate (no file on a mere mention) ────────────────────
console.log("▶ C1 format question (mention ≠ request)");
const fq = "ما الفرق بين pdf و docx؟";
const fqRoute = routeSkills({ signal: fq, lang: "ar", mode: "thinking" });
const fqPrompt = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, false, fq);
check("docgen skill rides the routed lane (instructions available)", fqRoute.selected.some((s) => s.id === "docgen-file-export"));
check("gate forbids a board on a mere mention", fqPrompt.includes("دون طلب ملف → جاوب نصاً عادياً بلا أي لوحة docgen"));
check("gate forbids any suggestion/offer", fqPrompt.includes("ممنوع منعاً باتاً اقتراح توليد ملف أو عرضه على المستخدم"));
const fqq: Record<string, string> = {
  saadat: buildSaadatContextBlock(fq, "ar", "thinking"),
  cables: buildCablesContextBlock(fq, "ar", "thinking"),
  refs: buildRefsContextBlock(fq, "ar", "thinking", { cablesIntentActive: false }),
};
check("no KB loaded for a format question", fqq.saadat.length === 0 && fqq.cables.length === 0 && fqq.refs.length === 0);
console.log("");

// ── C2. OWNER DISCIPLINE v3.9.2: Saudi-DPS question never drags the Elsewedy/EgyCode KB ──
console.log("▶ C2 Saudi-DPS question + load words → cables KB stays EMPTY (no unimportant reads)");
const saudiQ = "احسب الأحمال حسب الكود السعودي DPS لمصنع به محركات 50 كيلووات وإنارة 10 كيلووات";
const saudiKB = productionKB(saudiQ);
check("refs KB loaded (Saudi core owns it)", saudiKB.refs.length > 0, `${saudiKB.refs.length} chars`);
check("cables KB EMPTY (load words ≠ cable nouns)", saudiKB.cables.length === 0);
const saudiQ2 = "احسب الأحمال حسب الكود السعودي DPS ثم اختر مقطع الكابل للتغذية الرئيسية";
const saudiKB2 = productionKB(saudiQ2);
check("cables KB returns when an explicit cable noun joins the Saudi question", saudiKB2.cables.length > 0, `${saudiKB2.cables.length} chars`);
check("refs KB still loaded alongside (integration)", saudiKB2.refs.length > 0);
console.log("");

// ── D. refs internal scoping (Schneider question never loads ABB/DPS docs) ──
console.log("▶ D1 refs query routing inside the references core");
const sq = "احتاج قاطع شنايدر 250 أمبير 3 أطوار من قائمة الأسعار";
const route = routeRefsQuery(sq, false);
check("schneider lane fires", route.schneider);
check("abb lane silent on a Schneider breaker question", !route.abb);
check("saudi lane silent on a Schneider breaker question", !route.saudi);
const sqBlock = buildRefsContextBlock(sq, "ar", "thinking", { cablesIntentActive: false });
check("refs block built for the Schneider question", sqBlock.length > 0, `${sqBlock.length} chars`);
check("no ABB-KB excerpt inside the Schneider block", !sqBlock.includes("ABB-KB"), "");
console.log("");

// ── E. token economy totals ────────────────────────────────────────────────
console.log("▶ E token economy across the battery");
const battery = CASES.map((c) => c.q);
let totalSaved = 0;
for (const q of battery) {
  const d = routeSkills({ signal: q, lang: "ar", mode: "thinking" });
  totalSaved += d.savedTokensEstimate;
}
check("battery saves tokens on every case", totalSaved > 0, `total ~${totalSaved} tokens saved across ${battery.length} questions`);

console.log("");
console.log(pass > 0 && fail === 0 ? `AUDIT GREEN — ${pass} checks passed` : `AUDIT FAILED — ${fail} of ${pass + fail} checks failed`);
if (fail > 0) process.exit(1);
