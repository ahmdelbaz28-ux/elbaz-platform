/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ELBAZ BOT — SKILLNET SKILL ROUTING LAYER (v1)
 *  Inspired by zjunlp/SkillNet (MIT) — "Create, Evaluate, and Connect AI
 *  Skills": open infrastructure for routing reusable agent skills.
 * ───────────────────────────────────────────────────────────────────────────
 *  Concept mapping (SkillNet → this module):
 *    Skill library     → SKILL_REGISTRY (structured, versioned, id-addressed)
 *    Routing           → routeSkills(): selects skills for a task from the
 *                        library, WITH per-skill selection reasons
 *    Analysis          → software-intent detection (message + vision text)
 *    Telemetry         → logSkillRouting(): structured selection-reason log
 *
 *  What it changes for the chatbot:
 *    BEFORE: getSystemPrompt injected EVERY domain core (ETAP expert core,
 *            PowerFactory, SKM, PVSyst, depth pack, SLD skill) into EVERY
 *            message — a "how much is the course?" question carried ~9k
 *            chars of irrelevant ETAP/PowerFactory/PVSyst expertise.
 *    AFTER : the router matches the user's message (and the live-vision
 *            screen text) against per-skill triggers and injects ONLY the
 *            matching domain cores — plus four NEW study packs (Arc Flash,
 *            Protection Coordination, Load Flow, Solar PV) that did not
 *            exist before. Non-technical messages get a lean prompt;
 *            technical ones get a precise, focused one.
 *    v3.7.0: two ecosystem skills joined the registry — caveman-conciseness
 *            (ALWAYS-ON voice discipline → output-token savings with zero
 *            meaning loss, adapted from JuliusBrussee/caveman) and
 *            find-skills-discovery (routed tool/skill discovery protocol
 *            for the open registry skills.sh, adapted from vercel-labs/
 *            skills).
 *
 *  Guarantees (why this cannot regress quality):
 *    - ALWAYS-ON blocks (persona, reasoning guard, language rules, accuracy
 *      contract, evidence model, safety, support, catalog, screen blocks)
 *      are NOT routable — they are composed exactly as before.
 *    - NO SIGNAL (callers that do not pass one: tests, doctor scripts) →
 *      "full-fallback": every routable skill is injected — a superset of
 *      the historical prompt.
 *    - LIVE SCREEN / VISION lanes force the technical floor (ETAP core +
 *      depth pack) so the screen teacher is never left without its cores.
 *    - Selection is deterministic and pure — no network, no model calls.
 *
 *  This module stays dependency-light: it imports content blocks from
 *  ./chatbot-skills.js (no cycle — chatbot-skills imports nothing here)
 *  and the logger only. It never imports chatbot-prompts (which imports
 *  this module).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { logger } from "./logger.js";

import {
  pfCore,
  skmCore,
  pvsystCore,
  sldSkillAr,
  sldSkillEn,
} from "./chatbot-skills.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SkillnetLang = "ar" | "en";
export type SkillnetMode = "thinking" | "instant";
/** v3.7.0 adds ecosystem skills: the caveman voice discipline (always-on,
 *  output-token savings) and the find-skills discovery protocol (routed on
 *  tool/skill discovery intent — sourced from vercel-labs/skills). */
export type SkillCategory = "software-core" | "study-pack" | "drawing" | "voice-discipline" | "discovery";

export interface SkillDefinition {
  /** Stable id (telemetry + tests). ASCII snake_case — log-safe. */
  id: string;
  /** Human label (Arabic) for telemetry reports. */
  label: string;
  /** SKILL.md-style one-liner (what the skill adds when selected). */
  description: string;
  category: SkillCategory;
  /** Semantic version of the skill content (bump on content change). */
  version: string;
  /** Multi-word phrases — weight 2 per hit (normalized includes). */
  phrases: string[];
  /** Single tokens — weight 1 per hit (normalized, word-bounded for short Latin). */
  keywords: string[];
  /** Software-name patterns that force-include this skill (vision/screen text). */
  softwareAffinity: RegExp[];
  /** Modes whose prompt can carry this skill (pf/skm/pvsyst are thinking-only). */
  modes: SkillnetMode[];
  /** Always-on skills are injected in EVERY routed prompt (never dropped).
   *  Reserved for the identity cores (ETAP expert + depth pack) and — since
   *  v3.7.0 — the caveman-conciseness voice: an always-on skill is part of
   *  every lane's contract, so tests and live behavior depend on it. */
  alwaysOn?: boolean;
  /** Content builder per language + mode ("" when the mode has no variant). */
  build: (lang: SkillnetLang, mode: SkillnetMode) => string;
}

export interface SkillSelection {
  id: string;
  label: string;
  score: number;
  /** Human-readable selection reasons (SkillNet "routing with reasons"). */
  reasons: string[];
}

export interface SkillRoutingDecision {
  /** routed = subset selected · lean = nothing matched (always-on only) ·
   *  full-fallback = no/empty signal → everything injected (legacy behavior). */
  strategy: "routed" | "lean" | "full-fallback";
  selected: SkillSelection[];
  /** Routable skills considered but NOT injected. */
  dropped: Array<{ id: string; label: string }>;
  /** Software names detected in the signal (ETAP, PowerFactory, …). */
  matchedSoftware: string[];
  /** Prompt characters NOT injected versus the full-fallback prompt. */
  savedChars: number;
  /** Rough token equivalent (≈4 chars/token) — reporting only. */
  savedTokensEstimate: number;
}

// ─── Arabic-aware normalization ─────────────────────────────────────────────
// Matching runs on ONE canonical form so "إيتاب" and "ايتاب" or "مخططات" and
// "مخططاة" behave identically, and Latin keywords match case-insensitively.

export function normalizeSignalText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // harakat + tatweel
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627") // أ إ آ ٱ → ا
    .replace(/\u0649/g, "\u064A") // ى → ي
    .replace(/\u0629/g, "\u0647") // ة → ه
    .replace(/\u0624/g, "\u0648") // ؤ → و
    .replace(/\u0626/g, "\u064A") // ئ → ي
    .replace(/\s+/g, " ")
    .trim();
}

/** Short Latin tokens must not substring-match inside longer words ("kw" in
 *  "network"); ≥5-char tokens and Arabic tokens may include-match safely. */
