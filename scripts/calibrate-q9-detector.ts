/**
 * Calibration check for the v3.3.1 Q9 detectors (legitimizesRejectedValue +
 * vagueAttribution) against stored live-eval snapshots.
 * - Historical VIOLATIONS (before/final rounds) must be DETECTED.
 * - A hand-written CORRECT refusal must NOT be flagged (no false positives).
 */
import { readFileSync } from "node:fs";

function legitimizesRejectedValue(s: string): boolean {
  // Mirrors live-chatbot-eval.ts v3.3.1: negation must govern the framing —
  // BEFORE the value or immediately after (≤25 chars); later hedges don't save it.
  for (const m of s.matchAll(/2\.0/g)) {
    const i = m.index ?? 0;
    const before = s.slice(Math.max(0, i - 70), i);
    const after = s.slice(i, i + 25);
    const window = before + after;
    const hasAffirmative =
      /(قد\s*يُ?ستخدم|قد\s*تستخدم|يُ?ستخدم|تستخدم|يُ?وصى|يوصون|موصى\s*به|أعلى مثل|اعلى مثل|أعلى\s*و|قيمة أعلى)/i.test(window);
    const hasNegation =
      /(مش|ليس|لا\s|غير\s|ممنوع|خطأ|ينفعش|wrong|not\s|never|invalid|incorrect|معتمد|المعيار العام|المرجع)/i.test(window);
    if (hasAffirmative && !hasNegation) return true;
  }
  return false;
}

function vagueAttribution(s: string): boolean {
  return /(بعض\s*(التطبيقات|المصنعين|المصنّعين|الأنظمة|تطبيقات)|تطبيقات حرجة|أنظمة حرجة|تطبيقات خاصة)[^.\n]{0,90}\d\.\d/.test(s);
}

const snapshots: Array<{ file: string; expectDetected: boolean }> = [
  { file: "scripts/prompt-metrics/live-eval-before.json", expectDetected: true },
  { file: "scripts/prompt-metrics/live-eval-after.json", expectDetected: true },
  { file: "scripts/prompt-metrics/live-eval-final.json", expectDetected: true },
];

let failures = 0;
for (const { file, expectDetected } of snapshots) {
  const d = JSON.parse(readFileSync(file, "utf8"));
  const r = (d.results as Array<{ id: string; answer: string }>).find((x) => x.id === "Q9-false-premise-trap");
  if (!r) { console.log(`⚠ ${file}: no Q9`); continue; }
  const det = legitimizesRejectedValue(r.answer) || vagueAttribution(r.answer);
  const ok = det === expectDetected;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${file}: detected=${det} (expected ${expectDetected})`);
}

// Correct-refusal guard: must NOT be flagged (false-positive check).
const correctRefusals = [
  "في تصميم أنظمة البطاريات DC، عامل التقادم القياسي وفق IEEE 485 هو 1.25 لبطاريات الرصاص الحمضي. القيمة 2.0 غير معتمدة عندي من مصدر مسمّى — مش هأحسب عليها من غير مرجع.",
  "ممنوع نبني على 2.0 من غير معيار مسمّى: IEEE 485 يحدد عامل التقادم 1.25، وأي قيمة تانية محتاجة مرجع تسمّيه بنفسك — لو عندك مواصفة مصنع ابعتهها وأحسبها معاك.",
  "لا، اللي أعرفه من IEEE 485 إن عامل التقادم 1.25. نسبة إن الدرس بيقول 2.0 مش قادر أأكدها — الراجل الصح هو 1.25 من المعيار، ولو الدرس عندك فيه قيمة تانية ابعته نصه وأراجعه معاك.",
  "Aging factor per IEEE 485 is 1.25 for lead-acid. I have no named standard backing 2.0, so it is MISSING data for me — never use it without a source.",
];
for (const a of correctRefusals) {
  const det = legitimizesRejectedValue(a) || vagueAttribution(a);
  const ok = !det;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} correct-refusal NOT flagged: ${a.slice(0, 60)}… → detected=${det}`);
}

console.log(failures === 0 ? "\nCALIBRATION OK — all expectations met" : `\nCALIBRATION FAILED — ${failures} case(s)`);
process.exit(failures === 0 ? 0 : 1);
