/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHATBOT EVOLUTION METER — objective before/after measurement for any
 *  system-prompt change (agency-distill work: Options A / B / D).
 * ───────────────────────────────────────────────────────────────────────────
 *  Measures, for every (language × mode) system prompt:
 *   1. Size: characters + approximate token cost (heuristic, consistent
 *      across runs: Arabic ≈ 1 token / 2.5 chars, Latin ≈ 1 / 4, other ≈ 1 / 3).
 *   2. Knowledge coverage: presence of concrete engineering anchors grouped
 *      by domain (batteries/DC, earthing/lightning, short-circuit, arc flash,
 *      coordination, generators/UPS, units discipline, support tone).
 *   3. Prompt integrity (hard gate): safety rule, language rule, reasoning
 *      guard, table ban, no catalog placeholder leak, no CJK, size ceiling.
 *
 *  Usage:
 *    npx tsx scripts/measure-chatbot-evolution.ts --save <file.json>
 *    npx tsx scripts/measure-chatbot-evolution.ts --compare <file.json>
 *
 *  --compare exits 1 when any integrity check fails or the thinking prompt
 *  grows beyond the ceiling — safe to use as a pre-commit gate.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getSystemPrompt } from "../api/lib/chatbot-prompts.js";

// ─── Knowledge anchors (must be distinctive strings inside the prompts) ────

interface Category {
  key: string;
  label: string;
  /** Anchor applies to the AR prompt, EN prompt, or both via either-language list. */
  anchors: Array<{ re: RegExp; why: string }>;
  /** Which option introduced/strengthened this category (for reporting). */
  introducedBy: "baseline" | "A" | "B" | "D";
}

const CATEGORIES: Category[] = [
  {
    key: "batteries_dc",
    label: "Batteries & DC systems (IEEE 485 / -48 V plants)",
    introducedBy: "A",
    anchors: [
      { re: /IEEE 485/, why: "battery sizing standard" },
      { re: /C10|C20/, why: "discharge-rate discipline (capacity meaningless without rate)" },
      { re: /end.of.discharge|نهاية التفريغ/i, why: "end-of-discharge voltage input" },
      { re: /1\.25/, why: "IEEE 485 ageing factor" },
      { re: /ageing|aging|تقادم/i, why: "ageing factor concept" },
      { re: /LVD|low.voltage disconnect/i, why: "low-voltage disconnect settings" },
      { re: /-48 ?V|48 ?V DC/i, why: "telecom DC plant voltage" },
    ],
  },
  {
    key: "earthing_lightning",
    label: "Earthing & lightning protection (IEC 62305 / IEEE 80)",
    introducedBy: "A",
    anchors: [
      { re: /IEC 62305/, why: "lightning protection standard series" },
      { re: /IEEE 80/, why: "substation grounding (touch/step)" },
      { re: /soil resistivity|مقاومة التربة/i, why: "required input — never assumed" },
      { re: /SPD/, why: "surge protective devices" },
      { re: /touch|step voltage|جهد اللمس/i, why: "touch/step voltage safety" },
    ],
  },
  {
    key: "short_circuit",
    label: "Short-circuit depth (IEC 60909 / ANSI C37 / X/R)",
    introducedBy: "A",
    anchors: [
      { re: /IEC 60909/, why: "IEC short-circuit standard" },
      { re: /ANSI C37/, why: "ANSI short-circuit standard" },
      { re: /X\/R|X:R/i, why: "X/R ratio discipline" },
      { re: /motor contribution|مساهمة المحركات/i, why: "motor contribution to fault current" },
      { re: /interrupting/i, why: "breaker interrupting duty" },
    ],
  },
  {
    key: "arc_flash",
    label: "Arc flash (IEEE 1584 / NFPA 70E)",
    introducedBy: "baseline",
    anchors: [
      { re: /IEEE 1584/, why: "arc-flash calculation standard" },
      { re: /NFPA 70E/, why: "electrical safety in the workplace" },
      { re: /arc flash|ArcSafety/i, why: "arc-flash study concept" },
    ],
  },
  {
    key: "coordination",
    label: "Protection coordination & selectivity",
    introducedBy: "baseline",
    anchors: [
      { re: /CTI|coordination time/i, why: "coordination time interval" },
      { re: /selectivity|انتقائية/i, why: "selectivity principle" },
      { re: /upstream|downstream|المنبع|المصب/i, why: "series device logic" },
    ],
  },
  {
    key: "generators_ups",
    label: "Generators / UPS / transfer (ISO 8528, ATS)",
    introducedBy: "A",
    anchors: [
      { re: /ISO 8528/, why: "generator ratings & derating" },
      { re: /derating|الإخفاض/i, why: "derating discipline" },
      { re: /wet stacking/i, why: "minimum-loading failure mode" },
      { re: /UPS/, why: "UPS topologies" },
      { re: /ATS|transfer switch|التحويل الأوتوماتيكي/i, why: "transfer behaviour" },
    ],
  },
  {
    key: "units_discipline",
    label: "Units & input discipline (kW vs kVA, missing inputs)",
    introducedBy: "A",
    anchors: [
      { re: /kW.*kVA|kVA.*kW|كيلوواط/i, why: "kW/kVA are different quantities" },
      { re: /power factor|معامل القدرة/i, why: "PF conversion path" },
      { re: /MISSING|مفقود|ناقص/i, why: "missing-input protocol (never assumed)" },
    ],
  },
  {
    key: "support_tone",
    label: "Support tone & de-escalation (empathy-first handoff)",
    introducedBy: "B",
    anchors: [
      { re: /إحباط|محبط|frustrat/i, why: "frustration acknowledgement" },
      { re: /اعترف|أتعامل|acknowledge/i, why: "empathy-first rule" },
      { re: /ticket|التذكرة|الدعم/i, why: "human escalation channel" },
      { re: /لوم|blame/i, why: "never-blame rule" },
    ],
  },
];

