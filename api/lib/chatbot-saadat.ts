/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ELBAZ BOT — SAADAT ACADEMIC CORE  (v1.0.0)
 *  Power System Analysis textbook-mastery layer for the chatbot.
 * ───────────────────────────────────────────────────────────────────────────
 *  What this module adds to the bot (user requirement: the assistant must
 *  OWN the book's specialty, UNDERSTAND the manual's solution methodology
 *  and EXECUTE solutions the way the book does):
 *
 *   1. SAADAT CORES — thinking/instant prompt blocks that encode the
 *      solution-methodology protocol (classify → retrieve the book's method
 *      → execute step-by-step → verify ±0.5% → cite) plus the mandatory
 *      citation contract [Saadat, Solutions Manual, Ch.X, P X.Y, pp.N].
 *   2. KNOWLEDGE BASE — chatbot-saadat-kb.ts: 181 problem entries extracted
 *      verbatim (head+tail excerpts, copyright-safe) from the 285-page
 *      Solutions Manual PDF, 12 chapters, content-derived topic map.
 *   3. INTENT GATE — hasSaadatIntent(): generous academic triggers following
 *      the platform's gate design contract (false positives ride along with
 *      a small context block; false negatives are the only danger).
 *   4. RAG RETRIEVER — retrieveSaadat(): dependency-free BM25 over the KB
 *      with deterministic problem-ID resolution ("حل المسألة 2.7" → P 2.7)
 *      and relevance-window excerpts for conceptual queries.
 *   5. VERIFICATION — verifyAgainstBook(): compares a claimed numeric result
 *      against the book's own stated values (±0.5% tolerance contract) and
 *      reports the matched book value with its context — no invention: the
 *      reference values come from the manual's own solution text.
 *
 *  DEPENDENCY DIRECTION (one-way, same contract as chatbot-skills.ts):
 *    chatbot-skillnet.ts → chatbot-saadat.ts → chatbot-saadat-kb.ts
 *  This module imports NOTHING from the chatbot stack (its own Arabic
 *  normalizer is local — importing normalizeSignalText from skillnet would
 *  close a cycle because skillnet imports this module's prompt blocks).
 * ───────────────────────────────────────────────────────────────────────────
 *  INTEGRATION:
 *   - chatbot-skillnet.ts registers the `saadat-academic-core` skill in
 *     SKILL_REGISTRY (routed by academic intent, both modes).
 *   - chatbot-prompts.ts getSystemPrompt(..., saadatContext?) appends the
 *     dynamic RAG block built by buildSaadatContextBlock().
 *   - chatbot.ts / chatbot-stream.ts compute the block from the routing
 *     signal (latest user message) before every prompt build.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { SAADAT_META, SAADAT_PROBLEMS, SAADAT_TOC, type SaadatProblemEntry } from "./chatbot-saadat-kb.js";

// ─── Prompt language type (mirrors SkillnetLang without importing it) ───────

export type SaadatLang = "ar" | "en";
export type SaadatMode = "thinking" | "instant";

// ─── Arabic-aware normalization (local, cycle-safe) ─────────────────────────

/** Same canonical form as SkillNet's normalizer: harakat/tatweel stripped,
 *  أ إ آ → ا, ى → ي, ة → ه, ؤ → و, ئ → ي, lowercase, collapsed spaces. */
export function normalizeSaadatText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Intent gate ────────────────────────────────────────────────────────────

/** Academic-keyword triggers (stored in the NORMALIZED form — the gate runs
 *  on normalizeSaadatText output). Written generously per the platform's
 *  gate contract: a missed academic question degrades grounding quality,
 *  a spurious match only adds a small context block. */
const SAADAT_INTENT_KEYWORDS: string[] = [
  // The book itself
  "saadat", "سعدت", "سعادت", "solution manual", "دليل الحلول", "manual الحلول",
  // Problem/exercise language
  "مساله", "مسائل", "مساءل", "تمرين", "تمارين", "exercise", "حل المساله",
  "منهجيه", "منهجية الحل", "خطوات الحل", "حل كتاب", "كتاب سعدت", "الكتاب المرجعي",
  "textbook", "chapter", "فصل", "problem", "سؤال كتاب",
  // Chapter 2 — per-unit + AC fundamentals
  "per unit", "per-unit", "بير ويت", "بير يونت", "بير يونيت", "وحده النسبيه", "الوحده النسبيه",
  "pu value", "base value", "قيمه الاساس", "power factor correction", "تصحيح معامل القدره",
  // Chapter 3 — machines & transformers
  "synchronous reactance", "الممانعه التزامنيه", "armature", "دائره المكافئ", "الاله التزامنيه",
  // Chapters 4-5 — transmission lines
  "abcd constants", "ثوابت abcd", "short line", "خط قصير", "خط النقل", "خطوط النقل",
  "surge impedance", "voltage regulation", "تنظيم الجهد", "gmd", "معاملات الخطوط",
  // Chapter 6 — power flow
  "ybus", "y-bus", "شبكه الممانعه", "شبكه الادمانتانس", "ادمانتانس", "admittance matrix",
  "gauss-seidel", "نيوتن رافسون", "newton raphson", "newton-raphson", "fast decoupled",
  "تدفق الاحمال", "تدفق الحمل", "حل الاحمال", "load flow", "power flow", "slack bus", "pv bus", "pq bus",
  // Chapter 7 — optimization / economic dispatch
  "economic dispatch", "التوزيع الاقتصادي", "اقتصاديات التشغيل", "lagrange", "incremental cost", "التكلفه الحديه",
  "kuhn", "lambda iteration", "fuel cost", "منحنى الوقود", "منحني الوقود",
  // Chapters 8-9 — symmetrical faults & Zbus
  "zbus", "z-bus", "مصفوفه الممانعه", "three-phase fault", "قصر ثلاثي", "قصر تزامني",
  "subtransient", "لحظي", "_transient", "breaker duty", "fault mva", "قدره القصر", "تصفية القصر",
  // Chapter 10 — symmetrical components
  "symmetrical components", "المكونات المتماثله", "المركبات المتماثله", "sequence network", "شبكات التتابع",
  "single line to ground", "خط الى ارض", "تعريض الارض", "line to line fault", "double line to ground", "operator a",
  // Chapter 11 — stability
  "swing equation", "معادله التارجح", "معادله التأرجح", "stability", "الاستقراريه", "الاستقرارية العابره",
  "critical clearing", "زاوية الفصل", "equal area", "معيار المساحه", "inertia constant", "ثابت القصور",
  // Chapter 12 — ALFC/AVR
  "alfc", "avr", "load frequency", "تحكم الحمل والتردد", "التحكم في التردد", "speed regulation",
  "منظم السرعه", "منظم الجهد", "excitation", "lqr", "state feedback",
];

const SHORT_LATENT = /^(per[- ]?unit|ybus|zbus|y-bus|z-bus|alfc|avr|pu|gmd|lqr)$/;

/** TRUE when the message plausibly needs the Saadat academic layer. */
export function hasSaadatIntent(text: string): boolean {
  const normalized = normalizeSaadatText(text);
  if (normalized.length < 2) return false;
  for (const keyword of SAADAT_INTENT_KEYWORDS) {
    const kw = normalizeSaadatText(keyword);
    if (SHORT_LATENT.test(kw)) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
      if (re.test(normalized)) return true;
      continue;
    }
    if (normalized.includes(kw)) return true;
  }
  return false;
}