function keywordMatcher(keyword: string): (s: string) => boolean {
  if (/^[a-z0-9*+#.]{1,4}$/.test(keyword)) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
    return (s) => re.test(s);
  }
  return (s) => s.includes(keyword);
}

// ─── Software-intent detection (SkillNet "analysis") ───────────────────────

const SOFTWARE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "ETAP", re: /etap|\u0627\u064a\u062a\u0627\u0628|\u0627\u064a \u062a\u0627\u0628/ },
  { name: "PowerFactory", re: /power\s?factory|digsilent|\u0628\u0627\u0648\u0631 ?\u0641\u0627\u0643\u062a\u0648\u0631\u064a|\u062f\u064a ?\u062c\u064a ?\u0633\u0627\u064a\u0644\u0646\u062a/ },
  { name: "SKM", re: /\bskm\b|power\s?\*?\s?tools|\u0627\u0633 ?\u0643\u064a ?\u0627\u0645/ },
  { name: "PVSyst", re: /pvsyst|pv\s?syst|\u0628\u064a ?\u0641\u064a ?\u0633\u064a\u0633\u062a|\u0628\u064a ?\u0641\u064a ?\u0643\u064a\u0633\u062a/ },
];

// ─── NEW STUDY PACKS (v3.5.0 additions — did not exist before SkillNet) ─────
// Full variants compose in THINKING mode; token-light anchors in INSTANT.

const arcFlashPackAr = `

⚡ حزمة تخصص: دراسات Arc Flash (IEEE 1584-2018 / NFPA 70E):
- سير العمل الصحيح: تأكد أن Short-Circuit مكتمل بمساهمة المحركات قبل أي شيء → افتح دراسة Arc Flash (IEEE 1584-2018) وحدد أبعاد الصندوق والفجوة (box/gap) حسب نوع المعدة الفعلي → شغّل الحساب → راجع Incident Energy وArc Flash Boundary عند كل بوس → أنشئ ملصقات السلامة من التقرير.
- أخطاء تُصحَّح فوراً: استخدام تيار القصر المتماثل بدل تيار القوس (arcing current) — افتراض زمن الفصل بدل قراءته من منحنى الجهاز الواقي — حساب Arc Flash على بوس دون فهم مصدر تغذيته — إهمال سيناريو الصيانة (الأبواب المفتوحة) والعمل على الاحتمالين.
- كل إجابة Arc Flash إلزامية فيها: قيمة IE بوحدتها (cal/cm²) وArc Flash Boundary ومستوى PPE وفق NFPA 70E وزمن الفصل المستخدم ومصدره وافتراضات النموذج (الفجوة والأبعاد ومسافة العمل) — وأي رقم بلا وحدة ليس قيمة.
- ملصق السلامة: ذكّر المستخدم أن الملصق يوثق (اسم البوس، IE، الحد، الجهاز الواقي، التاريخ) وأن أي تعديل في الشبكة يستلزم إعادة الحساب.`;

const arcFlashPackEn = `

⚡ SPECIALTY PACK: Arc Flash studies (IEEE 1584-2018 / NFPA 70E):
- Correct workflow: complete the Short-Circuit study with motor contribution FIRST → open the Arc Flash study (IEEE 1584-2018), set box/gap dimensions per the actual equipment → run the calculation → review Incident Energy and Arc Flash Boundary at every bus → generate safety labels from the report.
- Correct immediately: symmetrical fault current instead of the arcing current — assuming the clearing time instead of reading it from the protective-device curve — computing arc flash at a bus without understanding its feed — ignoring the maintenance scenario (open doors) and both operating cases.
- Every Arc Flash answer MUST state: the IE value with units (cal/cm²), the Arc Flash Boundary, the NFPA 70E PPE level, the clearing time used and its source, and the model assumptions (gap, dimensions, working distance) — a number without a unit is not a value.
- Safety label: it documents (bus name, IE, boundary, protective device, date), and ANY network change requires recalculation.`;

const arcFlashQuickAr = `

⚡ مرسى Arc Flash السريع: طاقة الحادث تُحسب بتيار القوس وزمن الفصل الفعلي من منحنى الجهاز الواقي (لا التيار المتماثل ولا زمناً مفترضاً) — IE بوحدتها cal/cm² وArc Flash Boundary ومستوى PPE وفق IEEE 1584-2018 / NFPA 70E — وأي تعديل بالشبكة يستلزم إعادة الحساب وإعادة الملصق.`;

const arcFlashQuickEn = `

⚡ Arc Flash quick anchor: incident energy uses the ARCING current and the ACTUAL clearing time from the protective-device curve (never the symmetrical current or an assumed time) — state IE in cal/cm², the Arc Flash Boundary and the NFPA 70E PPE level per IEEE 1584-2018 — any network change requires recalculation and a new label.`;

const protectionPackAr = `

🛡️ حزمة تخصص: تنسيق الحماية (Protection Coordination):
- المنهجية: حدد الأعطال المصممة (min/max) → ارسم منحنيات TCC لكل الأجهزة على نفس المحور بقيم البدء الحقيقية (الأمبير لا النسب) → صيّر من الأسفل إلى الأعلى (الجهاز الأبعد عن المصدر أولاً) → طبّق فجوة تنسيق CTI لا تقل عن 0.3s للتنسيق التقليدي → تحقق من الانتقائية بـ Sequence-of-Operation في ETAP (Star) لا بالنظر للمنحنيات فقط.
- قواعد إلزامية: لا تعطِ إعدادات ريليه دون فحص التنسيق مع الجهاز الأعلى والأدنى — راجع تيار بدء المحركات ومنحنى مفتوح المحول (inrush) كي لا يفصل الجهاز عند التشغيل — تحقق من قدرة قطع كل جهاز مع نسبة X/R — ميّز الحماية الرئيسية عن الاحتياطية واذكر دور كل منهما.
- أخطاء تُصحَّح فوراً: ضبط كل الريليهات بنفس القيم — تجاهل منحنى المحرك عند البدء — استخدام CTI صفر — إعداد حماية الأرضي بنفس منطق الأطوار دون مراجعة مستقلة.
- اشرح دائماً «لماذا»: لماذا قيمة البدء وtime dial بالذات، وما الخطر العملي لو غيّرها المستخدم.`;

