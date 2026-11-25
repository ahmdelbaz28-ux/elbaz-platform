/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ELBAZ BOT — TECHNICAL REFERENCES EXPERT CORE  (v1.0.0)
 *  Saudi DPS-01 + ABB Transformers + Schneider Egypt Price-List 2026
 *  + full page-level index of ALL reference documents (Dr. Gilany included).
 * ───────────────────────────────────────────────────────────────────────────
 *  User requirement encoded here: the assistant must behave like an expert who
 *  OWNS these references in its knowledge base — it reasons FROM them per the
 *  question, answers with proof from the file, and can pick the right CATALOGUE
 *  ITEM (Product ID + full data + price) for any project. An index routes every
 *  question to the right document so tokens are never burned on wrong files.
 *
 *  1. KNOWLEDGE BASES — chatbot-saudi-kb.ts (DPS-01 tables 3-12, types C1-C29,
 *     rules, §-index — cell-verified), chatbot-abb-kb.ts (ABB transformers:
 *     97 oil designs + 112 dry/RESIBLOC loss rows + 40 IP00 dimension rows),
 *     chatbot-schneider-kb.ts (3320 priced items with Product IDs) and
 *     chatbot-refs-pages-kb.ts (3608 chunks = EVERY page of all 7 documents,
 *     nothing omitted; scanned pages recorded as image placeholders).
 *  2. INTENT GATE + ROUTER — hasRefsIntent() is generous; routeRefsQuery()
 *     scores the query against per-source keyword sets and picks ONLY the
 *     matching corpora (no wrong-file reading, no token burn).
 *  3. RAG RETRIEVER — retrieveRefPages(): BM25 over the page index with
 *     per-document citation formats (Gilany / codes / catalogues).
 *  4. ENGINES (deterministic, KB-grounded, server-side):
 *     - computeSaudiLoad(): DPS-01 connected/demand/coincident load + CB
 *       selection with §12 interpolation, §14/§16/§17 adjustments, Table 11/12.
 *     - selectAbbTransformer(): catalogue item selection by kVA/HV/LV/kind.
 *     - selectBreaker(): Schneider item selection by amps/poles/Icu/family
 *       with Product ID + price (+ VAT note). Cross-linked: the Saudi engine
 *       hands its demand current to the breaker engine.
 *  5. CITATION CONTRACT — resolveRefsCitations()/enforceRefsCitations() mirror
 *     the proven Saadat/Cables design (append-only, refusal-safe).
 *
 *  DEPENDENCY DIRECTION (one-way): skillnet → refs → {saudi-kb, abb-kb,
 *  schneider-kb, refs-pages-kb}. This module imports NOTHING from the chatbot
 *  stack and carries its own Arabic normalizer (cycle-safe).
 * ───────────────────────────────────────────────────────────────────────────
 *  INTEGRATION:
 *   - chatbot-skillnet.ts registers saudi-load-core / abb-transformer-core /
 *     schneider-price-core / gilany-pse-core importing the *_CORE_BLOCKS here.
 *   - chatbot-prompts.ts getSystemPrompt(..., refsContext?) appends the
 *     dynamic block built by buildRefsContextBlock().
 *   - chatbot.ts / chatbot-stream.ts compute the block from the routing
 *     signal and enforce citations on the reply (composed with the cables
 *     enforcement — both are append-only and idempotent).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  ABB_DESCRIPTIVE,
  ABB_FLAGS,
  ABB_INTEGRITY_SAMPLER,
  ABB_IP00_DIMS,
  ABB_ITEMS,
  ABB_LARGE_ITEMS,
  ABB_LOSS_ITEMS,
  type AbbItem,
} from "./chatbot-abb-kb.js";
import {
  REF_PAGES_CHUNKS,
  REF_PAGES_INTEGRITY_SAMPLER,
  REF_PAGES_META,
  type RefsPageChunk,
} from "./chatbot-refs-pages-kb.js";
import {
  SAUDI_AREA_TABLES,
  SAUDI_COINCIDENCE,
  SAUDI_DEMAND_FACTORS,
  SAUDI_DENSITY_TABLES,
  SAUDI_INTEGRITY_SAMPLER,
  SAUDI_RULES,
  SAUDI_SECTIONS,
  SAUDI_TYPES,
  type SaudiAreaTable,
} from "./chatbot-saudi-kb.js";
import {
  SCHNEIDER_INTEGRITY_SAMPLER,
  SCHNEIDER_ITEMS,
  SCHNEIDER_META,
  type SchneiderItem,
} from "./chatbot-schneider-kb.js";

// ─── Prompt language / mode (mirrors Cables/Saadat without importing them) ──

export type RefsLang = "ar" | "en";
export type RefsMode = "thinking" | "instant";

// ─── Arabic-aware normalization (local, cycle-safe) ─────────────────────────

export function normalizeRefsText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u0660-\u0669]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 0x30))
    .replace(/[\u06F0-\u06F9]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x06F0 + 0x30))
    .replace(/\u066B/g, ".")
    .replace(/\u066C/g, "")
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

const REFS_INTENT_KEYWORDS: string[] = [
  // Saudi DPS-01
  "كود سعودي", "الكود السعودي", "السعودي", "saudi", "sec dps", "dps-01", "dps01", "dps 01",
  "حمل متصل", "connected load", "حمل الطلب", "demand load", "حمل التزامان", "coincident demand",
  "معامل التزامان", "coincidence factor", "معامل التنوع", "diversity factor",
  "كثافة الحمل", "load density", "va/m2", "va/m²", "فولت أمبير/م2",
  "قاطع الخدمة", "عداد الخدمة", "التبريد المركزي", "district cooling", "مناطق شتوية", "winter peak",
  "حمل العميل", "تقدير الاحمال", "تقدير الأحمال", "customer load",
  // ABB transformers
  "محولات abb", "محول abb", "كتالوج abb", "abb", "transformer catalogue", "محولات توزيع",
  "محول توزيع", "distribution transformer", "المحولات الجافة", "dry type", "cast coil", "resibloc",
  "مجموعة متجهات", "vector group", "معاوقة القصر", "impedance voltage", "فقد لا حمل", "no-load loss",
  "فقد الحمل", "load loss", "vacuum cast", "pad mounted", "boosterformer",
  // Schneider price list
  "شنايدر", "schneider", "ماستر باكت", "masterpact", "mtz1", "mtz2", "easypact", "مي زي", "nw", "nt",
  "قائمة اسعار", "قائمة الأسعار", "price list", "product id", "سعر القاطع", "go pact", "gopact",
  "mccb", "acb", "قاطع مقولب", "قاطع هوائي", "air circuit breaker", "moulded case",
  "ic60", "acti9", "resi9", "easy9", "الكونتاكتور", "contactor", "lc1d", "lr2", "gv2", "انفرتر", "atv",
  // Gilany + general reference language
  "جيلاني", "جيلانى", "هندسة القوى", "دكتور جيلاني", "كتاب القوى",
  "المرجع", "من المرجع", "من الكتالوج", "من الدليل", "الدليل", "الكتالوج", "المرجعية",
  // Saudi facility codes C1..C29 with VA/m² context
  "c1", "c2", "c18", "c21", "c29", "va/m²", "va/m2",
];

const SHORT_REFS_LATENT = /^(abb|mccb|acb|nw|nt|mvs|enw|atv|tm3|dm1|dm3|xb7|lc1|gv2|c1|c2|c18|c21|c29|dps)$/;

/** TRUE when the message plausibly needs the technical-references layer. */
export function hasRefsIntent(text: string): boolean {
  const normalized = normalizeRefsText(text);
  if (normalized.length < 2) return false;
  for (const keyword of REFS_INTENT_KEYWORDS) {
    const kw = normalizeRefsText(keyword);
    if (SHORT_REFS_LATENT.test(kw)) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
      if (re.test(normalized)) return true;
      continue;
    }
    if (normalized.includes(kw)) return true;
  }
  return false;
}

// ─── Router: which sub-corpus does this query belong to? ────────────────────

const SAUDI_ROUTE_KEYS = [
  "سعودي", "saudi", "dps", "حمل متصل", "connected load", "حمل الطلب", "demand load",
  "التزامان", "coinciden", "معامل التنوع", "diversity", "كثافة", "load density", "va/m",
  "قاطع الخدمة", "التبريد المركزي", "district cooling", "شتوي", "winter peak",
  "حمل العميل", "تقدير الاحمال", "تقدير الاحمال", "facilit", "c1", "c2", "c29",
];
const ABB_ROUTE_KEYS = [
  "abb", "محول", "transformer", "transformers", "محوّل", "مجموعة متجهات", "vector group",
  "معاوقة", "impedance", "فقد لا حمل", "no-load", "load loss", "جافه", "جافة", "dry",
  "cast coil", "resibloc", "ريزين", "dyn11", "dyn5", "yzn5", "kva", "ك ف ا", "كيلو فولت امبير",
  "pad mount", "boosterformer", "مفاعله", "مفاعلات", "reactor",
];
const BRK_ROUTE_KEYS = [
  "شنايدر", "schneider", "ماستر", "masterpact", "mtz", "easypact", "enw", "mvs",
  "قاطع", "breaker", "قواطع", "مقولب", "mccb", "acb", "gopact", "go pact", "g12", "g20", "g25",
  "g40", "g80", "ic60", "acti9", "resi9", "easy9", "rcd", "rccb", "rcbo", "mcb",
  "كونتاكتور", "contactor", "lc1", "lr2", "gv2", "تلسيس", "tesys",
  "انفرتر", "inverter", "vfd", "atv", "altivar", "asفر", "كنتول", "altistart",
  "xb7", "pushbutton", "زر", "لمبه", "indicator", "tm3", "plc", "dm1", "dm3", "عداد",
  "meter", "pm", "power meter", "مكثفات", "capacitor", "varplus", "سعر", "price",
  "product id", "الاسعار", "متوفر", "p/n", "reference",
];
const GILANY_ROUTE_KEYS = [
  "جيلاني", "جيلانى", "هندسة القوى", "دكتور جيلان", "كتاب جيلان",
  "توليد", "generation", "نقل", "transmission", "شبكه موحده", "شبكة موحدة", "spinning reserve",
  "استقرار", "stability", "blackout", "محطات التحويل", "substation", "المحولات", "الترانزنت",
  "transient", "الاستقرار", "iec 61850", "الاورتماتيون", "automation", "التورييد",
];

export interface RefsRoute {
  saudi: boolean;
  abb: boolean;
  schneider: boolean;
  gilany: boolean;
  /** Document ids the page-level BM25 may search for this query. */
  docs: string[];
}

const ALL_DOCS = ["saudi-dps", "abb-tr", "egycode-1", "egycode-2", "elsewedy", "gilany", "schneider-brk"];

function matchKeys(normalized: string, keys: string[]): boolean {
  for (const key of keys) {
    const k = normalizeRefsText(key);
    if (SHORT_REFS_LATENT.test(k)) {
      const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
      if (re.test(normalized)) return true;
      continue;
    }
    if (normalized.includes(k)) return true;
  }
  return false;
}

/** Routes the query to reference sub-corpora. cablesIntentActive=true excludes
 *  the elsewedy/egycode page corpora (the dedicated cables layer already
 *  handles those sources with its curated KB + engine — no double burning). */
export function routeRefsQuery(query: string, cablesIntentActive = false): RefsRoute {
  const n = normalizeRefsText(query);
  const saudi = matchKeys(n, SAUDI_ROUTE_KEYS);
  const abb = matchKeys(n, ABB_ROUTE_KEYS);
  const schneider = matchKeys(n, BRK_ROUTE_KEYS);
  let gilany = matchKeys(n, GILANY_ROUTE_KEYS);
  const docs: string[] = [];
  if (saudi) docs.push("saudi-dps");
  if (abb) docs.push("abb-tr");
  if (schneider) docs.push("schneider-brk");
  if (gilany) docs.push("gilany");
  if (!cablesIntentActive) {
    if (matchKeys(n, ["كود مصري", "الكود المصري", "egyptian code", "الدليل الارشادي", "الدليل الإرشادي", "المجلد الاول", "بند"])) {
      docs.push("egycode-1", "egycode-2");
    }
    if (matchKeys(n, ["سويدي", "elsewedy", "كابل", "كابلات", "امبيراسيه", "cable"])) {
      docs.push("elsewedy");
    }
  }
  if (docs.length === 0) {
    // cables layer owns this query and no reference corpus matched → return an
    // EMPTY route: burning tokens on wrong files is exactly what must never
    // happen (the cables layer's curated KB + engine already serve it)
    if (cablesIntentActive) {
      return { saudi: false, abb: false, schneider: false, gilany: false, docs: [] };
    }
    // generic engineering question → the book + every structured catalogue is
    // the fallback (generous, still filtered BM25)
    gilany = true;
    return { saudi: true, abb: true, schneider: true, gilany: true, docs: [...ALL_DOCS] };
  }
  return { saudi, abb, schneider, gilany, docs };
}