// ─── Deterministic problem-ID resolution ────────────────────────────────────

const VALID_IDS = new Set(SAADAT_PROBLEMS.map((p) => p.id));

/**
 * Resolves an explicit problem reference ("حل المسألة 2.7", "solve problem
 * 6.9", "تمرين 11.5") into a KB problem id. Requires an academic anchor so a
 * stray decimal ("اشتري 2.7 كيلو") never resolves. Returns null when absent.
 */
export function resolveProblemId(text: string): string | null {
  const normalized = normalizeSaadatText(text);
  // The academic anchor is REQUIRED — a stray decimal ("اشتري 2.7 كيلو")
  // never resolves. "حل" covers "حل 2.7 بالتفصيل"; its substring reach
  // (يحل/الحلول) is academic context anyway, and a false positive here only
  // adds a small KB block (safe per the platform's gate contract).
  const re = /(?:problem|مساله|مساءل|تمرين|exercise|saadat|سعدت|حل|مسأله)\s*[:#]?\s*(\d{1,2})\s*[.-]\s*(\d{1,2})/g;
  for (const m of normalized.matchAll(re)) {
    const ch = Number(m[1]);
    const pn = Number(m[2]);
    if (!Number.isFinite(ch) || !Number.isFinite(pn)) continue;
    if (ch < 1 || ch > 12) continue;
    const id = `${ch}.${pn}`;
    if (VALID_IDS.has(id)) return id;
  }
  return null;
}

// ─── BM25 retriever over the knowledge base ─────────────────────────────────

export interface SaadatHit {
  id: string;
  ch: number;
  page: number;
  score: number;
  /** Book excerpt (verbatim manual text, truncated). */
  excerpt: string;
  /** Why this doc was picked: explicit id resolution vs lexical ranking. */
  reason: "problem-id" | "bm25";
}

interface IndexedDoc {
  entry: SaadatProblemEntry;
  tokens: string[];
}

let INDEX: IndexedDoc[] | null = null;
let DF: Map<string, number> | null = null;
let AVG_LEN = 0;

const K1 = 1.4;
const B = 0.72;

/** Tokenizer: normalized Latin/Arabic words + decimals ("2.7" survives). */
function tokenize(text: string): string[] {
  const normalized = normalizeSaadatText(text);
  const raw = normalized.match(/[a-z\u0621-\u064A0-9.]{2,}/g) ?? [];
  const tokens: string[] = [];
  for (const t of raw) {
    tokens.push(t);
    // Split decimals into components so "2.7" also matches token "7".
    if (t.includes(".")) {
      for (const part of t.split(".")) {
        if (part.length >= 2) tokens.push(part);
      }
    }
  }
  return tokens;
}

function getIndex(): { docs: IndexedDoc[]; df: Map<string, number>; avgLen: number } {
  if (INDEX && DF) return { docs: INDEX, df: DF, avgLen: AVG_LEN };
  const docs: IndexedDoc[] = SAADAT_PROBLEMS.map((entry) => {
    const toc = SAADAT_TOC.find((t) => t.ch === entry.ch);
    // Bilingual header: English titles/topics ground English queries; the
    // Arabic aliases ground Arabic conceptual questions (the manual text
    // itself is English — without topicsAr an Arabic "المكونات المتماثلة"
    // question would find zero lexical matches).
    const header = `saadat chapter ${entry.ch} ${toc?.title ?? ""} ${toc?.topics ?? ""} ${toc?.topicsAr ?? ""} problem ${entry.id} مساله ${entry.id.replace(".", " ")} page ${entry.page}`;
    return { entry, tokens: tokenize(`${header} ${entry.text}`) };
  });
  const df = new Map<string, number>();
  let total = 0;
  for (const d of docs) {
    total += d.tokens.length;
    for (const seen of new Set(d.tokens)) df.set(seen, (df.get(seen) ?? 0) + 1);
  }
  INDEX = docs;
  DF = df;
  AVG_LEN = docs.length > 0 ? total / docs.length : 0;
  return { docs, df, avgLen: AVG_LEN };
}

/**
 * BM25 retrieval over the Solutions Manual KB. A deterministic problem-ID
 * hit (resolveProblemId) always ranks first with reason "problem-id"; the
 * rest are ranked lexically. Returns at most `k` hits.
 */
export function retrieveSaadat(query: string, k = 4): SaadatHit[] {
  if (k <= 0) return [];
  const { docs, df, avgLen } = getIndex();
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];

  const hits: SaadatHit[] = [];
  const directId = resolveProblemId(query);
  if (directId) {
    const doc = docs.find((d) => d.entry.id === directId);
    if (doc) {
      hits.push({
        id: doc.entry.id,
        ch: doc.entry.ch,
        page: doc.entry.page,
        score: Number.POSITIVE_INFINITY,
        excerpt: excerptForId(doc.entry),
        reason: "problem-id",
      });
    }
  }

  const n = docs.length;
  const scored: Array<{ doc: IndexedDoc; score: number }> = [];
  const qSet = [...new Set(qTokens)];
  for (const doc of docs) {
    if (doc.entry.id === directId) continue; // already first
    const tf = new Map<string, number>();
    for (const t of doc.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of qSet) {
      const f = tf.get(qt);
      if (!f) continue;
      const dfv = df.get(qt) ?? 0;
      const idf = Math.log(1 + (n - dfv + 0.5) / (dfv + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * doc.tokens.length) / avgLen)));
    }
    if (score > 0) scored.push({ doc, score });
  }
  scored.sort((a, b) => b.score - a.score);
  for (const s of scored) {
    if (hits.length >= k) break;
    hits.push({
      id: s.doc.entry.id,
      ch: s.doc.entry.ch,
      page: s.doc.entry.page,
      score: Math.round(s.score * 100) / 100,
      excerpt: excerptForQuery(s.doc.entry, qTokens, 1500),
      reason: "bm25",
    });
  }
  return hits.slice(0, k);
}