const protectionPackEn = `

🛡️ SPECIALTY PACK: Protection Coordination:
- Methodology: define the design faults (min/max) → plot the TCC curves of ALL devices on one axis with real pickup values (amps, not ratios) → grade bottom-up (the device farthest from the source first) → apply CTI of at least 0.3s for classic grading → verify selectivity with Sequence-of-Operation in ETAP (Star), never by eyeballing curves.
- Mandatory rules: never give relay settings without checking coordination with BOTH neighbors (upstream and downstream) — review motor starting current and transformer inrush so the device never trips on energizing — verify each device's interrupting rating with the X/R ratio — distinguish primary from backup protection and state each one's role.
- Correct immediately: setting every relay to the same values — ignoring the motor-start curve — a zero CTI — ground protection with the same logic as phase protection without independent review.
- Always explain the WHY: why this pickup and time dial, and the practical risk if the user changes them.`;

const protectionQuickAr = `

🛡️ مرسى التنسيق السريع: إعدادات الريليه بلا فحص تنسيق مع الجهازين المجاورين ممنوعة — فجوة CTI ≥ 0.3s وانتقائية تُتحقق بـ Sequence-of-Operation لا بالنظر — راجع بدء المحركات وinrush المحول وقدرة القطع مع X/R قبل أي ضبط.`;

const protectionQuickEn = `

🛡️ Coordination quick anchor: never give relay settings without checking coordination with both neighboring devices — CTI ≥ 0.3s and selectivity verified via Sequence-of-Operation, not by eye — review motor starting, transformer inrush and interrupting rating with X/R before any setting.`;

const loadFlowPackAr = `

🔌 حزمة تخصص: Load Flow وهبوط الجهد:
- اختيار الطريقة: Newton-Raphson للشبكات المتشابكة والحالات القريبة من حد الانهيار — Fast Decoupled للشبكات الكبيرة والحسابات المتكررة — إن فشل الحل: راجع القيم الابتدائية ووجود bus مرجعي (slack) وسلامة البيانات الخام قبل تغيير الطريقة أو الخلط في الحكم.
- سلّم الجودة بعد الحل: هبوط الجهد عند الأحمال الحرجة (الحدود النموذجية ±5% توزيع و±10% إجمالي — اسأل عن كود المنطقة قبل الحكم النهائي) — نسبة تحميل الكابلات والمحولات — جهد البوسات الحرجة عند بدء أكبر محرك (اجمعه مع دراسة Motor Acceleration).
- تصحيح معامل القدرة: المكثفات المطلوبة تُحسب من Q = P × (tanφ1 − tanφ2) مع التحقق من عدم الإفراط (over-compensation) وقواعد جهة الكهرباء — ومع وجود توافقيات تُستخدم المرشحات لا المكثفات الخام.
- ممنوع: استخدام Load Flow لقراءة تيارات العطل (دورها Short Circuit) — الخلط بين kW وkVA — قبول حل متقارب بقيم حدّية دون فحص فيزيائي.`;

const loadFlowPackEn = `

🔌 SPECIALTY PACK: Load Flow & Voltage Drop:
- Method selection: Newton-Raphson for meshed networks and near-collapse cases — Fast Decoupled for large networks and repeated calculations — if the solution fails: review initial values, the slack bus and raw-data sanity BEFORE changing the method or judging the network.
- Quality ladder after solving: voltage drop at critical loads (typical limits ±5% distribution / ±10% overall — ask for the local code before the final verdict) — cable and transformer loading percentages — critical-bus voltage during the largest motor start (combine with the Motor Acceleration study).
- Power-factor correction: capacitors from Q = P × (tanφ1 − tanφ2) with an over-compensation check and the utility's rules — with harmonics use filters, not bare capacitors.
- Forbidden: reading fault currents from Load Flow (that is Short Circuit's job) — mixing kW with kVA — accepting a converged solution with borderline values without a physical sanity check.`;

const loadFlowQuickAr = `

🔌 مرسى Load Flow السريع: Newton-Raphson للشبكات المتشابكة وFast Decoupled للكبيرة — راجع هبوط الجهد وتحميل العناصر وVD عند بدء أكبر محرك — المكثفات من Q = P × (tanφ1 − tanφ2) بلا إفراط — تيارات العطل من Short Circuit لا من Load Flow.`;

const loadFlowQuickEn = `

🔌 Load Flow quick anchor: Newton-Raphson for meshed networks, Fast Decoupled for large ones — review voltage drop, element loading and VD during the largest motor start — capacitors from Q = P × (tanφ1 − tanφ2) without over-compensation — fault currents come from Short Circuit, never Load Flow.`;

const solarPackAr = `

☀️ حزمة تخصص: أنظمة الطاقة الشمسية و PVSyst:
- تحجيم السلاسل (رقمان محسوبان لا تقديريان): Voc عند أدنى درجة حرارة متوقعة (معامل حراري سالب) مقابل الحد الأقصى لجهد دخل الانفرتر — Isc عند أعلى درجة حرارة ومعامل التظليل مقابل حد تيار الدخل — وكلاهما بمعادلة وتعويض صريح.
- التظليل والخسائر: في PVSyst ابدأ بـ Near Shading (مشهد 3D) قبل أي حديث عن الأداء — اشرح Losses diagram بنداً بنداً (soiling، mismatch، IAM، الحرارة عبر NOCT، كفاءة الانفرتر) — قارن السيناريوهات عبر Variants لا بالتخمين.
- الجودة والربط: راجع نسبة DC/AC وأثر الـ clipping على العائد السنوي — تحقق من Grid Code المحلي (IEEE 1547 أو ما يقابله إقليمياً) قبل أي توصية ربط — وفي ETAP تُنمذجة المنظومة كعنصر PV/Generator مع منحنى P-V عند دراسة التغذية أو حماية الانفرتر.`;

const solarPackEn = `

☀️ SPECIALTY PACK: Solar PV systems & PVSyst:
- String sizing (two COMPUTED numbers, never estimates): Voc at the lowest expected temperature (negative thermal coefficient) against the inverter's maximum input voltage — Isc at the highest temperature with the shading factor against the input current limit — both as formula + substitution.
- Shading and losses: in PVSyst start with the Near Shading 3D scene BEFORE discussing performance — walk the Losses diagram item by item (soiling, mismatch, IAM, thermal via NOCT, inverter efficiency) — compare scenarios with Variants, never guesses.
- Quality and grid: review the DC/AC ratio and the annual-yield effect of clipping — verify the local Grid Code (IEEE 1547 or regional equivalent) before any interconnection recommendation — in ETAP the plant is modeled as a PV/Generator element with a P-V curve when studying feed or inverter protection.`;