// ─── Integrity checks (hard gate — apply to every prompt) ──────────────────

interface IntegrityCheck {
  key: string;
  test: (p: string) => boolean;
  failMsg: string;
}

const CJK_RE = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF01-\uFF5E\uFF61-\uFF9F]/;

const INTEGRITY: IntegrityCheck[] = [
  { key: "no_cjk", test: (p) => !CJK_RE.test(p), failMsg: "CJK characters found in prompt" },
  { key: "no_placeholder_leak", test: (p) => !p.includes("__COURSE_CATALOG__"), failMsg: "catalog placeholder literal leaked" },
  { key: "reasoning_guard", test: (p) => p.includes("OUTPUT RULES"), failMsg: "reasoning guard missing" },
  { key: "language_rule", test: (p) => p.includes("قاعدة اللغة") || p.includes("LANGUAGE RULE"), failMsg: "language-mirror rule missing" },
  { key: "safety_rule", test: (p) => p.includes("السلامة الكهربائية") || p.includes("ELECTRICAL SAFETY RULE"), failMsg: "electrical safety rule missing" },
  { key: "table_ban", test: (p) => p.includes("Markdown tables") || p.includes("جداول Markdown"), failMsg: "Markdown-table ban missing" },
  { key: "no_provider_name", test: (p) => {
      // Every provider-name occurrence must sit inside an explicit BAN sentence
      // (the prompt itself forbids mentioning providers). Occurrences outside
      // such sentences would be real leaks (e.g. routing notes, model names).
      const lines = p.split(/\r?\n/);
      return lines.filter((l) => /OpenRouter|NVIDIA|Groq/.test(l))
        .every((l) => /NEVER mention|لا تذكر|لا تذكر أبداً/.test(l));
    }, failMsg: "bare provider name outside a ban sentence" },
];

// Thinking prompt size ceiling (chars) — growth beyond this must be a decision, not an accident.
const THINKING_CHAR_CEILING = 40_000;
// Instant prompt must stay token-light.
const INSTANT_CHAR_CEILING = 22_000;

// ─── Token heuristic ────────────────────────────────────────────────────────

function approxTokens(p: string): number {
  let arabic = 0, latin = 0, other = 0;
  for (const ch of p) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x0600 && c <= 0x06ff) arabic++;
    else if (c < 0x0250) latin++;
    else other++;
  }
  return Math.round(arabic / 2.5 + latin / 4 + other / 3);
}

// ─── Measurement core ───────────────────────────────────────────────────────

interface PromptMetrics {
  chars: number;
  tokensApprox: number;
  coverage: Record<string, { found: string[]; missing: string[]; pct: number }>;
  coveragePct: number;
  integrityFailures: string[];
  integrityPass: boolean;
}

function measure(lang: "ar" | "en", mode: "thinking" | "instant"): PromptMetrics {
  const prompt = getSystemPrompt(lang, mode);
  const coverage: PromptMetrics["coverage"] = {};
  let foundCount = 0, totalCount = 0;

  for (const cat of CATEGORIES) {
    const found: string[] = [], missing: string[] = [];
    for (const a of cat.anchors) {
      if (a.re.test(prompt)) found.push(a.why);
      else missing.push(a.why);
    }
    foundCount += found.length;
    totalCount += cat.anchors.length;
    coverage[cat.key] = {
      found,
      missing,
      pct: Math.round((found.length / cat.anchors.length) * 100),
    };
  }

  const integrityFailures = INTEGRITY.filter((c) => !c.test(prompt)).map((c) => c.failMsg);
  const ceiling = mode === "thinking" ? THINKING_CHAR_CEILING : INSTANT_CHAR_CEILING;
  if (prompt.length > ceiling) {
    integrityFailures.push(`size ${prompt.length} exceeds ${mode} ceiling ${ceiling}`);
  }

  return {
    chars: prompt.length,
    tokensApprox: approxTokens(prompt),
    coverage,
    coveragePct: Math.round((foundCount / totalCount) * 100),
    integrityFailures,
    integrityPass: integrityFailures.length === 0,
  };
}

