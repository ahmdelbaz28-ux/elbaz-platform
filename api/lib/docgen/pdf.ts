/**
 * PDF renderer — DocSpec → single-file PDF 1.4 with full Arabic support.
 *
 * Zero dependencies: node:zlib compresses streams, the two vendored font
 * subsets (GNU FreeFont — GPL + font-embedding exception) are embedded as
 * CIDFontType2/Identity-H, Arabic shaping + bidi come from ./shape.ts and
 * glyph geometry from ./font.ts. Deterministic: same spec → byte-identical
 * PDF (fixed dates, no IDs).
 *
 * Layout vocabulary: A4 portrait, RTL-first typography (Arabic documents
 * right-aligned with bidi runs; Latin paragraphs left-aligned), wrapped
 * paragraphs, bullets, bordered tables with RTL column order, a citations
 * section, and a per-page footer with page numbers. It is a REPORT engine —
 * the shapes a technical chatbot actually produces.
 */
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseTtf, textWidthUnits, type FontData } from "./font.js";
import { bidiRuns, shapeLine, isArabicText } from "./shape.js";
import type { NormalizedDocSpec } from "./spec.js";

// ─── Geometry (pt) ───────────────────────────────────────────────────────────
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP_Y = MARGIN; // y cursor measured from the top
const BOTTOM_LIMIT = PAGE_H - MARGIN - 30; // leave room for the footer

// Palette (same family as the chat UI: dark navy + cyan accents).
const INK = [0.09, 0.14, 0.23];
const INK_SOFT = [0.35, 0.42, 0.52];
const ACCENT = [0.05, 0.46, 0.56];
const HEAD_FILL = [0.93, 0.95, 0.98];
const RULE = [0.48, 0.58, 0.71];

const LINE_FACTOR = 1.62; // generous leading for Arabic descenders

// ─── Fonts ───────────────────────────────────────────────────────────────────
const FONTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");

let fontRegular: FontData | null = null;
let fontBold: FontData | null = null;
let fontRegularBytes: Uint8Array | null = null;
let fontBoldBytes: Uint8Array | null = null;

function loadFonts(): { regular: FontData; bold: FontData; regularBytes: Uint8Array; boldBytes: Uint8Array } {
  if (!fontRegular || !fontBold || !fontRegularBytes || !fontBoldBytes) {
    fontRegularBytes = readFileSync(join(FONTS_DIR, "docgen-serif.ttf"));
    fontBoldBytes = readFileSync(join(FONTS_DIR, "docgen-serif-bold.ttf"));
    fontRegular = parseTtf(fontRegularBytes);
    fontBold = parseTtf(fontBoldBytes);
  }
  return { regular: fontRegular, bold: fontBold, regularBytes: fontRegularBytes, boldBytes: fontBoldBytes };
}