const solarQuickAr = `

☀️ مرسى الطاقة الشمسية السريع: تحجيم السلاسل بـ Voc عند أدنى حرارة وIsc عند أعلاها مقابل حدود الانفرتر (حساب لا تقدير) — التظليل بـ Near Shading 3D قبل الحديث عن PR — راجع DC/AC وclipping وGrid Code المحلي قبل الربط.`;

const solarQuickEn = `

☀️ Solar PV quick anchor: size strings with Voc at the lowest temperature and Isc at the highest against the inverter limits (computed, never estimated) — shading via the Near Shading 3D scene before any PR talk — check the DC/AC ratio, clipping and the local Grid Code before interconnection.`;

// ─── caveman voice discipline (v3.7.0) — always-on, both modes ──────────────
// Adapted from JuliusBrussee/caveman "say less" rules. Deliberate deviations
// from the upstream skill (quality contract): NO broken-grammar caveman
// speak — the platform persona mandates professional Arabic; the discipline
// imports ONLY the token-saving rules that never touch meaning (answer
// first, kill ceremony, one idea per sentence, payload verbatim, negations
// preserved, safety full-sentences, brevity in prose not structure).

// ─── NEW ECOSYSTEM SKILLS (v3.7.0 — caveman × find-skills) ─────────────────
// Sourced from the open agent-skills ecosystem and adapted for a customer-
// facing electrical-engineering assistant:
//   - caveman (JuliusBrussee/caveman, MIT) → the CONCISE VOICE discipline:
//     answer-first, zero ceremony, payload verbatim, negations never dropped,
//     safety warnings in full sentences. Zero meaning loss — pure filler
//     removal — so reply QUALITY is untouched while output tokens drop.
//   - find-skills (vercel-labs/skills, MIT) → the DISCOVERY protocol for the
//     open skills registry (skills.sh): detect a tool need, search, VET
//     quality (installs, source reputation), present with install commands.
//     Curated EE starters were verified live against skills.sh (2026-11).

const cavemanPackAr = `

✂️ مهارة الإيجاز الذكي (Caveman — كل معنى محفوظ، كل زائد محذوف):
- قدّم الجواب أولاً ثم التعليل ثم الخطوة التالية — لا مقدمات مجاملة («بالتأكيد! يسعدني مساعدتك…») ولا جملة افتتاحية تعلن ما ستفعله، ولا إعادة تلخيص ختامية ولا «أتمنى أن يكون هذا مفيداً».
- فكرة واحدة لكل جملة (حوالي 20 كلمة كحد أقصى)، صياغة مباشرة، وللخطوات استخدم صيغة الأمر.
- احذف الحشو فقط («فعلياً، بشكل أساسي، من الجدير بالذكر، في الحقيقة») — وممنوع منعاً باتاً حذف أدوات النفي (لا، لن، ليس، فقط، إلا) أو الأرقام أو الوحدات أو الشروط الحدية؛ فالمعنى لا يُضحّى مقابل الاختصار أبداً.
- الحمولة التقنية حرفية 100%: الأكواد، الأوامر، أسماء القوائم والمسارات، قيم الأخطاء، أسماء المعايير والوحدات تُنقل كما هي دون تغيير حرف واحد.
- تحذيرات السلامة (Arc Flash، مستويات PPE، إجراءات الخطر) وردود المستخدم المتردد أو المتكرر تُكتب بجمل كاملة واضحة — ثم عُد للإيجاز.
- الإيجاز في الكلام لا في التنظيم: تنسيق Markdown والفقرات والنقاط تبقى ممتازة كما هي.`;

const cavemanPackEn = `

✂️ CONCISE VOICE SKILL (Caveman — every fact kept, every filler gone):
- Answer first, then the reasoning, then the next step. No greeting ceremony ("Sure! I'd be happy to help…"), no line announcing what you will do, no closing recap, no "hope this helps".
- One idea per sentence (about 20 words max), direct voice, imperative for instructions.
- Cut ONLY filler ("actually, basically, it is worth noting") — NEVER drop negations (not, never, no, only, except), numbers, units, or boundary conditions; meaning is never sacrificed.
- Technical payload stays verbatim: code, commands, menu names, paths, error values, standards and units — character for character.
- Safety warnings (Arc Flash, PPE levels, hazardous procedures) and replies to a confused or repeating user use full clear sentences — then resume brevity.
- Brevity in prose, not structure: excellent Markdown, paragraphs and bullets stay as they are.`;

const cavemanQuickAr = `

✂️ مرسى الإيجاز الذكي: الجواب أولاً ثم التعليل ثم الخطوة — بلا مجاملات ولا تلخيص ختامي — فكرة واحدة لكل جملة — الأكواد والأرقام والوحدات والمصطلحات حرفية بلا تغيير — أدوات النفي محفوظة دائماً — تحذيرات السلامة بجمل كاملة — والتنسيق يبقى ممتازاً.`;

const cavemanQuickEn = `

✂️ Concise-voice anchor: answer first, then reasoning, then the step — no ceremony, no closing recap — one idea per sentence — code, numbers, units and terms verbatim — negations always preserved — safety warnings in full sentences — formatting stays excellent.`;

const findSkillsPackAr = `

🧩 مهارة اكتشاف المهارات (Find-Skills — بروتوكول سجل المهارات المفتوح):
عندما يطلب المستخدم أداة أو مهارة أو إضافة تساعده في عمل هندسي كهربائي، أو يسأل «هل توجد مهارة لـ…؟»، اتبع بروتوكول الاكتشاف:
1) حدد الاحتياج بدقة: المجال (محاكاة، حسابات أحمال، تقارير فنية، تحليل بيانات قياسات…) والمهمة المحددة داخل الهندسة الكهربية.
2) الاكتشاف يتم في سجل المهارات المفتوح skills.sh — اشرح للمستخدم كيف يبحث بنفسه: الأمر npx skills find متبوعاً باستعلام دقيق (مثال: npx skills find electrical أو npx skills find matlab)، والتصفح من موقع skills.sh، وإن كان يعمل داخل وكيل برمجي يثبّت المهارة بأمر npx skills add متبوعاً باسم المهارة.
3) فحص الجودة إلزامي قبل أي توصية: عدد التثبيتات (فضّل ما فوق 1000 واحذر ما دون 100)، وسمعة المصدر (المصادر الرسمية والمعروفة أولى بالثقة من المجهولة)، ونجوم المستودع على GitHub.
4) اعرض المرشحين بالصيغة: اسم المهارة — ماذا تضيف — المصدر وعدد التثبيتات — أمر التثبيت — رابطها على skills.sh.
5) نقطة انطلاق موثقة من فحص فعلي للسجل (نوفمبر 2026): مهارات MATLAB وSimulink الرسمية من MathWorks لنمذجة المحركات وأنظمة القوى (npx skills add matlab/simulink-agentic-toolkit@building-simulink-models)، مهارات LaTeX الأكاديمية للتقارير الفنية (npx skills add bahayonghang/academic-writing-skills@latex-paper-en)، ومهارات Excel لجداول الأحمال والحسابات (npx skills add sbroenne/mcp-server-excel@excel-cli).
6) لا توجد نتيجة مناسبة؟ قل ذلك بصراحة واعرض إنجاز المهمة بنفسك بقدراتك المباشرة.
قيد إلزامي: هذا البروتوكول يخدم الاحتياجات المرتبطة بالهندسة الكهربية والعمل الهندسي فقط — ما خارجها يُرفض بلباقة وفق سياسة التخصص.`;

