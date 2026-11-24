/**
 * Arabic shaping + bidi for the PDF engine (the only format where shaping
 * must be done by us — DOCX delegates to Word, MD/HTML to the browser).
 *
 * Two deterministic passes over each logical line:
 *  1. shape(): map each Arabic base letter to its presentation form
 *     (U+FE70–FEFF forms-B + lam-alef ligatures) according to its joining
 *     context; everything else passes through. This is the classic
 *     "legacy" model used by WinANSI-era PDFs — enough for reports, since
 *     FreeSerif carries every needed presentation glyph (verified: all of
 *     FE70–FEFC present in the vendored subset).
 *  2. bidi(): split the shaped line into visual runs. Paragraph direction
 *     is set by the caller; runs of LTR content (Latin, digits, units like
 *     "kV", part IDs like "MTZ2") keep internal left-to-right order and are
 *     placed as blocks in the paragraph's visual direction. Neutral chars
 *     (spaces, punctuation) attach to the surrounding run.
 *
 * Not a full UAX #9 engine — a deliberate, bounded subset that is correct
 * for the document shapes this skill produces (technical Arabic reports
 * with embedded Latin terms and numbers).
 */

// Joining type per base letter: D = dual-joining, R = right-joining (joins to
// the previous only), L = left-joining (none in modern standard Arabic), U =
// non-joining. Anything not listed is U (pass-through).
const JOIN: Record<string, "D" | "R" | "U"> = {
  "\u0621": "U", // ء hamza
  "\u0622": "R", // آ alef madda
  "\u0623": "R", // أ alef hamza
  "\u0624": "R", // ؤ waw hamza
  "\u0625": "R", // إ alef hamza below
  "\u0626": "D", // ئ yeh hamza
  "\u0627": "R", // ا alef
  "\u0628": "D", // ب beh
  "\u0629": "R", // ة teh marbuta
  "\u062A": "D", // ت teh
  "\u062B": "D", // ث theh
  "\u062C": "D", // ج jeem
  "\u062D": "D", // ح hah
  "\u062E": "D", // خ khah
  "\u062F": "R", // د dal
  "\u0630": "R", // ذ thal
  "\u0631": "R", // ر reh
  "\u0632": "R", // ز zain
  "\u0633": "D", // س seen
  "\u0634": "D", // ش sheen
  "\u0635": "D", // ص sad
  "\u0636": "D", // ض dad
  "\u0637": "D", // ط tah
  "\u0638": "D", // ظ zah
  "\u0639": "D", // ع ain
  "\u063A": "D", // غ ghain
  "\u0640": "D", // ـ tatweel
  "\u0641": "D", // ف feh
  "\u0642": "D", // ق qaf
  "\u0643": "D", // ك kaf
  "\u0644": "D", // ل lam
  "\u0645": "D", // م meem
  "\u0646": "D", // ن noon
  "\u0647": "D", // ه heh
  "\u0648": "R", // و waw
  "\u0649": "R", // ى alef maksura
  "\u064A": "D", // ي yeh
  // Extended Arabic (Egyptian tech docs occasionally carry these)
  "\u0671": "R", // ٱ alef wasla
  "\u0680": "D", "\u0681": "D", "\u0682": "D", "\u0683": "D", "\u0684": "D",
  "\u0685": "D", "\u0686": "D", "\u0687": "D", "\u0688": "R", "\u0689": "D",
  "\u068A": "D", "\u068B": "D", "\u068C": "R", "\u068D": "R", "\u068E": "R",
  "\u0691": "R", "\u0693": "R", "\u0694": "D", "\u0695": "R", "\u0696": "D",
  "\u0697": "R", "\u0698": "R", "\u069A": "D", "\u069B": "D", "\u069C": "D",
  "\u06A4": "D", "\u06A9": "D", "\u06AF": "D", "\u06CC": "D",
};

