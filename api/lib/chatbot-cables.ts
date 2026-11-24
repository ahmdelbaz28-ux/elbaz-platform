/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ELBAZ BOT — CABLES & EGYPTIAN-CODE EXPERT CORE  (v1.0.0)
 *  Egyptian-Code + Elsewedy-catalogue mastery layer for the chatbot.
 * ───────────────────────────────────────────────────────────────────────────
 *  User requirement encoded here: the assistant must behave like an expert in
 *  the Egyptian Code (المجلد الأول: أعمال التصميم) AND the Elsewedy Power
 *  Cables catalogue — able to determine the cable cross-section and type from
 *  its own calculations and to DEFEND every answer with a verifiable citation.
 *
 *  1. KNOWLEDGE BASES — chatbot-cables-kb.ts (Elsewedy: 20 ampacity tables +
 *     short-circuit / voltage-drop / derating / conversions, all extracted
 *     from the PDF and page-cited) and chatbot-egycode-kb.ts (Egyptian Code
 *     design volume, clause-cited sections).
 *  2. INTENT GATE — hasCablesIntent(): generous triggers (false positives ride
 *     along with a small context block; false negatives are the only danger).
 *  3. RAG RETRIEVER — retrieveCables(): dependency-free BM25 over the combined
 *     corpus with page/clause citations.
 *  4. SIZING ENGINE — parseSizingRequest() + sizeCable(): DETERMINISTIC cable
 *     selection (load current → derated ampacity → short-circuit → voltage
 *     drop → governing criterion) computed server-side from the KB values and
 *     injected as a CALC-SHEET block the model must use verbatim. No invented
 *     numbers: every value is a KB value and every step carries its citation.
 *  5. VERIFICATION — verifyCablesNumber(): compares a claimed number against
 *     the KB values (±0.5% contract, same contract as the Saadat layer).
 *  6. CITATION CONTRACT — pre-filled citation lines + server-side enforcement
 *     (enforceCablesCitations), mirroring the proven Saadat design.
 *
 *  DEPENDENCY DIRECTION (one-way, same contract as chatbot-saadat.ts):
 *    skillnet → cables → {cables-kb, egycode-kb}
 *  This module imports NOTHING from the chatbot stack and carries its own
 *  Arabic normalizer to avoid the skillnet cycle.
 * ───────────────────────────────────────────────────────────────────────────
 *  INTEGRATION:
 *   - chatbot-skillnet.ts registers the `cables-expert-core` skill (routed by
 *     intent, both modes) importing CABLES_CORE_BLOCKS from here.
 *   - chatbot-prompts.ts getSystemPrompt(..., cablesContext?) appends the
 *     dynamic block built by buildCablesContextBlock().
 *   - chatbot.ts / chatbot-stream.ts compute the block from the routing
 *     signal before every prompt build and enforce citations on the reply.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  AMPACITY_TABLES,
  SHORT_CIRCUIT_TABLES,
  SC_DURATIONS,
  VOLTAGE_DROP_MULTICORE,
  VOLTAGE_DROP_SINGLE_CORE,
  type CableAmpacityRow,
  type CableAmpacityTable,
} from "./chatbot-cables-kb.js";
import { EGYCODE_SECTIONS, type EgyCodeSection } from "./chatbot-egycode-kb.js";

// ─── Prompt language / mode (mirrors Saadat without importing it) ───────────

export type CablesLang = "ar" | "en";
export type CablesMode = "thinking" | "instant";

// ─── Arabic-aware normalization (local, cycle-safe) ─────────────────────────

export function normalizeCablesText(text: string): string {
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

const CABLES_INTENT_KEYWORDS: string[] = [
  // The sources themselves
  "سويدي", "elsewedy", "السويدي", "كود مصري", "الكود المصري", "egyptian code", "الدليل الارشادي",
  // Cable selection language
  "كابل", "كابلات", "cable", "cables", "مقطع الكابل", "مساحة المقطع", "مساحة مقطع",
  "اختيار الكابل", "تحجيم الكابل", "cable sizing", "cross section", "مم2", "مم²",
  "امبيراسيه", "الأمبيراسية", "أمبيراسية", "ampacity", "current rating", "قدرة تحميل",
  "تيار الحمل", "تيار التصميم", "design current",
  // Installation conditions
  "مدفون", "دفن", "مدفونه", "مأسور", "في الأرض", "في الارض", "buried", "underground",
  "هواء", "معلق", "مسلك", "سرير كابلات", "سراير", "tray", "trunking", "مجرى", "مجارى", "duct",
  "ماسورة", "ماسوره", "مواسير", "conduit",
  "تكوين مثلثي", "trefoil", "مسطح", "flat formation", "متلامس",
  "درجة حرارة", "حرارة المحيط", "ambient", "معامل التصحيح", "derating", "معاملات التصحيح",
  "معامل التجميع", "grouping factor", "عدد الدوائر", "دائرتين",
  // Checks
  "هبوط الجهد", "هبوط جهد", "فرق الجهد", "voltage drop", "vd",
  "تيار القصر", "قدرة القصر", "short circuit", "قصر", "fault level", "كيلو أمبير", "kA",
  // Code chapters
  "خنادق", "غرف التفتيش", "قنوات الكابلات", "معامل الفراغ", "معامل الاستفادة", "معامل الصيانة",
  "معامل الحجرة", "شدة الإضاءة", "شده الاضاءه", "وحدات الإنارة", "الإنارة", "انارة", "إضاءة",
  "مصاعد", "سلالم متحركة", "تكييف", "طلمبات", "مضخات", "سخانات", "معامل الطلب", "حريق", "fire pump",
  "تصحيح معامل القدرة", "قدرة غير فعالة", "مكثفات",
  // Conductors / families
  "نحاس", "ألومنيوم", "الومنيوم", "المنيوم", "copper", "aluminium", "aluminum",
  "xlpe", "إكس إل", "اكس ال بي", "pvc", "سيفي", "سي في بي", "جدار سميك", "مسلح",
  "حديد مطاوع", "مجلفن", "seamless", "مضادة للانفجار",
];

const SHORT_CABLE_LATENT = /^(xlpe|pvc|vd|kvar|mcm|swa|sta|awa|cu|al)$/;

/** TRUE when the message plausibly needs the cables/Code expertise layer. */
export function hasCablesIntent(text: string): boolean {
  const normalized = normalizeCablesText(text);
  if (normalized.length < 2) return false;
  for (const keyword of CABLES_INTENT_KEYWORDS) {
    const kw = normalizeCablesText(keyword);
    if (SHORT_CABLE_LATENT.test(kw)) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
      if (re.test(normalized)) return true;
      continue;
    }
    if (normalized.includes(kw)) return true;
  }
  return false;
}

// ─── Corpus: every KB entry becomes one citable document ────────────────────

export interface CablesDoc {
  id: string;
  /** Canonical citation line (AR) — copied verbatim into replies. */
  citation: string;
  citationEn: string;
  page: number | null;
  /** Retrieval keywords beyond the text itself. */
  keywords: string;
  text: string;
}

function ampTableDoc(t: CableAmpacityTable): CablesDoc {
  const colNamesAr: Record<string, string> = {
    groundFlat: "أرض مسطح", groundTrefoil: "أرض مثلثي", duct: "مجرى",
    airFlatSeparated: "هواء مسطح منفصل", airFlatTouched: "هواء مسطح متلامس",
    airTrefoilTouched: "هواء مثلثي متلامس", ground: "أرض", air: "هواء",
  };
  const rowsText = t.rows
    .map((r: CableAmpacityRow) => {
      const vals = t.cols.map((c) => `${colNamesAr[c] ?? c}=${(r as Record<string, number | undefined>)[c]}`).join("، ");
      return `${fmtCsa(r.csaLabel)}مم²: ${vals}`;
    })
    .join(" | ");
  const conductorAr = t.conductor === "cu" ? "نحاس" : "ألومنيوم";
  const insulationAr = t.insulation === "xlpe" ? "XLPE" : "PVC";
  const coreAr: Record<string, string> = { single: "أحادي القلب", multi3: "3 قلوب", multi4: "4 قلوب", multi4red: "4 قلوب بمحايد مصغر", mv3: "3 قلوب", mv1: "أحادي القلب (مصدّح)" };
  return {
    id: `elsewedy:amp:${t.id}`,
    citation: `[Elsewedy Electric — Power Cables Catalogue، ${t.label}، ص.${t.page}]`,
    citationEn: `[Elsewedy Electric — Power Cables Catalogue, ${t.label}, p.${t.page}]`,
    page: t.page,
    keywords: `جدول أمبيراسية امبير أمبيراسية ارض هواء مجرى سرير ماسوره أرض مسطح مثلثي متلامس منفصل مم² ${t.label} ${conductorAr} ${insulationAr} ${coreAr[t.cores] ?? t.cores} ${t.voltage} ${t.cols.join(" ")} ampacity ${t.id}`,
    text: `أمبيراسية ${t.label} (${conductorAr}/${insulationAr}) — الجهد ${t.voltage} — الأساس IEC 60287 (هواء 30°C مظلل/أرض 20°C/تربة 100 K.cm/W/عمق 0.5م):
${rowsText}`,
  };
}

function fmtCsa(label: string): string {
  return label;
}

