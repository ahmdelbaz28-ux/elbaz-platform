/* Find duplicated instruction segments inside the static prompt floor. */
import { getSystemPrompt } from "../api/lib/chatbot-prompts.js";

const p = getSystemPrompt("ar", "thinking", undefined, false, undefined, undefined, false, "شكراً جزيلاً على الرد اللطيف");

// split into blocks by the emoji-section convention, look for overlapping themes
const sections = p.split("\n\n");
console.log("section count:", sections.length);
for (const s of sections) {
  const head = s.trim().slice(0, 90).replace(/\n/g, " ");
  console.log(`${String(s.length).padStart(6)} chars | ${head}`);
}

// repeated key phrases (duplication candidates)
const probes = [
  "الهندسة الكهربية", "ETAP", "لا تخترع", "لا تختلق", "المصدر", "الاستشهاد", "استشهد",
  "أداة", "كورسات", "أحمد الباز", "المنصة", "اتبع", "خطوة بخطوة", "±0.5", "التوثيق",
  "ممنوع", "إلزامي",
];
console.log("\n=== phrase occurrence counts (duplication candidates) ===");
for (const probe of probes) {
  const count = p.split(probe).length - 1;
  if (count >= 2) console.log(`"${probe}" × ${count}`);
}