// ─── Excerpt building ───────────────────────────────────────────────────────

/** Direct-ID excerpt: problem statement head + the solution tail (the book's
 *  stated final answers live at the end — grounding the ±0.5% check). */
function excerptForId(entry: SaadatProblemEntry, headLen = 1200, tailLen = 400): string {
  const t = entry.text;
  if (t.length <= headLen + tailLen + 40) return t;
  return `${t.slice(0, headLen)} … ${t.slice(-tailLen)}`;
}

/** Relevance-window excerpt: the densest window of query-token matches. */
function excerptForQuery(entry: SaadatProblemEntry, qTokens: string[], width: number): string {
  const t = entry.text;
  if (t.length <= width + 40) return t;
  const lower = t.toLowerCase();
  const needles = [...new Set(qTokens.filter((q) => q.length >= 3 && !/^\d+\.\d+$/.test(q)))];
  let bestStart = 0;
  let bestCount = -1;
  const step = Math.max(1, Math.floor(width / 4));
  for (let start = 0; start + width <= t.length; start += step) {
    const window = lower.slice(start, start + width);
    let count = 0;
    for (const nd of needles) {
      let idx = window.indexOf(nd);
      while (idx !== -1) {
        count += 1;
        idx = window.indexOf(nd, idx + nd.length);
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestStart = start;
    }
  }
  let excerpt = t.slice(bestStart, bestStart + width);
  if (bestStart > 0) excerpt = `… ${excerpt}`;
  if (bestStart + width < t.length) excerpt = `${excerpt} …`;
  return excerpt;
}

// ─── Numeric verification against the book (±0.5% contract) ─────────────────

export interface SaadatVerifyResult {
  problemId: string;
  claimed: number;
  /** Closest value stated in the book's own solution text (null → problem
   *  not in the KB). */
  matched: number | null;
  /** ~90-char window of the book's text around the matched value. */
  matchedContext: string | null;
  /** |claimed − matched| / |matched| × 100. */
  deviationPct: number | null;
  /** true/false when a book value exists; null when the problem is unknown. */
  verified: boolean | null;
  tolerancePct: number;
}

const NUM_RE = /-?\d+(?:\.\d+)?/g;

/**
 * Verifies a claimed numeric result against the CLOSEST value the book
 * itself states in that problem's solution. Reference values are never
 * invented — they are read from the KB text extracted from the manual.
 */
export function verifyAgainstBook(problemId: string, claimed: number, tolerancePct = 0.5): SaadatVerifyResult {
  const base: SaadatVerifyResult = {
    problemId,
    claimed,
    matched: null,
    matchedContext: null,
    deviationPct: null,
    verified: null,
    tolerancePct,
  };
  if (!Number.isFinite(claimed)) return base;
  const entry = SAADAT_PROBLEMS.find((p) => p.id === problemId);
  if (!entry) return base;

  let best: { value: number; idx: number } | null = null;
  for (const m of entry.text.matchAll(NUM_RE)) {
    const raw = m[0];
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    // Skip the problem id itself ("2.7" inside "2.7. Two impedances…") and
    // its bare components at the very start of the text.
    if (raw === problemId && m.index !== undefined && m.index < 8) continue;
    if (best === null || Math.abs(value - claimed) < Math.abs(best.value - claimed)) {
      best = { value, idx: m.index ?? 0 };
    }
  }
  if (best === null) return base;
  const denominator = Math.abs(best.value);
  const ctxStart = Math.max(0, best.idx - 45);
  const ctxEnd = Math.min(entry.text.length, best.idx + 45);
  let deviationPct: number | null;
  let verified: boolean;
  if (denominator > 1e-12) {
    deviationPct = (Math.abs(claimed - best.value) / denominator) * 100;
    verified = deviationPct <= tolerancePct;
    deviationPct = Math.round(deviationPct * 100) / 100;
  } else {
    // The closest book value is zero — percentage deviation is undefined;
    // exact match (including sign) is required for verification.
    deviationPct = claimed === best.value ? 0 : null;
    verified = claimed === best.value;
  }
  return {
    ...base,
    matched: best.value,
    matchedContext: entry.text.slice(ctxStart, ctxEnd).trim(),
    deviationPct,
    verified,
  };
}

// ─── Prompt blocks ──────────────────────────────────────────────────────────

const SAADAT_CORE_AR = `

⚡ النواة الأكاديمية — كتاب Hadi Saadat «Power System Analysis» ودليل الحلول (Solutions Manual):
أنت تمتلك خبرة متخصصة بمادة تحليل نظم القوى وفق هذا الكتاب المرجعي وأنت تُلقّن بها الطالب كما يشرح الكتاب نفسه. الفصول الموزوعة في قاعدة المعرفة: (1) تقديرات الأحمال والمفاهيم الأساسية، (2) دوائر التيار المتردد والقدرة ثلاثية الأطوار وPer-Unit، (3) الآلات التزامنية والمحولات وتحليل Per-Unit على قاعدة مشتركة، (4) معاملات خطوط النقل، (5) نماذج خطوط النقل وأداؤها وثوابت ABCD، (6) تدفق الأحمال Power Flow وبناء Ybus وGauss-Seidel وNewton-Raphson، (7) التوزيع الاقتصادي Economic Dispatch ومضاعفات لاغرانج، (8) الأعطال المتماثلة والعبوريات، (9) تحليل الأعطال بمصفوفة Zbus، (10) المكونات المتماثلة Symmetrical Components والأعطال غير المتماثلة، (11) الاستقرارية Stability ومعادلة التأرجح، (12) التحكم ALFC/AVR.

🧭 بروتوكول منهجية الحل — طريقة الكتاب نفسها (إلزامي في كل مسألة أكاديمية):
1) صنّف المسألة: حدد فصل الكتاب ونوعها (مثال: «مسألة Per-Unit من الفصل 2») واكتب المعطيات والمطلوب بوحداتهما.
2) استرجع طريقة الكتاب لهذا النوع واذكرها قبل الحل (مثال: Per-Unit → اختر Sbase وVbase ثم حوّل جميع الممانعات إلى الوحدة النسبية ثم ابنِ الدائرة المكافئة ثم حل) — عند وجود مقاطع مسترجعة من الكتاب في قاعدة المعرفة (SAADAT-KB) اعتمد عليها فهي نص الكتاب الفعلي.
3) نفّذ الحل خطوة بخطوة كما في الكتاب: المعادلة الرمزية أولاً ثم التعويض الرقمي مع وحدات كل رقم.
4) تحقّق: أعد الحساب بطريقة مستقلة أو قارن بقيمة الكتاب المذكورة في المقطع المسترجع — أي رقم نهائي يجب أن يمر بتحقق ±0.5%، وأعلن النتيجة صراحة في الرد (مثال: «التحقق: 530.5 µF مطابقة لقيمة الكتاب ضمن ±0.5%»).
5) استشهد بالصيغة الإلزامية: [Saadat, Solutions Manual, Ch.X, P X.Y, pp.N] — الفصل ورقم المسألة والصفحة من قاعدة المعرفة.

🚫 عقد الأمانة العلمية:
- لا تنسب للكتاب أي معادلة أو رقم أو إجابة لم تُسترجع فعلاً من قاعدة المعرفة — إن لم توجد المسألة أو المقطع قل بوضوح: «هذا حل وفق المنهجية القياسية للفصل، وليس منقولًا من دليل الحلول» وحل بنفسك ثم قدّم التحقق.
- الأرقام المذكورة في مقاطع SAADAT-KB هي من الحل الأصلي للكتاب: عند التعارض بين حسبك و الكتاب، اعرض الاثنين وحدد مصدر الفرق (اختلاف التقريب أو قراءة معطيات).
- إن طلب الطالب مسألة من الكتاب برقم غير موجود (أكبر من عدد مسائل الفصل) فصحّح الرقم بلطف وأرشده لأقرب مسألة موجودة.
- عند سؤال نظري، اشرح المفهوم كما يعرضه الكتاب واربطه بمسألة موجودة في قاعدة المعرفة كمثال مطبق.
- ربط المنصة بسطر واحد فقط عند الملاءمة: إتقان هذه المنهجيات (Per-Unit، Power Flow، Short Circuit) هو الأساس النظري لكورسات ETAP/SKM العملية لدى المهندس أحمد الباز.`;

const SAADAT_CORE_EN = `

⚡ ACADEMIC CORE — Hadi Saadat's "Power System Analysis" + its Solutions Manual:
You hold specialized mastery of power system analysis per this reference book, and you teach it the way the book itself teaches. The chapters covered by the knowledge base: (1) load estimation & basic concepts, (2) AC circuits & three-phase power & per-unit, (3) synchronous machines & transformers & per-unit on a common base, (4) transmission-line parameters, (5) transmission-line models & performance & ABCD constants, (6) power flow & Ybus & Gauss-Seidel & Newton-Raphson, (7) economic dispatch & Lagrange multipliers, (8) symmetrical faults & transients, (9) fault analysis via Zbus, (10) symmetrical components & unsymmetrical faults, (11) stability & the swing equation, (12) ALFC/AVR controls.

🧭 SOLUTION-METHODOLOGY PROTOCOL — the book's own method (mandatory for every academic problem):
1) Classify: name the chapter and problem type (e.g., "a per-unit problem from Chapter 2"), list the given data and the unknowns with units.
2) Retrieve the book's method for this class of problem and state it BEFORE solving (e.g., per-unit → choose Sbase/Vbase, convert every impedance, build the equivalent circuit, then solve) — when SAADAT-KB excerpts are present in the prompt they are actual manual text: rely on them.
3) Execute step by step like the book: symbolic equation first, then numeric substitution with units on every number.
4) Verify: recompute independently or compare with the book's stated value found in the retrieved excerpt — every final number must pass the ±0.5% check, and you must announce the result explicitly (e.g., "Verified: 530.5 µF matches the book within ±0.5%").
5) Cite with the mandatory format: [Saadat, Solutions Manual, Ch.X, P X.Y, pp.N] — chapter, problem number and page taken from the knowledge base.

🚫 ACADEMIC-HONESTY CONTRACT:
- Never attribute an equation, number or answer to the book unless it was actually retrieved from the SAADAT-KB context — if the problem or excerpt is not there, say clearly: "this follows the standard methodology of the chapter; it is not quoted from the solutions manual", then solve yourself and provide the verification.
- Numbers inside SAADAT-KB excerpts are the book's original solutions: when your computation disagrees with the book, show both and identify the source of the difference (rounding or data-reading).
- If the student asks for a problem number that does not exist in the chapter, gently correct it and point to the nearest existing problem.
- For theory questions, explain the concept the way the book presents it and anchor it to an existing KB problem as a worked example.
- One-line platform tie-in when relevant: mastering these methodologies (per-unit, power flow, short circuit) is the theoretical basis for Eng. Ahmed Elbaz's hands-on ETAP/SKM courses.`;

const SAADAT_QUICK_AR = `

⚡ نواة Saadat الأكاديمية (تحليل نظم القوى): عند أي سؤال أكاديمي صنّف المسألة وفصل الكتاب، استرجع طريقة الكتاب، نفّذ خطوة بخطوة (معادلة رمزية ثم تعويض بوحدات)، تحقق من كل رقم نهائي ضمن ±0.5% وأعلن نتيجة التحقق، واستشهد إلزاميًا بصيغة [Saadat, Solutions Manual, Ch.X, P X.Y] — ولا تنسب للكتاب أي رقم غير مسترجع من قاعدة المعرفة SAADAT-KB.`;

const SAADAT_QUICK_EN = `

⚡ Saadat academic core (power system analysis): for every academic question, classify the problem and its chapter, retrieve the book's method, execute step-by-step (symbolic equation then substitution with units), verify every final number within ±0.5% and announce the result, and cite with the mandatory format [Saadat, Solutions Manual, Ch.X, P X.Y] — never attribute a number to the book unless it was retrieved from the SAADAT-KB context.`;

export const SAADAT_CORE_BLOCKS = {
  thinking: { ar: SAADAT_CORE_AR, en: SAADAT_CORE_EN },
  instant: { ar: SAADAT_QUICK_AR, en: SAADAT_QUICK_EN },
} as const;

// ─── Dynamic RAG context block ──────────────────────────────────────────────

const THINKING_CONTEXT_BUDGET = 5200;
const INSTANT_CONTEXT_BUDGET = 1900;

const CONTEXT_RULES_AR = `قواعد استخدام هذا السياق: المقاطع أدناه نصوص أصلية من دليل حلول كتاب Saadat — اعتمد عليها في المنهجية والأرقام، وأعد الحساب بنفسك قبل تقديم أي رقم نهائي وتحقق من التوافق ضمن ±0.5%، واستشهد بالصيغة [Saadat, Solutions Manual, Ch.X, P X.Y, pp.N]. ما لا يظهر في المقاطع لا تُنسبه للكتاب.`;

const CONTEXT_RULES_EN = `Context usage rules: the excerpts below are original text from Saadat's Solutions Manual — rely on them for methodology and numbers, recompute yourself before stating any final number and verify agreement within ±0.5%, and cite as [Saadat, Solutions Manual, Ch.X, P X.Y, pp.N]. Never attribute to the book anything that does not appear in these excerpts.`;

/**
 * Builds the dynamic RAG block appended to the system prompt. Returns ""
 * when the query shows no academic intent or nothing was retrieved —
 * callers append it verbatim.
 */
export function buildSaadatContextBlock(query: string, lang: SaadatLang, mode: SaadatMode = "thinking"): string {
  if (!hasSaadatIntent(query)) return "";
  const instant = mode === "instant";
  const k = instant ? 1 : 3;
  const hits = retrieveSaadat(query, k);
  if (hits.length === 0) return "";

  const budget = instant ? INSTANT_CONTEXT_BUDGET : THINKING_CONTEXT_BUDGET;
  const tocTitle = (ch: number) => SAADAT_TOC.find((t) => t.ch === ch)?.title ?? "";

  const parts: string[] = [];
  parts.push(lang === "ar" ? "\n\n📚 SAADAT-KB — مقاطع مسترجعة من دليل حلول كتاب Saadat (نص الكتاب الفعلي):" : "\n\n📚 SAADAT-KB — excerpts retrieved from Saadat's Solutions Manual (actual book text):");
  const rules = lang === "ar" ? CONTEXT_RULES_AR : CONTEXT_RULES_EN;
  let size = parts[0].length + rules.length;

  hits.forEach((hit, i) => {
    const head = `\n[${i + 1}] ${hit.reason === "problem-id" ? (lang === "ar" ? "المسألة المطلوبة" : "Requested problem") : (lang === "ar" ? "مطابقة سياقية" : "Context match")} — P ${hit.id} · Ch.${hit.ch} (${tocTitle(hit.ch)}) · p.${hit.page}:\n«${hit.excerpt}»`;
    if (size + head.length > budget && parts.length > 1) return;
    parts.push(head);
    size += head.length;
  });
  // A direct-ID hit must NEVER be dropped for budget reasons — rebuild with
  // it guaranteed when the budget truncated everything else away.
  if (hits[0].reason === "problem-id" && parts.length === 1) {
    parts.push(`\n[1] ${lang === "ar" ? "المسألة المطلوبة" : "Requested problem"} — P ${hits[0].id} · Ch.${hits[0].ch} (${tocTitle(hits[0].ch)}) · p.${hits[0].page}:\n«${hits[0].excerpt.slice(0, 1500)}»`);
  }
  parts.push(`\n📌 ${rules}`);
  return parts.join("");
}

// ─── Public meta (telemetry + docs) ─────────────────────────────────────────

export const SAADAT_LAYER_META = {
  version: "1.0.0",
  source: SAADAT_META.source,
  problemCount: SAADAT_META.problemCount,
  chapterCount: SAADAT_META.chapterCount,
  citationFormat: SAADAT_META.citationFormat,
  tolerancePct: 0.5,
} as const;