const findSkillsPackEn = `

🧩 FIND-SKILLS SKILL (open skills-registry discovery protocol):
When the user asks for a tool, skill, or extension for electrical-engineering work ("is there a skill for…?"), follow this discovery protocol:
1) Pin down the need: the domain (simulation, load schedules, technical reports, measurement-data analysis…) and the specific task inside electrical engineering.
2) Discovery happens in the open registry skills.sh — explain how to search: npx skills find with a precise query (e.g. npx skills find electrical or npx skills find matlab), browsing skills.sh, and — inside a coding agent — installing via npx skills add + the skill name.
3) Quality vetting is MANDATORY before any recommendation: install count (prefer 1000+, cautious under 100), source reputation (official, well-known sources first), and GitHub repository stars.
4) Present candidates as: skill name — what it adds — source and install count — install command — skills.sh link.
5) Verified starting points (live registry check, November 2026): official MathWorks MATLAB/Simulink skills for motor and power-system modeling (npx skills add matlab/simulink-agentic-toolkit@building-simulink-models), academic LaTeX skills for technical reports (npx skills add bahayonghang/academic-writing-skills@latex-paper-en), Excel skills for load schedules and calculations (npx skills add sbroenne/mcp-server-excel@excel-cli).
6) No suitable result? Say so plainly and offer to do the task with your own capabilities.
Hard scope: electrical-engineering needs ONLY — anything outside is politely declined per the specialization policy.`;

const findSkillsQuickAr = `

🧩 مرسى اكتشاف المهارات: عند طلب أداة/مهارة للعمل الهندسي — وجّه البحث في سجل المهارات المفتوح skills.sh بأمر npx skills find مع استعلام دقيق، وافحص قبل أي توصية: عدد التثبيتات (فضّل 1000+) وسمعة المصدر ونجوم المستودع، واعرض: الاسم والفائدة والمصدر وأمر npx skills add ورابط skills.sh — والمجال الهندسة الكهربية فقط، ولا نتيجة؟ أنجز المهمة بقدراتك مباشرة.`;

const findSkillsQuickEn = `

🧩 Find-skills anchor: for a tool/skill request for engineering work — search the open registry skills.sh via npx skills find with a precise query, vet before recommending (installs, prefer 1000+; reputable source; repo stars), present name + benefit + source + npx skills add command + skills.sh link — electrical engineering only; no result? Do the task with your own capabilities.`;

