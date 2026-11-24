/* Prompt-size audit: measure the REAL system prompt for each scenario
 * (token estimate ≈ chars/3.4 for mixed AR/EN technical text). */
import { getSystemPrompt } from "../api/lib/chatbot-prompts.js";
import { buildCablesContextBlock } from "../api/lib/chatbot-cables.js";
import { buildSaadatContextBlock } from "../api/lib/chatbot-saadat.js";
import { buildRefsContextBlock, hasRefsIntent } from "../api/lib/chatbot-refs.js";
import { routeSkills } from "../api/lib/chatbot-skillnet.js";

function measure(label: string, prompt: string): void {
  const chars = prompt.length;
  console.log(`${label.padEnd(52)} chars=${String(chars).padStart(7)} ~tokens≈${Math.round(chars / 3.4)}`);
}

const scenarios: Array<{ label: string; q: string }> = [
  { label: "generic: ما الفرق بين القاطع والفاصل؟", q: "ما الفرق بين القاطع والفاصل؟" },
  { label: "cables: مقطع كابل 100 ك.و 200 متر مدفون", q: "مقطع كابل نحاس 4×25 مم2 لحمل 100 كيلو واط طول 200 متر مدفون في الأرض تيار قصر 25 كيلو أمبير" },
  { label: "saudi: فيلا 300م² الكود السعودي", q: "فيلا سكنية C1 مساحة 300 متر مربع على 230/400 فولت وفق الكود السعودي احسب الحمل المتصل وحمل الطلب" },
  { label: "schneider: قاطع 1600A سعر", q: "قاطع هوائي Masterpact بتيار 1600 أمبير 3 أقطار من قائمة أسعار شنايدر مع السعر" },
  { label: "abb: محول 1000 kVA", q: "محول ABB 1000 kVA جهد 11/0.4 ك.ف زيتي بكل بياناته" },
  { label: "gilany: spinning reserve", q: "ما هو الاحتياطي الدوار spinning reserve كما يشرح كتاب جيلاني؟" },
  { label: "saadat: مسألة مصفوفات امكانية", q: "حل مسألة Ybus من كتاب سعدت حلول الفصل التاسع امكانية الحمل" },
];

for (const s of scenarios) {
  for (const mode of ["thinking", "instant"] as const) {
    const saadat = buildSaadatContextBlock(s.q, "ar", mode);
    const cables = buildCablesContextBlock(s.q, "ar", mode);
    const cablesActive = cables.length > 0;
    const refs = buildRefsContextBlock(s.q, "ar", mode, { cablesIntentActive: cablesActive });
    const p = getSystemPrompt("ar", mode, undefined, false, undefined, undefined, false, s.q, false, "full", saadat, cables, refs);
    measure(`[${mode}] ${s.label}`, p);
  }
}

// skillnet routing decision for each scenario
console.log("\n--- skillnet routing (thinking) ---");
for (const s of scenarios) {
  const d = routeSkills({ signal: s.q, lang: "ar", mode: "thinking", floor: false });
  console.log(`${s.label.slice(0, 40).padEnd(42)} strategy=${d.strategy} selected=${d.selected.map((x) => x.id).join(",") || "-"} savedTokens≈${d.savedTokensEstimate}`);
}