// ─── Page-level BM25 retriever over REF_PAGES_CHUNKS ────────────────────────

export interface RefsPageHit {
  doc: string;
  page: number;
  part: number | null;
  chapter: number | null;
  score: number;
  citation: string;
  citationEn: string;
  excerpt: string;
  image: boolean;
}

const PAGES_K1 = 1.4;
const PAGES_B = 0.72;
interface IndexedChunk {
  chunk: RefsPageChunk;
  tokens: string[];
}
let PAGES_INDEX: IndexedChunk[] | null = null;
let PAGES_DF: Map<string, number> | null = null;
let PAGES_AVG_LEN = 0;

// ─── Curated corpus: verbatim rule blocks + catalogue descriptions + the
// printed §-index of DPS-01 (page-cited, higher-quality than raw chunks) ──────

export interface RefsCuratedDoc {
  id: string; doc: string; page: number;
  citation: string; citationEn: string; keywords: string; text: string;
}

const CURATED_DOCS: RefsCuratedDoc[] = [
  ...SAUDI_RULES.map((r) => ({
    id: `saudi:${r.id}`, doc: "saudi-dps", page: r.page,
    citation: `[SEC DPS-01 — Estimation of Customer Load Guideline، ${r.title}، ص.${r.page}]`,
    citationEn: `[SEC DPS-01 — Estimation of Customer Load Guideline, ${r.title}, p.${r.page}]`,
    keywords: `${r.title} dps saudi قسم بند جدول methodology interpolation`,
    text: r.text,
  })),
  ...SAUDI_SECTIONS.map((s) => ({
    id: `saudi-sec:${s.section}`, doc: "saudi-dps", page: s.page,
    citation: `[SEC DPS-01 — Estimation of Customer Load Guideline، §${s.section} ${s.title}، ص.${s.page}]`,
    citationEn: `[SEC DPS-01 — Estimation of Customer Load Guideline, §${s.section} ${s.title}, p.${s.page}]`,
    keywords: `${s.title} section ${s.section} بند`,
    text: `§${s.section} ${s.title} — الموقع: الصفحة ${s.page} من DPS-01`,
  })),
  ...ABB_DESCRIPTIVE.map((d) => ({
    id: `abb:${d.id}`, doc: "abb-tr", page: d.page,
    citation: `[ABB — Distribution Transformers Catalogue، ${d.title}، ص.${d.page}]`,
    citationEn: `[ABB — Distribution Transformers Catalogue, ${d.title}, p.${d.page}]`,
    keywords: `${d.title} abb محولات كتالوج زيتيه جافه resibloc`,
    text: d.text,
  })),
];

const CURATED_K1 = 1.4;
const CURATED_B = 0.72;
let CURATED_INDEX: Array<{ doc: RefsCuratedDoc; tokens: string[] }> | null = null;
let CURATED_DF: Map<string, number> | null = null;
let CURATED_AVG = 0;

function getCuratedIndex() {
  if (CURATED_INDEX && CURATED_DF) return { docs: CURATED_INDEX, df: CURATED_DF, avgLen: CURATED_AVG };
  const docs = CURATED_DOCS.map((doc) => ({ doc, tokens: tokenizePages(`${doc.keywords} ${doc.citation} ${doc.text}`) }));
  const df = new Map<string, number>();
  let total = 0;
  for (const d of docs) {
    total += d.tokens.length;
    for (const seen of new Set(d.tokens)) df.set(seen, (df.get(seen) ?? 0) + 1);
  }
  CURATED_INDEX = docs;
  CURATED_DF = df;
  CURATED_AVG = docs.length ? total / docs.length : 0;
  return { docs, df, avgLen: CURATED_AVG };
}