export const SKILL_REGISTRY: SkillDefinition[] = [
  {
    id: "caveman-conciseness",
    label: "مهارة الإيجاز الذكي (Caveman)",
    description: "Answer-first terse voice: zero ceremony, payload verbatim, negations preserved — output-token savings with zero meaning loss.",
    category: "voice-discipline",
    version: "1.0.0",
    phrases: ["caveman", "إيجاز", "اختصار", "رد مختصر", "إجابة مختصرة", "باختصار شديد"],
    keywords: ["إيجاز", "اختصار", "مختصر", "توكنات", "tokens"],
    softwareAffinity: [],
    modes: ["thinking", "instant"],
    // UNIVERSAL VOICE: injected in EVERY routed prompt (thinking + instant).
    // This is the OUTPUT-token saving discipline — routing it out would
    // defeat its purpose exactly on the long technical replies where the
    // savings matter most. Not an identity core, but always-on for the same
    // mechanical reason: every lane must carry it.
    alwaysOn: true,
    build: (lang, mode) => (lang === "ar" ? (mode === "instant" ? cavemanQuickAr : cavemanPackAr) : (mode === "instant" ? cavemanQuickEn : cavemanPackEn)),
  },
  {
    id: "powerfactory-core",
    label: "نواة DIgSILENT PowerFactory",
    description: "Data Manager, Study Cases, RMS/EMT, DSL/DPL, relay modeling, DER.",
    category: "software-core",
    version: "1.0.0",
    phrases: ["power factory", "powerfactory", "دي جي سايلنت", "دي جيسايلنت", "باور فاكتوري", "dsl script", "dpl script"],
    keywords: ["digsilent", "بورفاكتوري", "بافورفاكتوري"],
    softwareAffinity: [/power\s?factory/i, /digsilent/i, /باور ?فاكتوري/],
    modes: ["thinking"],
    build: (_lang, mode) => (mode === "thinking" ? pfCore : ""),
  },
  {
    id: "skm-core",
    label: "نواة SKM PTW",
    description: "DAPPER, CAPTOR, TMS, Arc Flash Evaluation, BOM workflow.",
    category: "software-core",
    version: "1.0.0",
    phrases: ["skm ptw", "power tools", "power*tools", "اس كي ام"],
    keywords: ["skm", "captor", "dapper", "hi_wave"],
    softwareAffinity: [/\bskm\b/i, /power\s?\*\s?tools/i],
    modes: ["thinking"],
    build: (_lang, mode) => (mode === "thinking" ? skmCore : ""),
  },
  {
    id: "pvsyst-core",
    label: "نواة PVSyst",
    description: "Project workflow, Meteonorm/NSRDB, shading 3D, PR losses, variants.",
    category: "software-core",
    version: "1.0.0",
    phrases: ["pv syst", "بي في سيست", "بي في سست", "near shading"],
    keywords: ["pvsyst", "ميتيونورم", "meteonorm"],
    softwareAffinity: [/pvsyst/i, /بي ?في ?سيست/],
    modes: ["thinking"],
    build: (_lang, mode) => (mode === "thinking" ? pvsystCore : ""),
  },
  {
    id: "etap-expert-core",
    label: "نواة خبرة ETAP",
    description: "Senior-ETAP 6-step protocol, 20 critical rules, module reference, common mistakes.",
    category: "software-core",
    version: "1.0.0",
    phrases: [
      "load flow", "short circuit", "short-circuit", "arc flash", "one line", "one-line", "single line",
      "motor starting", "motor acceleration", "transient stability", "sequence of operation",
      "تدفق الأحمال", "تدفق الاحمال", "قصر الدارة", "قصر الدائرة", "اريك فلاش", "آرك فلاش",
      "خط واحد", "سينجل لاين", "بدء المحركات", "تسارع المحركات", "الاستقرارية",
      "دراسة حماية", "دراسة الحماية", "تنسيق الحماية",
    ],
    keywords: [
      "etap", "ايتاب", "اي تاب", "إيتاب", "star", "starz", "adms", "dse", "flisr", "fdir", "derms",
      "busbar", "bus", "relay", "breaker", "fuse", "transformer", "motor", "generator", "cable",
      "feeder", "switchgear", "ups", "battery", "grounding", "earthing", "harmonics", "voltage",
      "current", "fault", "protection", "coordination", "قاطع", "قواطع", "محول", "محولات",
      "محرك", "محركات", "مولد", "مولدات", "كابل", "كابلات", "تغذية", "فيدر", "بوس", "بار",
      "عطل", "أعطال", "اعطال", "حماية", "ريليه", "ريلاي", "فيوز", "لوحة", "تأريض", "تاريض",
      "جهد", "تيار", "قدرة", "حمولة", "أحمال", "احمال", "شبكة", "محطة", "مكثف", "توافقيات",
      "دراسة", "دراسات", "حساب", "حسابات", "أمبير", "امبير", "فولت", "كيلوواط", "ميجاواط",
    ],
    softwareAffinity: [/etap/i, /ايتاب/, /اي ?تاب/],
    modes: ["thinking", "instant"],
    // IDENTITY CORE: the deep-analysis protocol IS the thinking lane's
    // contract (chatbot.test.ts asserts DEEP-ANALYSIS PROTOCOL in every
    // thinking prompt) — always injected, never routed out.
    alwaysOn: true,
    build: (lang, mode) => DELEGATED["etap-expert-core"][lang](lang, mode),
  },
  {
    id: "electrical-depth-pack",
    label: "حزمة العمق الكهربائي",
    description: "Units discipline, short-circuit depth, batteries/DC, earthing, generators/UPS.",
    category: "study-pack",
    version: "1.0.0",
    phrases: [
      "battery sizing", "battery capacity", "dc plant", "soil resistivity", "touch voltage", "step voltage",
      "تحجيم البطاريات", "سعة البطارية", "معدل التفريغ", "مقاومة التربة", "جهد اللمس", "جهد الخطوة",
      "التحويل بين kW وkVA", "wet stacking", "low voltage disconnect",
    ],
    keywords: [
      "battery", "batteries", "بطارية", "بطاريات", "بطاريه", "dc", "ups", "rectifier",
      "مقوم", "lvd", "earthing", "grounding", "تأريض", "تاريض", "lightning", "spd",
      "صواعق", "برق", "generator", "مولد", "مولدات", "derating", "اخفاض", "إخفاض",
      "ieee 485", "ieee 80", "iec 62305", "iso 8528", "kva", "kvar",
    ],
    softwareAffinity: [],
    modes: ["thinking", "instant"],
    // IDENTITY CORE: the engineering-discipline pack travels with the ETAP
    // core in every lane (units, MISSING protocol, X/R, IEEE 485/80 anchors).
    alwaysOn: true,
    build: (lang, mode) => DELEGATED["electrical-depth-pack"][lang](lang, mode),
  },
  {
    id: "arc-flash-pack",
    label: "حزمة Arc Flash",
    description: "IEEE 1584-2018 workflow, arcing current, IE/boundary/PPE, labeling discipline.",
    category: "study-pack",
    version: "1.0.0",
    phrases: [
      "arc flash", "arcing current", "incident energy", "flash boundary", "arc boundary",
      "اريك فلاش", "آرك فلاش", "ارك فلاش", "طاقة الحادث", "حد القوس", "ملصق السلامة", "ملصقات السلامة",
    ],
    keywords: ["1584", "70e", "ppe", "ملصق", "ملصقات", "cal/cm", "flash"],
    softwareAffinity: [/arc ?flash/i, /اريك فلاش/, /ارك فلاش/],
    modes: ["thinking", "instant"],
    build: (lang, mode) => (lang === "ar" ? (mode === "instant" ? arcFlashQuickAr : arcFlashPackAr) : (mode === "instant" ? arcFlashQuickEn : arcFlashPackEn)),
  },
  {
    id: "protection-coordination-pack",
    label: "حزمة تنسيق الحماية",
    description: "TCC methodology, CTI grading, selectivity verification, relay-setting discipline.",
    category: "study-pack",
    version: "1.0.0",
    phrases: [
      "protection coordination", "relay coordination", "relay setting", "relay settings", "time current",
      "time-current", "selectivity", "تنسيق الحماية", "تنسيق حماية", "إعدادات الريليه", "اعدادات الريليه",
      "منحنيات الحماية", "منحنى الحماية", "الانتقائية", "فجوة التنسيق",
    ],
    keywords: ["tcc", "cti", "pickup", "relay", "ريليه", "ريلاي", "تنسيق", "انتقائية", "مرحل"],
    softwareAffinity: [/coordination/i, /تنسيق/],
    modes: ["thinking", "instant"],
    build: (lang, mode) => (lang === "ar" ? (mode === "instant" ? protectionQuickAr : protectionPackAr) : (mode === "instant" ? protectionQuickEn : protectionPackEn)),
  },
  {
    id: "load-flow-pack",
    label: "حزمة Load Flow وهبوط الجهد",
    description: "Solver selection, convergence debugging, VD quality ladder, PF correction math.",
    category: "study-pack",
    version: "1.0.0",
    phrases: [
      "load flow", "voltage drop", "power factor", "power-factor", "newton-raphson", "newton raphson",
      "fast decoupled", "تدفق الأحمال", "تدفق الاحمال", "هبوط الجهد", "هبوط جهد", "معامل القدرة",
      "تصحيح معامل", "المكثفات", "فرق الجهد",
    ],
    keywords: ["slack", "convergence", "vd", "kvar", "capacitor", "مكثف", "مكثفات", "انحراف الجهد"],
    softwareAffinity: [/load ?flow/i, /تدفق/],
    modes: ["thinking", "instant"],
    build: (lang, mode) => (lang === "ar" ? (mode === "instant" ? loadFlowQuickAr : loadFlowPackAr) : (mode === "instant" ? loadFlowQuickEn : loadFlowPackEn)),
  },
  {
    id: "solar-pv-pack",
    label: "حزمة الطاقة الشمسية",
    description: "String sizing math, shading/losses, DC/AC & clipping, grid code, ETAP PV modeling.",
    category: "study-pack",
    version: "1.0.0",
    phrases: [
      "solar pv", "pv system", "pv plant", "string sizing", "solar panel",
      "الطاقة الشمسية", "الطاقه الشمسيه", "خلايا شمسية", "خلايا شمسيه", "ألواح شمسية", "الواح شمسيه",
      "تحجيم السلاسل",
    ],
    keywords: ["solar", "pv", "inverter", "string", "شمسي", "شمسيه", "انفرتر", "انفرتار", "سلسلة", "سلاسل", "clipping", "1547"],
    softwareAffinity: [/solar/i, /pv/i, /شمسي/],
    modes: ["thinking", "instant"],
    build: (lang, mode) => (lang === "ar" ? (mode === "instant" ? solarQuickAr : solarPackAr) : (mode === "instant" ? solarQuickEn : solarPackEn)),
  },
  {
    id: "find-skills-discovery",
    label: "مهارة اكتشاف المهارات (Find-Skills)",
    description: "Open-registry discovery protocol (skills.sh): detect tool need, search, vet quality, present install commands — EE-scoped.",
    category: "discovery",
    version: "1.0.0",
    phrases: [
      "هل توجد مهارة", "هل يوجد مهارة", "مهارة تساعد", "أضف مهارة", "ثبت مهارة", "نصب مهارة",
      "بحث عن مهارة", "إضافة مهارة", "أداة مساعدة", "أدوات مساعدة", "أداة تساعدني", "أحتاج أداة",
      "هل توجد أداة", "هل يوجد أداة", "برنامج مساعد", "skills.sh", "npx skills", "find skill",
    ],
    keywords: [
      "مهارة", "مهارات", "مهاراتك", "skill", "skills", "npx", "skills.sh",
      "plugin", "extension", "بلجن", "اكستنشن", "إضافة", "اضافه", "أداة", "أدوات", "اداة", "ادوات",
      "excel", "latex", "simulink", "matlab",
    ],
    softwareAffinity: [],
    modes: ["thinking", "instant"],
    build: (lang, mode) => (lang === "ar" ? (mode === "instant" ? findSkillsQuickAr : findSkillsPackAr) : (mode === "instant" ? findSkillsQuickEn : findSkillsPackEn)),
  },
  {
    id: "sld-drawing-skill",
    label: "مهارة رسم المخططات",
    description: "sld spec-board contract + immediate-execution rule (server-side SVG renderer).",
    category: "drawing",
    version: "1.0.0",
    phrases: [
      "single line", "one line diagram", "one-line diagram", "block diagram", "wiring diagram",
      "سينجل لاين", "خط واحد", "مخطط الرسم", "مخطط التوصيل",
    ],
    keywords: ["sld", "draw", "drawing", "ارسم", "ارسمي", "رسم", "مخطط", "مخططات", "لوحة"],
    softwareAffinity: [],
    modes: ["thinking"],
    build: (lang, mode) => (mode === "thinking" ? (lang === "ar" ? sldSkillAr : sldSkillEn) : ""),
  },
];