const deratingDocs: CablesDoc[] = [
  {
    id: "elsewedy:t3",
    citation: "[Elsewedy Electric — Power Cables Catalogue، Table 3 (درجات حرارة الهواء)، ص.16]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, Table 3 (air temperature), p.16]",
    page: 16,
    keywords: "معامل تصحيح حرارة الهواء t3 air temperature derating ambient 15 20 25 30 35 40 45 50 55 حرارة محيط",
    text: "معاملات التصحيح لدرجة حرارة الهواء (الأساس 30°C مظلل) — Table 3: PVC-70°C: 15°→1.21، 20°→1.15، 25°→1.07، 30°→1.00، 35°→0.92، 40°→0.84، 45°→0.75، 50°→0.66، 55°→0.55 | XLPE-90°C: 15°→1.15، 20°→1.10، 25°→1.05، 30°→1.00، 35°→0.95، 40°→0.90، 45°→0.84، 50°→0.78، 55°→0.72",
  },
  {
    id: "elsewedy:t4",
    citation: "[Elsewedy Electric — Power Cables Catalogue، Table 4 (درجات حرارة الأرض)، ص.16]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, Table 4 (ground temperature), p.16]",
    page: 16,
    keywords: "معامل تصحيح حرارة الأرض t4 ground temperature derating تربة",
    text: "معاملات التصحيح لدرجة حرارة الأرض (الأساس 20°C) — Table 4: PVC-70°C: 15°→1.05، 20°→1.00، 25°→0.95، 30°→0.89، 35°→0.84، 40°→0.77، 45°→0.71، 50°→0.63، 55°→0.55 | XLPE-90°C: 15°→1.04، 20°→1.00، 25°→0.96، 30°→0.93، 35°→0.89، 40°→0.85، 45°→0.80، 50°→0.76، 55°→0.71",
  },
  {
    id: "elsewedy:t5",
    citation: "[Elsewedy Electric — Power Cables Catalogue، Table 5 (عمق الدفن)، ص.17]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, Table 5 (burial depth), p.17]",
    page: 17,
    keywords: "معامل تصحيح عمق الدفن t5 burial depth 0.5 0.8 1 1.25 1.5 2 3 متر",
    text: "معاملات تصحيح عمق الدفن (الأساس 0.5م) — Table 5، دفن مباشر أحادي القلب: 0.5م→1.00، 0.8م→0.96، 1م→0.94، 1.25م→0.92، 1.5م→0.91، 2م→0.89، 2.5م→0.88، 3م→0.87 (≤185مم²؛ أقل بقليل للـ>185مم² و3 قلوب — القيم الكاملة بالجدول)",
  },
  {
    id: "elsewedy:t6",
    citation: "[Elsewedy Electric — Power Cables Catalogue، Table 6 (المقاومة الحرارية للتربة)، ص.17]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, Table 6 (soil thermal resistivity), p.17]",
    page: 17,
    keywords: "مقاومة حرارية للتربة t6 soil thermal resistivity 100 جاف رطب",
    text: "معاملات تصحيح المقاومة الحرارية للتربة (الأساس 100 K.cm/W) — Table 6: 0.8→1.10، 0.9→1.05، 1.0→1.00، 1.2→0.92، 1.5→0.83، 2.0→0.73، 2.5→0.66، 3.0→0.60 (K.°C/W)",
  },
  {
    id: "elsewedy:t8t9",
    citation: "[Elsewedy Electric — Power Cables Catalogue، Tables 8-9 (تجميع الدوائر في الأرض)، ص.17]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, Tables 8-9 (grouping in ground), p.17]",
    page: 17,
    keywords: "معامل التجميع في الأرض t8 t9 grouping trefoil flat مسافة 0.15 0.30 دائرتين ثلاث دوائر circuits",
    text: "معاملات التجميع للدوائر المدفونة — Table 8 (3 كابلات أحادية لكل دائرة): دائرتان مثلثي متلامس→0.77، مسطح متلامس→0.80، بمسافة 0.15م→0.82/0.85، 0.30م→0.88/0.91 | ثلاث دوائر: مثلثي متلامس→0.66، مسطح→0.69، 0.15م→0.73/0.76، 0.30م→0.80/0.83 | Table 9 (كابلات متعددة القلوب): دائرتان متلامسة→0.81، ثلاث→0.69/0.70، أربع→0.62/0.63، خمس→0.58/0.60، ست→0.54/0.56",
  },
  {
    id: "elsewedy:t10t11",
    citation: "[Elsewedy Electric — Power Cables Catalogue، Tables 10-11 (التجميع في الهواء)، ص.18-19]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, Tables 10-11 (grouping in air), p.18-19]",
    page: 18,
    keywords: "معامل التجميع في الهواء t10 t11 trays perforated ladder vertical رفوف سراير cables في الهواء",
    text: "معاملات التجميع في الهواء — Table 10 (متعددة القلوب، رف/رفين/3 رفوف × 1/2/3/4/6/9 كابلات): رف واحد متلامسة: 1→1.00، 2→0.88، 3→0.82، 4→0.79، 6→0.76، 9→0.73 (متباعدة: 2→1.00، 3→0.98، 4→0.95، 6→0.91) | Table 11 (أحادية القلب): 3 كابلات أفقي على رف مثقب: رف واحد→0.98/0.91/0.87 (1/2/3 دوائر)",
  },
  {
    id: "elsewedy:t12t13",
    citation: "[Elsewedy Electric — Power Cables Catalogue، Tables 12-13 (الفصل وحدرات القصر)، ص.19-20]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, Tables 12-13, p.19-20]",
    page: 19,
    keywords: "أقل مسافة فصل في الهواء t12 حد حرارة القصر t13 pvc 160 xlpe 250 عازل غلاف",
    text: "Table 12 أقل مسافة فصل في الهواء (مضاعفات قطر الكابل) تلغي معامل التجميع: جنبًا إلى جنب — 2 متعدد القلوب→0.5×، 3 متعدد→0.75×، 2 مثلثي→1×، 3 مثلثي→1.5×؛ فوق بعضها — 2 متعدد→2×، 3 متعدد→4× | Table 13 حرارة القصر القصوى للمكونات: عازل PVC→160°C للمقاطع ≤300مم² و140°C لما يزيد، XLPE→250°C، غلاف PVC→200°C، موصل نحاس/ألومنيوم→250°C",
  },
  {
    id: "elsewedy:sc",
    citation: "[Elsewedy Electric — Power Cables Catalogue، Tables 14-17 (تيار القصر)، ص.20-22]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, Tables 14-17 (short circuit), p.20-22]",
    page: 20,
    keywords: "تيار القصر short circuit kA جدول قصر withstand 0.1 0.2 0.5 1 2 3 4 5 ثانية مقطع قصر",
    text: `تيارات القصر (kA) حسب المقطع والزمن — Tables 14-17 (نحاس PVC / نحاس XLPE / ألومنيوم PVC / ألومنيوم XLPE، أزمنة 0.1-5 ث). عينات XLPE نحاس (Table 15) عند 1 ثانية: 16مم²→2.3، 25→3.6، 35→5.0، 50→7.2، 70→10، 95→13.6، 120→17.2، 150→21.5، 185→26.5، 240→34.3، 300→42.9، 400→57.2، 630→90.1، 800→114.5. لأي زمن غير مذكور: I(t) = I(1s)/√t (صيغة §8). مبنية على حدود حرارة Table 13.`,
  },
  {
    id: "elsewedy:vd",
    citation: "[Elsewedy Electric — Power Cables Catalogue، Tables 18-19 (هبوط الجهد)، ص.23-24]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, Tables 18-19 (voltage drop), p.23-24]",
    page: 23,
    keywords: "هبوط الجهد voltage drop mv/a/m mV مللي فولت لكل أمبير متر جدول 18 19 هبوط",
    text: `هبوط الجهد (mV/A/M) — Table 18 أحادي القلب (مسطح/مثلثي × PVC/XLPE) وTable 19 متعدد القلوب (PVC/XLPE)، الأساس: حرارة التشغيل القصوى، معامل قدرة 0.8، تردد 50Hz، كابلات متلامسة بالتكوين المسطح. عينات Table 19 نحاس (PVC/XLPE): 1.5مم²→20.345/20.341، 4→7.741/7.731، 16→1.275/1.282، 25→0.957/1.009، 50→0.526/0.552، 95→0.334/0.347، 150→0.246/0.254، 240→0.182/0.185. الصيغ (§9): أحادي الطور Vd=2·I·l·(Rcosφ+Xsinφ)، ثلاثي Vd=√3·I·l·(Rcosφ+Xsinφ) — لذا قيمة الجدول للدائرة ثلاثية الأطوار، وللأحادية تُضرب بـ2/√3. حد التصميم 3-5%.`,
  },
  {
    id: "elsewedy:general",
    citation: "[Elsewedy Electric — Power Cables Catalogue، General Information §D، ص.14-15]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, General Information §D, p.14-15]",
    page: 14,
    keywords: "افتراضات الكتالوج basis 60287 هواء 30 درجة أرض 20 عمق 0.5 مجرى 1.5 معامل الحمل تردد 50 selection factors اختيار الكابل عوامل",
    text: `أساس قيم الكتالوج (§7): IEC 60287 — هواء 30°C مظلل، أرض 20°C، مقاومة حرارية للتربة 100 K.cm/W، عمق دفن 0.5م، قطر مجرى 1.5×قطر الكابل، تجاهل جفاف التربة، معامل حمل = 1، تردد 50Hz (§10). عوامل اختيار الكابل: تعيين الجهد، معامل الحمل، الحمل المطلوب (أمبير/MVA)، مستوى تيار القصر ومدته، الظروف البيئية، ظروف التمديد. عند اختلاف شروط التمديد تُستخدم معاملات التصحيح (Tables 3-11). الصيغ الأساسية: تصحيح المقاومة بالحرارة R(θ)=R20[1+α(θ−20)] (αCu=0.00393، αAl=0.00403)، المحاثة L=K+0.2·ln(2S/d)، السعة C=εr/(18·ln(D/d))، تيار الشحن Ic=U0·ω·C·10⁻⁶، فقد العازل Wd=ωC·U0²·tanδ·10⁻⁶، مقاومة العزل R=K·ln(D/d)، وعلاقة cosφ/sinφ: 0.9→0.44، 0.8→0.6، 0.71→0.71، 0.6→0.8، 0.5→0.87.`,
  },
  {
    id: "elsewedy:conversion",
    citation: "[Elsewedy Electric — Power Cables Catalogue، Tables 21-22 (التحويلات)، ص.26-27]",
    citationEn: "[Elsewedy Electric — Power Cables Catalogue, Tables 21-22, p.26-27]",
    page: 26,
    keywords: "تحويل awg mcm مقاييس أمريكية نحاس ألومنيوم مكافئ copper aluminum equivalent conversion جدول المقاطع",
    text: "Table 21 AWG/MCM→مم²: 20→0.5، 18→0.75، 16→1.5، 14→2.5، 12→4، 10→6، 8→10، 6→16، 4→25، 2→35، 1→50، 2/0→70، 3/0→95، 4/0→120، 300MCM→150، 500MCM→240، 750MCM→400، 1000MCM→500. Table 22 المقابل النحاس→ألومنيوم لنفس قدرة التيار: 10→25، 16→35، 25→50، 35→70، 50→95، 70→120، 95→150، 120→185، 150→240، 185→300، 240→400، 300→500، 400→630، 500→800، 630→1000، 800→1200، 1000→1400، 1200→1600.",
  },
];