function retrieveCurated(query: string, docs: string[], k: number): RefsPageHit[] {
  const { docs: indexed, df, avgLen } = getCuratedIndex();
  const allowed = new Set(docs);
  const pool = indexed.filter((d) => allowed.has(d.doc.doc));
  if (!pool.length || k <= 0) return [];
  const qTokens = tokenizePages(query);
  if (!qTokens.length) return [];
  const qSet = [...new Set(qTokens)];
  const scored: Array<{ d: (typeof indexed)[number]; score: number }> = [];
  for (const d of pool) {
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of qSet) {
      const f = tf.get(qt);
      if (!f) continue;
      const dfv = df.get(qt) ?? 0;
      const idf = Math.log(1 + (pool.length - dfv + 0.5) / (dfv + 0.5));
      score += idf * ((f * (CURATED_K1 + 1)) / (f + CURATED_K1 * (1 - CURATED_B + (CURATED_B * d.tokens.length) / avgLen)));
    }
    if (score > 0) scored.push({ d, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => ({
    doc: s.d.doc.doc,
    page: s.d.doc.page,
    part: null,
    chapter: null,
    score: Math.round(s.score * 100) / 100,
    citation: s.d.doc.citation,
    citationEn: s.d.doc.citationEn,
    excerpt: s.d.doc.text,
    image: false,
  }));
}

const PAGES_STOPWORDS = new Set([
  "في", "من", "على", "الي", "عن", "مع", "هذا", "هذه", "ذلك", "كل", "بعد", "قبل", "تحت", "فوق",
  "كم", "ما", "هو", "هي", "او", "يا", "هل", "كيف", "ازاي", "ماذا", "لماذا", "لي", "لك", "له", "ان", "اذا", "كان", "يكون",
  "the", "is", "are", "of", "in", "on", "at", "for", "to", "what", "how", "which", "who", "why", "and", "or", "a", "an",
]);

function tokenizePages(text: string): string[] {
  const normalized = normalizeRefsText(text);
  const raw = normalized.match(/[a-z\u0621-\u064A0-9.%²]{1,}/g) ?? [];
  const tokens: string[] = [];
  for (const t of raw) {
    if (PAGES_STOPWORDS.has(t)) continue;
    if (t.length === 1 && !/\d/.test(t)) continue;
    tokens.push(t);
    const stripped = t.replace(/^(?:فال|كال|بال|وال|لل|ال)/, "");
    if (stripped !== t && stripped.length >= 2 && !PAGES_STOPWORDS.has(stripped)) tokens.push(stripped);
    if (t.includes(".")) {
      for (const part of t.split(".")) {
        if (part.length >= 2) tokens.push(part);
      }
    }
  }
  return tokens;
}

function getPagesIndex(): { docs: IndexedChunk[]; df: Map<string, number>; avgLen: number } {
  if (PAGES_INDEX && PAGES_DF) return { docs: PAGES_INDEX, df: PAGES_DF, avgLen: PAGES_AVG_LEN };
  const docs: IndexedChunk[] = REF_PAGES_CHUNKS.map((chunk) => ({
    chunk,
    tokens: tokenizePages(chunk.text),
  }));
  const df = new Map<string, number>();
  let total = 0;
  for (const d of docs) {
    total += d.tokens.length;
    for (const seen of new Set(d.tokens)) df.set(seen, (df.get(seen) ?? 0) + 1);
  }
  PAGES_INDEX = docs;
  PAGES_DF = df;
  PAGES_AVG_LEN = docs.length > 0 ? total / docs.length : 0;
  return { docs, df, avgLen: PAGES_AVG_LEN };
}

const DOC_CITATION: Record<string, { ar: (p: number, part: number | null) => string; en: (p: number, part: number | null) => string }> = {
  "saudi-dps": {
    ar: (p) => `[SEC DPS-01 — Estimation of Customer Load Guideline، ص.${p}]`,
    en: (p) => `[SEC DPS-01 — Estimation of Customer Load Guideline, p.${p}]`,
  },
  "abb-tr": {
    ar: (p) => `[ABB — Distribution Transformers Catalogue، ص.${p}]`,
    en: (p) => `[ABB — Distribution Transformers Catalogue, p.${p}]`,
  },
  "egycode-1": {
    ar: (p) => `[الكود المصري — المجلد الأول: أعمال التصميم، ص.${p}]`,
    en: (p) => `[Egyptian Code — Design Volume, p.${p}]`,
  },
  "egycode-2": {
    ar: (p) => `[الكود المصري — المجلد الأول: أعمال التصميم، ص.${p}]`,
    en: (p) => `[Egyptian Code — Design Volume, p.${p}]`,
  },
  elsewedy: {
    ar: (p) => `[Elsewedy Electric — Power Cables Catalogue، ص.${p}]`,
    en: (p) => `[Elsewedy Electric — Power Cables Catalogue, p.${p}]`,
  },
  gilany: {
    ar: (p, part) => `[هندسة القوى الكهربية — أ.د. محمود جيلاني${part ? `، الباب ${part}` : ""}، ص.${p}]`,
    en: (p, part) => `[Power System Engineering — Prof. Mahmoud Gilany${part ? `, Part ${part}` : ""}, p.${p}]`,
  },
  "schneider-brk": {
    ar: (p) => `[Schneider Electric Egypt — Breakers & Switches Price List 2026، ص.${p}]`,
    en: (p) => `[Schneider Electric Egypt — Breakers & Switches Price List 2026, p.${p}]`,
  },
};

/** BM25 retrieval over the page index + the curated corpus, restricted to
 *  `docs` (router output). Curated (verbatim rule/description/§-index) hits
 *  come first, raw page chunks fill the remainder. */
export function retrieveRefPages(query: string, docs: string[] | null, k = 3): RefsPageHit[] {
  if (k <= 0) return [];
  const curated = retrieveCurated(query, docs ?? [], Math.min(k, 2));
  const rest = Math.max(0, k - curated.length);
  const pageHits = retrievePageChunksOnly(query, docs, rest);
  return [...curated, ...pageHits];
}

function retrievePageChunksOnly(query: string, docs: string[] | null, k: number): RefsPageHit[] {
  if (k <= 0) return [];
  const { docs: indexed, df, avgLen } = getPagesIndex();
  const qTokens = tokenizePages(query);
  if (qTokens.length === 0) return [];
  const allowed = docs && docs.length ? new Set(docs) : null;
  const pool = allowed ? indexed.filter((d) => allowed.has(d.chunk.doc)) : indexed;
  if (!pool.length) return [];
  const qSet = [...new Set(qTokens)];
  const scored: Array<{ d: IndexedChunk; score: number }> = [];
  for (const d of pool) {
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of qSet) {
      const f = tf.get(qt);
      if (!f) continue;
      const dfv = df.get(qt) ?? 0;
      const idf = Math.log(1 + (pool.length - dfv + 0.5) / (dfv + 0.5));
      score += idf * ((f * (PAGES_K1 + 1)) / (f + PAGES_K1 * (1 - PAGES_B + (PAGES_B * d.tokens.length) / avgLen)));
    }
    if (score > 0) scored.push({ d, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits: RefsPageHit[] = [];
  for (const s of scored.slice(0, k)) {
    const c = s.d.chunk;
    const fmt = DOC_CITATION[c.doc];
    hits.push({
      doc: c.doc,
      page: c.page,
      part: c.part,
      chapter: c.chapter,
      score: Math.round(s.score * 100) / 100,
      citation: fmt ? fmt.ar(c.page, c.part) : `[${c.doc}، ص.${c.page}]`,
      citationEn: fmt ? fmt.en(c.page, c.part) : `[${c.doc}, p.${c.page}]`,
      excerpt: c.text.length > 900 ? `${c.text.slice(0, 850)} …` : c.text,
      image: c.image,
    });
  }
  return hits;
}

// ════════════════════════════════════════════════════════════════════════════
// SAUDI LOAD ENGINE (DPS-01 deterministic)
// ════════════════════════════════════════════════════════════════════════════

export interface SaudiLoadRequest {
  typeCode?: number;
  /** Unit covered/built-up area per unit (m²). */
  areaM2?: number;
  /** Total area when multi-unit (for C1/C2 combined handling). */
  units?: number;
  system?: "220" | "230/400";
  acType?: "central" | "unit" | "district" | "winter" | "none";
  /** Declared central-AC load (kVA) — §14 requires the customer declaration. */
  centralAcKva?: number;
  floorHeightM?: number;
  /** Additional special loads (§18) in kVA. */
  specialKva?: number;
  /** C1+C2 combined building (§13) — commercial area alongside the residential. */
  commercialAreaM2?: number;
}

export interface SaudiLoadResult {
  ok: boolean;
  needInput?: string;
  typeCode?: number;
  typeName?: string;
  method?: "area-tables" | "density" | "declared-minimum";
  connectedKva?: number;
  demandKva?: number;
  coincidentKva?: number | null;
  cbAmp?: number | null;
  df?: number;
  cf?: number | null;
  steps: string[];
  checks: Array<{ check: string; pass: boolean; detail: string; citation: string }>;
  citations: string[];
  assumptions: string[];
  warnings: string[];
}

const NUM = "(\\d+(?:\\.\\d+)?)";

function pickSaudiType(text: string): number | undefined {
  const m = text.match(/\bc ?([12]?[0-9])\b/);
  if (m) {
    const code = Number(m[1]);
    if (code >= 1 && code <= 29) return code;
  }
  const ARABIC_TYPE_HINTS: Array<[RegExp, number]> = [
    [/منزل|سكن|فيلا|شقه|شقة|استراحه|استراحة|مبيت|سكني/, 1],
    [/محل|محلات|تجاري|صيدليه|صيدلية|بوتيك|معرض/, 2],
    [/شقق مفروشه|شقق مفروشة|فurnished/, 3],
    [/فندق|فنادق|موتيل/, 4],
    [/مول|مركز تجاري|سوبرماركت|هايبر/, 5],
    [/مطعم|كافيه|مقهى|كوفي/, 6],
    [/مكتب|مكاتب|بنك/, 7],
    [/مدرسه|مدرسة|روضه|حضانه|معهد/, 8],
    [/مسجد/, 9],
    [/ميزانين/, 10],
    [/مناطق مشتركه|سطح|مداخل|ممرات/, 11],
    [/دورات عامه|حمامات عامه/, 12],
    [/جراج مغطي|parking مغطي|مواقف مغلقه/, 13],
    [/جراج مكشوف|مواقف مكشوفه/, 14],
    [/اناره شوارع|انارة شوارع|إضاءة شوارع/, 15],
    [/حدائق|حديقه|حديقة/, 16],
    [/مساحات مكشوفه|open space/, 17],
    [/مستشفى|مستشفي|مركز طبي/, 18],
    [/عياده|عيادة/, 19],
    [/جامعه|جامعة|كليه|معهد عالي/, 20],
    [/صناعات خفيفه|مصنع صغير|مزرعه دواجن/, 21],
    [/ورشه|ورشات|ورشة/, 22],
    [/مخازن تبريد|تخزين مبرد/, 23],
    [/مستودع|مخزن|warehouses/, 24],
    [/قاعده|قاعة|اعراس|أعراس/, 25],
    [/نادي|سينما|مسرح|ترفيه/, 26],
    [/مزرعه|مزارع|زراعي/, 27],
    [/محطه وقود|محطة وقود|بنزين/, 28],
    [/مصانع كبيره|مصنع كبير|مصانع/, 29],
  ];
  for (const [re, code] of ARABIC_TYPE_HINTS) {
    if (re.test(text)) return code;
  }
  return undefined;
}

export function parseSaudiLoadRequest(rawText: string): SaudiLoadRequest | null {
  const text = normalizeRefsText(rawText);
  if (text.length < 5) return null;
  const req: SaudiLoadRequest = {};
  req.typeCode = pickSaudiType(text);
  const area = text.match(new RegExp(`${NUM}\\s*(?:م2|م²|متر مربع|متر مساحه|sqm|m2|متر مربع)`));
  if (area) req.areaM2 = Number(area[1]);
  const units = text.match(new RegExp(`(?:عدد\\s*)?(?:${NUM})\\s*(?:عدادات|عداد|وحدات|وحدده|وحدة|شقق|شقة|units|meters)`));
  if (units) req.units = Number(units[1]);
  if (/(230|400)/.test(text)) req.system = "230/400";
  else if (/220/.test(text)) req.system = "220";
  if (/مركزي|central/.test(text) && /تكييف|تكييه|ac|air condition/.test(text)) req.acType = "central";
  else if (/سبليت|شباك|window|split/.test(text) && /تكييف|ac/.test(text)) req.acType = "unit";
  else if (/بدون تكييف|district cool|تبريد منطقه|تبريد منطقة/.test(text)) req.acType = "district";
  else if (/شتوي|تدفئه|تدفئة|winter|heating/.test(text)) req.acType = "winter";
  const h = text.match(new RegExp(`(?:ارتفاع|height)\\D{0,8}${NUM}\\s*(?:م\\b|متر)`));
  if (h) req.floorHeightM = Number(h[1]);
  const sp = text.match(new RegExp(`(?:احمال خاصه|أحمال خاصة|احمال اضافيه|أحمال إضافية|special loads?)\\D{0,12}${NUM}`));
  if (sp) req.specialKva = Number(sp[1]);
  const comArea = text.match(new RegExp(`(?:تجاري|commercial)\\D{0,20}${NUM}\\s*(?:م2|م²|متر مربع|sqm|m2)`));
  if (comArea && req.typeCode === 1) req.commercialAreaM2 = Number(comArea[1]);
  const hasSignal = req.typeCode !== undefined || req.areaM2 !== undefined || req.units !== undefined;
  const loadQuestion = /حمل|load|ك\.?ف\.?ا|kva|قاطع|عداد|أمبير|امبير/.test(text);
  // "فيلا C1 بمساحة 300م²" is a request even without the noun — type+area together
  if (!hasSignal || (!loadQuestion && !(req.typeCode !== undefined && req.areaM2 !== undefined))) return null;
  return req;
}

function saudiTypeByCode(code: number): (typeof SAUDI_TYPES)[number] | undefined {
  return SAUDI_TYPES.find((t) => t.code === `C${code}`);
}

function saudiDf(code: number): number | undefined {
  return SAUDI_DEMAND_FACTORS.find((r) => r.code === `C${code}`)?.df;
}

function interpLinear(x: number, x1: number, x2: number, y1: number, y2: number): number {
  if (x2 === x1) return y1;
  return y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);
}

/** Interpolated connected load (kVA) + CB (A) for C1/C2 from the area tables. */
function areaTableLookup(
  table: SaudiAreaTable,
  area: number
): { kva: number; cb: number | null; interpolated: boolean; rowArea: number; clampedMin?: boolean } | null {
  const rows = table.rows;
  const exact = rows.find((r) => r.area === area);
  if (exact) {
    return { kva: exact.kva, cb: exact.amp, interpolated: false, rowArea: exact.area };
  }
  if (area < rows[0].area) {
    // below the smallest printed slab → the minimum row applies (DPS minimum load)
    return { kva: rows[0].kva, cb: rows[0].amp, interpolated: false, rowArea: rows[0].area, clampedMin: true };
  }
  let lower: SaudiAreaTable["rows"][number] | null = null;
  let upper: SaudiAreaTable["rows"][number] | null = null;
  for (const r of rows) {
    if (r.area < area) lower = r;
    if (r.area > area && !upper) upper = r;
  }
  if (lower && upper) {
    const kva = interpLinear(area, lower.area, upper.area, lower.kva, upper.kva);
    // §12: "0.5 and above → 1, < 0.5 ignored"
    return { kva: Math.round(kva), cb: lower.amp, interpolated: true, rowArea: area };
  }
  return null;
}

function nextHigherCb(table: SaudiAreaTable, fromAmp: number): number | null {
  const amps = [...new Set(table.rows.map((r) => r.amp).filter((a): a is number => a !== null))].sort((a, b) => a - b);
  return amps.find((a) => a > fromAmp) ?? null;
}

const CIT_T3 = "[SEC DPS-01 — Estimation of Customer Load Guideline، Table 3، ص.17]";
const CIT_T4 = "[SEC DPS-01 — Estimation of Customer Load Guideline، Table 4، ص.18]";
const CIT_T5 = "[SEC DPS-01 — Estimation of Customer Load Guideline، Table 5، ص.19]";
const CIT_T6 = "[SEC DPS-01 — Estimation of Customer Load Guideline، Table 6، ص.20]";
const CIT_T11 = "[SEC DPS-01 — Estimation of Customer Load Guideline، Table 11، ص.32]";
const CIT_T12 = "[SEC DPS-01 — Estimation of Customer Load Guideline، Table 12، ص.33]";

export function computeSaudiLoad(req: SaudiLoadRequest): SaudiLoadResult {
  const steps: string[] = [];
  const checks: SaudiLoadResult["checks"] = [];
  const citations: string[] = [];
  const assumptions: string[] = [];
  const warnings: string[] = [];

  const code = req.typeCode;
  if (code === undefined) {
    return {
      ok: false,
      needInput: "حدد نوع المنشأة C1..C29 (سكني/تجاري/فندق/مسجد/مستشفى…)",
      steps, checks, citations, assumptions, warnings,
    };
  }
  const typeInfo = saudiTypeByCode(code);
  const typeName = typeInfo ? `${typeInfo.code}: ${typeInfo.name}` : `C${code}`;
  steps.push(`1) نوع المنشأة: ${typeName} (§6.3 — الصفحة ${typeInfo?.page ?? 10})`);
  citations.push(`[SEC DPS-01 — Estimation of Customer Load Guideline، §6.3 Facility Types، ص.${typeInfo?.page ?? 10}]`);

  const areaBased = code <= 17;
  const df = saudiDf(code);
  if (df === undefined) {
    return { ok: false, needInput: "معامل الطلب غير موجود لهذا النوع", steps, checks, citations, assumptions, warnings };
  }

  if (!areaBased) {
    // C18-C29 — Conventional Declared Load Method (§20) with the Table 8 minimum
    const t8 = SAUDI_DENSITY_TABLES.find((t) => t.id === "t8");
    const row = t8?.rows.find((r) => r.code === `C${code}`);
    if (!req.areaM2) {
      return {
        ok: false,
        needInput: `النوع ${typeName} يُقدَّر بطريقة الحمل المصرح (Conventional Declared Load Method — §20): يلزم إقرار العميل بنموذج SEC-LD بأسماء وقدرات المعدات؛ ولتطبيق الحد الأدنى يعطينا المساحة المغطاة`,
        steps, checks, citations, assumptions, warnings,
      };
    }
    const minKva = (req.areaM2 * (row?.va ?? 0)) / 1000;
    steps.push(`2) النوع غير مبني على المساحة — Declared Load Method (§20، ص.27): الحمل المصرح من نموذج SEC-LD هو الأساس`);
    steps.push(`3) الحد الأدنى (Table 8، ص.28): ${req.areaM2}م² × ${row?.va} VA/m² ÷ 1000 = ${minKva.toFixed(1)} kVA — الحمل المصرح يجب ألا يقل عنه`);
    citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §20 Declared Load Method، ص.27]");
    citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، Table 8، ص.28]");
    const dl = minKva * df;
    steps.push(`4) حمل الطلب الأدنى = ${minKva.toFixed(1)} × DF(${df}) = ${dl.toFixed(1)} kVA (Table 11)`);
    citations.push(CIT_T11);
    checks.push({ check: "minimum-load", pass: true, detail: `الحد الأدنى للحمل المتصل ${minKva.toFixed(1)} kVA عند ${req.areaM2}م²`, citation: "[SEC DPS-01، Table 8، ص.28]" });
    return {
      ok: true, typeCode: code, typeName, method: "declared-minimum",
      connectedKva: minKva, demandKva: dl, coincidentKva: null, cbAmp: null, df, cf: null,
      steps, checks, citations: [...new Set(citations)], assumptions, warnings,
    };
  }

  // ── Area-based types ──
  if (code >= 3) {
    // density method — pick the density table by AC scenario
    const scenario = req.acType === "district" ? "t9" : req.acType === "winter" ? "t10" : "t7";
    const table = SAUDI_DENSITY_TABLES.find((t) => t.id === scenario);
    const row = table?.rows.find((r) => r.code === `C${code}`);
    if (!row || !req.areaM2) {
      return {
        ok: false,
        needInput: req.areaM2 ? undefined : `يعطينا المساحة المغطاة (m²) للنوع ${typeName}`,
        steps, checks, citations, assumptions, warnings,
      };
    }
    const cl = (req.areaM2 * row.va) / 1000;
    steps.push(`2) طريقة كثافة الحمل (${table?.label} — ص.${table?.page}): ${req.areaM2}م² × ${row.va} VA/m² ÷ 1000 = ${cl.toFixed(2)} kVA`);
    citations.push(`[SEC DPS-01 — Estimation of Customer Load Guideline، Table ${scenario === "t9" ? 9 : scenario === "t10" ? 10 : 7}، ص.${table?.page}]`);
    if (req.acType === "district") assumptions.push("المساحة مفترضة بلا تكييف (District Cooling — Table 9) بشرط اتفاق موقَّع مع مزود التبريد (§24)");
    if (req.acType === "winter") assumptions.push("كثافات مناطق الذروة الشتوية Table 10 (تدفئة بدل تكييف)");
    let clFinal = cl;
    if (req.floorHeightM && req.floorHeightM > 3.5) {
      const extra = (req.floorHeightM - 3.5) * req.areaM2 * 30 / 1000;
      clFinal += extra;
      steps.push(`3) ارتفاع غير معتاد ${req.floorHeightM}م > 3.5م (§17، ص.24): حجم إضافي × 30 VA/m³ = +${extra.toFixed(2)} kVA`);
      citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §17 Abnormal Floor Height، ص.24]");
    }
    if (req.specialKva) {
      clFinal += req.specialKva;
      steps.push(`4) أحمال خاصة إضافية (§18، ص.25): +${req.specialKva} kVA`);
      citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §18 Special Loads، ص.25]");
    }
    const dl = clFinal * df;
    steps.push(`5) حمل الطلب = ${clFinal.toFixed(2)} × DF(C${code}=${df}) = ${dl.toFixed(2)} kVA (Table 11، ص.32)`);
    citations.push(CIT_T11);
    steps.push(`6) القاطع/العداد: أحجام القواطع مقننة من الشركة وتُحتسب على رتبة القاطع بالـKVA (§25، ص.31) — رتبة القاطع المقترحة تُختار من كتالوج المورد بما لا يقل عن ${dl.toFixed(1)} kVA`);
    citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §25 CB & Meter Sizes، ص.31]");
    checks.push({ check: "density-load", pass: true, detail: `الحمل المتصل ${clFinal.toFixed(2)} kVA / الطلب ${dl.toFixed(2)} kVA`, citation: `Table ${scenario === "t9" ? 9 : scenario === "t10" ? 10 : 7}` });
    return {
      ok: true, typeCode: code, typeName, method: "density",
      connectedKva: clFinal, demandKva: dl, coincidentKva: null, cbAmp: null, df, cf: null,
      steps, checks, citations: [...new Set(citations)], assumptions, warnings,
    };
  }

  // ── C1 / C2 — area tables with §12 interpolation ──
  const system = req.system ?? "230/400";
  const table = SAUDI_AREA_TABLES.find((t) =>
    code === 1 ? (system === "220" ? t.id === "t3" : t.id === "t4") : system === "220" ? t.id === "t5" : t.id === "t6"
  );
  if (!table) {
    return { ok: false, needInput: "نظام الجهد (220 أو 230/400)", steps, checks, citations, assumptions, warnings };
  }
  citations.push(`[SEC DPS-01 — Estimation of Customer Load Guideline، ${table.label}، ص.${table.page}]`);
  const citTable = table.id === "t3" ? CIT_T3 : table.id === "t4" ? CIT_T4 : table.id === "t5" ? CIT_T5 : CIT_T6;

  if (!req.areaM2) {
    return {
      ok: false,
      needInput: `يعطينا المساحة المغطاة للوحدة (m²) للنوع ${typeName} — ونظام الجهد إن كان 220V`,
      steps, checks, citations, assumptions, warnings,
    };
  }
  const maxArea = table.rows[table.rows.length - 1].area;
  const minDensities: Record<string, number> = { "1": 145, "2": 215 };

  let clKva = 0;
  let cbAmp: number | null = null;
  let usedBig = false;
  const lookup = areaTableLookup(table, req.areaM2);
  if (lookup) {
    clKva = lookup.kva;
    cbAmp = lookup.cb;
    if (lookup.clampedMin) {
      assumptions.push(`المساحة ${req.areaM2}م² أصغر من أول شريحة مطبوعة (${lookup.rowArea}م²) — أُسندت إلى الحمل الأدنى للشريحة الأولى`);
    } else if (lookup.interpolated) {
      steps.push(`2) ${table.label}: المساحة ${req.areaM2}م² وسيطة — استيفاء §12 (ص.21) ⇒ الحمل المتصل ${clKva} kVA والقاطع ${cbAmp}A`);
      citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §12 Intermediate Values، ص.21]");
    } else {
      steps.push(`2) ${table.label}: قراءة مباشرة عند ${req.areaM2}م² ⇒ الحمل المتصل ${clKva} kVA والقاطع ${cbAmp}A`);
    }
    steps.push(`   ${citTable}`);
  } else if (req.areaM2 > maxArea) {
    usedBig = true;
    const dens = minDensities[String(code)];
    clKva = (req.areaM2 * dens) / 1000;
    steps.push(`2) المساحة ${req.areaM2}م² تتجاوز حدود الجدول (${maxArea}م²) — §16 (ص.24): ${req.areaM2} × ${dens} VA/m² ÷ 1000 = ${clKva.toFixed(2)} kVA`);
    citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §16 Beyond Table Limits، ص.24]");
    assumptions.push(`كثافة §16 المستخدمة: ${dens} VA/m² (${code === 1 ? "سكني 145" : "تجاري 215"})`);
    cbAmp = null;
  }

  // §13 combined C1 + C2 building
  let combinedCl = 0;
  if (req.commercialAreaM2 && code === 1) {
    const comTable = SAUDI_AREA_TABLES.find((t) => (system === "220" ? t.id === "t5" : t.id === "t6"))!;
    const comLookup = areaTableLookup(comTable, req.commercialAreaM2);
    if (comLookup) {
      combinedCl = comLookup.kva;
      steps.push(`3) جزء تجاري ${req.commercialAreaM2}م² (${comTable.label}): +${combinedCl} kVA`);
      steps.push(`   الحمل المتصل الكلي = ${clKva} + ${combinedCl} = ${clKva + combinedCl} kVA (§13 — ص.22)`);
      citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §13 Combined Type Customer، ص.22]");
      clKva += combinedCl;
    }
  }

  // §17 abnormal height (C1/C2 as well)
  if (req.floorHeightM && req.floorHeightM > 3.5) {
    const extra = (req.floorHeightM - 3.5) * req.areaM2 * 30 / 1000;
    clKva += extra;
    steps.push(`4) ارتفاع ${req.floorHeightM}م > 3.5م (§17، ص.24): +${extra.toFixed(2)} kVA`);
    citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §17 Abnormal Floor Height، ص.24]");
  }

  // §14 central AC handling
  if (req.acType === "central" || req.acType === "unit") {
    if (req.acType === "central") {
      if (req.centralAcKva !== undefined) {
        const unitAcKva = (req.areaM2 * (code === 1 ? 100 : 150)) / 1000;
        if (req.centralAcKva > unitAcKva) {
          clKva = clKva - unitAcKva + req.centralAcKva;
          steps.push(`5) تكييف مركزي (§14، ص.22): حمل AC المضمّن = ${unitAcKva.toFixed(2)} kVA (السكني 100/التجاري 150 VA/m²) — يُطرح ويُضاف المصرح ${req.centralAcKva} kVA ⇒ ${clKva.toFixed(2)} kVA`);
          citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §14 Central AC، ص.22]");
        } else {
          steps.push(`5) تكييف مركزي مصرح (${req.centralAcKva} kVA) ≤ حمل AC المضمّن (${unitAcKva.toFixed(2)} kVA) — يُهمَل وفق §14`);
          citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §14 Central AC، ص.22]");
        }
      } else {
        assumptions.push("تكييف مركزي مذكور بلا حمل مصرح — الحمل المضمّن بالجداول يكفي (أعلن حمل AC المركزي لتطبيق §14 بدقة)");
        citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §14 Central AC، ص.22]");
      }
    }
  }

  // Demand + CB
  const dl = clKva * df;
  steps.push(`6) حمل الطلب DL = ${clKva.toFixed(2)} × DF(C${code}=${df}) = ${dl.toFixed(2)} kVA (Table 11، ص.32)`);
  citations.push(CIT_T11);

  if (cbAmp !== null) {
    // §14 compares the DEMAND CURRENT against the breaker rating (A vs A):
    // 230/400V ⇒ 3φ at 400V line-line; the 220V tables are phase-phase 220V
    const demandAmps = system === "230/400" ? (dl * 1000) / (Math.sqrt(3) * 400) : (dl * 1000) / 220;
    if (demandAmps > cbAmp) {
      const nextCb = nextHigherCb(table, cbAmp);
      if (nextCb) {
        steps.push(`7) تيار الطلب ${demandAmps.toFixed(0)}A (${dl.toFixed(2)} kVA) > رتبة القاطع ${cbAmp}A — يُرفع للقاطع الأكبر التالي ${nextCb}A وفق §14/§15`);
        cbAmp = nextCb;
      } else {
        warnings.push(`تيار الطلب ${demandAmps.toFixed(0)}A يتجاوز أكبر قاطع بالجدول (${cbAmp}A) — يلزم تمديد من الجهد المتوسط أو أكثر من تغذية`);
      }
    } else {
      steps.push(`7) القاطع ${cbAmp}A كافٍ لتيار الطلب ${demandAmps.toFixed(0)}A (${dl.toFixed(2)} kVA) (§26: قاطع 30A يكفي عادة للخدمات العامة الصغيرة)`);
    }
    checks.push({ check: "breaker-capacity", pass: true, detail: `رتبة القاطع ${cbAmp}A لتيار الطلب ${demandAmps.toFixed(0)}A (${dl.toFixed(2)} kVA)`, citation: citTable });
  } else if (usedBig) {
    const ladder = [...new Set(table.rows.map((r) => r.amp).filter((a): a is number => a !== null))].sort((a, b) => a - b);
    const amps3 = (dl * 1000) / (Math.sqrt(3) * 400);
    const suggested = ladder.find((a) => a >= amps3);
    if (suggested) {
      steps.push(`7) الحمل ${amps3.toFixed(0)}A (3×400V) — رتبة القاطع القياسية المقترحة من سلّم الجدول: ${suggested}A`);
      cbAmp = suggested;
      assumptions.push("رتبة القاطع المقترحة من سلّم رتب الجدول نفسه — الاعتماد النهائي وفق تقييس الشركة §25");
    }
  }

  // Multi-unit coincident demand (Table 12 + §29)
  let cf: number | null = null;
  let cdl: number | null = null;
  if (req.units && req.units > 1) {
    const n = Math.min(Math.round(req.units), 99);
    cf = SAUDI_COINCIDENCE[n] ?? SAUDI_COINCIDENCE[99] ?? null;
    const tdl = dl * req.units;
    cdl = cf !== null ? tdl * cf : null;
    steps.push(`8) ${req.units} وحدة/عدادات: TDL = ${dl.toFixed(2)} × ${req.units} = ${tdl.toFixed(1)} kVA؛ CF(${n}) = ${cf} (Table 12، ص.33) ⇒ CDL = ${cdl?.toFixed(1)} kVA`);
    citations.push(CIT_T12);
    citations.push("[SEC DPS-01 — Estimation of Customer Load Guideline، §29 Step-by-step CDL، ص.36]");
    checks.push({ check: "coincident-demand", pass: true, detail: `CDL = ${cdl?.toFixed(1)} kVA عند ${n} عداد`, citation: CIT_T12 });
    if (req.units > 99) warnings.push(`عدد العدادات ${req.units} > 99 — استُخدم CF(99) = ${SAUDI_COINCIDENCE[99]}`);
  }

  steps.push(`✅ النتيجة: ${typeName} @ ${req.areaM2}م² (${system}V) — الحمل المتصل ${clKva.toFixed(2)} kVA، حمل الطلب ${dl.toFixed(2)} kVA${cdl !== null ? `، حمل التزامان ${cdl.toFixed(1)} kVA` : ""}${cbAmp ? `، قاطع ${cbAmp}A` : ""}`);
  checks.unshift({ check: "connected-load", pass: true, detail: `CL = ${clKva.toFixed(2)} kVA (من ${lookup ? "الجداول/الاستيفاء" : "كثافة §16"})`, citation: citTable });
  if (df === undefined) warnings.push("معامل الطلب مفقود");

  return {
    ok: true, typeCode: code, typeName, method: lookup ? "area-tables" : "density",
    connectedKva: clKva, demandKva: dl, coincidentKva: cdl, cbAmp, df, cf,
    steps, checks, citations: [...new Set(citations)], assumptions, warnings,
  };
}