function measureAll(): Record<string, PromptMetrics> {
  const out: Record<string, PromptMetrics> = {};
  for (const lang of ["ar", "en"] as const)
    for (const mode of ["thinking", "instant"] as const)
      out[`${lang}:${mode}`] = measure(lang, mode);
  return out;
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function renderSnapshot(m: Record<string, PromptMetrics>): string {
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║   CHATBOT EVOLUTION METER — system prompt quality report      ║");
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  for (const [key, v] of Object.entries(m)) {
    lines.push(`\n▶ ${key}  —  ${v.chars.toLocaleString("en-US")} chars ≈ ${v.tokensApprox.toLocaleString("en-US")} tokens`);
    lines.push(`  Knowledge coverage: ${v.coveragePct}%`);
    for (const [cat, c] of Object.entries(v.coverage)) {
      const label = CATEGORIES.find((x) => x.key === cat)?.label ?? cat;
      const tag = c.pct === 100 ? "✓" : c.pct >= 50 ? "◐" : "✗";
      lines.push(`   ${tag} ${c.pct.toString().padStart(3)}%  ${label}`);
      for (const miss of c.missing) lines.push(`        · missing: ${miss}`);
    }
    lines.push(`  Integrity: ${v.integrityPass ? "PASS ✓" : "FAIL ✗" + " — " + v.integrityFailures.join("; ")}`);
  }
  return lines.join("\n");
}

// ─── CLI ────────────────────────────────────────────────────────────────────

const argi = process.argv.indexOf("--save");
const argcmp = process.argv.indexOf("--compare");
const metrics = measureAll();

if (argi > -1 && process.argv[argi + 1]) {
  const file = resolve(process.argv[argi + 1]);
  mkdirSync(dirname(file), { recursive: true });
  const snapshot = { generatedAt: new Date().toISOString(), prompts: metrics };
  writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(renderSnapshot(metrics));
  console.log(`\n💾 snapshot saved → ${file}`);
  process.exit(metrics["ar:thinking"].integrityPass && metrics["en:thinking"].integrityPass ? 0 : 1);
}

if (argcmp > -1 && process.argv[argcmp + 1]) {
  const file = resolve(process.argv[argcmp + 1]);
  if (!existsSync(file)) {
    console.error(`✗ baseline file not found: ${file}`);
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(file, "utf8")).prompts as Record<string, PromptMetrics>;
  const lines: string[] = [];
  lines.push("╔══════════════════════════════════════════════════════════════╗");
  lines.push("║   CHATBOT EVOLUTION — BASELINE → CURRENT comparison           ║");
  lines.push("╚══════════════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push("key             chars(base→now)          tokens(base→now)       coverage(base→now)   integrity");
  lines.push("─".repeat(100));
  let anyFail = false;
  for (const key of Object.keys(metrics)) {
    const b = base[key], c = metrics[key];
    const dChars = c.chars - b.chars;
    const dTok = c.tokensApprox - b.tokensApprox;
    const dCov = c.coveragePct - b.coveragePct;
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    const integrity = c.integrityPass ? "PASS ✓" : "FAIL ✗";
    if (!c.integrityPass) anyFail = true;
    lines.push(
      `${key.padEnd(15)}${b.chars.toLocaleString()}→${c.chars.toLocaleString()} (${sign(dChars)})`.padEnd(40) +
        `${b.tokensApprox.toLocaleString()}→${c.tokensApprox.toLocaleString()} (${sign(dTok)})`.padEnd(28) +
        `${b.coveragePct}%→${c.coveragePct}% (${sign(dCov)})`.padEnd(24) +
        integrity,
    );
  }
  // Per-category delta for the AR thinking prompt (the flagship).
  lines.push("");
  lines.push("AR:thinking per-category knowledge coverage delta:");
  for (const cat of Object.keys(metrics["ar:thinking"].coverage)) {
    const b = base["ar:thinking"].coverage[cat]?.pct ?? 0;
    const c = metrics["ar:thinking"].coverage[cat].pct;
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    const bar = "█".repeat(Math.round(c / 10)) + "░".repeat(10 - Math.round(c / 10));
    lines.push(`  ${cat.padEnd(18)} ${b}%→${c}% (${sign(c - b)})  ${bar}`);
  }
  console.log(lines.join("\n"));
  process.exit(anyFail ? 1 : 0);
}

console.log(renderSnapshot(metrics));
console.log("\nTip: use --save <file> to snapshot, --compare <file> to diff against a snapshot.");