// Presentation form → base letter (for ToUnicode: copied text carries real
// base letters, not presentation codepoints).
const PRES_TO_BASE: Map<number, string> = (() => {
  const m = new Map<number, string>();
  // Lazy require would break ESM lint — the tables live in shape.ts but are
  // not exported; a local mirror of the FE70 block is deterministic and small.
  const pairs: Array<[number, number]> = [
    [0xFE80, 0x0621], [0xFE81, 0x0622], [0xFE82, 0x0622], [0xFE83, 0x0623], [0xFE84, 0x0623],
    [0xFE85, 0x0624], [0xFE86, 0x0624], [0xFE87, 0x0625], [0xFE88, 0x0625], [0xFE89, 0x0626],
    [0xFE8A, 0x0626], [0xFE8B, 0x0626], [0xFE8C, 0x0626], [0xFE8D, 0x0627], [0xFE8E, 0x0627],
    [0xFE8F, 0x0628], [0xFE90, 0x0628], [0xFE91, 0x0628], [0xFE92, 0x0628], [0xFE93, 0x0629],
    [0xFE94, 0x0629], [0xFE95, 0x062A], [0xFE96, 0x062A], [0xFE97, 0x062A], [0xFE98, 0x062A],
    [0xFE99, 0x062B], [0xFE9A, 0x062B], [0xFE9B, 0x062B], [0xFE9C, 0x062B], [0xFE9D, 0x062C],
    [0xFE9E, 0x062C], [0xFE9F, 0x062C], [0xFEA0, 0x062C], [0xFEA1, 0x062D], [0xFEA2, 0x062D],
    [0xFEA3, 0x062D], [0xFEA4, 0x062D], [0xFEA5, 0x062E], [0xFEA6, 0x062E], [0xFEA7, 0x062E],
    [0xFEA8, 0x062E], [0xFEA9, 0x062F], [0xFEAA, 0x062F], [0xFEAB, 0x0630], [0xFEAC, 0x0630],
    [0xFEAD, 0x0631], [0xFEAE, 0x0631], [0xFEAF, 0x0632], [0xFEB0, 0x0632], [0xFEB1, 0x0633],
    [0xFEB2, 0x0633], [0xFEB3, 0x0633], [0xFEB4, 0x0633], [0xFEB5, 0x0634], [0xFEB6, 0x0634],
    [0xFEB7, 0x0634], [0xFEB8, 0x0634], [0xFEB9, 0x0635], [0xFEBA, 0x0635], [0xFEBB, 0x0635],
    [0xFEBC, 0x0635], [0xFEBD, 0x0636], [0xFEBE, 0x0636], [0xFEBF, 0x0636], [0xFEC0, 0x0636],
    [0xFEC1, 0x0637], [0xFEC2, 0x0637], [0xFEC3, 0x0637], [0xFEC4, 0x0637], [0xFEC5, 0x0638],
    [0xFEC6, 0x0638], [0xFEC7, 0x0638], [0xFEC8, 0x0638], [0xFEC9, 0x0639], [0xFECA, 0x0639],
    [0xFECB, 0x0639], [0xFECC, 0x0639], [0xFECD, 0x063A], [0xFECE, 0x063A], [0xFECF, 0x063A],
    [0xFED0, 0x063A], [0xFED1, 0x0641], [0xFED2, 0x0641], [0xFED3, 0x0641], [0xFED4, 0x0641],
    [0xFED5, 0x0642], [0xFED6, 0x0642], [0xFED7, 0x0642], [0xFED8, 0x0642], [0xFED9, 0x0643],
    [0xFEDA, 0x0643], [0xFEDB, 0x0643], [0xFEDC, 0x0643], [0xFEDD, 0x0644], [0xFEDE, 0x0644],
    [0xFEDF, 0x0644], [0xFEE0, 0x0644], [0xFEE1, 0x0645], [0xFEE2, 0x0645], [0xFEE3, 0x0645],
    [0xFEE4, 0x0645], [0xFEE5, 0x0646], [0xFEE6, 0x0646], [0xFEE7, 0x0646], [0xFEE8, 0x0646],
    [0xFEE9, 0x0647], [0xFEEA, 0x0647], [0xFEEB, 0x0647], [0xFEEC, 0x0647], [0xFEED, 0x0648],
    [0xFEEE, 0x0648], [0xFEEF, 0x0649], [0xFEF0, 0x0649], [0xFEF1, 0x064A], [0xFEF2, 0x064A],
    [0xFEF3, 0x064A], [0xFEF4, 0x064A],
    [0xFEF5, 0x0644], [0xFEF6, 0x0644], [0xFEF7, 0x0644], [0xFEF8, 0x0644],
    [0xFEF9, 0x0644], [0xFEFA, 0x0644], [0xFEFB, 0x0644], [0xFEFC, 0x0644],
  ];
  for (const [pres, base] of pairs) m.set(pres, String.fromCodePoint(base));
  return m;
})();

function toUnicodeFor(cp: number): string {
  const base = PRES_TO_BASE.get(cp);
  return base ?? String.fromCodePoint(cp);
}

// ─── Small PDF text helpers ──────────────────────────────────────────────────

const n2 = (x: number) => (Math.round(x * 100) / 100).toString();
const hex4 = (cp: number) => cp.toString(16).toUpperCase().padStart(4, "0");

interface DrawFont {
  data: FontData;
  /** PDF resource name (F1 / F2). */
  ref: string;
  /** Used glyph ids in first-use order (drives /W + ToUnicode). */
  usedGids: Map<number, number[]>; // gid → shaped codepoints (for ToUnicode)
}

function gidFor(font: FontData, cp: number): number {
  return font.charMap.get(cp) ?? font.charMap.get(0x20) ?? 0;
}

function runWidth(font: FontData, cps: readonly number[], size: number): number {
  return (textWidthUnits(font, cps) / font.unitsPerEm) * size;
}