const egycodeDocs: CablesDoc[] = EGYCODE_SECTIONS.map((s: EgyCodeSection) => ({
  id: `egycode:${s.id}`,
  citation: `[الكود المصري — المجلد الأول: أعمال التصميم، الباب ${s.chapter}، ${s.clause}]`,
  citationEn: `[Egyptian Code — Design Volume, Chapter ${s.chapter}, ${s.clause}]`,
  page: null,
  keywords: `${s.title} ${s.titleEn} ${s.keywords} الباب ${s.chapter} ${s.clause}`,
  text: `${s.title} (${s.clause}): ${s.text}`,
}));

export const CABLES_DOCS: CablesDoc[] = [
  ...AMPACITY_TABLES.map(ampTableDoc),
  ...deratingDocs,
  ...egycodeDocs,
];

// ─── BM25 retriever over the combined corpus ────────────────────────────────

export interface CablesHit {
  id: string;
  score: number;
  citation: string;
  page: number | null;
  excerpt: string;
  reason: "bm25";
}

interface IndexedDoc {
  doc: CablesDoc;
  tokens: string[];
}

let INDEX: IndexedDoc[] | null = null;
let DF: Map<string, number> | null = null;
let AVG_LEN = 0;
const K1 = 1.4;
const B = 0.72;

// Arabic + English function words — they carry no topical signal and poison
// BM25's idf when a short doc happens to contain one ("في الأرض" ranked a
// grouping table above the ampacity table a user asked for).
const STOPWORDS = new Set([
  "في", "من", "على", "الي", "عن", "مع", "هذا", "هذه", "ذلك", "هؤلاء", "كل", "بعد", "قبل", "تحت", "فوق",
  "كم", "ما", "هو", "هي", "او", "يا", "هل", "كيف", "ازاي", "ماذا", "لماذا", "لي", "لك", "له", "ان", "إن", "ان", "اذا", "كان", "يكون",
  "the", "is", "are", "of", "in", "on", "at", "for", "to", "what", "how", "which", "who", "why", "and", "or", "a", "an",
]);