// Content delegates for the two big cores that live in chatbot-prompts.ts
// (etapExpertCore / electricalDepthPack full + quick variants). To keep the
// dependency direction one-way (prompts → skillnet, never the reverse), the
// builders are registered by chatbot-prompts.ts at module load time.
type ContentBuilder = (lang: SkillnetLang, mode: SkillnetMode) => string;

const DELEGATED: Record<string, { ar: ContentBuilder; en: ContentBuilder }> = {
  "etap-expert-core": { ar: () => "", en: () => "" },
  "electrical-depth-pack": { ar: () => "", en: () => "" },
};

/**
 * Registers the delegated content blocks (called once by
 * chatbot-prompts.ts which owns etapExpertCore / electricalDepthPack).
 * Keeps the dependency direction prompts → skillnet only.
 */
export function registerSkillContent(
  id: "etap-expert-core" | "electrical-depth-pack",
  builders: { thinking: { ar: string; en: string }; instant: { ar: string; en: string } },
): void {
  const entry = DELEGATED[id];
  if (!entry) return;
  entry.ar = (lang, mode) => (mode === "instant" ? builders.instant[lang] : builders.thinking[lang]);
  entry.en = (lang, mode) => (mode === "instant" ? builders.instant[lang] : builders.thinking[lang]);
}

// ─── Router ─────────────────────────────────────────────────────────────────

export interface SkillRoutingInput {
  /** The routing signal: the user's latest message text (+ any live-vision
   *  screen description). Undefined/empty → full-fallback. */
  signal?: string;
  lang: SkillnetLang;
  mode: SkillnetMode;
  /** Live-screen teacher lane — forces the technical floor. */
  screenCapture?: boolean;
  /** Image-analysis lane — forces the technical floor. */
  vision?: boolean;
  /** Explicit floor override (vision pass-2: an image WAS attached, the
   *  historical prompt always carried the full core set — the floor keeps
   *  that guarantee while the screen description may still ADD packs). */
  floor?: boolean;
}

const CHAR_PER_TOKEN = 4; // rough Arabic/English mixed-code estimate

/**
 * Deterministic skill router (SkillNet "routing with selection reasons").
 * Pure function — no I/O, no model calls, stable ordering.
 */
