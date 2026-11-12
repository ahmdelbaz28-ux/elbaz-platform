/**
 * measure-skillnet-impact.ts — قبل/بعد أرقام طبقة توجيه المهارات (v3.5.0)
 * يقاس: حجم البرومبت الكامل (fallback) مقابل البرومبت الموجّه لرسائل نموذجية،
 * وأحرف الحزم الجديدة، ويطبع جدولاً يُستخدم في تقرير المقارنة.
 */
import { getSystemPrompt } from "../api/lib/chatbot-prompts.js";
import { routeSkills, SKILL_REGISTRY } from "../api/lib/chatbot-skillnet.js";

function size(p: string): number { return p.length; }
function tokens(p: string): number { return Math.round(p.length / 4); }

const packIds = ["arc-flash-pack", "protection-coordination-pack", "load-flow-pack", "solar-pv-pack"];
let packsChars = 0;
for (const id of packIds) {
  const s = SKILL_REGISTRY.find((x) => x.id === id)!;
  packsChars += s.build("ar", "thinking").length + s.build("en", "thinking").length;
}

const cases: Array<{ label: string; lang: "ar" | "en"; mode: "thinking" | "instant"; signal: string }> = [
  { label: "سؤال Arc Flash في ETAP (عربي، thinking)", lang: "ar", mode: "thinking", signal: "كيف أعمل دراسة arc flash في ETAP خطوة بخطوة؟" },
  { label: "سؤال تنسيق حماية (عربي، thinking)", lang: "ar", mode: "thinking", signal: "كيف أضبط إعدادات الريليه وأتحقق من التنسيق بين القواطع؟" },
  { label: "مشروع شمسي في PVSyst (عربي، thinking)", lang: "ar", mode: "thinking", signal: "أنا أستخدم PVSyst لمشروع طاقة شمسية وأريد تحجيم السلاسل" },
  { label: "سؤال عن سعر كورس (عربي، thinking)", lang: "ar", mode: "thinking", signal: "كورس ETAP بكم؟ وهل يوجد خصم حالياً؟" },
  { label: "شكر غير تقني (عربي، thinking)", lang: "ar", mode: "thinking", signal: "شكراً جزيلاً على الرد اللطيف" },
  { label: "Arc Flash (إنجليزي، thinking)", lang: "en", mode: "thinking", signal: "How do I run an arc flash study in ETAP?" },
  { label: "Arc Flash سريع (عربي، instant)", lang: "ar", mode: "instant", signal: "كيف أعمل arc flash في ETAP؟" },
  { label: "شكر غير تقني (عربي، instant)", lang: "ar", mode: "instant", signal: "شكراً جزيلاً" },
];

console.log("=== BEFORE/AFTER — SKILLNET ROUTING (v3.5.0) ===\n");
const fallbackThinkingAr = getSystemPrompt("ar", "thinking");
const fallbackThinkingEn = getSystemPrompt("en", "thinking");
const fallbackInstantAr = getSystemPrompt("ar", "instant");
const before35ThinkingAr = fallbackThinkingAr.length; // fallback = superset
console.log(`Fallback thinking AR: ${fallbackThinkingAr.length} chars (~${tokens(fallbackThinkingAr)} tokens)`);
console.log(`Fallback thinking EN: ${fallbackThinkingEn.length} chars (~${tokens(fallbackThinkingEn)} tokens)`);
console.log(`Fallback instant AR:  ${fallbackInstantAr.length} chars (~${tokens(fallbackInstantAr)} tokens)`);
console.log(`New pack content (4 packs, AR+EN full): ${packsChars} chars\n`);

for (const c of cases) {
  const routed = getSystemPrompt(c.lang, c.mode, undefined, false, undefined, undefined, false, c.signal);
  const full = getSystemPrompt(c.lang, c.mode);
  const decision = routeSkills({ signal: c.signal, lang: c.lang, mode: c.mode });
  const saved = full.length - routed.length;
  const savedPct = ((saved / full.length) * 100).toFixed(1);
  console.log(`${c.label}`);
  console.log(`  قبل (3.4.0-equivalent full): ${full.length} chars (~${tokens(full)} tok)`);
  console.log(`  بعد (routed): ${routed.length} chars (~${tokens(routed)} tok) — strategy=${decision.strategy}, saved=${saved} chars (${savedPct}%) ≈ ${Math.round(saved / 4)} tokens`);
  console.log(`  selected: ${decision.selected.map((s) => s.id).join(", ")}`);
}