/** Escape-free CID text op: `x y F# size <hex> Tj` with cursor-based Tm. */
function textOp(font: DrawFont, cps: readonly number[], x: number, yPdf: number, size: number): string {
  let hex = "";
  for (const cp of cps) {
    const gid = gidFor(font.data, cp);
    if (!font.usedGids.has(gid)) font.usedGids.set(gid, [cp]);
    hex += hex4(gid);
  }
  return `BT /${font.ref} ${n2(size)} Tf 1 0 0 1 ${n2(x)} ${n2(yPdf)} Tm <${hex}> Tj ET`;
}

// ─── Layout ──────────────────────────────────────────────────────────────────

interface PageOps {
  ops: string[];
}
interface WrapWord {
  cps: number[];
  width: number;
  space: boolean; // separator space after this word (rendered as a run)
}

function tokenizeWords(text: string, font: FontData, size: number): WrapWord[] {
  const words = text.split(" ").filter((w) => w.length > 0);
  const spaceCps = [0x20];
  const spaceW = runWidth(font, spaceCps, size);
  return words.map((w) => {
    const cps = shapeLine(w);
    return { cps, width: runWidth(font, cps, size), space: false };
  }).flatMap((w, i) => (i < words.length - 1 ? [w, { cps: spaceCps, width: spaceW, space: true }] : [w]));
}

function wrapLine(text: string, font: FontData, size: number, maxWidth: number): number[][] {
  // Returns arrays of SHAPED cps per line (logical order — bidi runs per line at draw time).
  const tokens = tokenizeWords(text, font, size);
  const lines: number[][] = [];
  let line: number[] = [];
  let w = 0;
  for (const tok of tokens) {
    if (tok.cps.length === 1 && tok.cps[0] === 0x20) {
      if (line.length) {
        line.push(0x20);
        w += tok.width;
      }
      continue;
    }
    if (line.length && w + tok.width > maxWidth) {
      // flush (drop trailing space)
      while (line.length && line[line.length - 1] === 0x20) line.pop();
      lines.push(line);
      line = [];
      w = 0;
    }
    // Overlong single token → hard-chunk it.
    if (tok.width > maxWidth && line.length === 0) {
      let chunk: number[] = [];
      let cw = 0;
      for (const cp of tok.cps) {
        const cpW = runWidth(font, [cp], size);
        if (cw + cpW > maxWidth && chunk.length) {
          lines.push(chunk);
          chunk = [];
          cw = 0;
        }
        chunk.push(cp);
        cw += cpW;
      }
      line = chunk;
      w = cw;
      continue;
    }
    line.push(...tok.cps);
    w += tok.width;
  }
  if (line.length) {
    while (line.length && line[line.length - 1] === 0x20) line.pop();
    if (line.length) lines.push(line);
  }
  return lines;
}

// ─── Document builder ────────────────────────────────────────────────────────

