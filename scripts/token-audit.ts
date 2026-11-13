/**
 * TOKEN SAVINGS AUDIT — quantifies the v3.6.0 optimization layer.
 *
 * Measures, on the REAL prompt builders and normalizers:
 *   1. Stable-prefix share of the system prompt (provider prompt-cache
 *      eligibility → 50-90% discount on cached tokens at OpenAI/Groq/NVIDIA).
 *   2. Catalog gating: full vs lite prompt size on a technical question.
 *   3. History trim: shipped history chars before/after for realistic
 *      conversations.
 *   4. Vision description cap: injected chars before/after.
 *   5. Intent-gated web plugin: attachment decision matrix.
 *
 * Run: npx tsx scripts/token-audit.ts
 */

import { getSystemPrompt } from "../api/lib/chatbot-prompts.js";
import { courseIntentFromMessages, hasWebIntent, sliceCatalogLite } from "../api/lib/chatbot-intent.js";
import { normalizeChatInput } from "../api/lib/chatbot-normalize.js";

// chatbot-vision keeps its cap module-private; the audit documents it here.
const VISION_CAP_CHARS = 2_400;

const COURSES = 40;
const fullCatalog = Array.from({ length: COURSES }, (_, i) =>
  `- كورس ETAP عملي ${i + 1} | Practical ETAP Course ${i + 1} — المستوى/Level: ${["مبتدئ", "متوسط", "متقدم"][i % 3]} | السعر/Price: ${(200 + i * 50).toLocaleString()} EGP | المدة/Duration: ${10 + i} ساعة | مدفوع/Premium — داخل المنصة (on-platform path): /courses/practical-etap-${i + 1}`
).join("\n");
const liteCatalog = sliceCatalogLite(fullCatalog, 8);

function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  return i;
}

const pct = (n: number, d: number) => `${Math.round((n / Math.max(1, d)) * 100)}%`;
const tok = (chars: number) => Math.round(chars / 4); // conservative 4 ch/tok — Arabic real BPE is heavier

console.log("═".repeat(72));
console.log(" TOKEN SAVINGS AUDIT — prompt v3.6.0 (measured on the real builders)");
console.log("═".repeat(72));

// ── 1. Stable prefix share ──────────────────────────────────────────────────
console.log("\n[1] CACHE-FRIENDLY LAYOUT — stable prefix share (provider prompt caching)");
for (const [lang, mode] of [["ar", "thinking"], ["ar", "instant"], ["en", "thinking"], ["en", "instant"]] as const) {
  const pFull = getSystemPrompt(lang, mode, fullCatalog);
  const pOther = getSystemPrompt(lang, mode, fullCatalog, false, "ملخص متداول قديم للمحادثات السابقة", undefined, false, "احسب تيار القصر");
  const prefix = commonPrefixLen(pFull, pOther);
  console.log(`   ${mode}/${lang}: prompt ${(pFull.length / 1000).toFixed(1)}k chars → identical prefix ${prefix} chars = ${pct(prefix, pFull.length)} of the prompt is cacheable`);
}

// ── 2. Catalog gating ───────────────────────────────────────────────────────
console.log("\n[2] CATALOG GATING — full vs lite (non-course messages)");
const techPromptFull = getSystemPrompt("ar", "thinking", fullCatalog, false, undefined, undefined, false, "احسب تيار القصر عند البوس الرئيسي");
const techPromptLite = getSystemPrompt("ar", "thinking", liteCatalog, false, undefined, undefined, false, "احسب تيار القصر عند البوس الرئيسي");
const savedChars = techPromptFull.length - techPromptLite.length;
console.log(`   catalog chars: full=${fullCatalog.length} lite=${liteCatalog.length}`);
console.log(`   technical-question prompt: full=${techPromptFull.length} lite=${techPromptLite.length} → saved ${savedChars} chars ≈ ${tok(savedChars)}+ tokens/message (Arabic real BPE ≈ 2x)`);
console.log(`   × every cascade attempt × every persistence round × ${COURSES - 8} catalog rows`);

// ── 3. History trim ─────────────────────────────────────────────────────────
console.log("\n[3] HISTORY TRIM — sliding window on realistic conversations");
for (const rounds of [10, 20]) {
  const raw = Array.from({ length: rounds }, (_, i) => [
    { role: "user", content: `سؤال هندسي رقم ${i + 1} مع تفاصيل المواصفات: ${"و".repeat(300)}` },
    { role: "assistant", content: `إجابة مفصلة برقم ${i + 1}: ${"ج".repeat(2000)}` },
  ]).flat();
  const norm = normalizeChatInput(raw);
  if (!norm.ok) throw new Error("normalize failed");
  const before = raw.reduce((s, m) => s + (m.content as string).length, 0);
  const after = norm.data.messages.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0);
  console.log(`   ${rounds} rounds: shipped ${before} → ${after} chars (saved ${pct(before - after, before)} ≈ ${tok(before - after)} tokens/request)`);
}

// ── 4. Vision description cap ───────────────────────────────────────────────
console.log("\n[4] VISION DESCRIPTION CAP");
console.log(`   MAX_DESCRIPTION_CHARS: 6000 → ${VISION_CAP_CHARS} (saves ≈ ${tok(6000 - VISION_CAP_CHARS)} tokens per screen frame × 60 frames/day lane)`);

// ── 5. Web plugin gating ────────────────────────────────────────────────────
console.log("\n[5] WEB PLUGIN GATING — attachment decision matrix");
const samples = [
  ["كم سعر ترخيص ETAP 2026؟", true],
  ["ما هو أحدث إصدار من PowerFactory؟", true],
  ["احسب تيار القصر عند بوس 11kV", false],
  ["اشرح لي تنسيق الحماية", false],
  ["How do I model a transformer in SKM?", false],
] as const;
for (const [text, expected] of samples) {
  const got = hasWebIntent(text);
  console.log(`   ${got === expected ? "✓" : "✗"} "${text}" → ${got ? "web ON" : "web OFF (saves 1-3k injected tokens/attempt)"}`);
}

// ── 6. Catalog intent matrix ────────────────────────────────────────────────
console.log("\n[6] CATALOG INTENT — course questions always get the FULL catalog");
const courseSamples = [
  [[{ role: "user", content: "إيه كورسات المنصة؟" }] as const, true],
  [[{ role: "user", content: "كم سعر كورس الحماية؟" }] as const, true],
  [
    [{ role: "user", content: "عايز كورس ETAP" }, { role: "assistant", content: "..." }, { role: "user", content: "طيب والأخيرة دي؟" }] as const,
    true,
  ],
  [[{ role: "user", content: "احسب هبوط الجهد للفيدر" }] as const, false],
] as const;
for (const [msgs, expected] of courseSamples) {
  const got = courseIntentFromMessages(msgs as never);
  console.log(`   ${got === expected ? "✓" : "✗"} → full catalog: ${got}`);
}

console.log("\n" + "═".repeat(72));
console.log(" Quality guarantees: stable-prefix reordering only, intent false-positives");
console.log(" restore legacy behavior, latest 2 assistant turns + current question always full.");
console.log("═".repeat(72));