// Base → presentation forms [isolated, final, initial, medial] (forms-B).
const FORMS: Record<string, [number, number, number, number]> = {
  "\u0626": [0xFE8B, 0xFE8C, 0xFE89, 0xFE8A], // ئ
  "\u0628": [0xFE8F, 0xFE90, 0xFE91, 0xFE92], // ب
  "\u062A": [0xFE95, 0xFE96, 0xFE97, 0xFE98], // ت
  "\u062B": [0xFE99, 0xFE9A, 0xFE9B, 0xFE9C], // ث
  "\u062C": [0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0], // ج
  "\u062D": [0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4], // ح
  "\u062E": [0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8], // خ
  "\u062F": [0xFEA9, 0xFEAA, 0xFEA9, 0xFEAA], // د
  "\u0630": [0xFEAB, 0xFEAC, 0xFEAB, 0xFEAC], // ذ
  "\u0631": [0xFEAD, 0xFEAE, 0xFEAD, 0xFEAE], // ر
  "\u0632": [0xFEAF, 0xFEB0, 0xFEAF, 0xFEB0], // ز
  "\u0633": [0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4], // س
  "\u0634": [0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8], // ش
  "\u0635": [0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC], // ص
  "\u0636": [0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0], // ض
  "\u0637": [0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4], // ط
  "\u0638": [0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8], // ظ
  "\u0639": [0xFEC9, 0xFECA, 0xFECB, 0xFECC], // ع
  "\u063A": [0xFECD, 0xFECE, 0xFECF, 0xFED0], // غ
  "\u0641": [0xFED1, 0xFED2, 0xFED3, 0xFED4], // ف
  "\u0642": [0xFED5, 0xFED6, 0xFED7, 0xFED8], // ق
  "\u0643": [0xFED9, 0xFEDA, 0xFEDB, 0xFEDC], // ك
  "\u0644": [0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0], // ل
  "\u0645": [0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4], // م
  "\u0646": [0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8], // ن
  "\u0647": [0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC], // ه
  "\u0648": [0xFEED, 0xFEEE, 0xFEED, 0xFEEE], // و
  "\u0649": [0xFEEF, 0xFEF0, 0xFEEF, 0xFEF0], // ى
  "\u064A": [0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4], // ي
  "\u0621": [0xFE80, 0xFE80, 0xFE80, 0xFE80], // ء
  "\u0622": [0xFE81, 0xFE82, 0xFE81, 0xFE82], // آ
  "\u0623": [0xFE83, 0xFE84, 0xFE83, 0xFE84], // أ
  "\u0624": [0xFE85, 0xFE86, 0xFE85, 0xFE86], // ؤ
  "\u0625": [0xFE87, 0xFE88, 0xFE87, 0xFE88], // إ
  "\u0629": [0xFE93, 0xFE94, 0xFE93, 0xFE94], // ة
  "\u0627": [0xFE8D, 0xFE8E, 0xFE8D, 0xFE8E], // ا
  "\u0671": [0xFB50, 0xFB51, 0xFB50, 0xFB51], // ٱ
  "\u06A4": [0xFB6A, 0xFB6B, 0xFB6C, 0xFB6D], // ڤ
  "\u06A9": [0xFB8E, 0xFB8F, 0xFB90, 0xFB91], // ک
  "\u06AF": [0xFB92, 0xFB93, 0xFB94, 0xFB95], // گ
  "\u06CC": [0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF], // ی
};

// Lam-alef ligatures: the ONLY mandatory two-letter ligature. Key = alef variant.
const LAM_ALEF_LIG: Array<{ alef: string; iso: number; fin: number }> = [
  { alef: "\u0627", iso: 0xFEFB, fin: 0xFEFC }, // لا
  { alef: "\u0622", iso: 0xFEF5, fin: 0xFEF6 }, // لآ
  { alef: "\u0623", iso: 0xFEF7, fin: 0xFEF8 }, // لأ
  { alef: "\u0625", iso: 0xFEF9, fin: 0xFEFA }, // لإ
];