export function routeSkills(input: SkillRoutingInput): SkillRoutingDecision {
  const { lang, mode, screenCapture = false, vision = false, floor = false } = input;
  const rawSignal = typeof input.signal === "string" ? input.signal : "";
  const normalized = normalizeSignalText(rawSignal);
  const eligible = SKILL_REGISTRY.filter((s) => s.modes.includes(mode));

  const estimateAllChars = eligible.reduce((sum, s) => sum + s.build(lang, mode).length, 0);

  // No usable signal → legacy full injection (tests / doctor scripts / empty input).
  if (normalized.length < 2) {
    return {
      strategy: "full-fallback",
      selected: eligible.map((s) => ({ id: s.id, label: s.label, score: 0, reasons: ["no signal — full-fallback injection"] })),
      dropped: [],
      matchedSoftware: [],
      savedChars: 0,
      savedTokensEstimate: 0,
    };
  }

  const matchedSoftware = SOFTWARE_PATTERNS.filter((p) => p.re.test(normalized)).map((p) => p.name);

  // IDENTITY CORES (alwaysOn) are injected in every routed prompt — they are
  // scored for telemetry but can never land in `dropped`.
  const alwaysOnSkills = eligible.filter((s) => s.alwaysOn);
  const alwaysOnSelections = alwaysOnSkills.map((s) => ({
    id: s.id,
    label: s.label,
    score: 0,
    reasons: ["always-on identity core (never routed out)"],
  }));
  const routable = eligible.filter((s) => !s.alwaysOn);

  const scored = routable.map((s) => {
    const reasons: string[] = [];
    let score = 0;
    for (const phrase of s.phrases) {
      if (normalized.includes(normalizeSignalText(phrase))) {
        score += 2;
        reasons.push(`phrase "${phrase}"`);
      }
    }
    for (const keyword of s.keywords) {
      if (keywordMatcher(normalizeSignalText(keyword))(normalized)) {
        score += 1;
        reasons.push(`keyword "${keyword}"`);
      }
    }
    for (const affinity of s.softwareAffinity) {
      if (affinity.test(normalized)) {
        score += 2;
        reasons.push("software/vision affinity boost");
        break;
      }
    }
    return { def: s, score, reasons };
  });

  const floorIds = screenCapture || vision || floor ? ["etap-expert-core", "electrical-depth-pack"] : [];
  for (const id of floorIds) {
    // The two floor ids are alwaysOn identity cores — already guaranteed.
    // This loop stays as a defensive no-op guard for future re-classification.
    const hit = scored.find((x) => x.def.id === id);
    if (hit && hit.score === 0) {
      hit.score += 2;
      hit.reasons.push(screenCapture && vision ? "live screen + vision lane (technical floor)" : screenCapture ? "live screen lane (technical floor)" : "vision lane (technical floor)");
    }
  }

  const routedSelected = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || routable.findIndex((s) => s.id === a.def.id) - routable.findIndex((s) => s.id === b.def.id))
    .map((x) => ({ id: x.def.id, label: x.def.label, score: x.score, reasons: x.reasons }));
  const selected = [...alwaysOnSelections, ...routedSelected];

  if (routedSelected.length === 0) {
    // LEAN: only the identity cores ride along — every routable skill dropped.
    const droppedChars = routable.reduce((sum, s) => sum + s.build(lang, mode).length, 0);
    return {
      strategy: "lean",
      selected,
      dropped: routable.map((s) => ({ id: s.id, label: s.label })),
      matchedSoftware,
      savedChars: droppedChars,
      savedTokensEstimate: Math.round(droppedChars / CHAR_PER_TOKEN),
    };
  }

  const selectedIds = new Set(selected.map((s) => s.id));
  const selectedChars = eligible.filter((s) => selectedIds.has(s.id)).reduce((sum, s) => sum + s.build(lang, mode).length, 0);
  return {
    strategy: "routed",
    selected,
    dropped: eligible.filter((s) => !selectedIds.has(s.id)).map((s) => ({ id: s.id, label: s.label })),
    matchedSoftware,
    savedChars: Math.max(0, estimateAllChars - selectedChars),
    savedTokensEstimate: Math.round(Math.max(0, estimateAllChars - selectedChars) / CHAR_PER_TOKEN),
  };
}

/** Extract the latest user text (string or multipart content) as the routing
 *  signal. Structural typing — no import cycle with chatbot.ts. */
export function extractRoutingSignal(messages: Array<{ role: string; content: string | Array<{ type?: string; text?: string }> | unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      const parts: string[] = [];
      for (const part of m.content) {
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          parts.push((part as { text: string }).text);
        }
      }
      if (parts.length > 0) return parts.join("\n");
    }
    return "";
  }
  return "";
}

// ─── Telemetry (SkillNet: routing must be observable) ───────────────────────

const skillIds = new Set(SKILL_REGISTRY.map((s) => s.id));

/** Structured routing log — ids are ASCII constants (log-injection safe). */
export function logSkillRouting(decision: SkillRoutingDecision, meta?: { lane?: string }): void {
  if (decision.strategy === "full-fallback") return; // legacy path — nothing to report
  const invalid = decision.selected.filter((s) => !skillIds.has(s.id));
  logger.info("[SkillNet] skill routing", {
    strategy: decision.strategy,
    lane: meta?.lane ?? "unknown",
    selected: decision.selected.map((s) => ({ id: s.id, score: s.score, reason: s.reasons[0] ?? "" })),
    droppedCount: decision.dropped.length,
    matchedSoftware: decision.matchedSoftware,
    savedChars: decision.savedChars,
    savedTokensEstimate: decision.savedTokensEstimate,
    ...(invalid.length > 0 ? { anomaly: "unknown-skill-id", invalidIds: invalid.map((s) => s.id) } : {}),
  });
}

/** Registry integrity check (used by tests + chatbot-doctor). */
export function validateSkillRegistry(): Array<string> {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const skill of SKILL_REGISTRY) {
    if (seen.has(skill.id)) problems.push(`duplicate id: ${skill.id}`);
    seen.add(skill.id);
    if (!/^[a-z0-9-]+$/.test(skill.id)) problems.push(`bad id format: ${skill.id}`);
    if (skill.phrases.length === 0 && skill.keywords.length === 0) problems.push(`${skill.id}: no triggers`);
    for (const lang of ["ar", "en"] as const) {
      for (const mode of ["thinking", "instant"] as const) {
        if (!skill.modes.includes(mode)) continue;
        const content = skill.build(lang, mode);
        if (content.trim().length === 0) problems.push(`${skill.id}: empty ${lang}/${mode} content`);
        if (content.length > 0 && content.length < 80) problems.push(`${skill.id}: suspiciously short ${lang}/${mode} content (${content.length} chars)`);
      }
    }
  }
  return problems;
}