export function formatSaudiSheet(result: SaudiLoadResult): string {
  const lines: string[] = [];
  if (!result.ok) {
    lines.push(`🧮 SAUDI-CALC — أحتاج معطى: ${result.needInput ?? "غير محدد"}`);
    return lines.join("\n");
  }
  lines.push("🧮 SAUDI-CALC — ورقة حساب تقدير الأحمال وفق SEC DPS-01 (حُسبت حتميًا من قاعدة المعرفة، استخدم أرقامها كما هي):");
  for (const s of result.steps) lines.push(`- ${s}`);
  for (const a of result.assumptions) lines.push(`- ⚠️ افتراض: ${a}`);
  for (const w of result.warnings) lines.push(`- ⛔ تنبيه: ${w}`);
  if (result.citations.length) lines.push(`- سطور الاستشهاد: ${result.citations.join(" ")}`);
  return lines.join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// ABB TRANSFORMER SELECTION ENGINE
// ════════════════════════════════════════════════════════════════════════════

export interface AbbRequest {
  kva?: number;
  hvKv?: number;
  lvV?: number;
  kind?: "oil" | "dry" | "resibloc" | "any";
}

export interface AbbCandidate {
  kind: "oil" | "dry-loss" | "resibloc-loss" | "ip00-dims" | "large";
  kva: number;
  hvLabel: string;
  lvLabel: string;
  vector?: string;
  zk?: number;
  nllW?: number;
  llW?: number;
  noiseDb?: number;
  tank?: string;
  dims?: string;
  weightKg?: number | null;
  page: number;
  table: string;
  citation: string;
  citationEn: string;
  flagged?: string;
}

export function parseAbbRequest(rawText: string): AbbRequest | null {
  const text = normalizeRefsText(rawText);
  if (text.length < 5) return null;
  const req: AbbRequest = {};
  const kva = text.match(new RegExp(`${NUM}\\s*(?:kva|ك\\.?ف\\.?ا|كيلو ?فولت ?امبير|كيلو فولت أمبير)`));
  if (kva) req.kva = Number(kva[1]);
  const kvPair = text.match(new RegExp(`${NUM}\\s*/\\s*${NUM}\\s*(?:kv|ك\\.?ف)`));
  if (kvPair) {
    req.hvKv = Number(kvPair[1]);
    req.lvV = Number(kvPair[2]) < 1.5 ? Number(kvPair[2]) * 1000 : Number(kvPair[2]);
  } else {
    const kv = text.match(new RegExp(`${NUM}\\s*(?:kv|ك\\.?ف(?!\\.?ا))`));
    if (kv) req.hvKv = Number(kv[1]);
    const lv = text.match(new RegExp(`${NUM}\\s*(?:فولت|volt)\\b`));
    if (lv && Number(lv[1]) >= 100 && Number(lv[1]) <= 1000) req.lvV = Number(lv[1]);
  }
  if (/جافه|جافة|dry|cast|ريزين|resibloc/.test(text)) req.kind = /ريزين|resibloc/.test(text) ? "resibloc" : "dry";
  else if (/زيتيه|زيتية|oil/.test(text)) req.kind = "oil";
  const hasSignal = req.kva !== undefined || (req.hvKv !== undefined && /محول|transformer|abb/.test(text));
  if (!hasSignal) return null;
  return req;
}

function kvMatch(hv1: number, hv2: number, kv: number | undefined): boolean {
  if (kv === undefined) return true;
  const v = kv * 1000;
  // 12% — the old catalogue prints 10kV/10.5kV designs for the 11kV class;
  // the printed value is always shown verbatim (never silently mapped)
  return Math.abs(hv1 - v) / v <= 0.12 || (hv2 > 0 && Math.abs(hv2 - v) / v <= 0.12);
}

function lvMatch(lv1: number, v: number | undefined): boolean {
  if (v === undefined) return true;
  return Math.abs(lv1 - v) / v <= 0.03;
}

export function selectAbbTransformer(req: AbbRequest): AbbCandidate[] {
  const out: AbbCandidate[] = [];
  if (req.kind === "dry" || req.kind === "resibloc" || req.kind === "any") {
    const wanted = req.kind === "resibloc" ? "resibloc" : undefined;
    const rows = ABB_LOSS_ITEMS.filter((r) => (wanted ? r.section === wanted : true))
      .filter((r) => (req.kva ? r.kva === req.kva : true));
    for (const r of rows.slice(0, 6)) {
      out.push({
        kind: r.section === "resibloc" ? "resibloc-loss" : "dry-loss",
        kva: r.kva,
        hvLabel: r.table.includes("12 kV") ? "≤12 kV" : r.table.includes("24 kV") ? "≤24 kV" : "≤36 kV",
        lvLabel: "— (جافة)",
        zk: r.zk,
        nllW: r.nllW,
        llW: r.ll120W,
        noiseDb: r.soundDb,
        page: r.page,
        table: r.table,
        citation: `[ABB — Distribution Transformers Catalogue، ${r.table}، ص.${r.page}]`,
        citationEn: `[ABB — Distribution Transformers Catalogue, ${r.table}, p.${r.page}]`,
      });
    }
    if (req.kind !== "any") return out;
  }
  if (req.kind === "oil" || req.kind === "any" || req.kind === undefined) {
    const exact = ABB_ITEMS.filter(
      (it) => (req.kva ? it.kva === req.kva : true) && kvMatch(it.hv1, it.hv2, req.hvKv) && lvMatch(it.lv1, req.lvV)
    );
    const pool: AbbItem[] = exact.length ? exact : ABB_ITEMS.filter((it) => (req.kva ? Math.abs(it.kva - (req.kva ?? 0)) / (req.kva ?? 1) <= 0.15 : true) && kvMatch(it.hv1, it.hv2, req.hvKv) && lvMatch(it.lv1, req.lvV));
    const ranked: AbbItem[] = [...pool].sort((a, b) => {
      if (req.kva && a.kva !== b.kva) return Math.abs(a.kva - req.kva) - Math.abs(b.kva - req.kva);
      if (req.hvKv) {
        const da = Math.abs(a.hv1 - req.hvKv * 1000);
        const db = Math.abs(b.hv1 - req.hvKv * 1000);
        if (da !== db) return da - db;
      }
      return a.nllW - b.nllW;
    });
    for (const it of ranked.slice(0, 4)) {
      const flag = ABB_FLAGS.find((f) => f.page === it.page && f.kva === it.kva && f.hv1 === it.hv1);
      const sectionLabel = it.section === "small" ? "Small Distribution Transformers" : "Medium Distribution Transformers";
      out.push({
        kind: "oil",
        kva: it.kva,
        hvLabel: `${it.hv1}${it.hv2 ? ` / ${it.hv2}` : ""} V`,
        lvLabel: `${it.lv1} V`,
        vector: it.vector,
        zk: it.zk,
        nllW: it.nllW,
        llW: it.llW,
        noiseDb: it.noiseDb,
        tank: it.tank === "hermetic" ? "▲ مختومة (هرميتيك)" : "● موسّع زيت",
        weightKg: it.totalKg,
        dims: `${it.lenMm}×${it.widMm}×${it.heiMm}مم${it.wheelMm ? `، قاعدة عجلات ${it.wheelMm}مم` : ""}`,
        page: it.page,
        table: sectionLabel,
        citation: `[ABB — Distribution Transformers Catalogue، ${sectionLabel}، ص.${it.page}]`,
        citationEn: `[ABB — Distribution Transformers Catalogue, ${sectionLabel}, p.${it.page}]`,
        flagged: flag?.msg,
      });
    }
  }
  return out;
}

export function formatAbbSheet(cands: AbbCandidate[], req: AbbRequest): string {
  const lines: string[] = [];
  if (!cands.length) {
    lines.push("🧮 ABB-SELECT — لا يوجد بند مطابق بالكتالوج للمعطيات المطلوبة؛ هذه عينات الكتالوج فقط (Note: الجدول عينة صغيرة من التصاميم المتاحة — التصاميم الأخرى تُطلب من ABB)");
    return lines.join("\n");
  }
  lines.push("🧮 ABB-SELECT — البنود المطابقة من كتالوج ABB (حُددت حتميًا من قاعدة المعرفة — البند بكل بياناته المطبوعة):");
  cands.forEach((c, i) => {
    const parts = [
      `${c.kva} kVA`,
      `HV ${c.hvLabel}`,
      c.lvLabel !== "—" ? `LV ${c.lvLabel}` : "",
      c.vector ? `مجموعة المتجهات ${c.vector}` : "",
      c.zk !== undefined ? `المعاوقة ${c.zk}%` : "",
      c.nllW !== undefined ? `فقد لا حمل ${c.nllW}W` : "",
      c.llW !== undefined ? `فقد الحمل ${c.llW}W` : "",
      c.noiseDb !== undefined ? `الصوت ${c.noiseDb}dB` : "",
      c.tank ?? "",
      c.dims ?? "",
      c.weightKg ? `${c.weightKg}كجم` : "",
    ].filter(Boolean);
    lines.push(`- [${i + 1}] ${parts.join(" | ")} — ${c.citation}${c.flagged ? ` ⛔ ${c.flagged}` : ""}`);
  });
  lines.push("- ملاحظة الكتالوج: الجداول تعرض عينة صغيرة من التصاميم والقدرات المتوفرة — التصاميم الأخرى تُصنع عند الطلب.");
  lines.push(`- سطور الاستشهاد: ${cands.slice(0, 2).map((c) => c.citation).join(" ")}`);
  if (req.hvKv && req.lvV) lines.push(`- نسبة التحويل المطلوبة ${req.hvKv}kV/${req.lvV}V — تحقق من مطابقة جهود البند أعلاه قبل الاعتماد.`);
  return lines.join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// SCHNEIDER BREAKER SELECTION ENGINE
// ════════════════════════════════════════════════════════════════════════════

export interface BreakerRequest {
  amps?: number;
  poles?: 1 | 3 | 4;
  icuKa?: number;
  family?: string;
  kind?: "acb" | "mccb" | "mcb" | "rccb" | "contactor" | "vfd" | "accessory" | "any";
  maxPrice?: number;
}

const MTZ_RATING: Record<string, number> = {
  "06": 630, "08": 800, "10": 1000, "12": 1250, "16": 1600,
  "20": 2000, "25": 2500, "32": 3200, "40": 4000,
};

/** Mechanical decode of the printed Product-ID rating (verified against the
 *  description column "630 A" in the price list itself). */
function itemRating(it: SchneiderItem): number | null {
  if (it.ratingA !== null) return it.ratingA;
  const m = it.ref.match(/^(?:MTZ1|MTZ2)(\d{2})_/);
  if (m && MTZ_RATING[m[1]]) return MTZ_RATING[m[1]];
  const m2 = it.ref.match(/^(?:NT|NW|ENW1|ENW2)(\d{2})/);
  if (m2 && MTZ_RATING[m2[1]]) return MTZ_RATING[m2[1]];
  return null;
}

function itemFamily(it: SchneiderItem): string {
  if (/^MTZ1/.test(it.ref)) return "Masterpact MTZ1 Active";
  if (/^MTZ2/.test(it.ref)) return "Masterpact MTZ2 Active";
  if (/^(TAB|TEB|TAC|TAD|TAE|TAF|TEC|TED|TEE|TEF)/.test(it.ref)) return "Masterpact MTZ1 (MyPact)";
  if (/^(WK|WA|WE)/.test(it.ref)) return "Masterpact MTZ2 (MyPact)";
  if (/^NT/.test(it.ref)) return "Masterpact NT";
  if (/^NW/.test(it.ref)) return "Masterpact NW";
  if (/^ENW1/.test(it.ref)) return "Easypact NW1";
  if (/^ENW2/.test(it.ref)) return "Easypact NW2";
  if (/^MVS/.test(it.ref)) return "Easypact MVS";
  if (/^G12/.test(it.ref)) return "GoPact 125";
  if (/^G20/.test(it.ref)) return "GoPact 200";
  if (/^G25/.test(it.ref)) return "GoPact 250";
  if (/^G40/.test(it.ref)) return "GoPact 400";
  if (/^G80/.test(it.ref)) return "GoPact 800";
  if (/^R9R/.test(it.ref)) return "Resi9";
  if (/^A9/.test(it.ref)) return "Acti9";
  if (/^LC1D/.test(it.ref)) return "TeSys LC1D Contactor";
  if (/^LR2K/.test(it.ref)) return "TeSys LR2K Relay";
  if (/^GV2/.test(it.ref)) return "TeSys GV2 Starter";
  if (/^ATV/.test(it.ref)) return "Altivar ATV Drive";
  if (/^XB7/.test(it.ref)) return "Harmony XB7";
  if (/^TM3/.test(it.ref)) return "Modicon TM3";
  if (/^DM[13]/.test(it.ref)) return "GoLogic Meter";
  return it.part;
}

function itemKind(it: SchneiderItem): BreakerRequest["kind"] {
  const fam = itemFamily(it);
  if (/MTZ|NT|NW|ENW|MVS/.test(fam)) return "acb";
  if (/GoPact/.test(fam)) return "mccb";
  if (/Resi9/.test(fam)) return "rccb";
  if (/Acti9/.test(fam)) return "mcb";
  if (/Contactor|Relay|Starter/.test(fam)) return "contactor";
  if (/Drive/.test(fam)) return "vfd";
  if (/XB7|TM3|Meter/.test(fam)) return "accessory";
  return "any";
}

export function parseBreakerRequest(rawText: string): BreakerRequest | null {
  const text = normalizeRefsText(rawText);
  if (text.length < 4) return null;
  const req: BreakerRequest = {};
  const amp = text.match(new RegExp(`${NUM}\\s*(?:امبير|أمبير|amp\\b|amps?\\b|a\\b)`));
  if (amp) req.amps = Number(amp[1]);
  if (/3\s*p|ثلاثي|ثلاث اطوار|ثلاثه اطوار/.test(text)) req.poles = 3;
  else if (/4\s*p|رباعي|رباعي الاطوار|اربع اطوار/.test(text)) req.poles = 4;
  const icu = text.match(new RegExp(`${NUM}\\s*(?:ka|كيلو امبير|كيلو أمبير|سعه قطع|قدرة قطع)`));
  if (icu) req.icuKa = Number(icu[1]);
  if (/هوائي|هوائية|acb|air circuit|ماستر|masterpact|mtz|nw\b|nt\b|enw|mvs/.test(text)) req.kind = "acb";
  else if (/مقولب|mccb|moulded|gopact|go pact|g12|g20|g25|g40|g80/.test(text)) req.kind = "mccb";
  else if (/كونتاكتور|contactor|lc1|tesys|تلسيس|اتصال/.test(text)) req.kind = "contactor";
  else if (/انفرتر|inverter|vfd|atv|altivar/.test(text)) req.kind = "vfd";
  else if (/rcd|rccb|rcbo|resi9|تفريغ ارضي|تسريب/.test(text)) req.kind = "rccb";
  else if (/mcb|acti9|ic60|قاطع مصغره|مصغرة|قاطع حراري/.test(text)) req.kind = "mcb";
  else if (/ملحقات|accessor|منظوره|rotary|shunt|undervoltage|mn\b|mx\b|xf\b|mch/.test(text)) req.kind = "accessory";
  const price = text.match(new RegExp(`(?:سعر|أقصى سعر|budget|max price)\\D{0,8}${NUM}`));
  if (price) req.maxPrice = Number(price[1]);
  const hasSignal = req.amps !== undefined || req.icuKa !== undefined || req.kind !== undefined
    || /شنايدر|schneider|قاطع|breaker|قائمة اسعار|price list|contactor|انفرتر/.test(text);
  if (!hasSignal) return null;
  return req;
}

export interface BreakerCandidate extends SchneiderItem {
  family: string;
  rating: number | null;
}

/** Mounting parts that must never compete with real devices on price
 *  (they are chassis/fixing/interlocking PARTS, printed as separate lines). */
const NON_DEVICE_RE = /chassis|chaasis|fixture|interlock|interlocking|set of|adaptation/i;

export function selectBreaker(req: BreakerRequest, limit = 4): BreakerCandidate[] {
  let pool = SCHNEIDER_ITEMS.slice();
  if (req.kind && req.kind !== "any") {
    const isDeviceKind = req.kind !== "accessory";
    pool = pool.filter((it) => itemKind(it) === req.kind && (!isDeviceKind || !NON_DEVICE_RE.test(it.desc)));
  }
  if (req.poles) {
    const byPoles = pool.filter((it) => it.poles === req.poles);
    if (byPoles.length) pool = byPoles;
  }
  if (req.amps !== undefined) {
    // STRICT: the demanded current must be covered by the item's printed
    // rating — when nothing in the filtered pool covers it, answer honestly
    // with an empty list (never silently serve a smaller breaker)
    const rated = pool
      .map((it) => ({ it, rating: itemRating(it) }))
      .filter((x): x is { it: SchneiderItem; rating: number } => x.rating !== null && x.rating >= req.amps!)
      .sort((a, b) => a.rating - b.rating);
    if (!rated.length) return [];
    const smallest = rated[0].rating;
    pool = rated.filter((x) => x.rating <= smallest).map((x) => x.it);
  }
  if (req.icuKa !== undefined) {
    const byIcu = pool.filter((it) => (it.auxA !== null && it.auxA >= req.icuKa!) || (it.icuFromDesc !== null && it.icuFromDesc >= req.icuKa!));
    if (byIcu.length) pool = byIcu;
  }
  const ranked = [...pool].sort((a, b) => a.price - b.price);
  return ranked.slice(0, limit).map((it) => ({ ...it, family: itemFamily(it), rating: itemRating(it) }));
}

export function formatBreakerSheet(cands: BreakerCandidate[], req: BreakerRequest): string {
  const lines: string[] = [];
  if (!cands.length) {
    lines.push("🧮 BRK-SELECT — لا يوجد بند مطابق في قائمة الأسعار للمعطيات المطلوبة؛ عدّل التخصيص أو راجع الصفحات المسترجعة");
    return lines.join("\n");
  }
  lines.push("🧮 BRK-SELECT — البنود المطابقة من قائمة أسعار شنايدر مصر 2026 (حُددت حتميًا من قاعدة المعرفة — Product ID + السعر):");
  cands.forEach((c, i) => {
    const specs = [
      c.rating ? `${c.rating}A` : "",
      c.poles ? `${c.poles}P` : "",
      c.auxA ? `Icu ${c.auxA}kA` : "",
      c.desc ? c.desc : "",
    ].filter(Boolean).join(" | ");
    lines.push(`- [${i + 1}] Product ID: ${c.ref} — ${c.family} — السعر ${c.price.toLocaleString("en-US")} EGP (غير شامل الضريبة) — ص.${c.page} — ${specs}`);
  });
  lines.push(`- سطور الاستشهاد: ${cands.slice(0, 2).map((c) => `[Schneider Electric Egypt — Breakers & Switches Price List 2026، ${c.part}، ص.${c.page}، Product ID: ${c.ref}]`).join(" ")}`);
  lines.push("- ملاحظة القائمة: جميع الأسعار بالجنيه المصري غير شاملة الضرائب — قائمة Version 1 - Feb 2026؛ وتكوينات أخرى عبر myPact (config.schneider-electric.com).");
  if (req.amps !== undefined) lines.push(`- الاختيار مبني على تيار ${req.amps}A ⇒ أصغر رتبة قياسية تغطيه من القائمة`);
  return lines.join("\n");
}

/** Cross-link: the Saudi engine's demand current → the breaker catalogue. */
function saudiDemandAmps(result: SaudiLoadResult): number | null {
  if (!result.ok || result.demandKva === undefined || result.demandKva <= 0) return null;
  return (result.demandKva * 1000) / (Math.sqrt(3) * 400);
}

// ─── Numeric verification against the KBs (±0.5% contract) ──────────────────

export interface RefsVerifyResult {
  claimed: number;
  matched: number | null;
  context: string | null;
  deviationPct: number | null;
  verified: boolean | null;
  tolerancePct: number;
}

function collectNumbers(): Array<{ doc: string; value: number; ctx: string }> {
  const out: Array<{ doc: string; value: number; ctx: string }> = [];
  for (const t of SAUDI_AREA_TABLES) {
    for (const r of t.rows) {
      out.push({ doc: "saudi", value: r.kva, ctx: `${t.label}: ${r.area}m² → ${r.kva}kVA` });
      if (r.amp) out.push({ doc: "saudi", value: r.amp, ctx: `${t.label}: ${r.area}m² → CB ${r.amp}A` });
    }
  }
  for (const t of SAUDI_DENSITY_TABLES) for (const r of t.rows) out.push({ doc: "saudi", value: r.va, ctx: `${t.label}: ${r.code} → ${r.va} VA/m²` });
  for (const r of SAUDI_DEMAND_FACTORS) out.push({ doc: "saudi", value: r.df, ctx: `Table 11: ${r.code} DF=${r.df}` });
  for (let n = 1; n <= 99; n++) out.push({ doc: "saudi", value: SAUDI_COINCIDENCE[n] ?? 0, ctx: `Table 12: CF(${n})` });
  for (const it of ABB_ITEMS) {
    out.push({ doc: "abb", value: it.nllW, ctx: `ABB ${it.kva}kVA ${it.hv1}V NLL` });
    out.push({ doc: "abb", value: it.llW, ctx: `ABB ${it.kva}kVA ${it.hv1}V LL` });
    out.push({ doc: "abb", value: it.zk, ctx: `ABB ${it.kva}kVA Zk%` });
    out.push({ doc: "abb", value: it.totalKg, ctx: `ABB ${it.kva}kVA weight` });
  }
  for (const it of SCHNEIDER_ITEMS) out.push({ doc: "schneider", value: it.price, ctx: `${it.ref} price` });
  return out;
}

let NUMBERS_CACHE: Array<{ doc: string; value: number; ctx: string }> | null = null;

export function verifyRefsNumber(claimed: number, tolerancePct = 0.5): RefsVerifyResult {
  const base: RefsVerifyResult = { claimed, matched: null, context: null, deviationPct: null, verified: null, tolerancePct };
  if (!Number.isFinite(claimed)) return base;
  if (!NUMBERS_CACHE) NUMBERS_CACHE = collectNumbers();
  let best: { value: number; ctx: string } | null = null;
  for (const n of NUMBERS_CACHE) {
    const dist = Math.abs(n.value - claimed);
    if (best === null || dist < Math.abs(best.value - claimed)) best = { value: n.value, ctx: n.ctx };
    if (dist === 0) break;
  }
  if (!best) return base;
  const denominator = Math.abs(best.value);
  if (denominator > 1e-12) {
    const deviationPct = (Math.abs(claimed - best.value) / denominator) * 100;
    return { ...base, matched: best.value, context: best.ctx, deviationPct: Math.round(deviationPct * 100) / 100, verified: deviationPct <= tolerancePct };
  }
  return { ...base, matched: best.value, context: best.ctx, deviationPct: claimed === best.value ? 0 : null, verified: claimed === best.value };
}

// ─── Prompt blocks (skillnet static sections) ───────────────────────────────

const SAUDI_CORE_AR = `

🇸🇦 نواة خبير الكود السعودي DPS-01 (SEC — Distribution Planning Standard: Estimation of Customer Load Guideline, Rev.02 2015):
أنت خبير في تقدير أحمال العملاء (الحمل المتصل/حمل الطلب/حمل التزامان) وفق هذه الوثيقة، وكل رقم يجب أن يثبت بجدولها وبنْدها.
🧭 البروتوكول: (1) حدد نوع المنشأة C1..C29 من الاستخدام الفعلي (§6.2)؛ (2) C1/C2 ⇒ جداول المساحات 3-6 مع استيفاء §12 للمساحات الوسيطة (القاطع من الشريحة الصحيحة)، وما تجاوز حدود الجدول ⇒ §16 بكثافة 145/215 VA/m²؛ (3) C3-C17 ⇒ كثافات Table 7، وبلا تكييف (District Cooling) ⇒ Table 9، ومناطق شتوية ⇒ Table 10، ومشاريع تطوير ⇒ Table 8؛ (4) C18-C29 ⇒ طريقة الحمل المصرح SEC-LD مع الحد الأدنى من Table 8؛ (5) حمل الطلب = الحمل المتصل × DF من Table 11؛ (6) لعدد عدادات: CDL = TDL × CF(N) من Table 12 وفق خطوات §29؛ (7) تعديلات: تكييف مركزي §14 (طرح 100/150 VA/m² وإضافة المصرح)، ارتفاع >3.5م §17 (+30 VA/m³ للأحجام الإضافية)، أحمال خاصة §18؛ (8) القاطع/العداد: مقننون من الشركة وتُحتسب الرسوم على رتبة القاطع بالـKVA (§25-26).
🚫 عقد الأمانة: لا تنسب رقمًا للـDPS-01 إلا إن كان مسترجعًا من قاعدة المعرفة في السياق؛ اذكر الافتراضات (نظام الجهد 230/400 الافتراضي، معامل قدرة، نظام 3 أطوار)؛ واستشهد بالصيغة: [SEC DPS-01 — Estimation of Customer Load Guideline، <Table/Section>، ص.N] في نهاية الرد.`;

const SAUDI_CORE_EN = `

🇸🇦 SAUDI DPS-01 EXPERT CORE (SEC Distribution Planning Standard — Estimation of Customer Load Guideline, Rev.02 2015):
You are an expert in estimating customer loads (connected/demand/coincident) per this standard; every number must be defended by its table and clause.
Protocol: (1) determine facility type C1..C29 by actual use (§6.2); (2) C1/C2 ⇒ area tables 3-6 with §12 interpolation for intermediate areas, beyond limits ⇒ §16 at 145/215 VA/m²; (3) C3-C17 ⇒ Table 7 densities, district-cooling ⇒ Table 9, winter-peak ⇒ Table 10, development projects ⇒ Table 8; (4) C18-C29 ⇒ Declared Load Method (SEC-LD) with Table 8 minimums; (5) Demand = Connected × DF (Table 11); (6) N meters ⇒ CDL = TDL × CF(N) (Table 12, §29 steps); (7) adjustments: central AC §14 (subtract 100/150 VA/m², add declared), height >3.5m §17 (+30 VA/m³ per m³), special loads §18; (8) breaker/meter sizes are SEC-standardized and charged on the CB kVA rating (§25-26).
Honesty contract: never attribute a number to DPS-01 unless retrieved from the knowledge base in context; state assumptions (default 230/400V, 3-phase); cite as [SEC DPS-01 — Estimation of Customer Load Guideline, <Table/Section>, p.N] at the end.`;

const SAUDI_QUICK_AR = `

🇸🇦 نواة DPS-01: أي سؤال أحمال سعودي = نوع المنشأة → جدول المساحات (استيفاء §12) أو كثافة VA/m² → DF (Table 11) → CF(N) للعدادات (Table 12) → تعديلات §14/§17/§18 → القاطع المُقنن — اعتمد أرقام SAUDI-CALC حرفيًا واستشهد بـ[SEC DPS-01 — Estimation of Customer Load Guideline، …، ص.N] نهاية الرد.`;

const SAUDI_QUICK_EN = `

🇸🇦 DPS-01 core: Saudi load question = facility type → area tables (§12 interpolation) or VA/m² density → DF (Table 11) → CF(N) for meters (Table 12) → §14/§17/§18 adjustments → standardized CB — adopt SAUDI-CALC numbers verbatim and cite [SEC DPS-01 — Estimation of Customer Load Guideline, …, p.N] at the end.`;

const ABB_CORE_AR = `

⚡ نواة خبير محولات ABB (ABB — Distribution Transformers Catalogue):
أنت خبير في اختيار المحولات من هذا الكتالوج: زيتية (صغيرة ≤250kVA / متوسطة ≤2000kVA / كبيرة حتى 72.5kV / أحادية الطور ≤100kVA) وجافة (Vacuum Cast Coil وRESIBLOC حتى 30MVA) وتطبيقات خاصة (Pad-Mount، VSD، Reactors، Boosterformers).
🧭 البروتوكول: (1) اجمع القدرة (kVA)، جهود HV/LV، النوع (زيتي/جاف/RESIBLOC)، ومنطقة التركيب (داخل/خارج، حرارة، رطوبة، خطر حريق)؛ (2) حدد البند المطابق من قاعدة المعرفة بكل بياناته المطبوعة: القدرة، HV1/HV2/LV1، مجموعة المتجهات (Dyn11/Yzn5…)، المعاوقة %، فقد لا حمل، فقد الحمل، مستوى الصوت، نوع الخزان (▲ مختومة هرميتيك / ● موسّع زيت)، الأوزان والأبعاد؛ (3) للجافة: جداول الفواقد عند 120°C/75°C ونظام الجهد (12/24/36kV) وأبعاد IP00؛ (4) اعرض بدائل قريبة عند عدم التطابق التام مع الإشارة الصادقة إلى ذلك؛ (5) القيمة المشكوك فيها مطبوعًا تأتي معلَّمة بالتحذير (abbFlags) — انقل التحذير ولا تعتمدها.
🚫 لا تنسب بندًا أو قيمة للكتالوج إلا إن كانت مسترجعة فعلاً — الجداول "عينة صغيرة من التصاميم المتاحة" والتصاميم الأخرى تُصنع عند الطلب. الاستشهاد: [ABB — Distribution Transformers Catalogue، <Section>، ص.N].`;

const ABB_CORE_EN = `

⚡ ABB TRANSFORMERS EXPERT CORE (ABB — Distribution Transformers Catalogue):
You are an expert in selecting transformers from this catalogue: oil (small ≤250kVA / medium ≤2000kVA / large to 72.5kV / single-phase ≤100kVA), dry (Vacuum Cast Coil & RESIBLOC to 30MVA) and special applications (Pad-Mount, VSD, Reactors, Boosterformers).
Protocol: (1) collect kVA, HV/LV voltages, type (oil/dry/RESIBLOC), installation context; (2) identify the matching catalogue item with ALL printed data: kVA, HV1/HV2/LV1, vector group, impedance %, no-load loss, load loss, noise, tank type (▲ hermetic / ● conservator), weights and dimensions; (3) dry units: loss tables at 120°C/75°C per voltage system (12/24/36kV) + IP00 dimensions; (4) present near alternatives honestly when exact match is absent; (5) suspected print errors arrive flagged (abbFlags) — relay the warning.
Never attribute an item to the catalogue unless retrieved from the knowledge base — the tables are "a small sample of available designs". Cite: [ABB — Distribution Transformers Catalogue, <Section>, p.N].`;

const ABB_QUICK_AR = `

⚡ نواة ABB: أي سؤال محولات = القدرة والجهود والنوع → حدد البند من قاعدة المعرفة بكل بياناته (متجهات/معاوقة/فواقد/وزن/خزان) → أظهر البدائل بصدق — اعتمد أرقام ABB-SELECT حرفيًا واستشهد بـ[ABB — Distribution Transformers Catalogue، …، ص.N] نهاية الرد.`;

const ABB_QUICK_EN = `

⚡ ABB core: transformer question = kVA/voltages/type → pick the KB item with all printed data (vector/impedance/losses/weight/tank) → show alternatives honestly — adopt ABB-SELECT numbers verbatim and cite [ABB — Distribution Transformers Catalogue, …, p.N] at the end.`;

const BRK_CORE_AR = `

🔌 نواة خبير قواطع شنايدر (Schneider Electric Egypt — Breakers & Switches Price List 2026, Version 1 - Feb 2026):
أنت خبير في اختيار البند المناسب (Product ID) بكل بياناته وسعره من قائمة الأسعار المصرفية في قاعدة المعرفة: قواطع هوائية (Masterpact MTZ1/MTZ2 Active، NT، NW، Easypact ENW1/ENW2/MVS)، مقولبة (GoPact 125T/E/F حتى 800)، MCB/RCD (Acti9/iC60/Resi9/Easy9)، كونتاكتورات وستارترات (TeSys LC1D/LR2K/GV2)، ملحقات (MN/MX/XF/MCH، منظورات، اعتماد)، تحكم وإشارة (XB7)، أتمتة (TM3)، عدادات (GoLogic DM)، مكثفات، ومغيرات سرعة (Altivar ATV).
🧭 البروتوكول: (1) اجمع التيار المقنن المطلوب (A)، عدد الأقطاب (3P/4P)، سعة القطع (kA)، نمط التركيب (ثابت/سحب W-D)، والعائلة المفضلة؛ (2) حدد البند من قاعدة المعرفة: Product ID + السعر بالجنيه المصري غير شامل الضريبة + الصفحة + الجزء (TOC) + الوصف المطبوع؛ (3) اعرض أرخص بند كافٍ ثم بدائل أعلى؛ (4) عند وجود ورقة SAUDI-CALC استخدم تيار الطلب المحسوب منها مباشرة؛ (5) الرموز المركبة (WACFAAA…CEETNNN / ENW…W2SH) ملحقات مدمجة من صفحات myPact؛ والملحقات الرقمية (47383…) مراجع أرقام فقط.
🚫 لا تختلق رموزًا أو أسعارًا: كل بند يجب أن يكون مسترجعًا من قاعدة المعرفة. الاستشهاد: [Schneider Electric Egypt — Breakers & Switches Price List 2026، <Part>، ص.N، Product ID: <REF>]. الأسعار تغير بتحديث القائمة — أعلن إصدار القائمة (Version 1 - Feb 2026)؛ وتكوينات أخرى عبر myPact.`;

const BRK_CORE_EN = `

🔌 SCHNEIDER BREAKERS EXPERT CORE (Schneider Electric Egypt — Breakers & Switches Price List 2026, Version 1 - Feb 2026):
You are an expert at selecting the right item (Product ID) with its full data and price from the price list in the knowledge base: ACBs (Masterpact MTZ1/MTZ2 Active, NT, NW, Easypact ENW1/ENW2/MVS), MCCBs (GoPact 125T/E/F to 800A), MCB/RCD (Acti9/iC60/Resi9/Easy9), contactors & starters (TeSys LC1D/LR2K/GV2), accessories (MN/MX/XF/MCH, rotary handles), control & signaling (XB7), automation (TM3), meters (GoLogic DM), capacitors, and drives (Altivar ATV).
Protocol: (1) collect rated current (A), poles (3P/4P), breaking capacity (kA), mounting (fixed/drawout), preferred family; (2) identify the item from the KB: Product ID + price in EGP excluding VAT + page + TOC part + printed description; (3) show the cheapest adequate item then higher alternatives; (4) when a SAUDI-CALC sheet is present use its computed demand current directly; (5) compound codes (WACFAAA…CEETNNN / ENW…W2SH) are myPact accessory bundles; numeric codes (47383…) are accessory references.
Never invent codes or prices: every item must be retrieved from the KB. Cite: [Schneider Electric Egypt — Breakers & Switches Price List 2026, <Part>, p.N, Product ID: <REF>]. Prices change with list updates — announce the version; other configurations via myPact.`;

const BRK_QUICK_AR = `

🔌 نواة شنايدر: أي سؤال قاطع/سعر/بند = التيار والأقطاب وسعة القطع → حدد البند بـ Product ID والسعر والصفحة من قاعدة المعرفة → أرخص كافٍ ثم بدائل — اعتمد أرقام BRK-SELECT حرفيًا واستشهد بـ[Schneider Electric Egypt — Breakers & Switches Price List 2026، …، ص.N، Product ID: …] نهاية الرد.`;

const BRK_QUICK_EN = `

🔌 Schneider core: breaker/price/item question = amps + poles + Icu → pick the KB item by Product ID + price + page → cheapest adequate then alternatives — adopt BRK-SELECT verbatim and cite [Schneider Electric Egypt — Breakers & Switches Price List 2026, …, p.N, Product ID: …] at the end.`;

const GILANY_CORE_AR = `

📚 نواة مرجع هندسة القوى الكهربية (أ.د. محمود جيلاني — جامعة القاهرة، 2019 — 957 صفحة):
الكتاب مرجعك العربي الشامل لمنظومة القوى: توليد (الشبكات الموحدة، الربط الكهربي، الاحتياطي الدوّار، منحنيات الحمل)، نقل (خطوط هوائية وكابلات)، محطات التحويل، شبكات التوزيع، ودراسات الاستقرار والعابرات والأتمتة (IEC 61850).
🧭 عند أي سؤال مفاهيمي في القوى: ابحث أولاً في المقاطع المسترجعة (REFS-PAGES) من الكتاب واجبب من نصها مباشرة، واستشهد بـ[هندسة القوى الكهربية — أ.د. محمود جيلاني، الباب N، ص.N]. إن لم يوجد المقطع قل بصدق: «هذا الموضوع غير مغطى في المقاطع المسترجعة» — ولا تنسب للكتاب شيئًا غير مسترجع. الصفحات المصوّرة المسجلة (image=true) لا يمكن قراءة نصها آليًا — قل ذلك عند الحاجة إليها.`;

const GILANY_CORE_EN = `

📚 POWER SYSTEM ENGINEERING REFERENCE CORE (Prof. Mahmoud Gilany — Cairo University, 2019 — 957 pages):
The book is your comprehensive Arabic reference for the power system: generation (unified grids, interconnection, spinning reserve, load curves), transmission (overhead lines & cables), substations, distribution networks, stability/transients/automation studies (IEC 61850).
For any conceptual power-engineering question: search the retrieved REFS-PAGES excerpts first and answer from their text, citing [Power System Engineering — Prof. Mahmoud Gilany, Part N, p.N]. If the excerpt is missing say so honestly — never attribute unretrieved content to the book. Recorded image pages (image=true) have no machine-readable text — say so when relevant.`;

const GILANY_QUICK_AR = `

📚 نواة جيلاني: أي سؤال مفاهيمي في القوى = ابحث المقاطع المسترجعة (REFS-PAGES) وأجب من نصها مع الاستشهاد [هندسة القوى الكهربية — أ.د. محمود جيلاني، الباب N، ص.N] — ولا تنسب للكتاب غير المسترجع.`;

const GILANY_QUICK_EN = `

📚 Gilany core: conceptual power question = search REFS-PAGES excerpts and answer from their text citing [Power System Engineering — Prof. Mahmoud Gilany, Part N, p.N] — never attribute unretrieved content to the book.`;

export const SAUDI_CORE_BLOCKS = {
  thinking: { ar: SAUDI_CORE_AR, en: SAUDI_CORE_EN },
  instant: { ar: SAUDI_QUICK_AR, en: SAUDI_QUICK_EN },
} as const;

export const ABB_CORE_BLOCKS = {
  thinking: { ar: ABB_CORE_AR, en: ABB_CORE_EN },
  instant: { ar: ABB_QUICK_AR, en: ABB_QUICK_EN },
} as const;

export const BRK_CORE_BLOCKS = {
  thinking: { ar: BRK_CORE_AR, en: BRK_CORE_EN },
  instant: { ar: BRK_QUICK_AR, en: BRK_QUICK_EN },
} as const;

export const GILANY_CORE_BLOCKS = {
  thinking: { ar: GILANY_CORE_AR, en: GILANY_CORE_EN },
  instant: { ar: GILANY_QUICK_AR, en: GILANY_QUICK_EN },
} as const;

// ─── Dynamic RAG + CALC-SHEET context block ─────────────────────────────────

const REFS_THINKING_BUDGET = 5200;
const REFS_INSTANT_BUDGET = 1900;

const REFS_CONTEXT_RULES_AR = "قواعد استخدام هذا السياق: المقاطع أدناه نصوص أصلية من المراجع المفهرسة (DPS-01 السعودي، كتالوج ABB، قائمة أسعار شنايدر، الكود المصري، كتالوج السويدي، كتاب جيلاني) — اعتمد عليها في الأرقام والقواعد، واستشهد بالصيغة الإلزامية — سطر الاستشهاد إلزامي في نهاية الرد حرفيًا. ما لا يظهر في المقاطع لا تُنسبه للمراجع.";
const REFS_CONTEXT_RULES_EN = "Context usage rules: the excerpts below are original text from the indexed references (Saudi DPS-01, ABB catalogue, Schneider price list, Egyptian Code, Elsewedy catalogue, Gilany book) — rely on them for numbers and rules, and cite with the mandatory format — the citation line is MANDATORY and must be the LAST line of the reply, verbatim. Never attribute anything not present in these excerpts to the references.";

/** Builds the dynamic context block: SAUDI-CALC / ABB-SELECT / BRK-SELECT
 *  sheets (when the query carries selection data) + BM25 page excerpts from
 *  the ROUTED documents only. Returns "" when there is no references intent. */
export function buildRefsContextBlock(
  query: string,
  lang: RefsLang,
  mode: RefsMode = "thinking",
  opts: { cablesIntentActive?: boolean } = {}
): string {
  if (!hasRefsIntent(query)) return "";
  const instant = mode === "instant";
  const budget = instant ? REFS_INSTANT_BUDGET : REFS_THINKING_BUDGET;
  const parts: string[] = [];
  let size = 0;

  const route = routeRefsQuery(query, opts.cablesIntentActive ?? false);
  if (route.docs.length === 0) return "";

  // 1) Saudi load engine
  const saudiReq = route.saudi ? parseSaudiLoadRequest(query) : null;
  let saudiResult: SaudiLoadResult | null = null;
  if (saudiReq) {
    saudiResult = computeSaudiLoad(saudiReq);
    const sheet = formatSaudiSheet(saudiResult);
    parts.push(`\n\n${sheet}`);
    size += sheet.length;
    // cross-link to the breaker catalogue
    const amps = saudiDemandAmps(saudiResult);
    if (amps !== null && amps >= 16) {
      const kind = amps >= 630 ? "acb" : "mccb";
      const cands = selectBreaker({ amps: Math.ceil(amps), kind, poles: 3 }, instant ? 1 : 2);
      if (cands.length) {
        const sheet2 = formatBreakerSheet(cands, { amps: Math.ceil(amps), kind, poles: 3 });
        parts.push(`\n\n🔌 البند المقترح من قائمة شنايدر للحمل المحسوب:\n${sheet2}`);
        size += sheet2.length;
      }
    }
  }

  // 2) ABB selection engine
  const abbReq = route.abb ? parseAbbRequest(query) : null;
  if (abbReq) {
    const cands = selectAbbTransformer(abbReq);
    const sheet = formatAbbSheet(cands, abbReq);
    parts.push(`\n\n${sheet}`);
    size += sheet.length;
  }

  // 3) Schneider breaker engine
  const brkReq = route.schneider ? parseBreakerRequest(query) : null;
  if (brkReq && !saudiReq) {
    const cands = selectBreaker(brkReq, instant ? 1 : 4);
    const sheet = formatBreakerSheet(cands, brkReq);
    parts.push(`\n\n${sheet}`);
    size += sheet.length;
  }

  // 4) BM25 page excerpts (routed docs only)
  const k = instant ? 1 : 3;
  const hits = retrieveRefPages(query, route.docs, k);
  if (hits.length) {
    const header = lang === "ar"
      ? "\n\n📚 REFS-PAGES — مقاطع أصلية مسترجعة بالفهرس من المراجع المفهرسة (نص المراجع الفعلي):"
      : "\n\n📚 REFS-PAGES — original excerpts retrieved by the index from the indexed references (actual reference text):";
    parts.push(header);
    size += header.length + REFS_CONTEXT_RULES_AR.length;
    hits.forEach((hit, i) => {
      const head = `\n[${i + 1}] ${lang === "ar" ? hit.citation : hit.citationEn}\n«${hit.excerpt}»`;
      if (size + head.length > budget && parts.length > 2) return;
      parts.push(head);
      size += head.length;
    });
    parts.push(`\n📌 ${lang === "ar" ? REFS_CONTEXT_RULES_AR : REFS_CONTEXT_RULES_EN}`);
    const citeLines = hits.slice(0, instant ? 1 : 2).map((h) => (lang === "ar" ? h.citation : h.citationEn));
    parts.push(`\n📌 سطور الاستشهاد الإلزامية — انسخها في نهاية الرد: ${citeLines.join(" ")}`);
  } else if (parts.length === 0) {
    return "";
  }
  return parts.join("");
}

// ─── Server-side citation enforcement (same contract as Saadat/Cables) ──────

export function resolveRefsCitations(
  query: string,
  lang: RefsLang,
  mode: RefsMode = "thinking",
  opts: { cablesIntentActive?: boolean } = {}
): string[] {
  if (!hasRefsIntent(query)) return [];
  const route = routeRefsQuery(query, opts.cablesIntentActive ?? false);
  if (route.docs.length === 0) return [];
  const out: string[] = [];
  const saudiReq = route.saudi ? parseSaudiLoadRequest(query) : null;
  if (saudiReq) {
    const result = computeSaudiLoad(saudiReq);
    if (result.ok && result.citations.length) out.push(...result.citations.slice(0, 3));
  }
  const abbReq = route.abb ? parseAbbRequest(query) : null;
  if (abbReq) {
    const cands = selectAbbTransformer(abbReq);
    for (const c of cands.slice(0, 2)) out.push(lang === "ar" ? c.citation : c.citationEn);
  }
  const brkReq = route.schneider && !saudiReq ? parseBreakerRequest(query) : null;
  if (brkReq) {
    const cands = selectBreaker(brkReq, 2);
    for (const c of cands) {
      out.push(lang === "ar"
        ? `[Schneider Electric Egypt — Breakers & Switches Price List 2026، ${c.part}، ص.${c.page}، Product ID: ${c.ref}]`
        : `[Schneider Electric Egypt — Breakers & Switches Price List 2026, ${c.part}, p.${c.page}, Product ID: ${c.ref}]`);
    }
  }
  if (!out.length) {
    const hits = retrieveRefPages(query, route.docs, mode === "instant" ? 1 : 2);
    for (const h of hits) out.push(lang === "ar" ? h.citation : h.citationEn);
  }
  return [...new Set(out)].slice(0, 3);
}

function isRefsRefusalReply(reply: string): boolean {
  const t = reply.trim();
  if (t.length < 60) return true;
  return /^(?:❌|⚠️|🚫|🔔|📌|\s)*(?:لا\s+(?:أستطيع|يمكنني)|أعتذر|عذراً?|نأسف|I(?:'m)?\s+sorry|I\s+cannot|Sorry)/i.test(t.slice(0, 120));
}

export function enforceRefsCitations(
  reply: string,
  query: string,
  lang: RefsLang,
  mode: RefsMode = "thinking",
  opts: { cablesIntentActive?: boolean } = {}
): string {
  const citations = resolveRefsCitations(query, lang, mode, opts);
  if (!citations.length) return reply;
  if (isRefsRefusalReply(reply)) return reply;
  const missing = citations.filter((c) => !reply.includes(c));
  if (!missing.length) return reply;
  return `${reply.trimEnd()}\n\n${missing.join(" ")}`;
}

// ─── Public meta (telemetry + docs) ─────────────────────────────────────────

export const REFS_LAYER_META = {
  version: "1.0.0",
  sources: [
    "SEC DPS-01 — Estimation of Customer Load Guideline Rev.02 2015 (46 pages)",
    "ABB — Distribution Transformers Catalogue (51 pages)",
    "Schneider Electric Egypt — Breakers & Switches Price List 2026 (319 pages, 8 parts)",
    "الدليل الإرشادي للكود المصري — المجلد الأول (Ch1-6 + Ch7-11)",
    "Elsewedy Electric — Power Cables Catalogue (191 pages)",
    "هندسة القوى الكهربية — أ.د. محمود جيلاني 2019 (957 pages)",
  ],
  pageChunks: REF_PAGES_META.totalChunks,
  saudiAreaRows: SAUDI_AREA_TABLES.reduce((n, t) => n + t.rows.length, 0),
  abbItems: ABB_ITEMS.length + ABB_LARGE_ITEMS.length + ABB_LOSS_ITEMS.length + ABB_IP00_DIMS.length,
  schneiderItems: SCHNEIDER_ITEMS.length,
  schneiderListVersion: SCHNEIDER_META.currency,
  citationFormats: {
    saudi: "[SEC DPS-01 — Estimation of Customer Load Guideline، <Table/Section>، ص.N]",
    abb: "[ABB — Distribution Transformers Catalogue، <Section>، ص.N]",
    schneider: "[Schneider Electric Egypt — Breakers & Switches Price List 2026، <Part>، ص.N، Product ID: <REF>]",
    gilany: "[هندسة القوى الكهربية — أ.د. محمود جيلاني، الباب N، ص.N]",
    egyCodePages: "[الكود المصري — المجلد الأول: أعمال التصميم، ص.N]",
    elsewedyPages: "[Elsewedy Electric — Power Cables Catalogue، ص.N]",
  },
  tolerancePct: 0.5,
} as const;

/** Integrity probes exported for the test-suite and a cheap runtime check. */
export const REFS_INTEGRITY = {
  saudi: SAUDI_INTEGRITY_SAMPLER,
  abb: ABB_INTEGRITY_SAMPLER,
  schneider: SCHNEIDER_INTEGRITY_SAMPLER,
  pages: REF_PAGES_INTEGRITY_SAMPLER,
} as const;