export function renderPdf(spec: NormalizedDocSpec): Uint8Array {
  const { regular, bold, regularBytes, boldBytes } = loadFonts();

  const F1: DrawFont = { data: regular, ref: "F1", usedGids: new Map() };
  const F2: DrawFont = { data: bold, ref: "F2", usedGids: new Map() };

  const pages: PageOps[] = [{ ops: [] }];
  let y = TOP_Y;

  const newPage = () => {
    pages.push({ ops: [] });
    y = TOP_Y;
  };
  const ensure = (h: number) => {
    if (y + h > BOTTOM_LIMIT) newPage();
  };
  const cur = () => pages[pages.length - 1];
  const pdfY = (topY: number, size: number) => PAGE_H - topY - size * 0.92; // baseline ≈ 0.92×size below the top edge of the line box

  const drawLineOfRuns = (cps: number[], xStart: number, size: number, font: DrawFont, alignRight: boolean, boxWidth: number) => {
    const runs = bidiRuns(cps, alignRight);
    const widths = runs.map((r) => runWidth(font.data, r.cps, size));
    const total = widths.reduce((a, b) => a + b, 0);
    // Right-aligned RTL lines start from the right edge; LTR from the left.
    let x = alignRight ? xStart + (boxWidth - total) : xStart;
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].cps.length === 0) continue;
      cur().ops.push(textOp(font, runs[i].cps, x, pdfY(y, size), size));
      x += widths[i];
    }
    y += size * LINE_FACTOR;
  };

  const paragraph = (text: string, size: number, font: DrawFont, opts: { alignRight?: boolean; color?: number[]; gapAfter?: number } = {}) => {
    const alignRight = opts.alignRight ?? isArabicText(text);
    const lines = wrapLine(text, font.data, size, CONTENT_W);
    cur().ops.push(`${opts.color ? `${opts.color.map(n2).join(" ")} rg` : `${INK.map(n2).join(" ")} rg`}`);
    for (const line of lines) drawLineOfRuns(line, MARGIN, size, font, alignRight, CONTENT_W);
    y += opts.gapAfter ?? size * 0.55;
  };

  const heading = (text: string) => {
    ensure(46);
    cur().ops.push(`${ACCENT.map(n2).join(" ")} rg`);
    drawLineOfRuns([...shapeLine(text)], MARGIN, 14.5, F2, isArabicText(text), CONTENT_W);
    // accent underline bar
    const lineY = PAGE_H - y - 3;
    cur().ops.push(`${n2(MARGIN)} ${n2(lineY)} ${n2(CONTENT_W)} 0.9 re f`);
    y += 10;
  };

  const bullet = (text: string) => {
    const marked = `•  ${text}`;
    paragraph(marked, 11, F1, { gapAfter: 2 });
  };

  const table = (t: { headers: string[]; rows: string[][] }) => {
    const cellFont = F1;
    const cellSize = 9;
    const pad = 5;
    // Logical column widths from max content width, clamped + normalized.
    const colW = t.headers.map((h, i) => {
      const cells = [h, ...t.rows.map((r) => r[i] ?? "")];
      const maxW = Math.max(...cells.map((c) => runWidth(cellFont.data, shapeLine(c), cellSize))) + pad * 2 + 8;
      return Math.min(Math.max(maxW, 52), CONTENT_W);
    });
    const sum = colW.reduce((a, b) => a + b, 0);
    const scale = CONTENT_W / sum;
    const widths = colW.map((w) => w * scale);
    // RTL table: the FIRST logical column renders rightmost (Word's
    // bidiVisual behavior) — paint columns right→left in logical order.
    const order = widths.map((_, i) => i);

    const rowLines = (row: string[], widthList: number[]) =>
      Math.max(
        ...row.map((c, i) => wrapLine(c, cellFont.data, cellSize, Math.max(widthList[i] - pad * 2, 30)).length),
        1,
      );

    const headerH = rowLines(t.headers, widths) * cellSize * LINE_FACTOR + pad;
    ensure(headerH + cellSize * LINE_FACTOR + pad * 2);

    const drawRow = (cells: string[], widthsList: number[], isHeader: boolean) => {
      const lineCount = rowLines(cells, widthsList);
      const rowH = lineCount * cellSize * LINE_FACTOR + pad;
      ensure(rowH + 4);
      const rowTop = y;
      let x = MARGIN + CONTENT_W; // right edge
      for (let vi = 0; vi < order.length; vi++) {
        const li = order[vi];
        const w = widthsList[li];
        x -= w;
        const cellText = cells[li] ?? "";
        const cellLines = wrapLine(cellText, cellFont.data, cellSize, Math.max(w - pad * 2, 30));
        const isAr = isArabicText(cellText);
        // Numeric-only cells center; Arabic cells right-align; Latin left.
        const isNumeric = /^[\d.,%\s+\-×/:]+$/u.test(cellText) && /\d/.test(cellText);
        cur().ops.push(`${(isHeader ? ACCENT : INK).map(n2).join(" ")} rg`);
        let cy = rowTop + pad * 0.4;
        for (const line of cellLines) {
          const lineW = runWidth(cellFont.data, line, cellSize);
          const xStart = isNumeric ? x + (w - lineW) / 2 : isAr ? x + (w - lineW) - pad : x + pad;
          cur().ops.push(textOp(isHeader ? F2 : cellFont, line, xStart, PAGE_H - cy - cellSize * 0.95, cellSize));
          cy += cellSize * LINE_FACTOR;
        }
      }
      // borders
      cur().ops.push(`${RULE.map(n2).join(" ")} RG 0.7 w`);
      let bx = MARGIN + CONTENT_W;
      for (const w of widthsList) {
        bx -= w;
        cur().ops.push(`${n2(bx)} ${n2(PAGE_H - rowTop - rowH)} m ${n2(bx)} ${n2(PAGE_H - rowTop)} l S`);
      }
      cur().ops.push(`${n2(MARGIN)} ${n2(PAGE_H - rowTop - rowH)} m ${n2(MARGIN + CONTENT_W)} ${n2(PAGE_H - rowTop - rowH)} l S`);
      cur().ops.push(`${n2(MARGIN)} ${n2(PAGE_H - rowTop)} m ${n2(MARGIN + CONTENT_W)} ${n2(PAGE_H - rowTop)} l S`);
      y = rowTop + rowH;
    };

    // Header fill
    const headerFillY = PAGE_H - y - headerH;
    cur().ops.push(`${HEAD_FILL.map(n2).join(" ")} rg`);
    cur().ops.push(`${n2(MARGIN)} ${n2(headerFillY)} ${n2(CONTENT_W)} ${n2(headerH)} re f`);
    drawRow(t.headers, widths, true);
    for (const row of t.rows) drawRow(row, widths, false);
    y += 8;
  };

  // ── Content assembly ──
  // Title block
  cur().ops.push(`${INK.map(n2).join(" ")} rg`);
  {
    const lines = wrapLine(spec.title, bold, 20, CONTENT_W);
    for (const line of lines) drawLineOfRuns(line, MARGIN, 20, F2, isArabicText(spec.title), CONTENT_W);
  }
  y += 4;
  if (spec.subtitle) {
    cur().ops.push(`${INK_SOFT.map(n2).join(" ")} rg`);
    for (const line of wrapLine(spec.subtitle, regular, 11.5, CONTENT_W)) drawLineOfRuns(line, MARGIN, 11.5, F1, isArabicText(spec.subtitle), CONTENT_W);
  }
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  cur().ops.push(`${INK_SOFT.map(n2).join(" ")} rg`);
  paragraph(`ELBAZ Platform — تم إنشاء هذا الملف آلياً في ${stamp} UTC`, 8.5, F1, { alignRight: true, color: INK_SOFT, gapAfter: 6 });
  cur().ops.push(`${ACCENT.map(n2).join(" ")} RG 1.2 w`);
  cur().ops.push(`${n2(MARGIN)} ${n2(PAGE_H - y)} m ${n2(MARGIN + CONTENT_W)} ${n2(PAGE_H - y)} l S`);
  y += 16;

  for (const s of spec.sections) {
    if (s.heading) heading(s.heading);
    for (const p of s.paragraphs ?? []) paragraph(p, 11, F1, { gapAfter: 7 });
    for (const b of s.bullets ?? []) bullet(b);
    if (s.bullets?.length) y += 5;
    if (s.table) table(s.table);
  }

  if (spec.citations?.length) {
    ensure(60);
    heading("المصادر والمراجع");
    for (const [i, c] of spec.citations.entries()) bullet(`[${i + 1}] ${c}`);
  }

  // ── Footers (all pages, after the count is known) ──
  const totalPages = pages.length;
  pages.forEach((p, idx) => {
    p.ops.push(`${INK_SOFT.map(n2).join(" ")} rg`);
    const footerText = `ELBAZ Platform — صفحة ${idx + 1} من ${totalPages}`;
    const runs = bidiRuns(shapeLine(footerText), true);
    const totalW = runs.reduce((sum, r) => sum + runWidth(regular, r.cps, 8.5), 0);
    let x = (PAGE_W - totalW) / 2;
    for (const r of runs) {
      p.ops.push(textOp(F1, r.cps, x, 22, 8.5)); // 22pt above the bottom edge
      x += runWidth(regular, r.cps, 8.5);
    }
  });

  // ── Serialization ──
  const objects: string[] = []; // body strings, object number = index + 1
  const pushObj = (body: string) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Content streams first (each page needs its object number).
  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];
  for (const p of pages) {
    const stream = p.ops.join("\n");
    const compressed = deflateSync(Buffer.from(stream, "latin1"), { level: 6 });
    const b64 = Buffer.from(compressed).toString("binary");
    const num = pushObj(
      `<< /Length ${Buffer.byteLength(b64, "binary")} /Filter /FlateDecode >>\nstream\n${b64}\nendstream`,
    );
    contentObjNums.push(num);
  }

  // Font objects: Type0 → descendant CIDFontType2 → descriptor → file.
  const buildFontChain = (f: DrawFont, fileBytes: Uint8Array, baseName: string) => {
    const used = [...f.usedGids.entries()].sort((a, b) => a[0] - b[0]);

    const widths = used.filter(([gid]) => gid > 0);
    const wStr = widths.map(([gid]) => `${gid} [${Math.round((f.data.advances[gid] ?? 0))}]`).join(" ");

    const toUnicodeChars = widths
      .map(([gid, cps]) => {
        const dst = cps.map((cp) => toUnicodeFor(cp)).join("");
        const utf16 = [...dst].map((ch) => ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")).join("");
        return `<${gid.toString(16).padStart(4, "0")}> <${utf16}>`;
      })
      .join("\n");
    const toUnicodeCmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapName /${baseName}-Uni def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${widths.length ? `1 beginbfchar\n${toUnicodeChars}\nendbfchar` : ""}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
    const tuStream = deflateSync(Buffer.from(toUnicodeCmap, "utf8"));
    const tuB64 = Buffer.from(tuStream).toString("binary");

    const fileStream = deflateSync(Buffer.from(fileBytes));
    const fileB64 = Buffer.from(fileStream).toString("binary");

    const [x0, y0, x1, y1] = f.data.bbox;
    const fontFileNum = pushObj(
      `<< /Length ${Buffer.byteLength(fileB64, "binary")} /Filter /FlateDecode /Length1 ${fileBytes.length} >>\nstream\n${fileB64}\nendstream`,
    );
    const descriptorNum = pushObj(
      `<< /Type /FontDescriptor /FontName /${baseName} /Flags 4 /FontBBox [${x0} ${y0} ${x1} ${y1}] /ItalicAngle 0 /Ascent ${f.data.ascent} /Descent ${f.data.descent} /CapHeight ${f.data.capHeight} /StemV 80 /FontFile2 ${fontFileNum} 0 R >>`,
    );
    const descendantNum = pushObj(
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${baseName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptorNum} 0 R /W [ ${wStr} ] /DW 1000 /CIDToGIDMap /Identity >>`,
    );
    const toUnicodeNum = pushObj(
      `<< /Length ${Buffer.byteLength(tuB64, "binary")} /Filter /FlateDecode >>\nstream\n${tuB64}\nendstream`,
    );
    return pushObj(
      `<< /Type /Font /Subtype /Type0 /BaseFont /${baseName} /Encoding /Identity-H /DescendantFonts [ ${descendantNum} 0 R ] /ToUnicode ${toUnicodeNum} 0 R >>`,
    );
  };

  const f1Num = buildFontChain(F1, regularBytes, "DocGenSerif");
  const f2Num = buildFontChain(F2, boldBytes, "DocGenSerif-Bold");

  // Page objects — /Pages comes AFTER all page objects, so its number must
  // reserve slots for every page: content+fonts already pushed.
  const pagesNum = objects.length + pages.length + 1;
  for (let i = 0; i < pages.length; i++) {
    pageObjNums.push(
      pushObj(
        `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${n2(PAGE_W)} ${n2(PAGE_H)}] /Resources << /Font << /F1 ${f1Num} 0 R /F2 ${f2Num} 0 R >> >> /Contents ${contentObjNums[i]} 0 R >>`,
      ),
    );
  }
  const pagesObjNum = pushObj(
    `<< /Type /Pages /Kids [ ${pageObjNums.map((n) => `${n} 0 R`).join(" ")} ] /Count ${pages.length} >>`,
  );
  if (pagesObjNum !== pagesNum) throw new Error("docgen: object numbering desync");

  // UTF-16BE hex string — Arabic titles must not rely on PDFDocEncoding.
  const titleHex = [...spec.title.slice(0, 120)].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, "0")).join("");
  const infoNum = pushObj(
    `<< /Title <FEFF${titleHex}> /Producer (ELBAZ docgen v1) /Creator (ELBAZ Platform) /CreationDate (D:20260101000000Z) >>`,
  );
  const catalogNum = pushObj(`<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>`);

  // Assemble with xref — offsets computed over the exact byte stream.
  const header = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  let body = header;
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, "binary"));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, "binary");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${off.toString().padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(body, "binary"));
}