const ARABIC_LETTER = /[\u0620-\u064A\u066E-\u06D3\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** Strong LTR: Latin/Greek/Cyrillic letters + digits. Spaces and punctuation
 *  are neutrals — they attach to the run in progress (never split Arabic). */
const LTR_STRONG = /[A-Za-z0-9\u00C0-\u024F\u0370-\u052F]/;

export function isArabicText(text: string): boolean {
  return ARABIC_LETTER.test(text);
}

export type ShapedRun = {
  /** Direction of this run. */
  rtl: boolean;
  /** Shaped codepoints (visual order is decided by the paragraph pass). */
  cps: number[];
};

/**
 * Shape one logical line. Returns the codepoints in LOGICAL order (shaping
 * only — reversal/bidi happens in bidiRuns). Diacritics (harakat 064B–065F)
 * are dropped: the legacy forms-B model has no combining-position support,
 * and unvocalized text is the norm for technical reports.
 */
export function shapeLine(line: string): number[] {
  const src = Array.from(line).filter((ch) => !/[\u064B-\u065F\u0670\u0674]/.test(ch));
  const out: number[] = [];
  let prevJoinable = false; // could the previous letter join forward? (it is D and not final-only)
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (!FORMS[ch]) {
      prevJoinable = false;
      out.push(ch.codePointAt(0) ?? 0x20);
      continue;
    }
    // Lam-alef: ligate when a joining lam meets an alef variant.
    const lamAlef = LAM_ALEF_LIG.find((l) => l.alef === ch);
    const prevIsLam = out.length > 0 && out[out.length - 1] === 0xFEDF; // shaped lam initial
    if (lamAlef && prevIsLam) {
      out.pop();
      out.push(prevJoinable ? lamAlef.fin : lamAlef.iso);
      prevJoinable = false;
      continue;
    }
    const nextCh = src[i + 1];
    const nextJoinable = !!nextCh && !!FORMS[nextCh] && JOIN[nextCh] !== "U";
    const joinsPrev = prevJoinable;
    const joinsNext = JOIN[ch] !== "U" && nextJoinable;
    const form = FORMS[ch];
    let cp: number;
    if (joinsPrev && joinsNext && JOIN[ch] === "D") cp = form[3]; // medial
    else if (joinsPrev) cp = form[1]; // final
    else if (joinsNext) cp = form[2]; // initial
    else cp = form[0]; // isolated
    out.push(cp);
    prevJoinable = JOIN[ch] === "D" && joinsNext;
  }
  return out;
}

/**
 * Split a shaped logical line into bidi runs — simplified UAX #9:
 *   strong chars → R/L; neutrals resolve N1-style (same-direction bounding
 *   strongs take it; differing or one-sided neutrals take the PARAGRAPH
 *   direction). This is what makes a leading bullet sit at the line's right
 *   edge in RTL, and "(4)" hug the Arabic instead of the number.
 * Returns runs in VISUAL (paint left→right) order with per-run direction;
 * RTL runs carry reversed codepoints + mirrored brackets.
 */