function tokenize(text: string): string[] {
  const normalized = normalizeCablesText(text);
  const raw = normalized.match(/[a-z\u0621-\u064A0-9.%²]{1,}/g) ?? [];
  const tokens: string[] = [];
  for (const t of raw) {
    if (STOPWORDS.has(t)) continue;
    // single-char tokens only as digits ("4 قلوب" must survive tokenization)
    if (t.length === 1 && !/\d/.test(t)) continue;
    tokens.push(t);
    // Arabic prefix-variant: query "الارض/بالاسلاك/للماسوره" must match doc
    // tokens "ارض/سلاك/ماسوره" and vice versa (one strip per token).
    const stripped = t.replace(/^(?:فال|كال|بال|وال|لل|ال)/, "");
    if (stripped !== t && stripped.length >= 2 && !STOPWORDS.has(stripped)) tokens.push(stripped);
    // Split decimals so "0.8" also matches token "8".
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
  // Index tokens come from keywords + citation ONLY — the ampacity tables'
  // full-row text would dominate doc length and bury the tables in BM25's
  // length normalization. The excerpt still returns the full text.
  const docs: IndexedDoc[] = CABLES_DOCS.map((doc) => ({ doc, tokens: tokenize(`${doc.id} ${doc.keywords} ${doc.citation}`) }));
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

export function retrieveCables(query: string, k = 3): CablesHit[] {
  if (k <= 0) return [];
  const { docs, df, avgLen } = getIndex();
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return [];
  const n = docs.length;
  const qSet = [...new Set(qTokens)];
  const scored: Array<{ doc: IndexedDoc; score: number }> = [];
  for (const d of docs) {
    const tf = new Map<string, number>();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of qSet) {
      const f = tf.get(qt);
      if (!f) continue;
      const dfv = df.get(qt) ?? 0;
      const idf = Math.log(1 + (n - dfv + 0.5) / (dfv + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.tokens.length) / avgLen)));
    }
    if (score > 0) scored.push({ doc: d, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const hits: CablesHit[] = [];
  for (const s of scored.slice(0, k)) {
    hits.push({
      id: s.doc.doc.id,
      score: Math.round(s.score * 100) / 100,
      citation: s.doc.doc.citation,
      page: s.doc.doc.page,
      excerpt: s.doc.doc.text.length > 1700 ? `${s.doc.doc.text.slice(0, 1650)} …` : s.doc.doc.text,
      reason: "bm25",
    });
  }
  return hits;
}

// ─── SIZING ENGINE (deterministic, KB-grounded) ─────────────────────────────

export interface CableSizingRequest {
  loadKw?: number;
  loadKva?: number;
  loadA?: number;
  /** Line-line voltage (V). Default 380 (3φ) / 220 (1φ). */
  voltage?: number;
  phases?: 1 | 3;
  pf?: number;
  lengthM?: number;
  conductor?: "cu" | "al";
  insulation?: "pvc" | "xlpe";
  cores?: "single" | "multi";
  installation?: "air" | "ground" | "duct";
  /** Single-core layout in ground/air (default trefoil — MV practice). */
  formation?: "trefoil" | "flat";
  trays?: 1 | 2 | 3;
  cablesPerTray?: number;
  ambientAirC?: number;
  groundTempC?: number;
  soilResistivity?: number;
  depthM?: number;
  groupingCircuits?: number;
  spacing?: "touching" | "s15" | "s30";
  maxDropPct?: number;
  faultKa?: number;
  faultDurationS?: number;
  /** MV system nominal voltage (kV) — e.g. 6.6, 11, 22. */
  mvKv?: number;
}

export interface SizingCheck {
  check: "ampacity" | "voltage-drop" | "short-circuit";
  pass: boolean;
  detail: string;
  citation: string;
}

export interface SizingFamilyResult {
  tableId: string;
  label: string;
  voltage: string;
  csa: number;
  csaLabel: string;
  ratingColumn: string;
  tabulatedAmp: number;
  deratedAmp: number;
  vdPct: number | null;
  scKa: number | null;
  citation: string;
}

export interface SizingResult {
  ok: boolean;
  /** Design current (A). */
  ib?: number;
  /** Total derating factor applied. */
  derating?: number;
  /** Tabulated ampacity required BEFORE derating. */
  requiredTabulatedAmp?: number;
  /** The governing criterion of the final selection. */
  governedBy?: "ampacity" | "voltage-drop" | "short-circuit";
  families: SizingFamilyResult[];
  final?: SizingFamilyResult;
  checks: SizingCheck[];
  steps: string[];
  citations: string[];
  assumptions: string[];
  warnings: string[];
}

// ─── Factor helpers (interpolation over the KB tables) ──────────────────────

function interpFactor(ks: number[], fs: number[], x: number): number {
  if (x <= ks[0]) return fs[0];
  if (x >= ks[ks.length - 1]) return fs[fs.length - 1];
  for (let i = 1; i < ks.length; i++) {
    if (x <= ks[i]) {
      const t = (x - ks[i - 1]) / (ks[i] - ks[i - 1]);
      return fs[i - 1] + t * (fs[i] - fs[i - 1]);
    }
  }
  return fs[fs.length - 1];
}

function airTempFactor(insulation: "pvc" | "xlpe", tempC: number): number {
  const temps = [15, 20, 25, 30, 35, 40, 45, 50, 55];
  const fs = insulation === "pvc" ? [1.21, 1.15, 1.07, 1, 0.92, 0.84, 0.75, 0.66, 0.55] : [1.15, 1.1, 1.05, 1, 0.95, 0.9, 0.84, 0.78, 0.72];
  return interpFactor(temps, fs, tempC);
}

function groundTempFactor(insulation: "pvc" | "xlpe", tempC: number): number {
  const temps = [15, 20, 25, 30, 35, 40, 45, 50, 55];
  const fs = insulation === "pvc" ? [1.05, 1, 0.95, 0.89, 0.84, 0.77, 0.71, 0.63, 0.55] : [1.04, 1, 0.96, 0.93, 0.89, 0.85, 0.8, 0.76, 0.71];
  return interpFactor(temps, fs, tempC);
}

function depthFactor(installation: "ground" | "duct", cores: "single" | "mv1" | "other", csa: number, depthM: number): number {
  // Table 5 — direct buried vs duct; single core (≤185/>185) vs three cores.
  const direct = installation === "ground";
  const series =
    cores === "other"
      ? direct ? [1, 0.99, 0.96, 0.94, 0.92, 0.91, 0.9, 0.89, 0.88, 0.87] : [1, 0.99, 0.97, 0.96, 0.94, 0.93, 0.92, 0.91, 0.9, 0.89]
      : csa <= 185
        ? direct ? [1, 0.98, 0.96, 0.94, 0.92, 0.91, 0.9, 0.89, 0.88, 0.87] : [1, 0.98, 0.96, 0.94, 0.92, 0.91, 0.9, 0.89, 0.88, 0.87]
        : direct ? [1, 0.98, 0.94, 0.92, 0.9, 0.88, 0.86, 0.85, 0.83, 0.81] : [1, 0.98, 0.95, 0.92, 0.9, 0.89, 0.88, 0.87, 0.85, 0.84];
  return interpFactor([0.5, 0.6, 0.8, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0], series, depthM);
}

function soilFactor(soilResistivity: number): number {
  return interpFactor([0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0], [1.1, 1.05, 1.0, 0.92, 0.83, 0.73, 0.66, 0.6], soilResistivity);
}

function groupingFactorGround(cores: "single" | "mv1" | "other", formation: "trefoil" | "flat", spacing: "touching" | "s15" | "s30", circuits: number): number {
  const T8: Record<string, number[]> = {
    trefoilTouching: [0.77, 0.66, 0.6, 0.56, 0.53],
    flatTouching: [0.8, 0.69, 0.63, 0.59, 0.57],
    trefoilS15: [0.82, 0.73, 0.68, 0.64, 0.61],
    flatS15: [0.85, 0.76, 0.71, 0.67, 0.64],
    trefoilS30: [0.88, 0.8, 0.74, 0.72, 0.7],
    flatS30: [0.91, 0.83, 0.77, 0.75, 0.73],
  };
  const T9: Record<string, number[]> = {
    trefoilTouching: [0.81, 0.69, 0.62, 0.58, 0.54],
    flatTouching: [0.81, 0.7, 0.63, 0.6, 0.56],
    trefoilS15: [0.87, 0.76, 0.72, 0.66, 0.63],
    flatS15: [0.87, 0.78, 0.74, 0.7, 0.67],
    trefoilS30: [0.91, 0.82, 0.77, 0.73, 0.7],
    flatS30: [0.91, 0.84, 0.81, 0.78, 0.76],
  };
  const table = cores === "other" ? T9 : T8;
  const nr = Math.max(2, Math.min(6, Math.round(circuits)));
  const idx = Math.min(Math.max(nr - 2, 0), 4);
  return table[`${formation}${spacing === "touching" ? "Touching" : spacing === "s15" ? "S15" : "S30"}`][idx];
}

function groupingFactorAirMulticore(trays: 1 | 2 | 3, cables: number): number {
  // Table 10 — perforated trays, touching (conservative default).
  const t1 = [1.0, 0.88, 0.82, 0.79, 0.76, 0.73];
  const t2 = [1.0, 0.87, 0.8, 0.77, 0.73, 0.68];
  const t3 = [1.0, 0.86, 0.79, 0.76, 0.71, 0.66];
  const series = trays === 1 ? t1 : trays === 2 ? t2 : t3;
  const cables_ = [1, 2, 3, 4, 6, 9];
  const idx = cables_.indexOf(cables);
  if (idx === -1) {
    // nearest lower cable count (conservative)
    const lower = cables_.filter((c) => c <= cables).length - 1;
    return series[Math.max(0, lower)];
  }
  return series[idx];
}

function groupingFactorAirSingle(trays: 1 | 2 | 3, circuits: number): number {
  // Table 11 — three cables in horizontal formation on perforated trays.
  const t1 = [0.98, 0.91, 0.87];
  const t2 = [0.96, 0.87, 0.81];
  const t3 = [0.95, 0.85, 0.78];
  const series = trays === 1 ? t1 : trays === 2 ? t2 : t3;
  const idx = Math.min(Math.max(circuits - 1, 0), 2);
  return series[idx];
}

// ─── Request parsing (Arabic + English free text) ───────────────────────────

const NUM = "(\\d+(?:\\.\\d+)?)";

function pickLoad(text: string): { kw?: number; kva?: number; a?: number } {
  // منطق كلمات مفتاحية بلا \b بعد العربية (الحدود \b لا تعمل بعد حروف غير ASCII)
  const kwMw = text.match(new RegExp(`${NUM}\\s*(?:ك\\.?و(?![a-z0-9])|كيلو ?واط|كيلووات|kw(?![a-z0-9]))`));
  const kva = text.match(new RegExp(`${NUM}\\s*(?:ك\\.?ف\\.?ا|كيلو ?فولت ?أمبير|كيلو فولت امبير|kva(?![a-z0-9]))`));
  const a = text.match(new RegExp(`${NUM}\\s*(?:أمبير|امبير|amp(?:s|ere)?(?![a-z0-9])|\\bA(?![a-z0-9]))`));
  return {
    kw: kwMw ? Number(kwMw[1]) : undefined,
    kva: kva ? Number(kva[1]) : undefined,
    a: a ? Number(a[1]) : undefined,
  };
}

/** Extracts a cable-sizing request from free text. Returns null when the
 *  message carries no load/current figure at all (a conceptual question). */
export function parseSizingRequest(rawText: string): CableSizingRequest | null {
  const text = normalizeCablesText(rawText);
  if (text.length < 4) return null;
  const load = pickLoad(text);
  if (load.kw === undefined && load.kva === undefined && load.a === undefined) return null;

  const req: CableSizingRequest = {};
  req.loadKw = load.kw;
  req.loadKva = load.kva;
  req.loadA = load.a;

  const len = text.match(new RegExp(`(?:طول|مسافه|لمسافه|length)\\D{0,12}${NUM}\\s*(?:متر|م\\b|meter|metre|km|كم)`));
  const lenKm = text.match(new RegExp(`${NUM}\\s*(?:كم|km\\b)`));
  if (len) req.lengthM = Number(len[1]) * (len[0].includes("كم") || len[0].includes("km") ? 1000 : 1);
  else if (lenKm) req.lengthM = Number(lenKm[1]) * 1000;

  const kv = text.match(new RegExp(`${NUM}\\s*(?:ك\\.?ف(?!\\.?ا)(?![a-z0-9])|kv(?![a-z0-9])|كي ?لو ?فولت)`));
  if (kv) {
    const val = Number(kv[1]);
    if (val > 1.5) req.mvKv = val;
    else req.voltage = val * 1000;
  } else {
    const v = text.match(new RegExp(`${NUM}\\s*(?:فولت|volt|v\\b)`));
    if (v) req.voltage = Number(v[1]);
    else if (/\b380\b/.test(text)) req.voltage = 380;
    else if (/\b400\b/.test(text)) req.voltage = 400;
    else if (/\b220\b/.test(text)) req.voltage = 220;
  }

  const pf = text.match(new RegExp(`(?:معامل قدره|كوس|cos|power factor|pf)\\D{0,10}${NUM}`));
  if (pf && Number(pf[1]) > 0 && Number(pf[1]) <= 1) req.pf = Number(pf[1]);

  req.phases = /احادى|أحادي|احادي الطور|single phase| 单相|1 ?phase|طور واحد/.test(text) ? 1 : 3;
  if (req.phases === 1 && !req.voltage) req.voltage = 220;

  req.conductor = /نحاس|copper/.test(text) ? "cu" : /الومنيوم|المنيوم|ألومنيوم|alumi/.test(text) ? "al" : undefined;
  req.insulation = /\bxlpe\b|اكس ?ل ?ب|إكس ?إل/.test(text) ? "xlpe" : /\bpvc\b|سيفي|سي ?في ?بي/.test(text) ? "pvc" : undefined;

  if (/مدفون|دفن|في الارض|في الأرض|underground|buried|تراب/.test(text)) req.installation = "ground";
  else if (/مجرى|مجاري|دكت|duct|انبوب/.test(text)) req.installation = "duct";
  else if (/هواء|هوائي|معلق|سرير|سراير|حوامل|tray|air/.test(text)) req.installation = "air";

  if (/مسطح|flat/.test(text)) req.formation = "flat";
  else if (/مثلث|trefoil/.test(text)) req.formation = "trefoil";

  const circuits = text.match(new RegExp(`(?:عدد الدوائر)\\D{0,6}${NUM}`))
    ?? text.match(new RegExp(`${NUM}\\s*(?:دوائر|دائره|دواير|circuits?)`));
  if (circuits) req.groupingCircuits = Number(circuits[1]);
  else if (/دائرتين|مسالتين/.test(text)) req.groupingCircuits = 2;
  else if (/ثلاث ?دوائر|3 ?دوائر/.test(text)) req.groupingCircuits = 3;
  else if (/اربع ?دوائر|4 ?دوائر/.test(text)) req.groupingCircuits = 4;

  const temp = text.match(new RegExp(`(?:درجه حرار[هة]|حراره|حرارة|ambient)\\D{0,12}${NUM}`));
  if (temp) {
    const t = Number(temp[1]);
    if (t >= -10 && t <= 70) {
      req.ambientAirC = t;
      req.groundTempC = t;
    }
  }

  const fault = text.match(new RegExp(`(?:تيار )?قصر\\D{0,15}${NUM}\\s*(?:ك\\.?ا(?![a-z0-9])|kilo ?amp|ka(?![a-z0-9])|كيلو ?امبير)`));
  if (fault) req.faultKa = Number(fault[1]);
  const dur = text.match(new RegExp(`${NUM}\\s*(?:ثاني[هة]|ث\\b|sec\\b|s\\b)`));
  if (dur && req.faultKa) req.faultDurationS = Number(dur[1]);

  const drop = text.match(new RegExp(`(?:هبوط|فرق الجهد|voltage drop|vd)\\D{0,12}${NUM}\\s*%`));
  if (drop) req.maxDropPct = Number(drop[1]);

  return req;
}

// ─── Core sizing computation ────────────────────────────────────────────────

const SQRT3 = Math.sqrt(3);

function voltageCovers(tableVoltage: string, mvKv: number): boolean {
  // U0/U(Um) designations — system U0 = kV/√3 must fit the table's U0.
  const umMatch = tableVoltage.match(/\(([\d.]+)\)\s*kV/i);
  const u0Match = tableVoltage.match(/^([\d.]+)\//);
  if (!u0Match) return false;
  const tableU0 = Number(u0Match[1]);
  const tableUm = umMatch ? Number(umMatch[1]) : tableU0 * 2;
  const systemU0 = (mvKv * 1000) / SQRT3 / 1000;
  return systemU0 <= tableU0 + 0.05 && mvKv <= tableUm + 0.05;
}

function candidateTables(req: CableSizingRequest): CableAmpacityTable[] {
  const conductor = req.conductor ?? "cu";
  const insulation = req.insulation ?? "xlpe";
  const mvKv = req.mvKv ?? 0;
  const coresWanted = req.cores ?? (req.phases === 1 ? "single" : "multi");
  return AMPACITY_TABLES.filter((t) => {
    if (t.conductor !== conductor || t.insulation !== insulation) return false;
    if (mvKv > 0) {
      if (t.voltage.includes("0.6/1") || !voltageCovers(t.voltage, mvKv)) return false;
      const isSingleCore = t.cores === "mv1";
      return coresWanted === "single" ? isSingleCore : !isSingleCore;
    }
    if (!t.voltage.includes("0.6/1")) return false;
    if (coresWanted === "single") return t.cores === "single";
    return t.cores === "multi4" || t.cores === "multi3";
  });
}

function ratingColumnOf(t: CableAmpacityTable, req: CableSizingRequest): { col: string; ar: string } {
  const single = t.cores === "single" || t.cores === "mv1";
  if (req.installation === "ground") {
    if (!single) return { col: "ground", ar: "مدفون مباشرة" };
    return req.formation === "flat" ? { col: "groundFlat", ar: "أرض — تكوين مسطح" } : { col: "groundTrefoil", ar: "أرض — تكوين مثلثي" };
  }
  if (req.installation === "duct") return { col: "duct", ar: "داخل مجرى" };
  if (single) return req.formation === "trefoil" ? { col: "airTrefoilTouched", ar: "هواء — مثلثي متلامس" } : { col: "airFlatTouched", ar: "هواء — مسطح متلامس" };
  return { col: "air", ar: "هواء (مظلل)" };
}

function vdTableEntry(conductor: "cu" | "al", insulation: "pvc" | "xlpe", cores: "single" | "multi" | "mv1" | "mv3", csa: number, formation: "trefoil" | "flat"): number | null {
  if (cores === "single" || cores === "mv1") {
    const tbl = (VOLTAGE_DROP_SINGLE_CORE as Record<string, Record<number, { flat: number; trefoil: number; xlpeFlat: number; xlpeTrefoil: number }>>)[conductor];
    const row = tbl?.[csa];
    if (!row) return null;
    if (insulation === "pvc") return formation === "flat" ? row.flat : row.trefoil;
    return formation === "flat" ? row.xlpeFlat : row.xlpeTrefoil;
  }
  if (cores === "multi") {
    const tbl = (VOLTAGE_DROP_MULTICORE as Record<string, Record<number, { pvc: number; xlpe: number }>>)[conductor];
    const row = tbl?.[csa];
    if (!row) return null;
    return insulation === "pvc" ? row.pvc : row.xlpe;
  }
  return null; // MV computed from R/X of the row itself
}

function scValue(conductor: "cu" | "al", insulation: "pvc" | "xlpe", csa: number, durationS: number): number | null {
  const key = `${conductor}_${insulation}`;
  const table = (SHORT_CIRCUIT_TABLES as Record<string, Record<number, number[]>>)[key];
  const row = table?.[csa];
  if (!row) return null;
  const durations = SC_DURATIONS as unknown as number[];
  const exact = durations.indexOf(durationS);
  if (exact >= 0) return row[exact];
  // I(t) = I(1s)/√t — catalogue §8 formula
  const oneSecond = row[durations.indexOf(1)];
  return oneSecond / Math.sqrt(durationS);
}

/**
 * Deterministic cable sizing from the KB tables. Every numeric step cites its
 * source; assumptions are stated; nothing is invented.
 */
export function sizeCable(req: CableSizingRequest): SizingResult {
  const steps: string[] = [];
  const citations: string[] = [];
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const checks: SizingCheck[] = [];

  const conductor = req.conductor ?? "cu";
  const insulation = req.insulation ?? "xlpe";
  const phases = req.phases ?? 3;
  const installation = req.installation ?? "air";
  const formation = req.formation ?? "trefoil";
  const pf = req.pf ?? 0.8;
  if (req.pf === undefined) assumptions.push(`معامل القدرة افتراضي 0.8 (أساس جدول هبوط الجهد بالكتالوج) — حدده إن اختلف`);
  const voltage = req.voltage ?? (req.mvKv ? req.mvKv * 1000 : phases === 1 ? 220 : 380);
  if (req.voltage === undefined && !req.mvKv) assumptions.push(`الجهد افتراضي ${voltage} فولت (${phases === 1 ? "أحادي" : "ثلاثي"} الطور)`);
  const lengthM = req.lengthM;
  const maxDropPct = req.maxDropPct ?? 5;
  if (req.maxDropPct === undefined) assumptions.push(`حد هبوط الجهد 5% (نطاق الكتالوج 3-5% §9، ص.15) — حدده إن كان المشروع أ stricter`);

  // 1) Design current
  let ib: number | undefined;
  if (req.loadA) ib = req.loadA;
  else if (req.loadKva) ib = phases === 1 ? (req.loadKva * 1000) / voltage : (req.loadKva * 1000) / (SQRT3 * voltage);
  else if (req.loadKw) ib = phases === 1 ? (req.loadKw * 1000) / (voltage * pf) : (req.loadKw * 1000) / (SQRT3 * voltage * pf);
  if (ib === undefined || !Number.isFinite(ib) || ib <= 0) {
    return { ok: false, families: [], checks, steps, citations, assumptions, warnings: ["لم يُمكن تحديد تيار الحمل — أدخل الحمل (ك.و أو ك.ف.ا أو أمبير)"] };
  }
  const loadDesc = req.loadA
    ? "معطى مباشرة"
    : `من الحمل ${req.loadKva ?? req.loadKw} ${req.loadKva ? "ك.ف.ا" : "ك.و"}، جهد ${voltage}V، ${phases === 1 ? "أحادي" : "ثلاثي"} الطور${req.loadKw ? `، cosφ=${pf}` : ""}`;
  steps.push(`1) تيار التصميم Ib = ${ib.toFixed(1)} أمبير — ${loadDesc} [الصيغة القياسية: I = P/(√3·U·cosφ)]`);

  // 2) Derating factors
  const ambientAirC = req.ambientAirC ?? 30;
  const groundTempC = req.groundTempC ?? 20;
  const depthM = req.depthM ?? 0.5;
  const soil = req.soilResistivity ?? 1.0;
  const circuits = req.groupingCircuits ?? 1;
  const trays = req.trays ?? 1;
  const cablesPerTray = req.cablesPerTray ?? 1;

  const kAir = installation === "air" ? airTempFactor(insulation, ambientAirC) : 1;
  const kGroundT = installation === "ground" || installation === "duct" ? groundTempFactor(insulation, groundTempC) : 1;
  const kDepth = installation === "ground" || installation === "duct" ? depthFactor(installation, "other", 1000, depthM) : 1;
  const kSoil = installation === "ground" ? soilFactor(soil) : 1;
  const kGroupGround = installation === "ground" && circuits > 1 ? groupingFactorGround("other", formation, req.spacing ?? "touching", circuits) : 1;
  const isSingleCoreReq = (req.cores ?? (phases === 1 ? "single" : "multi")) === "single";
  const kGroupAir = installation === "air" && (circuits > 1 || cablesPerTray > 1)
    ? (isSingleCoreReq
      ? groupingFactorAirSingle(trays, Math.max(1, Math.min(3, cablesPerTray || circuits)))
      : groupingFactorAirMulticore(trays, cablesPerTray))
    : 1;
  const derating = kAir * kGroundT * kDepth * kSoil * kGroupGround * kGroupAir;

  const factorParts: string[] = [];
  if (installation === "air") factorParts.push(`حرارة الهواء ${ambientAirC}°→${kAir.toFixed(2)} [Table 3، ص.16]`);
  if (installation !== "air") {
    factorParts.push(`حرارة الأرض ${groundTempC}°→${kGroundT.toFixed(2)} [Table 4، ص.16]`);
    if (depthM !== 0.5) factorParts.push(`عمق ${depthM}م→${kDepth.toFixed(2)} [Table 5، ص.17]`);
    if (installation === "ground" && soil !== 1.0) factorParts.push(`تربة ${soil} K.°C/W→${kSoil.toFixed(2)} [Table 6، ص.17]`);
  }
  if (installation === "ground" && circuits > 1) factorParts.push(`تجميع ${circuits} دوائر (${formation === "trefoil" ? "مثلثي" : "مسطح"}/${req.spacing === "s30" ? "0.30م" : req.spacing === "s15" ? "0.15م" : "متلامس"})→${kGroupGround.toFixed(2)} [Tables 8-9، ص.17]`);
  if (installation === "air" && (circuits > 1 || cablesPerTray > 1)) factorParts.push(`تجميع في الهواء ${trays} رف × ${cablesPerTray} كابل→${kGroupAir.toFixed(2)} [Table 10، ص.18]`);
  steps.push(`2) معاملات التصحيح: ${factorParts.length ? factorParts.join(" × ") : "لا شيء (الشروط القياسية للكتالوج)"} ⇒ المعامل الكلي K = ${derating.toFixed(3)}`);
  if (factorParts.length) citations.push(deratingDocs[0].citation);

  const requiredTabulatedAmp = ib / derating;
  steps.push(`3) الأمبيراسية المطلوبة في الجدول = Ib / K = ${ib.toFixed(1)} / ${derating.toFixed(3)} = ${requiredTabulatedAmp.toFixed(1)} أمبير`);

  // 3) Ampacity selection per family
  const tables = candidateTables(req);
  if (tables.length === 0) {
    return {
      ok: false,
      ib,
      families: [],
      checks,
      steps,
      citations,
      assumptions,
      warnings: [
        req.mvKv
          ? `لا يوجد جدول أمبيراسية في قاعدة المعرفة يغطي جهد ${req.mvKv}kV (المطلوب designation أعلى) — قاعدة المعرفة تغطي 3.6/6 و6/10 و8.7/15 kV`
          : "لا يوجد جدول مطابق للمعطيات",
      ],
    };
  }

  const families: SizingFamilyResult[] = [];
  /** Per-family governing cause — the last check that raised the section. */
  const governedCause = new Map<string, "ampacity" | "voltage-drop" | "short-circuit">();
  let minCsaOverall: SizingFamilyResult | null = null;
  for (const t of tables) {
    const { col, ar } = ratingColumnOf(t, req);
    const row = t.rows.find((r) => {
      const amp = (r as unknown as Record<string, number>)[col];
      return amp !== undefined && amp * derating >= ib;
    });
    if (!row) {
      warnings.push(`${t.label}: أكبر مقطع بالكتالوج (${t.rows[t.rows.length - 1].csa}مم²) لا يكفي للحمل عند هذه الشروط — يلزم كابلات بالتوازي لكل طور`);
      continue;
    }
    const tabulatedAmp = (row as unknown as Record<string, number>)[col];
    const family: SizingFamilyResult = {
      tableId: t.id,
      label: t.label,
      voltage: t.voltage,
      csa: row.csa,
      csaLabel: row.csaLabel,
      ratingColumn: ar,
      tabulatedAmp,
      deratedAmp: tabulatedAmp * derating,
      vdPct: null,
      scKa: null,
      citation: `[Elsewedy Electric — Power Cables Catalogue، ${t.label}، ص.${t.page}]`,
    };
    families.push(family);
    governedCause.set(family.tableId, "ampacity");
    if (!minCsaOverall || family.csa < minCsaOverall.csa) minCsaOverall = family;
  }
  if (!minCsaOverall) {
    return { ok: false, ib, families: [], checks, steps, citations, assumptions, warnings };
  }
  steps.push(`4) الأمبيراسية: ${families.map((f) => `${f.label} ⇒ أول مقطع يكفي = ${f.csa}مم² (${f.ratingColumn}: ${f.tabulatedAmp}A مجدولة × ${derating.toFixed(3)} = ${f.deratedAmp.toFixed(1)}A ≥ ${ib.toFixed(1)}A)`).join("؛ ")}`);
  for (const f of families) if (!citations.includes(f.citation)) citations.push(f.citation);

  // 4) Voltage-drop check (on the ampacity-selected csa per family)
  if (lengthM && lengthM > 0) {
    for (const f of families) {
      const t = AMPACITY_TABLES.find((x) => x.id === f.tableId)!;
      const isMv = t.voltage !== "0.6/1 kV";
      if (isMv) {
        const row = t.rows.find((r) => r.csa === f.csa)!;
        const rOhm = row.ac;
        const xOhm = row.indMhKm !== undefined ? 2 * Math.PI * 50 * row.indMhKm * 1e-3 : 0.08;
        const lKm = lengthM / 1000;
        const sinPhi = Math.sqrt(Math.max(0, 1 - pf * pf));
        const vdVolts = SQRT3 * ib * lKm * (rOhm * pf + xOhm * sinPhi);
        const sysV = req.mvKv ? req.mvKv * 1000 : Number(t.voltage.match(/\/\s*(\d+\.?\d*)/)?.[1] ?? 0) * 1000;
        f.vdPct = (vdVolts / sysV) * 100;
      } else {
        const mv = vdTableEntry(conductor, insulation, t.cores === "single" ? "single" : "multi", f.csa, formation);
        if (mv === null) continue;
        const vdVolts = (mv * ib * lengthM) / 1000;
        f.vdPct = (vdVolts / voltage) * 100;
      }
    }
    const vdCitation = "[Elsewedy Electric — Power Cables Catalogue، Tables 18-19 (هبوط الجهد)، ص.23-24]";
    const byVd = [...families].sort((a, b) => a.csa - b.csa);
    const vdFail = byVd.filter((f) => f.vdPct !== null && f.vdPct > maxDropPct);
    if (vdFail.length) {
      // bump each failing family until VD passes
      for (const f of vdFail) {
        const t = AMPACITY_TABLES.find((x) => x.id === f.tableId)!;
        while (f.vdPct !== null && f.vdPct > maxDropPct) {
          const nextRow = t.rows.find((r) => r.csa > f.csa);
          if (!nextRow) {
            warnings.push(`${f.label}: لا مقطع في الكتالوج يحقق هبوط ≤${maxDropPct}% بهذا الطول — يلزم كابلات بالتوازي أو رفع الجهد`);
            break;
          }
          const amp = (nextRow as unknown as Record<string, number>)[ratingColumnOf(t, req).col];
          if (amp === undefined) break;
          f.csa = nextRow.csa;
          f.csaLabel = nextRow.csaLabel;
          f.tabulatedAmp = amp;
          f.deratedAmp = amp * derating;
          governedCause.set(f.tableId, "voltage-drop");
          const isMv = t.voltage !== "0.6/1 kV";
          if (isMv) {
            const rOhm = nextRow.ac;
            const xOhm = nextRow.indMhKm !== undefined ? 2 * Math.PI * 50 * nextRow.indMhKm * 1e-3 : 0.08;
            const lKm = lengthM / 1000;
            const sinPhi = Math.sqrt(Math.max(0, 1 - pf * pf));
            const sysV = req.mvKv ? req.mvKv * 1000 : Number(t.voltage.match(/\/\s*(\d+\.?\d*)/)?.[1] ?? 0) * 1000;
            f.vdPct = ((SQRT3 * ib * lKm * (rOhm * pf + xOhm * sinPhi)) / sysV) * 100;
          } else {
            const mv = vdTableEntry(conductor, insulation, t.cores === "single" ? "single" : "multi", f.csa, formation)!;
            f.vdPct = ((mv * ib * lengthM) / 1000 / voltage) * 100;
          }
        }
      }
      steps.push(`5) هبوط الجهد (الطول ${lengthM}م): رُفع المقطع في: ${vdFail.map((f) => `${f.label} ⇒ ${f.csa}مم² (هبوط ${f.vdPct?.toFixed(2)}%)`).join("؛ ")}`);
    } else {
      const sample = byVd[0];
      steps.push(`5) هبوط الجهد (الطول ${lengthM}م): مقطع ${sample.csa}مم² ⇒ ${sample.vdPct?.toFixed(2)}% ≤ ${maxDropPct}% ✓`);
    }
    citations.push(vdCitation);
    const finalVd = [...families].sort((a, b) => b.csa - a.csa)[0];
    checks.push({
      check: "voltage-drop",
      pass: finalVd.vdPct === null || finalVd.vdPct <= maxDropPct,
      detail: `هبوط الجهد عند ${lengthM}م = ${finalVd.vdPct?.toFixed(2) ?? "غير محسوب"}% (الحد ${maxDropPct}%)`,
      citation: vdCitation,
    });
  } else {
    assumptions.push("لم يُعطَ طول المسار — لم يُحسب هبوط الجهد؛ عند إعطاء الطول يُعاد الفحص وقد يرفع المقطع");
  }

  // 5) Short-circuit check
  let scGoverned = false;
  if (req.faultKa && req.faultKa > 0) {
    const tS = req.faultDurationS ?? 1;
    if (req.faultDurationS === undefined) assumptions.push(`زمن القصر افتراضي 1 ثانية — حدد زمن فصل الحماية الفعلي`);
    for (const f of families) {
      let csa = f.csa;
      let val = scValue(conductor, insulation, csa, tS);
      let guard = 0;
      while (val !== null && val < req.faultKa && guard < 40) {
        const t = AMPACITY_TABLES.find((x) => x.id === f.tableId)!;
        const nextRow = t.rows.find((r) => r.csa > csa);
        if (!nextRow) {
          warnings.push(`${f.label}: أكبر مقطع بالكتالوج لا يتحمل ${req.faultKa}kA لمدة ${tS}ث — يلزم كابلين بالتوازي لكل طور`);
          break;
        }
        csa = nextRow.csa;
        val = scValue(conductor, insulation, csa, tS);
        guard++;
        scGoverned = true;
      }
      const bumped = csa !== f.csa;
      if (bumped) {
        f.csa = csa;
        f.csaLabel = String(csa);
        governedCause.set(f.tableId, "short-circuit");
        const t = AMPACITY_TABLES.find((x) => x.id === f.tableId)!;
        const amp = (t.rows.find((r) => r.csa === csa) as unknown as Record<string, number>)[ratingColumnOf(t, req).col];
        if (amp !== undefined) {
          f.tabulatedAmp = amp;
          f.deratedAmp = amp * derating;
        }
        // keep the voltage-drop figure in sync with the raised section
        if (lengthM && lengthM > 0) {
          const isMvRow = t.voltage !== "0.6/1 kV";
          if (isMvRow) {
            const row = t.rows.find((r) => r.csa === csa)!;
            const rOhm = row.ac;
            const xOhm = row.indMhKm !== undefined ? 2 * Math.PI * 50 * row.indMhKm * 1e-3 : 0.08;
            const lKm = lengthM / 1000;
            const sinPhi = Math.sqrt(Math.max(0, 1 - pf * pf));
            const sysV = req.mvKv ? req.mvKv * 1000 : Number(t.voltage.match(/\/\s*(\d+\.?\d*)/)?.[1] ?? 0) * 1000;
            f.vdPct = ((SQRT3 * ib * lKm * (rOhm * pf + xOhm * sinPhi)) / sysV) * 100;
          } else {
            const mv = vdTableEntry(conductor, insulation, t.cores === "single" ? "single" : "multi", csa, formation);
            if (mv !== null) f.vdPct = ((mv * ib * lengthM) / 1000 / voltage) * 100;
          }
        }
      }
      f.scKa = val;
    }
    const scTableCite = `[Elsewedy Electric — Power Cables Catalogue، Tables 14-17 (تيار القصر)، ص.20-22]`;
    const afterSc = [...families].sort((a, b) => b.csa - a.csa)[0];
    steps.push(`6) القصر: ${req.faultKa}kA لمدة ${tS}ث ⇒ أصغر مقطع نحاس/${insulation === "xlpe" ? "XLPE" : "PVC"} يتحمل = ${afterSc.csa}مم² (${afterSc.scKa?.toFixed(1)}kA ≥ ${req.faultKa}kA)${scGoverned ? " — القصر هو الحاكم ورُفع المقطع" : " — أمبيراسية/الهبوط هما الحاكان"}`);
    citations.push(scTableCite);
    checks.push({
      check: "short-circuit",
      pass: afterSc.scKa !== null && afterSc.scKa >= req.faultKa,
      detail: `تحمل ${afterSc.csa}مم² عند ${tS}ث = ${afterSc.scKa?.toFixed(1) ?? "؟"}kA مقابل ${req.faultKa}kA مطلوبة`,
      citation: scTableCite,
    });
  }

  // 6) Final selection
  const final = [...families].sort((a, b) => b.csa - a.csa)[0];
  const governedBy = governedCause.get(final.tableId) ?? "ampacity";
  steps.push(`✅ التوصية: ${final.label} — مقطع ${final.csaLabel}مم² (الحاكم: ${governedBy === "ampacity" ? "الأمبيراسية المصححة" : governedBy === "voltage-drop" ? "هبوط الجهد" : "تيار القصر"}) — ${final.citation}`);
  if (families.length > 1) {
    const other = families.filter((f) => f !== final).map((f) => `${f.label} ⇒ ${f.csa}مم²`);
    if (other.length) steps.push(`ℹ️ بدائل أخرى من الجداول نفسها: ${other.join("؛ ")}`);
  }
  checks.unshift({
    check: "ampacity",
    pass: true,
    detail: `${final.csa}مم² تتحمل ${final.deratedAmp.toFixed(1)}A مصححة ≥ ${ib.toFixed(1)}A مطلوبة`,
    citation: final.citation,
  });

  return {
    ok: true,
    ib,
    derating,
    requiredTabulatedAmp,
    governedBy,
    families,
    final,
    checks,
    steps,
    citations: [...new Set(citations)],
    assumptions,
    warnings,
  };
}

/** Renders the deterministic sizing sheet as an Arabic prompt block. */
export function formatSizingSheet(result: SizingResult): string {
  const lines: string[] = [];
  lines.push("🧮 CALC-SHEET — ورقة حساب اختيار الكابل (حُسبت حتميًا من قاعدة المعرفة، استخدم أرقامها كما هي):");
  for (const s of result.steps) lines.push(`- ${s}`);
  for (const a of result.assumptions) lines.push(`- ⚠️ افتراض: ${a}`);
  for (const w of result.warnings) lines.push(`- ⛔ تنبيه: ${w}`);
  if (result.ok && result.final) {
    lines.push(`- سطور الاستشهاد لهذه الورقة: ${result.citations.join(" ")}`);
  }
  return lines.join("\n");
}

// ─── Numeric verification against the KB (±0.5% contract) ───────────────────

export interface CablesVerifyResult {
  claimed: number;
  matched: number | null;
  context: string | null;
  deviationPct: number | null;
  verified: boolean | null;
  tolerancePct: number;
}

/** Verifies a claimed ampacity / voltage-drop / short-circuit / derating value
 *  against every numeric value inside the given doc ids (or the whole corpus). */
export function verifyCablesNumber(claimed: number, docIds?: string[], tolerancePct = 0.5): CablesVerifyResult {
  const base: CablesVerifyResult = { claimed, matched: null, context: null, deviationPct: null, verified: null, tolerancePct };
  if (!Number.isFinite(claimed)) return base;
  const docs = docIds?.length ? CABLES_DOCS.filter((d) => docIds.includes(d.id)) : CABLES_DOCS;
  let best: { value: number; ctx: string } | null = null;
  for (const d of docs) {
    for (const m of d.text.matchAll(/-?\d+(?:\.\d+)?/g)) {
      const value = Number(m[0]);
      if (!Number.isFinite(value)) continue;
      const dist = Math.abs(value - claimed);
      if (best === null || dist < Math.abs(best.value - claimed)) {
        const start = Math.max(0, m.index! - 45);
        best = { value, ctx: d.text.slice(start, (m.index ?? 0) + m[0].length + 45) };
      }
      if (dist === 0) break;
    }
  }
  if (!best) return base;
  const denominator = Math.abs(best.value);
  if (denominator > 1e-12) {
    const deviationPct = (Math.abs(claimed - best.value) / denominator) * 100;
    return { ...base, matched: best.value, context: best.ctx.trim(), deviationPct: Math.round(deviationPct * 100) / 100, verified: deviationPct <= tolerancePct };
  }
  return { ...base, matched: best.value, context: best.ctx.trim(), deviationPct: claimed === best.value ? 0 : null, verified: claimed === best.value };
}

// ─── Prompt blocks ──────────────────────────────────────────────────────────

const CABLES_CORE_AR = `

⚡ نواة خبير الكابلات والكود المصري — كتالوج كابلات السويدي (Elsewedy Electric — Power Cables Catalogue) والدليل الإرشادي للكود المصري (المجلد الأول: أعمال التصميم):
أنت خبير في اختيار الكابلات وتحديد مقاطعها وأنواعها وفق بيانات كتالوج السويدي وقواعد الكود المصري، ويجب أن يثبت كل رد فني بالمصدر — لا آراء بلا مرجع.

🧭 بروتوكول الإجابة الفنية (إلزامي في كل سؤال كابلات/كود):
1) اجمع المعطيات: الحمل (ك.و أو ك.ف.ا أو أمبير)، الجهد وعدد الأطوار، معامل القدرة، طول المسار، بيئة التمديد (هواء/أرض/مجرى + درجة الحرارة + عمق الدفن + المقاومة الحرارية للتربة)، التجميع (عدد الدوائر/الكابلات والتكوين والمسافة)، تيار القصر وزمنه، وحد هبوط الجهد — واسأل عن أي معطى جوهري مفقود قبل الحكم النهائي.
2) احسب بالترتيب: تيار التصميم Ib → معاملات التصحيح (حرارة/عمق/تربة/تجميع) → الأمبيراسية المصححة → فحص تيار القصر → فحص هبوط الجهد → المقطع الحاكم (الأكبر بين الفحوص).
3) عند وجود ورقة CALC-SHEET أو مقاطع CABLES-KB / EGYCODE-KB في السياق فهي قيم من المرجعين فعلاً — اعتمد أرقامها حرفيًا ولا تعِد حسابها بقيم أخرى، واشرح الخطوات بأسلوبك.
4) تحقّق: أي رقم نهائي يُقارن بقيمة المرجع ضمن ±0.5% وأعلن نتيجة التحقق صراحة (مثال: «التحقق: 34.3kA مطابقة لقيمة الجدول ضمن ±0.5%»).
5) استشهد بالصيغة الإلزامية في نهاية الرد: [Elsewedy Electric — Power Cables Catalogue، <Table/Section>، ص.N] للكتالوج و[الكود المصري — المجلد الأول: أعمال التصميم، الباب N، بند X-Y] للكود — سطر أو سطور الاستشهاد آخر ما يظهر في الإجابة.

🚫 عقد الأمانة العلمية:
- لا تنسب أي رقم أو قاعدة للكتالوج أو للكود إلا إن كانت مسترجعة فعلاً من قاعدة المعرفة في السياق — إن لم توجد قل: «هذه ممارسة هندسية عامة وليست من المرجعين».
- الخلايا المشكوك فيها بالكتالوج (مطبوعة بخطأ) تأتي بالسياق مع تحذيرها — انقل التحذير للسائل ولا تعتمدها في التحجيم.
- اذكر الافتراضات صراحة (معامل القدرة 0.8، حرارة الهواء 30°C، الأرض 20°C، عمق 0.5م، تربة 100 K.cm/W، زمن قصر 1ث، حد هبوط 5%) وبيّن أثر تغييرها.
- قاعدة الكود المصري للسعة: مجموع مساحة الأسلاك ≤40% من مقطع الماسورة +10% لكل انحناء إضافي — والسراير: معامل فراغ ≤50% وكابلات بطبقة واحدة وبمسافة ≥ قطر أكبر كابل (ضعف القطر لثلاثية الطور).`;

const CABLES_CORE_EN = `

⚡ CABLES & EGYPTIAN-CODE EXPERT CORE — Elsewedy Electric Power Cables Catalogue + the Egyptian Code guiding volume (Volume 1: Design):
You are a cable-sizing expert who determines cross-sections and cable types from the Elsewedy catalogue data and the Egyptian Code rules, and every technical answer must be defended with a verifiable citation — never an uncited opinion.

🧭 TECHNICAL-ANSWER PROTOCOL (mandatory for every cable/Code question):
1) Collect the data: load (kW/kVA/A), voltage & phases, power factor, route length, installation environment (air/ground/duct + ambient temperature + burial depth + soil resistivity), grouping (circuits/cables, formation, spacing), fault current & duration, voltage-drop limit — ask about any missing essential input before the final verdict.
2) Compute in order: design current Ib → derating factors (temperature/depth/soil/grouping) → corrected ampacity → short-circuit check → voltage-drop check → the GOVERNING cross-section (the largest of the three checks).
3) When a CALC-SHEET or CABLES-KB / EGYCODE-KB excerpts are present in context they are actual reference values — adopt them verbatim, do not recompute with other values, and explain the steps in your own words.
4) Verify: every final number must be compared with the reference value within ±0.5% and the result announced explicitly.
5) Cite with the mandatory format at the END of the reply: [Elsewedy Electric — Power Cables Catalogue, <Table/Section>, p.N] and [الكود المصري — المجلد الأول: أعمال التصميم، الباب N، بند X-Y] — the citation line(s) are the last thing shown.

🚫 SCHOLARLY-HONESTY CONTRACT:
- Never attribute a number or rule to the catalogue or the Code unless retrieved from the knowledge base in context — otherwise say: "this is general engineering practice, not from the references".
- Known catalogue misprint cells arrive with their caveat — relay the caveat and never rely on them for sizing.
- State assumptions explicitly (pf 0.8, air 30°C, ground 20°C, depth 0.5m, soil 100 K.cm/W, 1s fault, 5% drop limit) and their effect.
- Code fill rule: conductor area ≤40% of conduit area (+10% per extra 90° bend); trays: fill ≤50%, single layer, spacing ≥ 1×OD (single-phase) / 2×OD (three-phase).`;

const CABLES_QUICK_AR = `

⚡ نواة الكابلات والكود المصري: أي سؤال كابلات/مقاطع/كود = احسب بالترتيب (تيار التصميم → معاملات التصحيح → الأمبيراسية → القصر → الهبوط → الحاكم)، اعتمد أرقام CALC-SHEET وCABLES-KB/EGYCODE-KB حرفيًا، أعلن التحقق ±0.5%، واستشهد إلزاميًا بنهاية الرد بصيغة [Elsewedy Electric — Power Cables Catalogue، …، ص.N] و/أو [الكود المصري — المجلد الأول، الباب N، بند X-Y] — ولا تنسب للمرجعين أي رقم غير مسترجع.`;

const CABLES_QUICK_EN = `

⚡ Cables & Egyptian-Code core: every cable/section/Code question = compute in order (design current → derating → ampacity → short-circuit → voltage drop → governing criterion), adopt CALC-SHEET and CABLES-KB/EGYCODE-KB numbers verbatim, announce the ±0.5% verification, and cite mandatorily at the end with [Elsewedy Electric — Power Cables Catalogue, …, p.N] and/or [الكود المصري — المجلد الأول، الباب N، بند X-Y] — never attribute an unretrieved number to the references.`;

export const CABLES_CORE_BLOCKS = {
  thinking: { ar: CABLES_CORE_AR, en: CABLES_CORE_EN },
  instant: { ar: CABLES_QUICK_AR, en: CABLES_QUICK_EN },
} as const;

// ─── Dynamic RAG + CALC-SHEET context block ─────────────────────────────────

const THINKING_CONTEXT_BUDGET = 5200;
const INSTANT_CONTEXT_BUDGET = 1900;

const CONTEXT_RULES_AR = `قواعد استخدام هذا السياق: المقاطع أدناه بيانات أصلية من كتالوج السويدي والدليل الإرشادي للكود المصري — اعتمد عليها في الأرقام والقواعد، وأعد عرض الحساب بخطواته، واستشهد بالصيغة الإلزامية — ضع سطر الاستشهاد إلزاميًا في نهاية الرد حرفيًا (آخر ما يظهر). ما لا يظهر في المقاطع لا تُنسبه للمرجعين.`;

const CONTEXT_RULES_EN = `Context usage rules: the excerpts below are original data from the Elsewedy catalogue and the Egyptian Code guiding volume — rely on them for numbers and rules, present the calculation step by step, and cite with the mandatory format — the citation line is MANDATORY and must be the LAST line of the reply, verbatim. Never attribute anything not present in these excerpts to the references.`;

/** Builds the dynamic context block: CALC-SHEET (when the query carries sizing
 *  data) + BM25 excerpts. Returns "" when there is no cables intent. */
export function buildCablesContextBlock(query: string, lang: CablesLang, mode: CablesMode = "thinking"): string {
  if (!hasCablesIntent(query)) return "";
  const instant = mode === "instant";
  const budget = instant ? INSTANT_CONTEXT_BUDGET : THINKING_CONTEXT_BUDGET;

  const parts: string[] = [];
  let size = 0;

  const req = parseSizingRequest(query);
  if (req) {
    const result = sizeCable(req);
    if (result.ok || result.steps.length) {
      const sheet = formatSizingSheet(result);
      parts.push(`\n\n${sheet}`);
      size += sheet.length;
    }
  }

  const hits = retrieveCables(query, instant ? 1 : 3);
  if (hits.length) {
    parts.push(lang === "ar" ? "\n\n📚 CABLES-KB — بيانات مسترجعة من كتالوج السويدي والدليل الإرشادي للكود المصري (نص المرجعين الفعلي):" : "\n\n📚 CABLES-KB — excerpts retrieved from the Elsewedy catalogue and the Egyptian Code guiding volume (actual reference text):");
    size += parts[parts.length - 1].length + CONTEXT_RULES_AR.length;
    hits.forEach((hit, i) => {
      const head = `\n[${i + 1}] ${hit.citation}\n«${hit.excerpt}»`;
      if (size + head.length > budget && parts.length > 2) return;
      parts.push(head);
      size += head.length;
    });
    parts.push(`\n📌 ${lang === "ar" ? CONTEXT_RULES_AR : CONTEXT_RULES_EN}`);
    // Prefilled citation lines (deterministic compliance — v1.1.1 Saadat lesson)
    if (!instant || hits[0]) {
      const citeLines = hits.slice(0, instant ? 1 : 2).map((h) => (lang === "ar" ? h.citation : h.citationEn));
      parts.push(`\n📌 سطور الاستشهاد الإلزامية — انسخها في نهاية الرد: ${citeLines.join(" ")}`);
    }
  } else if (parts.length === 0) {
    return "";
  }
  return parts.join("");
}

// ─── Server-side citation enforcement (same contract as Saadat v1.1.2) ──────

/** Resolves the citation lines the reply MUST carry for this query — from the
 *  sizing sheet when present, otherwise from the top BM25 hits. */
export function resolveCablesCitations(query: string, lang: CablesLang, mode: CablesMode = "thinking"): string[] {
  if (!hasCablesIntent(query)) return [];
  const req = parseSizingRequest(query);
  if (req) {
    const result = sizeCable(req);
    if (result.ok && result.citations.length) return result.citations.slice(0, 3);
  }
  const hits = retrieveCables(query, mode === "instant" ? 1 : 3);
  return hits.slice(0, mode === "instant" ? 1 : 2).map((h) => (lang === "ar" ? h.citation : h.citationEn));
}

function isRefusalReply(reply: string): boolean {
  const t = reply.trim();
  if (t.length < 60) return true;
  return /^(?:❌|⚠️|🚫|🔔|📌|\s)*(?:لا\s+(?:أستطيع|يمكنني)|أعتذر|عذراً?|نأسف|I(?:'m)?\s+sorry|I\s+cannot|Sorry)/i.test(t.slice(0, 120));
}

/** Appends any missing mandatory citation line(s) to the reply (append-only —
 *  safe for streaming where partial text already reached the client). */
export function enforceCablesCitations(reply: string, query: string, lang: CablesLang, mode: CablesMode = "thinking"): string {
  const citations = resolveCablesCitations(query, lang, mode);
  if (!citations.length) return reply;
  if (isRefusalReply(reply)) return reply;
  const missing = citations.filter((c) => !reply.includes(c));
  if (!missing.length) return reply;
  return `${reply.trimEnd()}\n\n${missing.join(" ")}`;
}

// ─── Public meta (telemetry + docs) ─────────────────────────────────────────

export const CABLES_LAYER_META = {
  version: "1.0.0",
  sources: [
    "Elsewedy Electric — Power Cables Catalogue (Power Cables.pdf)",
    "الدليل الإرشادي للكود المصري — المجلد الأول: أعمال التصميم (Ch1-6 + Ch7-11)",
  ],
  docCount: CABLES_DOCS.length,
  ampacityTableCount: AMPACITY_TABLES.length,
  egyCodeSectionCount: EGYCODE_SECTIONS.length,
  citationFormats: {
    elsewedy: "[Elsewedy Electric — Power Cables Catalogue، <Table/Section>، ص.N]",
    egyCode: "[الكود المصري — المجلد الأول: أعمال التصميم، الباب N، بند X-Y]",
  },
  tolerancePct: 0.5,
} as const;