export function bidiRuns(cps: number[], paragraphRtl: boolean): ShapedRun[] {
  const isRtlCp = (cp: number) => (cp >= 0x0600 && cp <= 0x06ff) || (cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff);
  const isLtrStrongCp = (cp: number) => LTR_STRONG.test(String.fromCodePoint(cp));

  type Cls = "R" | "L" | "N";
  const classes: Cls[] = cps.map((cp) => (isRtlCp(cp) ? "R" : isLtrStrongCp(cp) ? "L" : "N"));

  // ── Bracket-pair resolution (UAX #9 N0, simplified) ──
  // A matched bracket pair takes the direction of the strong content it
  // encloses when that content is directionally consistent ([1] → L); a
  // mixed or empty enclosure falls back to the paragraph direction. This
  // keeps "[1]" glued to its number and lets "(أمبيراسية XLPE)" hug the
  // Arabic stream. Note: NO glyph mirroring anywhere — the reversal below
  // already places each bracket glyph on its correct visual side.
  const pairDir: Array<"R" | "L" | null> = new Array(cps.length).fill(null);
  const OPEN: Record<number, number> = { 40: 0x29, 91: 0x5d, 123: 0x7d };
  const CLOSE = new Set([0x29, 0x5d, 0x7d]);
  const stack: Array<{ open: number; idx: number }> = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (OPEN[cp] !== undefined) stack.push({ open: cp, idx: i });
    else if (CLOSE.has(cp)) {
      const top = stack[stack.length - 1];
      if (top && OPEN[top.open] === cp) {
        stack.pop();
        let enclosed: "R" | "L" | null = null;
        let mixed = false;
        for (let j = top.idx + 1; j < i; j++) {
          if (classes[j] === "N") continue;
          if (enclosed === null) enclosed = classes[j] as "R" | "L";
          else if (enclosed !== classes[j]) mixed = true;
        }
        const dir: "R" | "L" = enclosed && !mixed ? enclosed : paragraphRtl ? "R" : "L";
        pairDir[top.idx] = dir;
        pairDir[i] = dir;
      } else if (top) {
        // Unmatched close — drop inner openers until a match or empty.
        while (stack.length && OPEN[stack[stack.length - 1].open] !== cp) stack.pop();
        if (stack.length) {
          const m = stack.pop()!;
          let enclosed: "R" | "L" | null = null;
          let mixed = false;
          for (let j = m.idx + 1; j < i; j++) {
            if (classes[j] === "N") continue;
            if (enclosed === null) enclosed = classes[j] as "R" | "L";
            else if (enclosed !== classes[j]) mixed = true;
          }
          const dir: "R" | "L" = enclosed && !mixed ? enclosed : paragraphRtl ? "R" : "L";
          pairDir[m.idx] = dir;
          pairDir[i] = dir;
        }
      }
    }
  }

  // ── nextStrong + neutral resolution (N1/N2) ──
  const nextStrong: Array<"R" | "L" | null> = new Array(cps.length);
  let scan: "R" | "L" | null = null;
  for (let i = cps.length - 1; i >= 0; i--) {
    nextStrong[i] = scan;
    if (classes[i] !== "N" || pairDir[i]) scan = pairDir[i] ?? (classes[i] as "R" | "L");
  }

  const resolved: Array<"R" | "L"> = new Array(cps.length);
  let lastStrong: "R" | "L" | null = null;
  for (let i = 0; i < cps.length; i++) {
    if (pairDir[i]) {
      resolved[i] = pairDir[i]!;
      lastStrong = pairDir[i]!;
      continue;
    }
    const c = classes[i];
    if (c === "N") {
      const nxt = nextStrong[i];
      let dir: "R" | "L";
      if (lastStrong && nxt && lastStrong === nxt) dir = lastStrong; // N1: surrounded by the same direction
      else dir = paragraphRtl ? "R" : "L"; // differing bounds / line edges → paragraph direction
      resolved[i] = dir;
    } else {
      resolved[i] = c;
      lastStrong = c;
    }
  }

  // Group consecutive same-direction codepoints into runs (logical order).
  type Seg = { rtl: boolean; cps: number[] };
  const segs: Seg[] = [];
  for (let i = 0; i < cps.length; i++) {
    const rtl = resolved[i] === "R";
    if (!segs.length || segs[segs.length - 1].rtl !== rtl) segs.push({ rtl, cps: [] });
    segs[segs.length - 1].cps.push(cps[i]);
  }

  // Visual order: RTL paragraph lays segments out from the right — the LAST
  // logical segment is painted FIRST (leftmost), so the sentence start lands
  // at the right edge. RTL runs carry reversed codepoints; glyphs are never
  // mirrored (reversal already yields the correct visual brackets).
  if (paragraphRtl) return [...segs].reverse().map((s) => ({ rtl: s.rtl, cps: s.rtl ? [...s.cps].reverse() : s.cps }));
  return segs.map((s) => ({ rtl: s.rtl, cps: s.rtl ? [...s.cps].reverse() : s.cps }));
}
